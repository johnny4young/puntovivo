/**
 * ENG-040c slice 1 — `ai.transcribeAudio` integration tests.
 *
 * Drives the procedure via `createCaller` against an in-memory
 * database. The AI SDK `experimental_transcribe` is mocked so no real
 * network round-trip is needed; the OpenAI provider's
 * `transcriptionModel` factory is stubbed to advertise the capability
 * without an `OPENAI_API_KEY` env var. The audit-log row, capability
 * gating, budget gating, and cross-tenant isolation paths are pinned
 * here — the cart-command parser + audio-capture UI land in
 * follow-up slices.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';
import type { TranscriptionModelV3 } from '@ai-sdk/provider';

const transcribeMock = vi.fn();

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    experimental_transcribe: (...args: unknown[]) => transcribeMock(...args),
  };
});

// Stub the OpenAI provider's `transcriptionModel` + `isConfigured` so
// `transcribeAudio` resolves it without an `OPENAI_API_KEY`. The
// returned model object is opaque — the mocked `experimental_transcribe`
// ignores it.
vi.mock('../services/ai/providers/openai.js', async () => {
  const actual = await vi.importActual<typeof import('../services/ai/providers/openai.js')>(
    '../services/ai/providers/openai.js'
  );
  return {
    ...actual,
    openaiProvider: {
      ...actual.openaiProvider,
      isConfigured: () => true,
      transcriptionModel: (_modelId: string) => ({}) as TranscriptionModelV3,
    },
  };
});

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { aiAuditLog, tenants, users } from '../db/schema.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;

function createCtx(opts: {
  tenantId: string;
  userId: string;
  role: 'admin' | 'cashier' | 'manager';
  siteId?: string | null;
}): Context {
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: {},
      user: {
        userId: opts.userId,
        email: 'context@example.com',
        role: opts.role,
        tenantId: opts.tenantId,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: {
      id: opts.userId,
      email: 'context@example.com',
      role: opts.role,
      tenantId: opts.tenantId,
    },
    tenantId: opts.tenantId,
    siteId: opts.siteId ?? null,
  };
}

async function seedTenant(
  suffix: string,
  options: { aiEnabled?: boolean; providerId?: 'openai' | 'anthropic' | 'ollama' } = {}
): Promise<{ tenantId: string; adminId: string; managerId: string; cashierId: string }> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `voice-${suffix}-${nanoid(4)}`;
  await db.insert(tenants).values({
    id: tenantId,
    name: `Voice Tenant ${suffix}`,
    slug: `voice-${suffix}-${nanoid(6)}`,
    settings: options.aiEnabled
      ? {
          ai: {
            enabled: true,
            monthlyBudgetUsd: 100,
            providerId: options.providerId ?? 'openai',
            modelId: null,
          },
        }
      : {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const adminId = nanoid();
  const managerId = nanoid();
  const cashierId = nanoid();
  const passwordHash = await hash('VoicePass123!');
  await db.insert(users).values([
    {
      id: adminId,
      tenantId,
      email: `admin-${tenantId}@example.com`,
      passwordHash,
      name: 'Voice Admin',
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: managerId,
      tenantId,
      email: `manager-${tenantId}@example.com`,
      passwordHash,
      name: 'Voice Manager',
      role: 'manager',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: cashierId,
      tenantId,
      email: `cashier-${tenantId}@example.com`,
      passwordHash,
      name: 'Voice Cashier',
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return { tenantId, adminId, managerId, cashierId };
}

/**
 * Build a base64 string of approximately `targetBytes` decoded bytes.
 * Mirrors the helper in `ai-vision.test.ts`; doesn't need to be
 * decodeable into real audio because the mocked `experimental_transcribe`
 * never inspects the buffer.
 */
function base64OfDecodedBytes(targetBytes: number): string {
  const base64Len = Math.ceil(targetBytes * (4 / 3));
  const padded = base64Len + ((4 - (base64Len % 4)) % 4);
  return 'A'.repeat(padded);
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  if (server) await server.close();
});

beforeEach(() => {
  transcribeMock.mockReset();
});

describe('ai.transcribeAudio (ENG-040c slice 1)', () => {
  it('returns transcript + language + writes a single audit row on the happy path', async () => {
    const { tenantId, managerId } = await seedTenant('happy', { aiEnabled: true });

    transcribeMock.mockResolvedValue({
      text: 'agrega dos cocas y un pan',
      language: 'es',
      durationInSeconds: 4.2,
      segments: [],
      warnings: [],
      responses: [],
      providerMetadata: {},
    });

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: managerId, role: 'manager' })
    );

    const result = await caller.ai.transcribeAudio({
      audioBase64: base64OfDecodedBytes(1024),
      mimeType: 'audio/webm',
    });

    expect(result.transcript).toBe('agrega dos cocas y un pan');
    expect(result.language).toBe('es');
    expect(result.audioDurationSeconds).toBeCloseTo(4.2, 4);
    expect(result.provider).toBe('openai');
    expect(result.model).toBe('whisper-1');
    // 4.2s of whisper-1 → 4.2/60 * 0.006 ≈ 0.00042.
    expect(result.costUsd).toBeCloseTo((4.2 / 60) * 0.006, 8);

    const audit = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.tenantId, tenantId))
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.feature).toBe('voiceTranscribe');
    expect(audit[0]?.providerId).toBe('openai');
    expect(audit[0]?.modelId).toBe('whisper-1');
    // input_tokens overloaded to carry rounded audio seconds.
    expect(audit[0]?.inputTokens).toBe(4);
    expect(audit[0]?.outputTokens).toBe(0);
    expect(audit[0]?.errorCode).toBeNull();
  });

  it('throws AI_DISABLED + skips the transcribe call when AI is off', async () => {
    const { tenantId, managerId } = await seedTenant('disabled', { aiEnabled: false });

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: managerId, role: 'manager' })
    );
    let caught: unknown;
    try {
      await caller.ai.transcribeAudio({
        audioBase64: base64OfDecodedBytes(1024),
        mimeType: 'audio/webm',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    expect((cause as ServerErrorWithCode).errorCode).toBe('AI_DISABLED');
    expect(transcribeMock).not.toHaveBeenCalled();

    const audit = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.tenantId, tenantId))
      .all();
    expect(audit).toHaveLength(0);
  });

  it('throws AI_VOICE_NOT_AVAILABLE when the provider lacks transcriptionModel', async () => {
    const { tenantId, managerId } = await seedTenant('no-transcribe', {
      aiEnabled: true,
      providerId: 'anthropic',
    });

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: managerId, role: 'manager' })
    );
    let caught: unknown;
    try {
      await caller.ai.transcribeAudio({
        audioBase64: base64OfDecodedBytes(1024),
        mimeType: 'audio/webm',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    expect((cause as ServerErrorWithCode).errorCode).toBe('AI_VOICE_NOT_AVAILABLE');
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('throws AI_VOICE_AUDIO_TOO_LARGE when the decoded payload exceeds the limit', async () => {
    const { tenantId, managerId } = await seedTenant('oversize', { aiEnabled: true });

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: managerId, role: 'manager' })
    );
    // Just over the service-layer 10 MB cap but well under the Zod
    // transport ceiling (which clamps at ~14.7 MB raw). Pinning the
    // service-side guard, not the Zod refinement.
    const oversize = base64OfDecodedBytes(10 * 1024 * 1024 + 1024);
    let caught: unknown;
    try {
      await caller.ai.transcribeAudio({
        audioBase64: oversize,
        mimeType: 'audio/webm',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    expect((cause as ServerErrorWithCode).errorCode).toBe('AI_VOICE_AUDIO_TOO_LARGE');
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('writes an AI_VOICE_PARSE_FAILED audit row when the SDK throws NoTranscriptGeneratedError', async () => {
    const { tenantId, managerId } = await seedTenant('parse-fail', { aiEnabled: true });

    // Plain Error matching the substring fallback the service narrows
    // on. Avoids constructing the typed `NoTranscriptGeneratedError`
    // which has a private constructor in some SDK versions.
    transcribeMock.mockRejectedValue(new Error('No transcript generated from the provider'));

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: managerId, role: 'manager' })
    );
    let caught: unknown;
    try {
      await caller.ai.transcribeAudio({
        audioBase64: base64OfDecodedBytes(1024),
        mimeType: 'audio/webm',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause;
    expect((cause as ServerErrorWithCode).errorCode).toBe('AI_VOICE_PARSE_FAILED');

    const audit = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.tenantId, tenantId))
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.errorCode).toBe('AI_VOICE_PARSE_FAILED');
    expect(audit[0]?.costUsd).toBe(0);
  });

  it('throws AI_BUDGET_EXCEEDED before invoking the provider', async () => {
    const { tenantId, managerId } = await seedTenant('budget', { aiEnabled: true });
    // Drop the budget to a fraction of a cent so the first call exhausts it.
    const db = getDatabase();
    const row = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .get();
    const settings = (row?.settings as Record<string, unknown>) ?? {};
    await db
      .update(tenants)
      .set({
        settings: { ...settings, ai: { ...(settings.ai as object), monthlyBudgetUsd: 0 } },
      })
      .where(eq(tenants.id, tenantId));

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: managerId, role: 'manager' })
    );
    let caught: unknown;
    try {
      await caller.ai.transcribeAudio({
        audioBase64: base64OfDecodedBytes(1024),
        mimeType: 'audio/webm',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause;
    expect((cause as ServerErrorWithCode).errorCode).toBe('AI_BUDGET_EXCEEDED');
    expect(transcribeMock).not.toHaveBeenCalled();
  });

  it('allows cashier callers (ENG-040c slice 3 widened the gate)', async () => {
    const { tenantId, cashierId } = await seedTenant('cashier-allowed', { aiEnabled: true });

    transcribeMock.mockResolvedValue({
      text: 'agrega una coca',
      language: 'es',
      durationInSeconds: 2,
      segments: [],
      warnings: [],
      responses: [],
      providerMetadata: {},
    });

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: cashierId, role: 'cashier' })
    );
    const result = await caller.ai.transcribeAudio({
      audioBase64: base64OfDecodedBytes(1024),
      mimeType: 'audio/webm',
    });
    expect(result.transcript).toBe('agrega una coca');

    const audit = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.tenantId, tenantId))
      .all();
    expect(audit).toHaveLength(1);
    // The audit row carries the cashier user id so the operator can
    // attribute calls when budget telemetry surfaces them.
    expect(audit[0]?.userId).toBe(cashierId);
  });

  it('ignores tenant settings.modelId (language model override) and stays on the transcription default', async () => {
    const { tenantId, managerId } = await seedTenant('lang-override', { aiEnabled: true });
    // Set a language-model override that is NOT a valid Whisper model.
    // A naive `settings.modelId ?? defaultTranscriptionModelId` would
    // push `gpt-4.1` into `openai.transcription(...)` and crash. The
    // pipeline must skip this field for transcription.
    const db = getDatabase();
    const row = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .get();
    const settings = (row?.settings as Record<string, unknown>) ?? {};
    await db
      .update(tenants)
      .set({
        settings: { ...settings, ai: { ...(settings.ai as object), modelId: 'gpt-4.1' } },
      })
      .where(eq(tenants.id, tenantId));

    transcribeMock.mockResolvedValue({
      text: 'hola mundo',
      language: 'es',
      durationInSeconds: 2,
      segments: [],
      warnings: [],
      responses: [],
      providerMetadata: {},
    });

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: managerId, role: 'manager' })
    );
    const result = await caller.ai.transcribeAudio({
      audioBase64: base64OfDecodedBytes(1024),
      mimeType: 'audio/webm',
    });

    expect(result.model).toBe('whisper-1');
    const audit = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.tenantId, tenantId))
      .all();
    expect(audit[0]?.modelId).toBe('whisper-1');
  });

  it('isolates audit rows per tenant', async () => {
    const { tenantId: tenantA, managerId: managerA } = await seedTenant('iso-a', {
      aiEnabled: true,
    });
    const { tenantId: tenantB, managerId: managerB } = await seedTenant('iso-b', {
      aiEnabled: true,
    });

    transcribeMock.mockResolvedValue({
      text: 'hola',
      language: 'es',
      durationInSeconds: 1.5,
      segments: [],
      warnings: [],
      responses: [],
      providerMetadata: {},
    });

    const callerA = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: managerA, role: 'manager' })
    );
    await callerA.ai.transcribeAudio({
      audioBase64: base64OfDecodedBytes(1024),
      mimeType: 'audio/webm',
    });

    const callerB = appRouter.createCaller(
      createCtx({ tenantId: tenantB, userId: managerB, role: 'manager' })
    );
    await callerB.ai.transcribeAudio({
      audioBase64: base64OfDecodedBytes(1024),
      mimeType: 'audio/webm',
    });

    const auditA = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.tenantId, tenantA))
      .all();
    const auditB = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.tenantId, tenantB))
      .all();
    expect(auditA).toHaveLength(1);
    expect(auditB).toHaveLength(1);
    expect(auditA[0]?.tenantId).toBe(tenantA);
    expect(auditB[0]?.tenantId).toBe(tenantB);
  });
});
