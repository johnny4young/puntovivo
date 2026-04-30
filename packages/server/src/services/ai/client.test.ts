import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { MockLanguageModelV3, mockId } from 'ai/test';
import { simulateReadableStream } from 'ai';

import { ServerErrorWithCode } from '../../lib/errorCodes.js';
import { createServer, type PuntovivoServer } from '../../index.js';
import { getDatabase } from '../../db/index.js';
import { aiAuditLog, companies, sites, tenants, users } from '../../db/schema.js';

import { completeAI, resolveAISettings, writeAISettings } from './client.js';
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
      new MockLanguageModelV3({
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

async function expectThrow(promise: Promise<unknown>, errorCode: string): Promise<void> {
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
}

describe('client.completeAI', () => {
  it('throws AI_DISABLED when ai.enabled is false (default)', async () => {
    const db = getDatabase();
    await expectThrow(
      completeAI(
        { db, tenantId, siteId, userId },
        baseInput,
        () => buildMockProvider()
      ),
      'AI_DISABLED'
    );
    const rows = await db.select().from(aiAuditLog).all();
    expect(rows).toHaveLength(0);
  });

  it('throws AI_PROVIDER_ERROR when the provider is not configured', async () => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 5 });
    await expectThrow(
      completeAI(
        { db, tenantId, siteId, userId },
        baseInput,
        () => buildMockProvider({ isConfigured: () => false })
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
      completeAI(
        { db, tenantId, siteId, userId },
        baseInput,
        () => buildMockProvider()
      ),
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
      completeAI(
        { db, tenantId, siteId, userId },
        baseInput,
        () => buildMockProvider()
      ),
      'AI_BUDGET_EXCEEDED'
    );
  });

  it('writes a successful audit-log row on the happy path', async () => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 1 });
    const result = await completeAI(
      { db, tenantId, siteId, userId },
      baseInput,
      () => buildMockProvider()
    );
    expect(result.text).toBe('pong');
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-haiku-4-5');
    expect(result.costUsd).toBeCloseTo(
      (10 / 1_000_000) * 3 + (5 / 1_000_000) * 15,
      6
    );

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

  it('persists ctx.siteId === null without breaking the insert', async () => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 1 });
    await completeAI(
      { db, tenantId, siteId: null, userId },
      baseInput,
      () => buildMockProvider()
    );
    const rows = await db.select().from(aiAuditLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.siteId).toBeNull();
  });

  it('records a failure row with cost_usd=0 and AI_PROVIDER_ERROR when the SDK throws', async () => {
    const db = getDatabase();
    await writeAISettings(db, tenantId, { enabled: true, monthlyBudgetUsd: 1 });
    await expectThrow(
      completeAI(
        { db, tenantId, siteId, userId },
        baseInput,
        () =>
          buildMockProvider({
            languageModel: () =>
              new MockLanguageModelV3({
                provider: 'anthropic',
                modelId: 'claude-haiku-4-5',
                doGenerate: async () => {
                  throw new Error('synthetic provider failure');
                },
                doStream: async () => {
                  throw new Error('synthetic provider failure');
                },
              }),
          })
      ),
      'AI_PROVIDER_ERROR'
    );
    const rows = await db.select().from(aiAuditLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.errorCode).toBe('AI_PROVIDER_ERROR');
    expect(rows[0]?.costUsd).toBe(0);
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
    const result = await completeAI(
      { db, tenantId, siteId, userId },
      baseInput,
      () => buildMockProvider()
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
