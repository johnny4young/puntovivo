/**
 * Pin the Anthropic prompt-cache contract on the co-pilot.
 *
 * Before this slice the co-pilot system prompt embedded the resolved
 * analytics window (`from` / `to` ISO timestamps + `defaulted` flag) and
 * the active `siteId` directly into the string. The Anthropic cache
 * marker (`provider.cacheControlForSystemPrompt()`) is applied to the
 * system prompt, so a fresh ISO timestamp on every call meant the cache
 * key never matched and hit rate was zero. The fix moves the dynamic
 * context into a `<context>...</context>` block injected into the latest
 * user message, leaving the system prompt byte-for-byte identical across
 * calls — these tests pin that invariant plus the no-regression contract
 * for the OpenAI path (no `providerOptions` because OpenAI auto-caches
 * server-side).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import type { LanguageModelV4 } from '@ai-sdk/provider';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { aiAuditLog, aiBudgetReservations, companies, sites, tenants } from '../db/schema.js';
import { ServerErrorWithCode, type ServerErrorCode } from '../lib/errorCodes.js';
import {
  buildContextBlock,
  buildSystemPrompt,
  injectContextIntoMessages,
  runCopilotChat,
  type CopilotChatMessage,
  type CopilotWindow,
} from '../services/ai/copilot.js';
import type { AIProvider, ProviderPricing } from '../services/ai/providers/types.js';
import { validateModelAnalyticsSQL } from '../services/ai/copilot/sql.js';

const generateTextMock = vi.fn();

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    generateText: (...args: unknown[]) => generateTextMock(...args),
  };
});

const PRICING: ProviderPricing = {
  models: {
    'test-copilot-model': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1 },
  },
  calculateCostUsd: (_modelId: string, usage) =>
    usage.inputTokens / 1_000_000 + (usage.outputTokens * 5) / 1_000_000,
};

function buildStubProvider(overrides?: Partial<AIProvider>): AIProvider {
  return {
    id: 'anthropic',
    defaultModelId: 'test-copilot-model',
    pricing: PRICING,
    isConfigured: () => true,
    languageModel: () => ({}) as LanguageModelV4,
    cacheControlForSystemPrompt: () => ({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    }),
    ...overrides,
  };
}

async function expectErrorCode(
  promise: Promise<unknown>,
  expectedCode: ServerErrorCode
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(TRPCError);
  const cause = (caught as TRPCError).cause;
  expect(cause).toBeInstanceOf(ServerErrorWithCode);
  expect((cause as ServerErrorWithCode).errorCode).toBe(expectedCode);
}

async function seedTenantWithAI(
  suffix: string,
  responseMode: 'guided' | 'verified' = 'guided'
): Promise<{ tenantId: string; siteId: string }> {
  const db = getDatabase();
  const tenantId = `cop-tenant-${suffix}`;
  const companyId = `cop-co-${suffix}`;
  const siteId = `cop-site-${suffix}`;
  const now = new Date().toISOString();
  await db.insert(tenants).values({
    id: tenantId,
    name: `Copilot Tenant ${suffix}`,
    slug: `cop-${suffix}`,
    settings: {
      ai: {
        enabled: true,
        monthlyBudgetUsd: 100,
        providerId: 'anthropic',
        modelId: null,
        features: { copilot: { enabled: true, responseMode } },
      },
    },
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: `Copilot Co ${suffix}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sites).values({
    id: siteId,
    tenantId,
    companyId,
    name: `Sede ${suffix}`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return { tenantId, siteId };
}

function successfulGenerateTextResult(textAnswer: string) {
  return {
    text: textAnswer,
    usage: {
      inputTokens: 1200,
      outputTokens: 300,
      inputTokenDetails: {
        noCacheTokens: 200,
        cacheReadTokens: 800,
        cacheWriteTokens: 200,
      },
    },
  };
}

function mockGenerateTextSuccess(textAnswer: string): void {
  generateTextMock.mockResolvedValue(successfulGenerateTextResult(textAnswer));
}

function mockGenerateTextWithSQL(textAnswer: string): void {
  generateTextMock.mockImplementation(
    async (options: {
      tools: {
        runReadOnlySQL: {
          execute?: (input: { query: string }) => Promise<unknown>;
        };
      };
    }) => {
      await options.tools.runReadOnlySQL.execute?.({
        query: 'SELECT COUNT(*) AS sale_count FROM sales_summary',
      });
      return successfulGenerateTextResult(textAnswer);
    }
  );
}

let server: PuntovivoServer;

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  generateTextMock.mockReset();
});

describe('buildSystemPrompt — cache stability invariant', () => {
  it('returns a byte-for-byte identical string across consecutive calls', () => {
    const first = buildSystemPrompt();
    const second = buildSystemPrompt();
    expect(first).toBe(second);
  });

  it('does not embed any ISO timestamp, site id, or per-call token', () => {
    const prompt = buildSystemPrompt();
    // ISO 8601 timestamp pattern — would re-break the cache key.
    expect(prompt).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Direct site id mention — the prompt should only reference the
    // <context> convention, not a specific id.
    expect(prompt).not.toMatch(/active site is (?!provided)/i);
    // Default-90-day marker that previously varied with the window.
    expect(prompt).not.toContain('default 90 days');
  });

  it('mentions the <context> convention so the model knows where the dynamic data lives', () => {
    const prompt = buildSystemPrompt();
    expect(prompt).toContain('<context>');
    expect(prompt).toContain('analytics_window_from');
    expect(prompt).toContain('active_site_id');
  });

  it('keeps verified mode byte-stable and forbids a generated business conclusion', () => {
    const first = buildSystemPrompt('verified');
    const second = buildSystemPrompt('verified');
    expect(first).toBe(second);
    expect(first).toContain('Call runReadOnlySQL and end the turn immediately');
    expect(first).toContain('Do not write a summary, explanation, recommendation');
    expect(first).toContain('not automatic proof of a correct business conclusion');
  });
});

describe('model SQL evidence floor', () => {
  it('requires a real analytics source, not a constant or a shadowing CTE', () => {
    for (const query of [
      'SELECT 42 AS sale_count',
      'WITH fabricated AS (SELECT 42 AS sale_count) SELECT * FROM fabricated',
      'WITH sales_summary AS (SELECT 42 AS sale_count) SELECT * FROM sales_summary',
      'WITH RECURSIVE sales_summary AS (SELECT 42 AS sale_count) SELECT * FROM sales_summary',
      'WITH sales_summary(sale_count) AS (SELECT 42) SELECT * FROM sales_summary',
      'SELECT * FROM (WITH sales_summary AS (SELECT 42 AS sale_count) SELECT * FROM sales_summary)',
    ]) {
      expect(() => validateModelAnalyticsSQL(query)).toThrow(TRPCError);
    }
    expect(validateModelAnalyticsSQL('SELECT COUNT(*) FROM sales_summary')).toBe(
      'SELECT COUNT(*) FROM sales_summary'
    );
  });
});

describe('buildContextBlock — dynamic per-call payload', () => {
  const window: CopilotWindow = {
    from: '2026-02-12T00:00:00.000Z',
    to: '2026-05-13T00:00:00.000Z',
    defaulted: true,
  };

  it('emits each required field on its own line with predictable keys', () => {
    const block = buildContextBlock(window, 'site_abc123');
    expect(block).toContain('<context>');
    expect(block).toContain('</context>');
    expect(block).toContain('analytics_window_from: 2026-02-12T00:00:00.000Z');
    expect(block).toContain('analytics_window_to: 2026-05-13T00:00:00.000Z');
    expect(block).toContain('analytics_window_defaulted: true');
    expect(block).toContain('active_site_id: site_abc123');
  });

  it('emits `active_site_id: none` when no UI site is active', () => {
    const block = buildContextBlock(window, null);
    expect(block).toContain('active_site_id: none');
  });

  it('emits `analytics_window_defaulted: false` when the client provided an explicit window', () => {
    const block = buildContextBlock({ ...window, defaulted: false }, 'site_abc123');
    expect(block).toContain('analytics_window_defaulted: false');
  });
});

describe('injectContextIntoMessages — latest-user-turn prepend', () => {
  const contextBlock = '<context>\nanalytics_window_from: x\n</context>';

  it('prepends the context to the only user message when there is one turn', () => {
    const original: CopilotChatMessage[] = [{ role: 'user', content: 'Cuanto vendi ayer?' }];
    const injected = injectContextIntoMessages(original, contextBlock);
    expect(injected).toHaveLength(1);
    expect(injected[0]!.content).toBe(`${contextBlock}\n\nCuanto vendi ayer?`);
  });

  it('only touches the LAST user message in a multi-turn conversation', () => {
    const original: CopilotChatMessage[] = [
      { role: 'user', content: 'First question' },
      { role: 'assistant', content: 'First answer' },
      { role: 'user', content: 'Follow-up question' },
    ];
    const injected = injectContextIntoMessages(original, contextBlock);
    expect(injected[0]!.content).toBe('First question');
    expect(injected[1]!.content).toBe('First answer');
    expect(injected[2]!.content).toBe(`${contextBlock}\n\nFollow-up question`);
  });

  it('does not mutate the original input array or messages', () => {
    const original: CopilotChatMessage[] = [{ role: 'user', content: 'Cuanto vendi ayer?' }];
    const snapshot = JSON.parse(JSON.stringify(original));
    injectContextIntoMessages(original, contextBlock);
    expect(original).toEqual(snapshot);
  });

  it('appends a synthetic user message when no user turn is present (defensive)', () => {
    const original: CopilotChatMessage[] = [{ role: 'assistant', content: 'orphan' }];
    const injected = injectContextIntoMessages(original, contextBlock);
    expect(injected).toHaveLength(2);
    expect(injected[1]!).toEqual({ role: 'user', content: contextBlock });
  });
});

describe('runCopilotChat — generateText receives the static system + context-prefixed prompt', () => {
  it('passes the static buildSystemPrompt() as system and a <context>-prefixed prompt for the Anthropic provider', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('anthropic');
    mockGenerateTextWithSQL('Summary ready.');

    const result = await runCopilotChat(
      { db: getDatabase(), tenantId, siteId, userId: null },
      { messages: [{ role: 'user', content: 'Cuanto vendi ayer?' }] },
      { factory: () => buildStubProvider(), now: new Date('2026-05-13T12:00:00.000Z') }
    );

    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('test-copilot-model');

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const call = generateTextMock.mock.calls[0]![0] as {
      instructions: string;
      prompt: string;
      providerOptions?: unknown;
      maxRetries?: number;
      timeout?: unknown;
    };

    // System prompt MUST be the static instruction block; this is the
    // cache-stability invariant.
    expect(call.instructions).toBe(buildSystemPrompt());

    // The user-facing prompt now carries the dynamic context inside the
    // last user turn. We assert the literal markers + the window we
    // injected for this call.
    expect(call.prompt).toContain('<context>');
    expect(call.prompt).toContain('analytics_window_from: ');
    expect(call.prompt).toContain('analytics_window_to: ');
    expect(call.prompt).toContain(`active_site_id: ${siteId}`);
    expect(call.prompt).toContain('Cuanto vendi ayer?');

    // Anthropic provider still advertises the ephemeral cache marker.
    expect(call.providerOptions).toEqual({
      anthropic: { cacheControl: { type: 'ephemeral' } },
    });
    expect(call.maxRetries).toBe(0);
    expect(call.timeout).toEqual({ totalMs: 60_000 });
  });

  it('omits providerOptions when the provider returns undefined (OpenAI path, no regression)', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('openai');
    mockGenerateTextWithSQL('OK');

    await runCopilotChat(
      { db: getDatabase(), tenantId, siteId, userId: null },
      { messages: [{ role: 'user', content: 'Show last week sales' }] },
      {
        factory: () =>
          buildStubProvider({
            id: 'openai',
            cacheControlForSystemPrompt: () => undefined,
          }),
        now: new Date('2026-05-13T12:00:00.000Z'),
      }
    );

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    const call = generateTextMock.mock.calls[0]![0] as Record<string, unknown>;
    expect('providerOptions' in call).toBe(false);

    // System prompt is still the static instruction block on OpenAI too.
    expect(call.instructions).toBe(buildSystemPrompt());
  });

  it('persists cacheReadTokens + cacheWriteTokens from the SDK usage shape onto the audit row', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('cache-audit');
    mockGenerateTextWithSQL('Resumen');

    const result = await runCopilotChat(
      { db: getDatabase(), tenantId, siteId, userId: null },
      { messages: [{ role: 'user', content: 'Pregunta repetida' }] },
      { factory: () => buildStubProvider(), now: new Date('2026-05-13T12:00:00.000Z') }
    );

    const row = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.id, result.auditLogId))
      .get();
    expect(row?.siteId).toBeNull();
    expect(row?.scopeSiteIds).toEqual([siteId]);
    expect(row).toMatchObject({
      tenantId,
      feature: 'copilot',
      responseMode: 'guided',
      providerId: 'anthropic',
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadTokens: 800,
      cacheWriteTokens: 200,
      errorCode: null,
    });
  });

  it('attributes an explicit body site even when the request has no header site', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('body-site-attribution');
    mockGenerateTextWithSQL('Resumen');

    const result = await runCopilotChat(
      { db: getDatabase(), tenantId, siteId: null, userId: null },
      {
        messages: [{ role: 'user', content: 'Ventas de esta sede' }],
        context: { siteId },
      },
      { factory: () => buildStubProvider(), now: new Date('2026-05-13T12:00:00.000Z') }
    );

    const row = await getDatabase()
      .select({ siteId: aiAuditLog.siteId, scopeSiteIds: aiAuditLog.scopeSiteIds })
      .from(aiAuditLog)
      .where(eq(aiAuditLog.id, result.auditLogId))
      .get();
    expect(row?.siteId).toBe(siteId);
    expect(row?.scopeSiteIds).toBeNull();
    const call = generateTextMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(call.prompt).toContain(`active_site_id: ${siteId}`);
  });

  it('stops verified mode after the SQL tool and never returns the model narrative', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('verified', 'verified');
    mockGenerateTextWithSQL('This generated narrative must never be rendered.');

    const result = await runCopilotChat(
      { db: getDatabase(), tenantId, siteId, userId: null },
      { messages: [{ role: 'user', content: 'Show sales yesterday' }] },
      { factory: () => buildStubProvider(), now: new Date('2026-05-13T12:00:00.000Z') }
    );

    const call = generateTextMock.mock.calls[0]![0] as {
      instructions: string;
      stopWhen: unknown;
    };
    const auditRow = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.id, result.auditLogId))
      .get();

    expect(call.instructions).toBe(buildSystemPrompt('verified'));
    expect(Array.isArray(call.stopWhen)).toBe(true);
    expect(result.answer).toBe('');
    expect(result.responseMode).toBe('verified');
    expect(result.sql).toBe('SELECT COUNT(*) AS sale_count FROM sales_summary');
    expect(auditRow?.responseMode).toBe('verified');
  });

  it('rejects a guided figure without SQL evidence and audits the failure', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('guided-unverified-figure');
    mockGenerateTextSuccess('There were 42 sales yesterday.');

    await expectErrorCode(
      runCopilotChat(
        { db: getDatabase(), tenantId, siteId, userId: null },
        { messages: [{ role: 'user', content: 'How many sales yesterday?' }] },
        { factory: () => buildStubProvider(), now: new Date('2026-05-13T12:00:00.000Z') }
      ),
      'AI_PROVIDER_ERROR'
    );
    const auditRow = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.tenantId, tenantId))
      .get();
    expect(auditRow).toMatchObject({
      responseMode: 'guided',
      errorCode: 'AI_PROVIDER_ERROR',
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadTokens: 800,
      cacheWriteTokens: 200,
    });
    expect(auditRow?.costUsd).toBeGreaterThan(0);
  });

  it('rejects even digit-free guided business prose without SQL evidence', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('guided-unverified-prose');
    mockGenerateTextSuccess('Sales were strong yesterday.');
    await expectErrorCode(
      runCopilotChat(
        { db: getDatabase(), tenantId, siteId, userId: null },
        { messages: [{ role: 'user', content: 'How did sales go yesterday?' }] },
        { factory: () => buildStubProvider(), now: new Date('2026-05-13T12:00:00.000Z') }
      ),
      'AI_PROVIDER_ERROR'
    );
  });

  it('returns only SQL rows when guided prose uses a correct digit under the wrong metric', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('guided-wrong-metric');
    mockGenerateTextWithSQL('Revenue was 0 dollars yesterday.');

    const result = await runCopilotChat(
      { db: getDatabase(), tenantId, siteId, userId: null },
      { messages: [{ role: 'user', content: 'How many sales yesterday?' }] },
      { factory: () => buildStubProvider(), now: new Date('2026-05-13T12:00:00.000Z') }
    );

    expect(result.rows).toEqual([{ sale_count: 0 }]);
    expect(result.answer).toBe('');
    expect(result.responseMode).toBe('guided');
  });

  it('withholds qualitative prose over a numeric result cell', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('guided-numeric-row');
    mockGenerateTextWithSQL('Revenue is high.');
    const result = await runCopilotChat(
      { db: getDatabase(), tenantId, siteId, userId: null },
      { messages: [{ role: 'user', content: 'How many sales yesterday?' }] },
      { factory: () => buildStubProvider(), now: new Date('2026-05-13T12:00:00.000Z') }
    );
    expect(result.answer).toBe('');
  });

  it('withholds guided model prose even when the SQL result is nonnumeric', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('guided-qualitative-row');
    generateTextMock.mockImplementation(
      async (options: {
        tools: { runReadOnlySQL: { execute?: (input: { query: string }) => Promise<unknown> } };
      }) => {
        await options.tools.runReadOnlySQL.execute?.({
          query: "SELECT COALESCE(MAX(site_name), 'none') AS site_name FROM sales_summary",
        });
        return successfulGenerateTextResult('Twenty sales happened in Sur.');
      }
    );

    const result = await runCopilotChat(
      { db: getDatabase(), tenantId, siteId, userId: null },
      { messages: [{ role: 'user', content: 'Which site?' }] },
      { factory: () => buildStubProvider(), now: new Date('2026-05-13T12:00:00.000Z') }
    );
    expect(result.rows).toEqual([{ site_name: 'none' }]);
    expect(result.answer).toBe('');
  });

  it('returns every SQL result in order instead of showing only the last one', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('guided-multistep');
    generateTextMock.mockImplementation(
      async (options: {
        tools: { runReadOnlySQL: { execute?: (input: { query: string }) => Promise<unknown> } };
      }) => {
        await options.tools.runReadOnlySQL.execute?.({
          query: 'SELECT COUNT(*) AS sale_count FROM sales_summary',
        });
        await options.tools.runReadOnlySQL.execute?.({
          query: "SELECT COALESCE(MAX(site_name), 'none') AS site_name FROM sales_summary",
        });
        return successfulGenerateTextResult('Sales look strong in Sur.');
      }
    );

    const result = await runCopilotChat(
      { db: getDatabase(), tenantId, siteId, userId: null },
      { messages: [{ role: 'user', content: 'How many sales in Sur?' }] },
      { factory: () => buildStubProvider(), now: new Date('2026-05-13T12:00:00.000Z') }
    );
    expect(result.queries).toHaveLength(2);
    expect(result.queries[0]?.rows).toEqual([{ sale_count: 0 }]);
    expect(result.queries[1]?.rows).toEqual([{ site_name: 'none' }]);
    expect(result.answer).toBe('');
  });

  it('rejects more than five model SQL attempts and accounts for provider usage', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('guided-query-limit');
    generateTextMock.mockImplementation(
      async (options: {
        tools: { runReadOnlySQL: { execute?: (input: { query: string }) => Promise<unknown> } };
      }) => {
        for (let i = 0; i < 6; i++) {
          await options.tools.runReadOnlySQL.execute?.({
            query: 'SELECT COUNT(*) AS sale_count FROM sales_summary',
          });
        }
        return successfulGenerateTextResult('Ignored model prose.');
      }
    );
    await expectErrorCode(
      runCopilotChat(
        { db: getDatabase(), tenantId, siteId, userId: null },
        { messages: [{ role: 'user', content: 'Many analytics requests' }] },
        { factory: () => buildStubProvider(), now: new Date('2026-05-13T12:00:00.000Z') }
      ),
      'AI_COPILOT_SQL_REJECTED'
    );
    const auditRow = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.tenantId, tenantId))
      .get();
    expect(auditRow?.costUsd).toBeGreaterThan(0);
  });

  it('does not use guided prose to assert a conclusion when a query returns no rows', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('guided-empty-rows');
    generateTextMock.mockImplementation(
      async (options: {
        tools: { runReadOnlySQL: { execute?: (input: { query: string }) => Promise<unknown> } };
      }) => {
        await options.tools.runReadOnlySQL.execute?.({
          query: 'SELECT sale_id FROM sales_summary WHERE 1 = 0',
        });
        return successfulGenerateTextResult('There are no sales in this business.');
      }
    );

    const result = await runCopilotChat(
      { db: getDatabase(), tenantId, siteId, userId: null },
      { messages: [{ role: 'user', content: 'Show sales' }] },
      { factory: () => buildStubProvider(), now: new Date('2026-05-13T12:00:00.000Z') }
    );
    expect(result.rowCount).toBe(0);
    expect(result.answer).toBe('');
  });

  it('fails closed when a verified-mode provider returns without validated SQL', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('verified-no-sql', 'verified');
    mockGenerateTextSuccess('Unsupported narrative-only response.');

    await expectErrorCode(
      runCopilotChat(
        { db: getDatabase(), tenantId, siteId, userId: null },
        { messages: [{ role: 'user', content: 'Show sales yesterday' }] },
        { factory: () => buildStubProvider(), now: new Date('2026-05-13T12:00:00.000Z') }
      ),
      'AI_PROVIDER_ERROR'
    );

    const auditRow = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.tenantId, tenantId))
      .get();
    expect(auditRow).toMatchObject({
      responseMode: 'verified',
      errorCode: 'AI_PROVIDER_ERROR',
    });
    expect(
      await getDatabase()
        .select()
        .from(aiBudgetReservations)
        .where(eq(aiBudgetReservations.tenantId, tenantId))
    ).toHaveLength(0);
  });

  it('does not dispatch a second Copilot provider call while the first holds the tenant budget', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('concurrent-budget');
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    let calls = 0;
    generateTextMock.mockImplementation(
      async (options: {
        tools: { runReadOnlySQL: { execute?: (input: { query: string }) => Promise<unknown> } };
      }) => {
        calls += 1;
        if (calls === 1) await firstGate;
        await options.tools.runReadOnlySQL.execute?.({
          query: 'SELECT COUNT(*) AS sale_count FROM sales_summary',
        });
        return successfulGenerateTextResult('Summary');
      }
    );
    const invoke = () =>
      runCopilotChat(
        { db: getDatabase(), tenantId, siteId, userId: null },
        { messages: [{ role: 'user', content: 'Sales?' }] },
        { factory: () => buildStubProvider() }
      );
    const first = invoke();
    await vi.waitFor(() => expect(generateTextMock).toHaveBeenCalledTimes(1));
    try {
      await expectErrorCode(invoke(), 'AI_BUDGET_EXCEEDED');
      expect(generateTextMock).toHaveBeenCalledTimes(1);
    } finally {
      releaseFirst?.();
    }
    await first;
    expect(
      await getDatabase()
        .select()
        .from(aiBudgetReservations)
        .where(eq(aiBudgetReservations.tenantId, tenantId))
    ).toHaveLength(0);
  });

  it('retains an unknown-cost liability and rejects retry after a Copilot SDK failure', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('unknown-provider-cost');
    generateTextMock.mockRejectedValue(new Error('provider timeout after dispatch'));
    const invoke = () =>
      runCopilotChat(
        { db: getDatabase(), tenantId, siteId, userId: null },
        { messages: [{ role: 'user', content: 'Sales?' }] },
        { factory: () => buildStubProvider() }
      );
    await expectErrorCode(invoke(), 'AI_PROVIDER_ERROR');
    const rows = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.tenantId, tenantId));
    expect(rows).toMatchObject([
      {
        siteId: null,
        scopeSiteIds: [siteId],
        costState: 'unknown',
        errorCode: 'AI_PROVIDER_ERROR',
      },
    ]);
    expect(
      await getDatabase()
        .select()
        .from(aiBudgetReservations)
        .where(eq(aiBudgetReservations.tenantId, tenantId))
    ).toMatchObject([{ state: 'unknown', auditLogId: rows[0]?.id }]);
    await expectErrorCode(invoke(), 'AI_BUDGET_EXCEEDED');
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(
      await getDatabase().select().from(aiAuditLog).where(eq(aiAuditLog.tenantId, tenantId))
    ).toHaveLength(1);
  });

  it('holds a remote liability when a successful provider response has no usable usage', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('zero-provider-usage');
    generateTextMock.mockImplementation(
      async (options: {
        tools: { runReadOnlySQL: { execute?: (input: { query: string }) => Promise<unknown> } };
      }) => {
        await options.tools.runReadOnlySQL.execute?.({
          query: 'SELECT COUNT(*) AS sale_count FROM sales_summary',
        });
        return { text: 'Summary', usage: { inputTokens: 0, outputTokens: 0 } };
      }
    );
    await expectErrorCode(
      runCopilotChat(
        { db: getDatabase(), tenantId, siteId, userId: null },
        { messages: [{ role: 'user', content: 'Sales?' }] },
        { factory: () => buildStubProvider() }
      ),
      'AI_PROVIDER_ERROR'
    );
    expect(
      await getDatabase().select().from(aiAuditLog).where(eq(aiAuditLog.tenantId, tenantId))
    ).toMatchObject([{ costState: 'unknown' }]);
    expect(
      await getDatabase()
        .select()
        .from(aiBudgetReservations)
        .where(eq(aiBudgetReservations.tenantId, tenantId))
    ).toMatchObject([{ state: 'unknown' }]);
  });

  it('propagates cancellation and retains the uncertain remote charge', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('cancelled-provider');
    const controller = new AbortController();
    generateTextMock.mockImplementation(async (options: { abortSignal?: AbortSignal }) => {
      expect(options.abortSignal).toBe(controller.signal);
      controller.abort();
      throw new Error('cancelled after provider dispatch');
    });
    await expectErrorCode(
      runCopilotChat(
        { db: getDatabase(), tenantId, siteId, userId: null, abortSignal: controller.signal },
        { messages: [{ role: 'user', content: 'Sales?' }] },
        { factory: () => buildStubProvider() }
      ),
      'AI_PROVIDER_ERROR'
    );
    expect(
      await getDatabase().select().from(aiAuditLog).where(eq(aiAuditLog.tenantId, tenantId))
    ).toMatchObject([{ costState: 'unknown' }]);
    expect(
      await getDatabase()
        .select()
        .from(aiBudgetReservations)
        .where(eq(aiBudgetReservations.tenantId, tenantId))
    ).toMatchObject([{ state: 'unknown' }]);
  });

  it('regenerates the context block on a follow-up call so the latest window flows through', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('multi-turn');
    mockGenerateTextWithSQL('First answer');

    await runCopilotChat(
      { db: getDatabase(), tenantId, siteId, userId: null },
      { messages: [{ role: 'user', content: 'Turn 1' }] },
      { factory: () => buildStubProvider(), now: new Date('2026-05-13T12:00:00.000Z') }
    );

    mockGenerateTextWithSQL('Second answer');
    await runCopilotChat(
      { db: getDatabase(), tenantId, siteId, userId: null },
      {
        messages: [
          { role: 'user', content: 'Turn 1' },
          { role: 'assistant', content: 'Answer 1' },
          { role: 'user', content: 'Turn 2' },
        ],
      },
      { factory: () => buildStubProvider(), now: new Date('2026-05-14T12:00:00.000Z') }
    );

    const callOne = generateTextMock.mock.calls[0]![0] as { instructions: string; prompt: string };
    const callTwo = generateTextMock.mock.calls[1]![0] as { instructions: string; prompt: string };

    // Static system invariant across turns — the cache stays warm.
    expect(callOne.instructions).toBe(callTwo.instructions);

    // Turn 1 in turn-2's prompt is untouched (no historical context
    // rewriting). The latest user turn carries the fresh context block.
    expect(callTwo.prompt).toContain('User: Turn 1');
    const turn2BlockIndex = callTwo.prompt.lastIndexOf('<context>');
    expect(turn2BlockIndex).toBeGreaterThan(callTwo.prompt.indexOf('User: Turn 1'));
    expect(callTwo.prompt.slice(turn2BlockIndex)).toContain('Turn 2');
  });

  it('rejects with AI_DISABLED before calling generateText when AI is off', async () => {
    const db = getDatabase();
    const tenantId = 'cop-tenant-disabled';
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: tenantId,
      name: 'Disabled tenant',
      slug: 'cop-disabled',
      settings: {
        ai: { enabled: false, monthlyBudgetUsd: 100, providerId: 'anthropic', modelId: null },
      },
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await expectErrorCode(
      runCopilotChat(
        { db, tenantId, siteId: null, userId: null },
        { messages: [{ role: 'user', content: 'irrelevant' }] },
        { factory: () => buildStubProvider() }
      ),
      'AI_DISABLED'
    );

    // The mock should NEVER be reached on the disabled path.
    expect(generateTextMock).not.toHaveBeenCalled();
  });
});
