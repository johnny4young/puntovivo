import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { TRPCError } from '@trpc/server';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModelV4GenerateResult } from '@ai-sdk/provider';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  companies,
  customers,
  products,
  saleItems,
  sales,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { runCopilotChat, runReadOnlySQL } from '../services/ai/copilot.js';
import type { CopilotChatMessage } from '../services/ai/copilot.js';
import { resolveAISettings } from '../services/ai/client.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import type { AIProvider } from '../services/ai/providers/types.js';

const NOW = new Date('2026-09-21T12:00:00Z');
const CUSTOMER = 'Zoë PrivacidadCanario';
const CASHIER = 'Óscar CajaCanario';
let server: PuntovivoServer;
let tenantId: string;
let siteId: string;
let userId: string;
let customerId: string;
let firstSaleId: string;

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  tenantId = nanoid();
  siteId = nanoid();
  userId = `staff-canary-${nanoid()}`;
  const companyId = nanoid();
  customerId = nanoid();
  const homonymId = nanoid();
  const sessionId = nanoid();
  await db.insert(tenants).values({
    id: tenantId,
    name: 'Privacy test',
    slug: nanoid(),
    settings: {
      ai: {
        enabled: true,
        monthlyBudgetUsd: 100,
        features: { copilot: { enabled: true }, privacy: { piiRedaction: true } },
      },
    },
  });
  await db.insert(companies).values({ id: companyId, tenantId, name: 'Test company' });
  await db.insert(sites).values({ id: siteId, tenantId, companyId, name: 'Main' });
  await db.insert(users).values({
    id: userId,
    tenantId,
    name: CASHIER,
    email: `${nanoid()}@example.invalid`,
    passwordHash: 'not-a-login-fixture',
    role: 'admin',
    isActive: false,
  });
  await db.insert(customers).values([
    { id: customerId, tenantId, name: CUSTOMER },
    { id: homonymId, tenantId, name: CUSTOMER },
  ]);
  await db.insert(cashSessions).values({
    id: sessionId,
    tenantId,
    siteId,
    cashierId: userId,
    registerName: 'Test',
    openingFloat: 0,
    openingCountDenominations: [],
    expectedBalance: 300,
    status: 'closed',
    openedAt: NOW.toISOString(),
    closedAt: NOW.toISOString(),
  });
  for (const [index, customer] of [customerId, homonymId, null].entries()) {
    const saleId = nanoid();
    if (index === 0) firstSaleId = saleId;
    await db.insert(sales).values({
      id: saleId,
      tenantId,
      saleNumber: `PRIV-${index}`,
      customerId: customer,
      subtotal: 100,
      taxAmount: 0,
      discountAmount: 0,
      total: 100,
      paymentMethod: 'cash',
      paymentStatus: 'paid',
      status: 'completed',
      cashSessionId: sessionId,
      createdBy: userId,
      createdAt: NOW.toISOString(),
    });
  }
});
afterAll(async () => {
  if (server) await server.close();
});

function step(query?: string): LanguageModelV4GenerateResult {
  return {
    content: query
      ? [
          {
            type: 'tool-call',
            toolCallId: nanoid(),
            toolName: 'runReadOnlySQL',
            input: JSON.stringify({ query }),
          },
        ]
      : [{ type: 'text', text: 'Three sales.' }],
    finishReason: { unified: query ? 'tool-calls' : 'stop', raw: undefined },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 5, text: 5, reasoning: 0 },
    },
    warnings: [],
  };
}

async function chat(
  query: string,
  messages: CopilotChatMessage[] = [{ role: 'user', content: 'Show sales' }]
) {
  const model = new MockLanguageModelV4({ doGenerate: [step(query), step()] });
  const provider: AIProvider = {
    id: 'anthropic',
    defaultModelId: 'privacy-test',
    isConfigured: () => true,
    languageModel: () => model,
    cacheControlForSystemPrompt: () => undefined,
    pricing: { models: {}, calculateCostUsd: () => 0 },
  };
  const result = await runCopilotChat(
    { db: getDatabase(), tenantId, siteId, userId },
    { messages },
    { now: NOW, factory: () => provider }
  );
  return { result, calls: model.doGenerateCalls };
}

function expectProtected(calls: unknown) {
  const serialized = JSON.stringify(calls);
  for (const canary of [CUSTOMER, CASHIER, userId]) {
    expect(serialized).not.toContain(canary);
    expect(serialized).not.toContain(Buffer.from(canary).toString('hex').toUpperCase());
  }
}

describe('copilot provider boundary (real AI SDK, no remote calls)', () => {
  it('protects old history and the current turn, not only SQL output', async () => {
    const { calls } = await chat('SELECT COUNT(*) AS n, SUM(total) AS amount FROM sales_summary', [
      { role: 'user', content: `Earlier: ${CUSTOMER}, ${CASHIER}, ${userId}` },
      { role: 'assistant', content: `Earlier answer: ${CUSTOMER}, ${CASHIER}, ${userId}` },
      { role: 'user', content: `Compare ${CUSTOMER} again` },
    ]);
    expect(calls).toHaveLength(2);
    expectProtected(calls);
  });

  it('protects identities before aliases, substrings, hex and aggregation can transform them', async () => {
    const { calls, result } = await chat(`SELECT cashier_id AS actor, upper(cashier_name) AS a,
      hex(customer_name) AS b, substr(customer_name, 1, 3) AS c,
      group_concat(customer_name) AS d, SUM(total) AS amount FROM sales_summary GROUP BY cashier_id`);
    expect(calls).toHaveLength(2);
    expectProtected(calls);
    expect(result.rows[0]?.amount).toBe(300);
    expect(result.rows[0]?.c).not.toBe(CUSTOMER.slice(0, 3));
    expect(JSON.stringify(calls)).not.toContain(CASHIER.toUpperCase());
  });

  it('preserves NULL, counts and name grouping without changing local SQL identity access', async () => {
    const query =
      'SELECT customer_name, COUNT(*) AS n, SUM(total) AS amount FROM sales_summary GROUP BY customer_name ORDER BY n';
    const local = await runReadOnlySQL(getDatabase(), tenantId, { query }, NOW);
    expect(local.rows).toEqual([
      { customer_name: null, n: 1, amount: 100 },
      { customer_name: CUSTOMER, n: 2, amount: 200 },
    ]);
    const { result, calls } = await chat(query);
    expect(result.rows.map(row => [row.n, row.amount])).toEqual([
      [1, 100],
      [2, 200],
    ]);
    expect(result.rows[0]?.customer_name).toBeNull();
    expectProtected(calls);
  });

  it('does not expose SQLite diagnostics from a rejected analytics query', async () => {
    const secret = 'PRIVATE_SQL_IDENTIFIER_IN_ERROR';
    let caught: unknown;
    try {
      await runReadOnlySQL(
        getDatabase(),
        tenantId,
        { query: `SELECT ${secret} FROM sales_summary` },
        NOW
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).message).toBe('Analytics SQL failed');
    expect((caught as TRPCError).message).not.toContain(secret);
    expect(((caught as TRPCError).cause as ServerErrorWithCode).errorCode).toBe(
      'AI_COPILOT_SQL_REJECTED'
    );
  });

  it('never reassigns a previous invocation label to a different identity', async () => {
    const query = 'SELECT customer_name FROM sales_summary WHERE customer_name IS NOT NULL LIMIT 1';
    const first = await chat(query);
    const second = await chat(query);
    expect(first.result.rows[0]?.customer_name).not.toBe(second.result.rows[0]?.customer_name);
    expectProtected([first.calls, second.calls]);
  });

  it('does not rewrite SQL syntax when a known identity is named Total or Select', async () => {
    const db = getDatabase();
    try {
      await db.update(customers).set({ name: 'Total' }).where(eq(customers.id, customerId));
      await db.update(users).set({ name: 'Select' }).where(eq(users.id, userId));
      const { result } = await chat('SELECT SUM(total) AS amount FROM sales_summary LIMIT 1');
      expect(result.rows).toEqual([{ amount: 300 }]);
    } finally {
      await db.update(customers).set({ name: CUSTOMER }).where(eq(customers.id, customerId));
      await db.update(users).set({ name: CASHIER }).where(eq(users.id, userId));
    }
  });

  it('protects matching names in operational labels and preserves useful line-item joins', async () => {
    const db = getDatabase();
    const productId = nanoid();
    const itemId = nanoid();
    await db.insert(products).values({
      id: productId,
      tenantId,
      name: `Gift for ${CUSTOMER}`,
      sku: `SKU-${CUSTOMER}`,
      price: 100,
    });
    await db.insert(saleItems).values({
      id: itemId,
      saleId: firstSaleId,
      productId,
      quantity: 1,
      unitPrice: 100,
      discount: 0,
      taxRate: 0,
      taxAmount: 0,
      total: 100,
    });
    try {
      const { result, calls } =
        await chat(`SELECT p.product_name, p.sku, SUM(p.line_total) AS amount
        FROM sale_line_items p JOIN sales_summary s ON p.sale_id = s.sale_id GROUP BY p.product_name, p.sku`);
      expect(result.rows[0]?.amount).toBe(100);
      expect(result.rows[0]?.product_name).toMatch(/^Gift for person_/);
      expectProtected(calls);
    } finally {
      await db.delete(saleItems).where(eq(saleItems.id, itemId));
      await db.delete(products).where(eq(products.id, productId));
    }
  });

  it('does not join a foreign customer even when a stored reference is inconsistent', async () => {
    const db = getDatabase();
    const foreignTenant = nanoid();
    const foreignCustomer = nanoid();
    await db.insert(tenants).values({ id: foreignTenant, slug: nanoid(), name: 'Other tenant' });
    await db
      .insert(customers)
      .values({ id: foreignCustomer, tenantId: foreignTenant, name: 'FOREIGN-CANARY' });
    try {
      await db.update(sales).set({ customerId: foreignCustomer }).where(eq(sales.id, firstSaleId));
      const { result, calls } = await chat('SELECT customer_name FROM sales_summary');
      expect(result.rows).toHaveLength(3);
      expect(JSON.stringify(calls)).not.toContain('FOREIGN-CANARY');
      expect(result.rows.filter(row => row.customer_name === null)).toHaveLength(2);
    } finally {
      await db.update(sales).set({ customerId }).where(eq(sales.id, firstSaleId));
    }
  });

  it('returns only protected data after a SQL tool error and a successful retry', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: [
        step('SELECT missing_column FROM sales_summary'),
        step(
          'SELECT customer_name, SUM(total) AS amount FROM sales_summary GROUP BY customer_name'
        ),
        step(),
      ],
    });
    const result = await runCopilotChat(
      { db: getDatabase(), tenantId, siteId, userId },
      { messages: [{ role: 'user', content: `Check ${CUSTOMER}` }] },
      {
        now: NOW,
        factory: () => ({
          id: 'anthropic',
          defaultModelId: 'test',
          isConfigured: () => true,
          languageModel: () => model,
          cacheControlForSystemPrompt: () => undefined,
          pricing: { models: {}, calculateCostUsd: () => 0 },
        }),
      }
    );
    expect(model.doGenerateCalls).toHaveLength(3);
    expectProtected(model.doGenerateCalls);
    expect(result.rows.reduce((sum, row) => sum + Number(row.amount), 0)).toBe(300);
  });

  it('uses the same projected identity for exact filtering across tool steps', async () => {
    let call = 0;
    const model = new MockLanguageModelV4({
      doGenerate: async options => {
        call++;
        if (call === 1)
          return step(
            'SELECT customer_name FROM sales_summary WHERE customer_name IS NOT NULL LIMIT 1'
          );
        if (call === 2) {
          const serialized = JSON.stringify(options.prompt);
          const token = serialized.match(/person_[a-f0-9-]+_\d+/)?.[0];
          expect(token).toBeTruthy();
          return step(
            `SELECT SUM(total) AS amount FROM sales_summary WHERE customer_name = '${token}'`
          );
        }
        return step();
      },
    });
    const result = await runCopilotChat(
      { db: getDatabase(), tenantId, siteId, userId },
      { messages: [{ role: 'user', content: `Check ${CUSTOMER}` }] },
      {
        now: NOW,
        factory: () => ({
          id: 'anthropic',
          defaultModelId: 'test',
          isConfigured: () => true,
          languageModel: () => model,
          cacheControlForSystemPrompt: () => undefined,
          pricing: { models: {}, calculateCostUsd: () => 0 },
        }),
      }
    );
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(result.rows).toEqual([{ amount: 200 }]);
    expectProtected(model.doGenerateCalls);
  });

  it('closes the private snapshot after a provider failure', async () => {
    const close = vi.spyOn(Database.prototype, 'close');
    const secret = 'PRIVATE_COPILOT_HISTORY_IN_PROVIDER_ERROR';
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error(`Provider unavailable ${secret}`);
      },
    });
    try {
      let caught: unknown;
      try {
        await runCopilotChat(
          { db: getDatabase(), tenantId, siteId, userId },
          { messages: [{ role: 'user', content: CUSTOMER }] },
          {
            now: NOW,
            factory: () => ({
              id: 'anthropic',
              defaultModelId: 'test',
              isConfigured: () => true,
              languageModel: () => model,
              cacheControlForSystemPrompt: () => undefined,
              pricing: { models: {}, calculateCostUsd: () => 0 },
            }),
          }
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TRPCError);
      expect((caught as TRPCError).message).toBe('AI provider call failed');
      expect((caught as TRPCError).message).not.toContain(secret);
      expect(((caught as TRPCError).cause as ServerErrorWithCode).details).toBeUndefined();
      expect(close).toHaveBeenCalledOnce();
      expect(model.doGenerateCalls).toHaveLength(1);
      expectProtected(model.doGenerateCalls);
    } finally {
      close.mockRestore();
    }
  });

  it('does not trust a provider-originated TRPCError as an internal safe error', async () => {
    const secret = 'PRIVATE_COPILOT_TRPC_IN_PROVIDER_ERROR';
    const model = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new TRPCError({ code: 'BAD_GATEWAY', message: secret });
      },
    });
    let caught: unknown;
    try {
      await runCopilotChat(
        { db: getDatabase(), tenantId, siteId, userId },
        { messages: [{ role: 'user', content: CUSTOMER }] },
        {
          now: NOW,
          factory: () => ({
            id: 'anthropic',
            defaultModelId: 'test',
            isConfigured: () => true,
            languageModel: () => model,
            cacheControlForSystemPrompt: () => undefined,
            pricing: { models: {}, calculateCostUsd: () => 0 },
          }),
        }
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).message).toBe('AI provider call failed');
    expect((caught as TRPCError).message).not.toContain(secret);
    expect(((caught as TRPCError).cause as ServerErrorWithCode).errorCode).toBe(
      'AI_PROVIDER_ERROR'
    );
  });

  it('does not advertise universal PII redaction for other AI paths or stored legacy settings', async () => {
    const settings = await resolveAISettings(getDatabase(), tenantId);
    expect(settings.features?.privacy.piiRedaction).toBe(false);
  });
});
