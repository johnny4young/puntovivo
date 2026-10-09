/**
 * slice 1 — Whisper-style audio transcription.
 *
 * Routes a base64-encoded audio clip through the tenant's configured
 * transcription-capable AI provider and returns the transcript text +
 * detected language. Reuses the existing `resolveAISettings` + budget
 * enforcement + `ai_audit_log` pipeline; this module is the voice
 * counterpart of `extractInvoiceFromImage` in `vision/invoice-ocr.ts`.
 *
 * Slice 1 ships the pipeline + tRPC mutation. Audio capture UI + the
 * `transcript → cart command` parser land as  slice 2 / 3.
 *
 * @module services/ai/voice/transcribe
 */
import type { TranscriptionModelV4 } from '@ai-sdk/provider';
import { NoTranscriptGeneratedError, transcribe } from 'ai';

import type { DatabaseInstance } from '../../../db/index.js';
import { throwServerError } from '../../../lib/errorCodes.js';

import { reserveAiBudget } from '../budget.js';
import { isDefinitiveProviderRejection } from '../provider-rejection.js';
import { logProviderFailure } from '../provider-error.js';
import { getProvider } from '../providers/registry.js';
import type { AIProvider } from '../providers/types.js';
import { resolveAISettings, settleCompletion } from '../client.js';

/** Supported audio MIME types — covers MediaRecorder outputs across
 * Chrome / Firefox / Safari plus the common upload mime types Whisper
 * accepts (mp3, mp4, mpeg, mpga, m4a, wav, webm). */
export const VOICE_TRANSCRIBE_MIME_TYPES = [
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/m4a',
  'audio/ogg',
  'audio/x-m4a',
] as const;
export type VoiceTranscribeMimeType = (typeof VOICE_TRANSCRIBE_MIME_TYPES)[number];

/**
 * 10 MB raw budget after base64 decode. Whisper's hard limit is 25 MB,
 * but bounding tenant-side keeps budget burn predictable for the
 * cart-command surface (a 60s webm-opus clip is ~600 KB) and matches
 * the shape of `INVOICE_OCR_MAX_BYTES`.
 */
export const VOICE_TRANSCRIBE_MAX_BYTES = 10 * 1024 * 1024;

export interface VoiceTranscribeInvocationContext {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string | null;
  userId: string | null;
  /**
   * Request cancellation (e.g. the HTTP client disconnected). Admission-only:
   * it stops work before the budget is reserved, but never cancels a
   * transcription already dispatched to the provider.
   */
  abortSignal?: AbortSignal;
}

export interface VoiceTranscribeInput {
  /**
   * Raw base64-encoded audio bytes WITHOUT the
   * `data:audio/...;base64,` prefix. The Zod input schema strips the
   * prefix client-side so the byte-size budget stays predictable.
   */
  audioBase64: string;
  mimeType: VoiceTranscribeMimeType;
}

export interface VoiceTranscribeResult {
  transcript: string;
  /** ISO-639-1 language code if Whisper detected one (e.g. 'es', 'en'). */
  language: string | null;
  /** Audio duration reported by the provider (seconds). */
  audioDurationSeconds: number;
  costUsd: number;
  durationMs: number;
  provider: AIProvider['id'];
  model: string;
  auditLogId: string;
}

export type VoiceProviderFactory = (id: AIProvider['id'] | null) => AIProvider;

/** Voice-specific factory: returns the configured provider AS-IS so
 * the capability check in `transcribeAudio` can surface
 * `AI_VOICE_NOT_AVAILABLE` for stubs (Anthropic + Ollama) instead of
 * the generic `AI_PROVIDER_ERROR` that `defaultFactory` in client.ts
 * emits. */
const defaultVoiceFactory: VoiceProviderFactory = id => getProvider(id);

function decodedByteLength(base64: string): number {
  // RFC 4648 base64 inflates input by 4/3. Strip padding to compute
  // the raw byte count without allocating a Buffer.
  const stripped = base64.replace(/=+$/, '').length;
  return Math.floor((stripped * 3) / 4);
}

/**
 * Run a transcription pass against the tenant's configured voice
 * provider. Throws via `throwServerError` for every gating failure
 * (`AI_DISABLED`, `AI_BUDGET_EXCEEDED`, `AI_PROVIDER_ERROR`,
 * `AI_VOICE_NOT_AVAILABLE`, `AI_VOICE_AUDIO_TOO_LARGE`,
 * `AI_VOICE_PARSE_FAILED`); successful calls return the transcript
 * plus the audit-log row id.
 */
export async function transcribeAudio(
  ctx: VoiceTranscribeInvocationContext,
  input: VoiceTranscribeInput,
  factory: VoiceProviderFactory = defaultVoiceFactory
): Promise<VoiceTranscribeResult> {
  if (input.audioBase64.length === 0) {
    // Defense-in-depth: the tRPC schema already rejects an empty
    // string at `audioBase64.min(1)`, so this branch only fires when
    // a future internal caller invokes `transcribeAudio` directly
    // without the Zod transport. The error code stays as
    // `AI_VOICE_AUDIO_TOO_LARGE` to mirror the vision slice's
    // empty-image guard (`AI_VISION_IMAGE_TOO_LARGE`) — fixing the
    // semantic mismatch on both slices is a separate scope.
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_VOICE_AUDIO_TOO_LARGE',
      message: 'Audio payload is empty',
    });
  }

  const rawBytes = decodedByteLength(input.audioBase64);
  if (rawBytes > VOICE_TRANSCRIBE_MAX_BYTES) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_VOICE_AUDIO_TOO_LARGE',
      message: `Audio payload exceeds the ${VOICE_TRANSCRIBE_MAX_BYTES / (1024 * 1024)} MB limit`,
      details: { rawBytes, limitBytes: VOICE_TRANSCRIBE_MAX_BYTES },
    });
  }

  const settings = await resolveAISettings(ctx.db, ctx.tenantId);
  if (!settings.enabled) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_DISABLED',
      message: 'AI features are disabled for this tenant',
    });
  }

  // Capability check FIRST so an Anthropic / Ollama tenant gets the
  // documented AI_VOICE_NOT_AVAILABLE rather than a generic
  // configured-or-not signal.
  const provider = factory(settings.providerId);
  if (typeof provider.transcriptionModel !== 'function') {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_VOICE_NOT_AVAILABLE',
      message: `Provider ${provider.id} does not support audio transcription`,
    });
  }

  if (!provider.isConfigured()) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_PROVIDER_ERROR',
      message: `Provider ${provider.id} is not configured (set the API key env var)`,
    });
  }

  if (settings.monthlyBudgetUsd <= 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_BUDGET_EXCEEDED',
      message: 'AI monthly budget is zero',
    });
  }

  // The tenant `settings.modelId` is the operator's per-tenant
  // LANGUAGE / vision model override (e.g. `gpt-4.1`, `gpt-4o`). It
  // belongs to a different model namespace than Whisper / GPT-4o-
  // Transcribe — pushing a language model id into
  // `openai.transcription(...)` would surface as a provider 4xx. The
  // transcription path stays on `provider.defaultTranscriptionModelId`
  // until a separate `settings.transcriptionModelId` ships (captured
  // as a slice 2 follow-up).
  const modelId = provider.defaultTranscriptionModelId ?? provider.defaultModelId;
  const audioBuffer = Buffer.from(input.audioBase64, 'base64');
  // Preparation runs before dispatch: sanitize its failure without reserving.
  let baseModel: TranscriptionModelV4;
  try {
    baseModel = provider.transcriptionModel(modelId);
  } catch {
    throwServerError({
      trpcCode: 'BAD_GATEWAY',
      errorCode: 'AI_PROVIDER_ERROR',
      message: 'Voice provider call failed',
    });
  }
  // Record the provider-reported audio duration even when the SDK then
  // rejects an empty transcript (NoTranscriptGeneratedError): the audio was
  // processed and billed per minute, so its cost is known, not unknown.
  let reportedDurationSeconds: number | undefined;
  const model: TranscriptionModelV4 = {
    specificationVersion: baseModel.specificationVersion,
    provider: baseModel.provider,
    modelId: baseModel.modelId,
    doGenerate: async options => {
      const generated = await baseModel.doGenerate(options);
      reportedDurationSeconds = generated.durationInSeconds;
      return generated;
    },
  };
  // Price only the model actually dispatched: borrowing another model's rate
  // would misstate the estimate, and an unpriced model settles as unknown.
  const pricingRow = provider.transcriptionPricing?.[modelId];
  const priceAudio = (seconds: unknown): number | null => {
    const perMinuteUsd = pricingRow?.perMinuteUsd;
    if (
      typeof seconds !== 'number' ||
      !Number.isFinite(seconds) ||
      seconds <= 0 ||
      typeof perMinuteUsd !== 'number' ||
      !Number.isFinite(perMinuteUsd) ||
      perMinuteUsd <= 0
    ) {
      return null;
    }
    const cost = (seconds / 60) * perMinuteUsd;
    return Number.isFinite(cost) && cost >= 0 ? cost : null;
  };
  // The client signal is admission-only: it stops work before the budget is
  // reserved, but a dispatched transcription runs to this deadline and
  // settles its known cost instead of becoming an unknown-cost liability.
  ctx.abortSignal?.throwIfAborted();
  const reservation = reserveAiBudget(ctx.db, ctx.tenantId);
  const startedAt = Date.now();
  const settle = (
    costState: 'estimated' | 'unknown' | 'not_incurred',
    costUsd: number,
    audioSeconds: unknown,
    errorCode: 'AI_VOICE_PARSE_FAILED' | 'AI_PROVIDER_ERROR' | null
  ) =>
    settleCompletion(
      ctx.db,
      reservation,
      {
        tenantId: ctx.tenantId,
        siteId: ctx.siteId,
        userId: ctx.userId,
        feature: 'voiceTranscribe',
        providerId: provider.id,
        modelId,
        // The audit schema stores rounded audio seconds in input_tokens until
        // a typed audio-duration column exists. A reported duration is kept
        // even on an unknown-cost row as evidence for reconciliation.
        inputTokens:
          typeof audioSeconds === 'number' && Number.isFinite(audioSeconds) && audioSeconds >= 0
            ? Math.round(audioSeconds)
            : 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd,
        costState,
        durationMs: Date.now() - startedAt,
        errorCode,
      },
      costState === 'unknown'
    );

  let result;
  try {
    result = await transcribe({
      model,
      audio: audioBuffer,
      abortSignal: AbortSignal.timeout(60_000),
      // Retry may bill twice even when the first response was lost.
      maxRetries: 0,
    });
  } catch (error) {
    const isParseFailure =
      NoTranscriptGeneratedError.isInstance(error) ||
      (error instanceof Error && /No transcript generated/i.test(error.message));
    const errorCode = isParseFailure ? 'AI_VOICE_PARSE_FAILED' : 'AI_PROVIDER_ERROR';
    const parsedAudioCost = isParseFailure ? priceAudio(reportedDurationSeconds) : null;
    logProviderFailure(error, {
      tenantId: ctx.tenantId,
      feature: 'voiceTranscribe',
      providerId: provider.id,
      modelId,
      errorCode,
    });

    if (parsedAudioCost !== null) {
      // Audio was processed without speech: billed, known cost.
      settle('estimated', parsedAudioCost, reportedDurationSeconds, errorCode);
    } else if (isDefinitiveProviderRejection(error)) {
      // A pre-inference rejection or a connection never established: no audio
      // was processed, so nothing was billed.
      settle('not_incurred', 0, 0, errorCode);
    } else {
      // The SDK may have sent the request before failure or our deadline.
      // Preserve the unknown invoice liability rather than allowing a free retry.
      settle('unknown', 0, reportedDurationSeconds, errorCode);
    }

    throwServerError({
      trpcCode: isParseFailure ? 'BAD_REQUEST' : 'BAD_GATEWAY',
      errorCode,
      // Provider error text is untrusted and can echo request data (#291).
      message: isParseFailure
        ? 'Voice transcription could not be parsed'
        : 'Voice provider call failed',
    });
  }

  const transcript = result.text;
  const language = result.language ?? null;
  const audioDurationSeconds = result.durationInSeconds;
  const costUsd = priceAudio(audioDurationSeconds);
  const durationMs = Date.now() - startedAt;

  // A transcript without duration or a usable price cannot establish a
  // monetary estimate. Keep the reservation for invoice reconciliation.
  if (costUsd === null || typeof audioDurationSeconds !== 'number') {
    settle('unknown', 0, audioDurationSeconds, 'AI_PROVIDER_ERROR');
    throwServerError({
      trpcCode: 'BAD_GATEWAY',
      errorCode: 'AI_PROVIDER_ERROR',
      message: 'Voice provider returned unpriceable audio duration',
    });
  }

  const { id: auditLogId } = settle('estimated', costUsd, audioDurationSeconds, null);

  return {
    transcript,
    language,
    audioDurationSeconds,
    costUsd,
    durationMs,
    provider: provider.id,
    model: modelId,
    auditLogId,
  };
}
