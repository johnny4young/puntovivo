/**
 * ENG-077 — Pin the Anthropic prompt-cache contract on the co-pilot.
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
import { aiAuditLog, companies, sites, tenants } from '../db/schema.js';
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

async function seedTenantWithAI(suffix: string): Promise<{ tenantId: string; siteId: string }> {
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

function mockGenerateTextSuccess(textAnswer: string): void {
  generateTextMock.mockResolvedValue({
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
  });
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
    mockGenerateTextSuccess('Total vendido ayer: $0');

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
  });

  it('omits providerOptions when the provider returns undefined (OpenAI path, no regression)', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('openai');
    mockGenerateTextSuccess('OK');

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
    mockGenerateTextSuccess('Resumen');

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
    expect(row).toMatchObject({
      tenantId,
      feature: 'copilot',
      providerId: 'anthropic',
      inputTokens: 1200,
      outputTokens: 300,
      cacheReadTokens: 800,
      cacheWriteTokens: 200,
      errorCode: null,
    });
  });

  it('regenerates the context block on a follow-up call so the latest window flows through', async () => {
    const { tenantId, siteId } = await seedTenantWithAI('multi-turn');
    mockGenerateTextSuccess('Answer 1');

    await runCopilotChat(
      { db: getDatabase(), tenantId, siteId, userId: null },
      { messages: [{ role: 'user', content: 'Turn 1' }] },
      { factory: () => buildStubProvider(), now: new Date('2026-05-13T12:00:00.000Z') }
    );

    mockGenerateTextSuccess('Answer 2');
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
      settings: { ai: { enabled: false, monthlyBudgetUsd: 100, providerId: 'anthropic', modelId: null } },
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
