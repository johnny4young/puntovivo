/**
 * Provider-invoice OCR (vision).
 *
 * Routes a base64-encoded invoice image through the tenant's configured
 * vision-capable AI provider and returns a structured invoice
 * projection. Reuses the existing `resolveAISettings` + budget
 * enforcement + `ai_audit_log` pipeline; this module is the vision
 * counterpart of `completeAI` in `client.ts`.
 *
 * Slice 1 () shipped the pipeline + Zod output schema.
 * Line-to-product mapping shipped in slice 1b. The 10-receipt
 * accuracy benchmark + mobile/tablet camera capture ship in slice 1d
 * () — see `scripts/benchmark-invoice-ocr.ts` and the
 * scoring helper in `./benchmark-scoring.ts`.
 *
 * @module services/ai/vision/invoice-ocr
 */
import {
  JSONParseError,
  NoObjectGeneratedError,
  TypeValidationError,
  generateObject,
  type LanguageModelUsage,
} from 'ai';
import type { ProviderOptions } from '@ai-sdk/provider-utils';
import { z } from 'zod';

import type { DatabaseInstance } from '../../../db/index.js';
import { throwServerError } from '../../../lib/errorCodes.js';

import { reserveAiBudget, settleAiBudget } from '../budget.js';
import { isDefinitiveProviderRejection } from '../provider-rejection.js';
import { toBillableTokenUsage } from '../client.js';
import { logProviderFailure } from '../provider-error.js';
import { getProvider } from '../providers/registry.js';
import type { AIProvider } from '../providers/types.js';
import { resolveAISettings } from '../client.js';

/** Supported upload MIME types for invoice OCR. */
export const INVOICE_OCR_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;
export type InvoiceOcrMimeType = (typeof INVOICE_OCR_MIME_TYPES)[number];

/**
 * 10 MB raw budget after base64 decode. Textract accepts larger PDFs,
 * but the product contract caps OCR uploads at 10 MB before a provider
 * sees the document.
 */
export const INVOICE_OCR_MAX_BYTES = 10 * 1024 * 1024;

const InvoiceOcrLineSchema = z.object({
  description: z.string().describe('Line item description as printed on the invoice.'),
  quantity: z.number().nullable().describe('Quantity column. Null if absent.'),
  unitPrice: z.number().nullable().describe('Unit price column. Null if absent.'),
  totalLine: z.number().nullable().describe('Line total. Null if absent.'),
});
export type InvoiceOcrLine = z.infer<typeof InvoiceOcrLineSchema>;

export const InvoiceOcrSchema = z.object({
  supplierName: z.string().nullable().describe('Supplier or vendor name printed on the invoice.'),
  supplierTaxId: z.string().nullable().describe('Supplier tax id (NIT, RUT, RFC, etc).'),
  invoiceNumber: z.string().nullable().describe('Invoice number / consecutive.'),
  invoiceDate: z
    .string()
    .nullable()
    .describe('Invoice date in ISO yyyy-mm-dd format, when readable.'),
  currencyCode: z
    .string()
    .nullable()
    .describe('Three-letter currency code; null when the invoice does not state one explicitly.'),
  lines: z.array(InvoiceOcrLineSchema),
  subtotal: z.number().nullable(),
  taxAmount: z.number().nullable(),
  total: z.number().nullable(),
});
export type InvoiceOcr = z.infer<typeof InvoiceOcrSchema>;

const EXTRACT_PROMPT_SYSTEM =
  'You extract structured purchase-invoice data for a Latin American retail point of sale. ' +
  'Read the supplied invoice photograph carefully. Return every line item you can read with confidence. ' +
  'Latin American number formatting matters: COP, CLP, ARS, PYG and similar zero-decimal currencies ' +
  'print prices with a DOT (or space) as the thousand separator and no fractional part — "1.950" means ' +
  'one thousand nine hundred fifty pesos, NOT one point nine five. ' +
  'In MXN, PEN, and USD the dot is a decimal mark. When the currency printed on the change is COP/CLP/' +
  'ARS/PYG, treat every dot/comma inside numeric prices as a thousand separator and return the integer ' +
  'value of the price in the local minor unit. ' +
  'Preserve all output values as plain numbers (no thousand separators in the output, dot as decimal). ' +
  'Use null for any field you cannot read with confidence rather than guessing.';

const EXTRACT_PROMPT_USER =
  'Extract the supplier metadata and the full line-item list from this purchase invoice photo. ' +
  'Return the result strictly matching the provided JSON schema.';

export interface InvoiceOcrInvocationContext {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string | null;
  userId: string | null;
  abortSignal?: AbortSignal | undefined;
}

export interface InvoiceOcrInput {
  /**
   * Raw base64-encoded image bytes WITHOUT the `data:image/...;base64,`
   * prefix. The tRPC schema strips the prefix client-side; the service
   * is strict about the payload shape so the byte-size budget check
   * stays predictable.
   */
  imageBase64: string;
  mimeType: InvoiceOcrMimeType;
}

export interface InvoiceOcrResult {
  invoice: InvoiceOcr;
  costUsd: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  provider: AIProvider['id'];
  model: string;
  auditLogId: string;
}

export type VisionProviderFactory = (id: AIProvider['id'] | null) => AIProvider;

// Vision-specific factory: returns the configured provider AS-IS so the
// downstream `visionModel` capability check can surface
// `AI_VISION_NOT_AVAILABLE` for stubs (Ollama today) instead of the
// generic `AI_PROVIDER_ERROR` that `defaultFactory` in client.ts emits.
const defaultVisionFactory: VisionProviderFactory = id => getProvider(id);

function decodedByteLength(base64: string): number {
  // RFC 4648 base64 inflates input by 4/3. Strip padding to compute the
  // raw byte count without allocating a Buffer.
  const stripped = base64.replace(/=+$/, '').length;
  return Math.floor((stripped * 3) / 4);
}

/**
 * Run an invoice OCR pass against the tenant's configured vision
 * provider. Throws via `throwServerError` for every gating failure
 * (`AI_DISABLED`, `AI_BUDGET_EXCEEDED`, `AI_PROVIDER_ERROR`,
 * `AI_VISION_NOT_AVAILABLE`, `AI_VISION_IMAGE_TOO_LARGE`,
 * `AI_VISION_PARSE_FAILED`); successful calls return the structured
 * invoice plus the audit-log row id.
 */
export async function extractInvoiceFromImage(
  ctx: InvoiceOcrInvocationContext,
  input: InvoiceOcrInput,
  factory: VisionProviderFactory = defaultVisionFactory
): Promise<InvoiceOcrResult> {
  if (input.imageBase64.length === 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_VISION_IMAGE_TOO_LARGE',
      message: 'Invoice image payload is empty',
    });
  }

  const rawBytes = decodedByteLength(input.imageBase64);
  if (rawBytes > INVOICE_OCR_MAX_BYTES) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_VISION_IMAGE_TOO_LARGE',
      message: `Invoice image exceeds the ${INVOICE_OCR_MAX_BYTES / (1024 * 1024)} MB limit`,
      details: { rawBytes, limitBytes: INVOICE_OCR_MAX_BYTES },
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

  // Capability check FIRST so an Ollama (or other stub) tenant gets
  // the documented AI_VISION_NOT_AVAILABLE rather than a generic
  // configured-or-not signal.
  const provider = factory(settings.providerId);
  if (typeof provider.visionModel !== 'function') {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_VISION_NOT_AVAILABLE',
      message: `Provider ${provider.id} does not support vision input`,
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

  const modelId = settings.modelId ?? provider.defaultModelId;
  // Preparation hooks run before dispatch: a failure here cannot have billed,
  // so it must not occupy the admission or record an unknown liability.
  let model: ReturnType<NonNullable<AIProvider['visionModel']>>;
  let providerOptions: ReturnType<AIProvider['cacheControlForSystemPrompt']>;
  try {
    model = provider.visionModel(modelId);
    providerOptions = provider.cacheControlForSystemPrompt();
  } catch (error) {
    logProviderFailure(error, {
      tenantId: ctx.tenantId,
      feature: 'invoiceOcr',
      providerId: provider.id,
      modelId,
      errorCode: 'AI_PROVIDER_ERROR',
    });
    throwServerError({
      trpcCode: 'BAD_GATEWAY',
      errorCode: 'AI_PROVIDER_ERROR',
      message: 'Vision provider call failed',
    });
  }
  // Ollama runs locally and cannot incur a remote charge: like the generic
  // completion kernel, its failures release the hold instead of retaining
  // a tenant-wide unknown liability for the rest of the month.
  const remoteCost = provider.id !== 'ollama';
  // The client signal is admission-only: it stops work before the budget is
  // reserved, but a dispatched extraction runs to its own deadline and
  // settles its known cost instead of becoming an unknown-cost liability.
  ctx.abortSignal?.throwIfAborted();
  const reservation = reserveAiBudget(ctx.db, ctx.tenantId);
  const startedAt = Date.now();
  const settleFailure = (
    errorCode: 'AI_VISION_PARSE_FAILED' | 'AI_PROVIDER_ERROR',
    notIncurred = false
  ) =>
    settleAiBudget(
      ctx.db,
      reservation,
      {
        tenantId: ctx.tenantId,
        siteId: ctx.siteId,
        userId: ctx.userId,
        feature: 'invoiceOcr',
        providerId: provider.id,
        modelId,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0,
        costState: !remoteCost ? 'local_zero' : notIncurred ? 'not_incurred' : 'unknown',
        durationMs: Date.now() - startedAt,
        errorCode,
      },
      remoteCost && !notIncurred
    );

  const isKnownCount = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0;
  /** Priced cost of complete, non-empty remote usage; null when unusable. */
  const priceUsage = (usage: LanguageModelUsage | undefined): number | null => {
    if (
      !usage ||
      !isKnownCount(usage.inputTokens) ||
      !isKnownCount(usage.outputTokens) ||
      usage.inputTokens + usage.outputTokens === 0
    ) {
      return null;
    }
    let cost: number;
    try {
      cost = provider.pricing.calculateCostUsd(modelId, toBillableTokenUsage(usage));
    } catch {
      return null;
    }
    return Number.isFinite(cost) && cost >= 0 ? cost : null;
  };

  let result;
  try {
    result = await generateObject({
      model,
      instructions: EXTRACT_PROMPT_SYSTEM,
      schema: InvoiceOcrSchema,
      abortSignal: AbortSignal.timeout(60_000),
      // Retrying may bill twice after an ambiguous provider response.
      maxRetries: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: EXTRACT_PROMPT_USER },
            {
              type: 'file',
              data: input.imageBase64,
              mediaType: input.mimeType,
            },
          ],
        },
      ],
      ...(providerOptions !== undefined
        ? { providerOptions: providerOptions as ProviderOptions }
        : {}),
    });
  } catch (error) {
    // Identify schema-validation failures by SDK error class rather
    // than substring matching, which would misclassify provider HTTP
    // 4xx bodies containing the words "validation" / "parse" / etc as
    // parse failures and tell the operator to retake the photo when
    // the real cause is an API-key issue. NoObjectGeneratedError +
    // TypeValidationError + JSONParseError cover the three SDK paths
    // that surface a malformed model response; ZodError covers Zod
    // refinements run inside the schema.
    const isSchemaFailure =
      NoObjectGeneratedError.isInstance(error) ||
      error instanceof TypeValidationError ||
      error instanceof JSONParseError ||
      error instanceof z.ZodError ||
      // Fallback for SDK versions that surface a schema failure as a
      // plain Error wrapping one of the above by toString. Narrow to
      // exact phrasings so transport errors do not get misclassified.
      (error instanceof Error && /No object generated/i.test(error.message));

    const errorCode = isSchemaFailure ? 'AI_VISION_PARSE_FAILED' : 'AI_PROVIDER_ERROR';
    logProviderFailure(error, {
      tenantId: ctx.tenantId,
      feature: 'invoiceOcr',
      providerId: provider.id,
      modelId,
      errorCode,
    });

    // A schema failure still consumed priced tokens: book them when the SDK
    // reports usage. A pre-inference rejection (4xx) or a connection never
    // established billed nothing. Anything else may have been billed.
    const parseUsage =
      isSchemaFailure && NoObjectGeneratedError.isInstance(error) ? error.usage : undefined;
    const parseCost = remoteCost ? priceUsage(parseUsage) : null;
    if (parseCost !== null && parseUsage) {
      settleAiBudget(
        ctx.db,
        reservation,
        {
          tenantId: ctx.tenantId,
          siteId: ctx.siteId,
          userId: ctx.userId,
          feature: 'invoiceOcr',
          providerId: provider.id,
          modelId,
          inputTokens: parseUsage.inputTokens ?? 0,
          outputTokens: parseUsage.outputTokens ?? 0,
          cacheReadTokens: parseUsage.inputTokenDetails?.cacheReadTokens ?? 0,
          cacheWriteTokens: parseUsage.inputTokenDetails?.cacheWriteTokens ?? 0,
          costUsd: parseCost,
          costState: 'estimated',
          durationMs: Date.now() - startedAt,
          errorCode,
        },
        false
      );
    } else {
      settleFailure(errorCode, isDefinitiveProviderRejection(error));
    }

    throwServerError({
      trpcCode: isSchemaFailure ? 'BAD_REQUEST' : 'BAD_GATEWAY',
      errorCode,
      message: isSchemaFailure ? 'Invoice could not be parsed' : 'Vision provider call failed',
    });
  }

  const usage = result.usage;
  const rawInputTokens = usage?.inputTokens;
  const rawOutputTokens = usage?.outputTokens;
  const inputTokens = isKnownCount(rawInputTokens) ? rawInputTokens : 0;
  const outputTokens = isKnownCount(rawOutputTokens) ? rawOutputTokens : 0;
  // A remote response without complete usage cannot be priced. Keep the
  // admission hold instead of recording a misleading zero-dollar success.
  // Local Ollama usage is informational only; its cost is zero regardless.
  if (
    remoteCost &&
    (!isKnownCount(rawInputTokens) ||
      !isKnownCount(rawOutputTokens) ||
      inputTokens + outputTokens === 0)
  ) {
    settleFailure('AI_PROVIDER_ERROR');
    throwServerError({
      trpcCode: 'BAD_GATEWAY',
      errorCode: 'AI_PROVIDER_ERROR',
      message: 'Vision provider returned missing or invalid token usage',
    });
  }

  const cacheReadTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const cacheWriteTokens = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
  let costUsd: number;
  try {
    costUsd = provider.pricing.calculateCostUsd(modelId, toBillableTokenUsage(usage));
  } catch {
    costUsd = Number.NaN;
  }
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    settleFailure('AI_PROVIDER_ERROR');
    throwServerError({
      trpcCode: 'BAD_GATEWAY',
      errorCode: 'AI_PROVIDER_ERROR',
      message: 'Vision provider returned unpriceable token usage',
    });
  }

  const durationMs = Date.now() - startedAt;
  const { id: auditLogId } = settleAiBudget(
    ctx.db,
    reservation,
    {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      userId: ctx.userId,
      feature: 'invoiceOcr',
      providerId: provider.id,
      modelId,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      costUsd,
      costState: remoteCost ? 'estimated' : 'local_zero',
      durationMs,
      errorCode: null,
    },
    false
  );

  return {
    invoice: result.object,
    costUsd,
    durationMs,
    inputTokens,
    outputTokens,
    provider: provider.id,
    model: modelId,
    auditLogId,
  };
}
