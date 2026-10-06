import { expectNoPublicDiagnostic } from '../../__tests__/utils/ai-error-privacy.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';
import { eq, sql } from 'drizzle-orm';
import { MockLanguageModelV4, mockId } from 'ai/test';
import { APICallError, simulateReadableStream } from 'ai';

import { ServerErrorWithCode } from '../../lib/errorCodes.js';
import { createServer, type PuntovivoServer } from '../../index.js';
import { getDatabase } from '../../db/index.js';
import {
  aiAuditLog,
  aiBudgetReservations,
  companies,
  sites,
  tenants,
  users,
} from '../../db/schema.js';

import { completeAI, resolveAISettings, writeAISettings } from './client.js';
import { reserveAiBudget } from './budget.js';
import type { AIProvider } from './providers/types.js';

let server: PuntovivoServer;
let tenantId: string;
let tenantOther: string;
let userId: string;
let siteId: string;

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const now = new Date().toISOString();

  tenantId = nanoid();
  tenantOther = nanoid();
  await db.insert(tenants).values([
    {
      id: tenantId,
      name: 'AI Tenant',
      slug: `ai-tenant-${nanoid(6)}`,
      settings: {},
      createdAt: now,
      updatedAt: now,
    },
    {
      id: tenantOther,
      name: 'Other Tenant',
      slug: `other-tenant-${nanoid(6)}`,
      settings: {},
      createdAt: now,
      updatedAt: now,
    },
  ]);

  userId = nanoid();
  await db.insert(users).values({
    id: userId,
    tenantId,
    email: 'ai-admin@example.com',
    passwordHash: await hash('AIPass123!'),
    name: 'AI Admin',
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  const companyId = nanoid();
  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: 'AI Co',
    createdAt: now,
    updatedAt: now,
  });

  siteId = nanoid();
  await db.insert(sites).values({
    id: siteId,
    tenantId,
    companyId,
    name: 'Main Site',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(async () => {
  if (server) await server.close();
});

beforeEach(async () => {
  const db = getDatabase();
  await db.delete(aiBudgetReservations).run();
  await db.delete(aiAuditLog).run();
  await db.update(tenants).set({ settings: {} }).where(eq(tenants.id, tenantId));
});

const baseInput = {
  feature: 'completeTest' as const,
  prompt: 'ping',
};

function buildMockProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  const base: AIProvider = {
    id: 'anthropic',
    defaultModelId: 'claude-haiku-4-5',
    pricing: {
      models: {
        'claude-haiku-4-5': {
          input: 3,
          output: 15,
          cacheRead: 0.3,
          cacheWrite: 3.75,
        },
      },
      calculateCostUsd: (modelId, usage) => {
        const row = base.pricing.models[modelId];
        if (!row) return 0;
        return (
          (usage.inputTokens / 1_000_000) * row.input +
          (usage.outputTokens / 1_000_000) * row.output
        );
      },
    },
    isConfigured: () => true,
    languageModel: () =>
      new MockLanguageModelV4({
        provider: 'anthropic',
        modelId: 'claude-haiku-4-5',
        doGenerate: async () => ({
          content: [{ type: 'text', text: 'pong' }],
          finishReason: 'stop',
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5 },
          },
          warnings: [],
        }),
        doStream: async () => ({
          stream: simulateReadableStream({
            chunks: [
              { type: 'text-delta', id: mockId(), delta: 'pong' },
              {
                type: 'finish',
                finishReason: 'stop',
                usage: {
                  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 5 },
                },
              },
            ],
          }),
        }),
      }),
    cacheControlForSystemPrompt: () => ({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    }),
  };
  return { ...base, ...overrides };
}

function apiError(statusCode: number): APICallError {
  return new APICallError({
    message: `provider answered ${statusCode}`,
    url: 'https://provider.invalid/v1/messages',
    requestBodyValues: {},
    statusCode,
    responseBody: '{}',
    isRetryable: false,
  });
}

async function expectThrow(promise: Promise<unknown>, errorCode: string): Promise<TRPCError> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(TRPCError);
  const cause = (caught as TRPCError).cause;
  expect(cause).toBeInstanceOf(ServerErrorWithCode);
  expect((cause as ServerErrorWithCode).errorCode).toBe(errorCode);
  return caught as TRPCError;
}

describe('client.completeAI', () => {
  it.each(['success', 'provider failure', 'pricing failure'] as const)(
    'keeps the pending hold and public privacy when completion audit fails: %s',
    async outcome => {
      const db = getDatabase();
      await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 1 });
      const provider = buildMockProvider({
        ...(outcome === 'provider failure'
          ? {
              languageModel: () =>
                new MockLanguageModelV4({
                  doGenerate: async () => {
                    throw new Error('PRIVATE_SDK_CANARY');
                  },
                }),
            }
          : {}),
        ...(outcome === 'pricing failure'
          ? {
              pricing: {
                models: {},
                calculateCostUsd: () => {
                  throw new Error('PRIVATE_PRICE_CANARY');
                },
              },
            }
          : {}),
      });
      db.run(
        sql`CREATE TRIGGER fail_completion_audit BEFORE INSERT ON ai_audit_log BEGIN SELECT RAISE(ABORT, 'PRIVATE_COMPLETION_AUDIT_CANARY'); END`
      );
      try {
        const error = await expectThrow(
          completeAI({ db, tenantId, siteId, userId }, baseInput, () => provider),
          'AI_PROVIDER_ERROR'
        );
        expectNoPublicDiagnostic(error, 'PRIVATE_COMPLETION_AUDIT_CANARY');
        expect(
          await db.select().from(aiAuditLog).where(eq(aiAuditLog.tenantId, tenantId))
        ).toHaveLength(0);
        expect(
          await db
            .select()
            .from(aiBudgetReservations)
            .where(eq(aiBudgetReservations.tenantId, tenantId))
        ).toMatchObject([{ tenantId, state: 'pending', auditLogId: null }]);
        // Until the orphan TTL elapses the unsettled admission reads as in flight.
        await expectThrow(
          completeAI({ db, tenantId, siteId, userId }, baseInput, () => buildMockProvider()),
          'AI_BUDGET_BUSY'
        );
      } finally {
        db.run(sql`DROP TRIGGER fail_completion_audit`);
      }
    }
  );

  it.each(['factory', 'isConfigured', 'languageModel', 'cacheControlForSystemPrompt'] as const)(
    'sanitizes a throwing %s hook before reserving or dispatching a provider call',
    async hook => {
      const db = getDatabase();
      await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 1 });
      const privateError = new Error('PREPARATION_SECRET_CANARY provider-key private-payload');
      let dispatched = false;
      const model = new MockLanguageModelV4({
        doGenerate: async () => {
          dispatched = true;
          throw new Error('A preparation failure must not dispatch');
        },
      });
      const provider = buildMockProvider({
        isConfigured: () => {
          if (hook === 'isConfigured') throw privateError;
          return true;
        },
        languageModel: () => {
          if (hook === 'languageModel') throw privateError;
          return model;
        },
        cacheControlForSystemPrompt: () => {
          if (hook === 'cacheControlForSystemPrompt') throw privateError;
          return undefined;
        },
      });
      let caught: unknown;
      try {
        await completeAI({ db, tenantId, siteId, userId }, baseInput, () => {
          if (hook === 'factory') throw privateError;
          return provider;
        });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TRPCError);
      expect((caught as TRPCError).code).toBe('BAD_GATEWAY');
      expect((caught as TRPCError).message).toBe('AI provider call failed');
      const cause = (caught as TRPCError).cause;
      expect(cause).toBeInstanceOf(ServerErrorWithCode);
      expect((cause as ServerErrorWithCode).errorCode).toBe('AI_PROVIDER_ERROR');
      expect((cause as ServerErrorWithCode).details ?? null).toBeNull();
      expect(cause).not.toBe(privateError);
      expect(JSON.stringify(caught)).not.toContain('PREPARATION_SECRET_CANARY');
      expect(dispatched).toBe(false);
      expect(await db.select().from(aiBudgetReservations).all()).toHaveLength(0);
      expect(await db.select().from(aiAuditLog).all()).toHaveLength(0);
    }
  );

  it('throws AI_DISABLED when ai.enabled is false (default)', async () => {
    const db = getDatabase();
    await expectThrow(
      completeAI({ db, tenantId, siteId, userId }, baseInput, () => buildMockProvider()),
      'AI_DISABLED'
    );
    const rows = await db.select().from(aiAuditLog).all();
    expect(rows).toHaveLength(0);
  });

  it('throws AI_PROVIDER_ERROR when the provider is not configured', async () => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 5 });
    await expectThrow(
      completeAI({ db, tenantId, siteId, userId }, baseInput, () =>
        buildMockProvider({ isConfigured: () => false })
      ),
      'AI_PROVIDER_ERROR'
    );
    const rows = await db.select().from(aiAuditLog).all();
    expect(rows).toHaveLength(0);
  });

  it('throws AI_BUDGET_EXCEEDED when the monthly budget is zero', async () => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 0 });
    await expectThrow(
      completeAI({ db, tenantId, siteId, userId }, baseInput, () => buildMockProvider()),
      'AI_BUDGET_EXCEEDED'
    );
  });

  it('throws AI_BUDGET_EXCEEDED when current spend has reached the budget', async () => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 0.01 });
    // Burn through the budget with a manual audit-log row.
    await db.insert(aiAuditLog).values({
      id: nanoid(),
      tenantId,
      siteId,
      userId,
      feature: 'completeTest',
      providerId: 'anthropic',
      modelId: 'claude-haiku-4-5',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.02,
      durationMs: 100,
      errorCode: null,
      createdAt: new Date().toISOString(),
    });
    await expectThrow(
      completeAI({ db, tenantId, siteId, userId }, baseInput, () => buildMockProvider()),
      'AI_BUDGET_EXCEEDED'
    );
  });

  it('writes a successful audit-log row on the happy path', async () => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 1 });
    const result = await completeAI({ db, tenantId, siteId, userId }, baseInput, () =>
      buildMockProvider()
    );
    expect(result.text).toBe('pong');
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-haiku-4-5');
    expect(result.costUsd).toBeCloseTo((10 / 1_000_000) * 3 + (5 / 1_000_000) * 15, 6);

    const rows = await db.select().from(aiAuditLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tenantId).toBe(tenantId);
    expect(rows[0]?.siteId).toBe(siteId);
    expect(rows[0]?.userId).toBe(userId);
    expect(rows[0]?.providerId).toBe('anthropic');
    expect(rows[0]?.modelId).toBe('claude-haiku-4-5');
    expect(rows[0]?.errorCode).toBeNull();
    expect(rows[0]?.costUsd).toBeCloseTo(result.costUsd, 6);
  });

  it('prices cached input once while preserving total input in the audit log', async () => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 1 });
    const cachedPricingModels = {
      'cached-model': {
        input: 10,
        output: 20,
        cacheRead: 1,
        cacheWrite: 2,
      },
    };
    const provider = buildMockProvider({
      defaultModelId: 'cached-model',
      pricing: {
        models: cachedPricingModels,
        calculateCostUsd: (modelId, usage) => {
          const row = cachedPricingModels[modelId as keyof typeof cachedPricingModels];
          if (!row) return 0;
          return (
            (usage.inputTokens / 1_000_000) * row.input +
            (usage.outputTokens / 1_000_000) * row.output +
            (usage.cacheReadTokens / 1_000_000) * row.cacheRead +
            (usage.cacheWriteTokens / 1_000_000) * row.cacheWrite
          );
        },
      },
      languageModel: () =>
        new MockLanguageModelV4({
          provider: 'anthropic',
          modelId: 'cached-model',
          doGenerate: async () => ({
            content: [{ type: 'text', text: 'pong' }],
            finishReason: 'stop',
            usage: {
              inputTokens: { total: 100, noCache: 50, cacheRead: 40, cacheWrite: 10 },
              outputTokens: { total: 20 },
            },
            warnings: [],
          }),
          doStream: async () => ({
            stream: simulateReadableStream({
              chunks: [
                { type: 'text-delta', id: mockId(), delta: 'pong' },
                {
                  type: 'finish',
                  finishReason: 'stop',
                  usage: {
                    inputTokens: { total: 100, noCache: 50, cacheRead: 40, cacheWrite: 10 },
                    outputTokens: { total: 20 },
                  },
                },
              ],
            }),
          }),
        }),
    });

    const result = await completeAI({ db, tenantId, siteId, userId }, baseInput, () => provider);

    expect(result.inputTokens).toBe(100);
    expect(result.cacheReadTokens).toBe(40);
    expect(result.cacheWriteTokens).toBe(10);
    expect(result.costUsd).toBeCloseTo(
      (50 / 1_000_000) * 10 + (20 / 1_000_000) * 20 + (40 / 1_000_000) * 1 + (10 / 1_000_000) * 2,
      6
    );

    const rows = await db.select().from(aiAuditLog).all();
    expect(rows[0]?.inputTokens).toBe(100);
    expect(rows[0]?.cacheReadTokens).toBe(40);
    expect(rows[0]?.cacheWriteTokens).toBe(10);
    expect(rows[0]?.costUsd).toBeCloseTo(result.costUsd, 6);
  });

  it('persists ctx.siteId === null without breaking the insert', async () => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 1 });
    await completeAI({ db, tenantId, siteId: null, userId }, baseInput, () => buildMockProvider());
    const rows = await db.select().from(aiAuditLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.siteId).toBeNull();
  });

  it('admits only one remote call while another tenant-month call is in flight', async () => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 0.01 });
    let enterFirst!: () => void;
    let finishFirst!: () => void;
    const firstEntered = new Promise<void>(resolve => {
      enterFirst = resolve;
    });
    const firstGate = new Promise<void>(resolve => {
      finishFirst = resolve;
    });
    let providerCalls = 0;
    const provider = buildMockProvider({
      languageModel: () =>
        new MockLanguageModelV4({
          provider: 'anthropic',
          modelId: 'claude-haiku-4-5',
          doGenerate: async () => {
            providerCalls += 1;
            if (providerCalls === 1) {
              enterFirst();
              await firstGate;
            }
            return {
              content: [{ type: 'text', text: 'pong' }],
              finishReason: 'stop',
              usage: {
                inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 5 },
              },
              warnings: [],
            };
          },
          doStream: async () => {
            throw new Error('unexpected streaming call');
          },
        }),
    });

    const first = completeAI({ db, tenantId, siteId, userId }, baseInput, () => provider);
    await firstEntered;
    try {
      await expectThrow(
        completeAI({ db, tenantId, siteId, userId }, baseInput, () => provider),
        'AI_BUDGET_BUSY'
      );
      expect(providerCalls).toBe(1);
    } finally {
      finishFirst();
      await first;
    }
    expect(await db.select().from(aiAuditLog).all()).toHaveLength(1);
  });

  it('lets a dispatched call finish and settle its known cost when the client disconnects', async () => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 1 });
    const controller = new AbortController();
    let enterCall!: () => void;
    let finishCall!: () => void;
    const entered = new Promise<void>(resolve => {
      enterCall = resolve;
    });
    const gate = new Promise<void>(resolve => {
      finishCall = resolve;
    });
    let providerSignal: AbortSignal | undefined;
    const provider = buildMockProvider({
      languageModel: () =>
        new MockLanguageModelV4({
          provider: 'anthropic',
          modelId: 'claude-haiku-4-5',
          doGenerate: async ({ abortSignal }) => {
            providerSignal = abortSignal;
            enterCall();
            await gate;
            return {
              content: [{ type: 'text', text: 'pong' }],
              finishReason: 'stop',
              usage: {
                inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 5 },
              },
              warnings: [],
            };
          },
          doStream: async () => {
            throw new Error('unexpected streaming call');
          },
        }),
    });

    const call = completeAI(
      { db, tenantId, siteId, userId, abortSignal: controller.signal },
      baseInput,
      () => provider
    );
    await entered;
    controller.abort();
    // The client signal never reaches the provider; only our own deadline does.
    expect(providerSignal?.aborted ?? false).toBe(false);
    finishCall();
    await expect(call).resolves.toMatchObject({ text: 'pong' });
    expect(await db.select().from(aiAuditLog).all()).toMatchObject([
      { costState: 'estimated', errorCode: null },
    ]);
    expect(await db.select().from(aiBudgetReservations).all()).toEqual([]);
  });

  it('does not reserve or dispatch a request cancelled before admission', async () => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 1 });
    const controller = new AbortController();
    controller.abort();
    let providerCalls = 0;
    const provider = buildMockProvider({
      languageModel: () =>
        new MockLanguageModelV4({
          provider: 'anthropic',
          modelId: 'claude-haiku-4-5',
          doGenerate: async () => {
            providerCalls += 1;
            throw new Error('must not dispatch');
          },
          doStream: async () => {
            throw new Error('unexpected streaming call');
          },
        }),
    });
    await expect(
      completeAI(
        { db, tenantId, siteId, userId, abortSignal: controller.signal },
        baseInput,
        () => provider
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(providerCalls).toBe(0);
    expect(await db.select().from(aiAuditLog).all()).toEqual([]);
    expect(await db.select().from(aiBudgetReservations).all()).toEqual([]);
  });

  it.each([
    { label: '429 rate limit', error: () => apiError(429), notIncurred: true },
    { label: '401 credentials', error: () => apiError(401), notIncurred: true },
    { label: '400 invalid request', error: () => apiError(400), notIncurred: true },
    {
      label: 'connection refused',
      error: () =>
        new TypeError('fetch failed', {
          cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
        }),
      notIncurred: true,
    },
    { label: '500 server error', error: () => apiError(500), notIncurred: false },
    { label: '529 overloaded', error: () => apiError(529), notIncurred: false },
    { label: '408 timeout', error: () => apiError(408), notIncurred: false },
    {
      label: 'reset after dispatch',
      error: () =>
        new TypeError('terminated', {
          cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
        }),
      notIncurred: false,
    },
  ])('classifies $label as a billed-or-not provider failure', async ({ error, notIncurred }) => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 1 });
    await expectThrow(
      completeAI({ db, tenantId, siteId, userId }, baseInput, () =>
        buildMockProvider({
          languageModel: () =>
            new MockLanguageModelV4({
              provider: 'anthropic',
              modelId: 'claude-haiku-4-5',
              doGenerate: async () => {
                throw error();
              },
              doStream: async () => {
                throw new Error('unexpected streaming call');
              },
            }),
        })
      ),
      'AI_PROVIDER_ERROR'
    );
    const rows = await db.select().from(aiAuditLog).all();
    expect(rows).toMatchObject([
      { costUsd: 0, costState: notIncurred ? 'not_incurred' : 'unknown' },
    ]);
    const holds = await db.select().from(aiBudgetReservations).all();
    if (notIncurred) {
      expect(holds).toEqual([]);
      // The released admission serves the next call.
      await expect(
        completeAI({ db, tenantId, siteId, userId }, baseInput, () => buildMockProvider())
      ).resolves.toMatchObject({ text: 'pong' });
    } else {
      expect(holds).toMatchObject([{ state: 'unknown', auditLogId: rows[0]?.id }]);
      await expectThrow(
        completeAI({ db, tenantId, siteId, userId }, baseInput, () => buildMockProvider()),
        'AI_BUDGET_EXCEEDED'
      );
    }
  });

  it('does not reserve or audit a request cancelled before provider dispatch', async () => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 1 });
    const controller = new AbortController();
    controller.abort();

    await expect(
      completeAI({ db, tenantId, siteId, userId, abortSignal: controller.signal }, baseInput, () =>
        buildMockProvider()
      )
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(await db.select().from(aiAuditLog).all()).toHaveLength(0);
    expect(await db.select().from(aiBudgetReservations).all()).toHaveLength(0);
  });

  it('does not block a different tenant on the first tenant budget reservation', async () => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 1 });
    await writeAISettings(db, tenantOther, { enabled: true, monthlyBudgetUsd: 1 });
    const reservation = reserveAiBudget(db, tenantId);
    try {
      const other = await completeAI(
        { db, tenantId: tenantOther, siteId: null, userId: null },
        baseInput,
        () => buildMockProvider()
      );
      expect(other.text).toBe('pong');
      expect(await db.select().from(aiAuditLog).all()).toHaveLength(1);
    } finally {
      await db.delete(aiBudgetReservations).where(eq(aiBudgetReservations.id, reservation.id));
    }
  });

  it('records an unknown-cost failure and blocks an unsafe retry after the SDK throws', async () => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 1 });
    const secret = 'PRIVATE_CUSTOMER_IN_PROVIDER_ERROR';
    const failure = await expectThrow(
      completeAI({ db, tenantId, siteId, userId }, baseInput, () =>
        buildMockProvider({
          languageModel: () =>
            new MockLanguageModelV4({
              provider: 'anthropic',
              modelId: 'claude-haiku-4-5',
              doGenerate: async () => {
                throw new Error(`synthetic provider failure ${secret}`);
              },
              doStream: async () => {
                throw new Error(`synthetic provider failure ${secret}`);
              },
            }),
        })
      ),
      'AI_PROVIDER_ERROR'
    );
    expect(failure.message).toBe('AI provider call failed');
    expect(failure.message).not.toContain(secret);
    expectNoPublicDiagnostic(failure, secret);
    expect((failure.cause as ServerErrorWithCode).details).toBeUndefined();
    const rows = await db.select().from(aiAuditLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.errorCode).toBe('AI_PROVIDER_ERROR');
    expect(rows[0]?.costUsd).toBe(0);
    expect(rows[0]?.costState).toBe('unknown');
    await expectThrow(
      completeAI({ db, tenantId, siteId, userId }, baseInput, () => buildMockProvider()),
      'AI_BUDGET_EXCEEDED'
    );
    expect(await db.select().from(aiAuditLog).all()).toHaveLength(1);
  });

  it.each([
    { label: 'negative input', input: -1, output: 5, read: 0, write: 0, noCache: 10 },
    { label: 'infinite input', input: Infinity, output: 5, read: 0, write: 0, noCache: 10 },
    { label: 'NaN input', input: NaN, output: 5, read: 0, write: 0, noCache: 10 },
    { label: 'negative output', input: 10, output: -1, read: 0, write: 0, noCache: 10 },
    { label: 'negative cache read', input: 10, output: 5, read: -1, write: 0, noCache: 10 },
    { label: 'infinite cache write', input: 10, output: 5, read: 0, write: Infinity, noCache: 10 },
    { label: 'negative uncached input', input: 10, output: 5, read: 0, write: 0, noCache: -1 },
  ])('holds unknown cost without pricing malformed usage: $label', async usage => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 1 });
    let priced = false;
    const provider = buildMockProvider({
      languageModel: () =>
        new MockLanguageModelV4({
          doGenerate: async () => ({
            content: [{ type: 'text', text: 'already dispatched' }],
            finishReason: 'stop',
            usage: {
              inputTokens: {
                total: usage.input,
                noCache: usage.noCache,
                cacheRead: usage.read,
                cacheWrite: usage.write,
              },
              outputTokens: { total: usage.output },
            },
            warnings: [],
          }),
        }),
      pricing: {
        models: {},
        calculateCostUsd: () => {
          priced = true;
          return 0.001;
        },
      },
    });
    await expectThrow(
      completeAI({ db, tenantId, siteId, userId }, baseInput, () => provider),
      'AI_PROVIDER_ERROR'
    );
    expect(priced).toBe(false);
    const rows = await db.select().from(aiAuditLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId,
      siteId,
      userId,
      costState: 'unknown',
      costUsd: 0,
      inputTokens: Number.isFinite(usage.input) && usage.input >= 0 ? usage.input : 0,
      outputTokens: Number.isFinite(usage.output) && usage.output >= 0 ? usage.output : 0,
      cacheReadTokens: Number.isFinite(usage.read) && usage.read >= 0 ? usage.read : 0,
      cacheWriteTokens: Number.isFinite(usage.write) && usage.write >= 0 ? usage.write : 0,
      errorCode: 'AI_PROVIDER_ERROR',
    });
    expect(await db.select().from(aiBudgetReservations).all()).toMatchObject([
      { tenantId, state: 'unknown', auditLogId: rows[0]?.id },
    ]);
    await expectThrow(
      completeAI({ db, tenantId, siteId, userId }, baseInput, () => buildMockProvider()),
      'AI_BUDGET_EXCEEDED'
    );
    expect(await db.select().from(aiAuditLog).all()).toHaveLength(1);
  });

  it('keeps provider success auditable when local pricing throws after the billable call', async () => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 1 });
    const provider = buildMockProvider({
      pricing: {
        models: {},
        calculateCostUsd: () => {
          throw new Error('missing price');
        },
      },
    });
    await expectThrow(
      completeAI({ db, tenantId, siteId, userId }, baseInput, () => provider),
      'AI_PROVIDER_ERROR'
    );
    const rows = await db.select().from(aiAuditLog).all();
    expect(rows).toMatchObject([{ costState: 'unknown', errorCode: 'AI_PROVIDER_ERROR' }]);
    expect(await db.select().from(aiBudgetReservations).all()).toMatchObject([
      { state: 'unknown', auditLogId: rows[0]?.id },
    ]);
  });

  it.each([-1, Infinity, NaN])('holds unknown cost when pricing returns %s', async cost => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 1 });
    const provider = buildMockProvider({ pricing: { models: {}, calculateCostUsd: () => cost } });
    const failure = await expectThrow(
      completeAI({ db, tenantId, siteId, userId }, baseInput, () => provider),
      'AI_PROVIDER_ERROR'
    );
    expect(failure.message).toBe('AI provider returned unpriceable usage');
    const rows = await db.select().from(aiAuditLog).all();
    expect(rows).toMatchObject([
      {
        tenantId,
        inputTokens: 10,
        outputTokens: 5,
        costState: 'unknown',
        costUsd: 0,
        errorCode: 'AI_PROVIDER_ERROR',
      },
    ]);
    expect(await db.select().from(aiBudgetReservations).all()).toMatchObject([
      { tenantId, state: 'unknown', auditLogId: rows[0]?.id },
    ]);
  });

  it('does not treat a remote success with zero reported usage as free', async () => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 1 });
    const provider = buildMockProvider({
      languageModel: () =>
        new MockLanguageModelV4({
          provider: 'anthropic',
          modelId: 'claude-haiku-4-5',
          doGenerate: async () => ({
            content: [{ type: 'text', text: 'pong' }],
            finishReason: 'stop',
            usage: {
              inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 0 },
            },
            warnings: [],
          }),
          doStream: async () => {
            throw new Error('unexpected streaming call');
          },
        }),
    });
    await expectThrow(
      completeAI({ db, tenantId, siteId, userId }, baseInput, () => provider),
      'AI_PROVIDER_ERROR'
    );
    expect(await db.select().from(aiAuditLog).all()).toMatchObject([
      { costState: 'unknown', costUsd: 0 },
    ]);
    expect(await db.select().from(aiBudgetReservations).all()).toMatchObject([
      { state: 'unknown' },
    ]);
  });

  it('does not let one tenant see another tenant spend during budget pre-check', async () => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 0.01 });
    // Other tenant's spend should NOT count.
    await db.insert(aiAuditLog).values({
      id: nanoid(),
      tenantId: tenantOther,
      siteId: null,
      userId: null,
      feature: 'completeTest',
      providerId: 'anthropic',
      modelId: 'claude-haiku-4-5',
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 99,
      durationMs: 1,
      errorCode: null,
      createdAt: new Date().toISOString(),
    });
    const result = await completeAI({ db, tenantId, siteId, userId }, baseInput, () =>
      buildMockProvider()
    );
    expect(result.text).toBe('pong');
  });
});

describe('settings round-trip', () => {
  it('resolveAISettings returns defaults for a fresh tenant', async () => {
    const db = getDatabase();
    const settings = await resolveAISettings(db, tenantId);
    expect(settings.enabled).toBe(false);
    expect(settings.monthlyBudgetUsd).toBe(0);
    expect(settings.providerId).toBeNull();
    expect(settings.modelId).toBeNull();
  });

  it('writeAISettings persists a partial patch', async () => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true });
    await writeAISettings(db, tenantId, { monthlyBudgetUsd: 25 });
    const settings = await resolveAISettings(db, tenantId);
    expect(settings.enabled).toBe(true);
    expect(settings.monthlyBudgetUsd).toBe(25);
  });
});
