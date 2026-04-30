/**
 * ENG-030 — `ai` tRPC router integration tests via createCaller.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  aiAuditLog,
  cashSessions,
  companies,
  sales,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { runReadOnlySQL, validateReadOnlySQL } from '../services/ai/index.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let tenantOther: string;
let adminId: string;
let managerId: string;
let cashierId: string;
let siteId: string;

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

  adminId = nanoid();
  managerId = nanoid();
  cashierId = nanoid();
  await db.insert(users).values([
    {
      id: adminId,
      tenantId,
      email: 'ai-admin@example.com',
      passwordHash: await hash('AIPass123!'),
      name: 'AI Admin',
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: managerId,
      tenantId,
      email: 'ai-manager@example.com',
      passwordHash: await hash('AIPass123!'),
      name: 'AI Manager',
      role: 'manager',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: cashierId,
      tenantId,
      email: 'ai-cashier@example.com',
      passwordHash: await hash('AIPass123!'),
      name: 'AI Cashier',
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  const companyId = nanoid();
  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: 'Router AI Co',
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

async function insertCompletedSale(opts: {
  tenantId: string;
  siteId: string;
  cashierId: string;
  saleNumber: string;
  total: number;
  createdAt?: string;
}) {
  const db = getDatabase();
  const now = opts.createdAt ?? new Date().toISOString();
  const sessionId = nanoid();

  await db.insert(cashSessions).values({
    id: sessionId,
    tenantId: opts.tenantId,
    siteId: opts.siteId,
    cashierId: opts.cashierId,
    registerName: `Register ${nanoid(4)}`,
    openingFloat: 0,
    openingCountDenominations: [],
    expectedBalance: opts.total,
    status: 'closed',
    openedAt: now,
    closedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(sales).values({
    id: nanoid(),
    tenantId: opts.tenantId,
    saleNumber: opts.saleNumber,
    customerId: null,
    subtotal: opts.total,
    taxAmount: 0,
    discountAmount: 0,
    total: opts.total,
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    cashSessionId: sessionId,
    notes: null,
    createdBy: opts.cashierId,
    createdAt: now,
    updatedAt: now,
  });
}

describe('ai.settings.get', () => {
  it('returns sensible defaults for a fresh tenant', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    const result = await caller.ai.settings.get();
    expect(result.enabled).toBe(false);
    expect(result.monthlyBudgetUsd).toBe(0);
    expect(result.providerId).toBe('anthropic');
    expect(result.modelId).toBeNull();
    expect(result.defaultModelId).toBe('claude-haiku-4-5');
    expect(result.effectiveModelId).toBe('claude-haiku-4-5');
    expect(result.providerConfigured).toBeTypeOf('boolean');
    expect(result.currentMonthSpendUsd).toBe(0);
    expect(result.availableProviders).toHaveLength(3);
    const byId = Object.fromEntries(result.availableProviders.map(p => [p.id, p]));
    expect(byId.anthropic.isImplemented).toBe(true);
    expect(byId.openai.isImplemented).toBe(true);
    expect(byId.openai.availableInTicket).toBeUndefined();
    expect(byId.ollama.isImplemented).toBe(false);
    expect(byId.ollama.availableInTicket).toBe('ENG-040');
  });

  it('rejects cashier callers with FORBIDDEN', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: cashierId, role: 'cashier', siteId })
    );
    let caught: unknown;
    try {
      await caller.ai.settings.get();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe('FORBIDDEN');
  });
});

describe('ai.settings.update', () => {
  it('round-trips a partial patch', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    await caller.ai.settings.update({ enabled: true, monthlyBudgetUsd: 25 });
    const result = await caller.ai.settings.get();
    expect(result.enabled).toBe(true);
    expect(result.monthlyBudgetUsd).toBe(25);
  });

  it('preserves and surfaces a custom model override across partial patches', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    await caller.ai.settings.update({ modelId: 'claude-opus-4-7' });
    await caller.ai.settings.update({ enabled: true });
    const result = await caller.ai.settings.get();
    expect(result.enabled).toBe(true);
    expect(result.modelId).toBe('claude-opus-4-7');
    expect(result.defaultModelId).toBe('claude-haiku-4-5');
    expect(result.effectiveModelId).toBe('claude-opus-4-7');
  });

  it('rejects monthlyBudgetUsd below zero (Zod)', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    let caught: unknown;
    try {
      await caller.ai.settings.update({ monthlyBudgetUsd: -1 });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe('BAD_REQUEST');
  });

  it('rejects providerId pointing at a notImplemented stub', async () => {
    // ENG-044 turned OpenAI on; Ollama remains the parked stub for
    // ENG-040. Switching the assertion to ollama keeps the rejection
    // flow under test without relying on a now-implemented provider.
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    let caught: unknown;
    try {
      await caller.ai.settings.update({ providerId: 'ollama' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    expect((cause as ServerErrorWithCode).errorCode).toBe('AI_PROVIDER_ERROR');
    expect((caught as TRPCError).message).toContain('ENG-040');
  });

  it('does not leak settings between tenants', async () => {
    const callerA = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    await callerA.ai.settings.update({ enabled: true, monthlyBudgetUsd: 50 });

    // Build an admin user for tenantOther so the role guard passes.
    const db = getDatabase();
    const otherAdmin = nanoid();
    const now = new Date().toISOString();
    await db.insert(users).values({
      id: otherAdmin,
      tenantId: tenantOther,
      email: 'other-admin@example.com',
      passwordHash: await hash('AIPass123!'),
      name: 'Other Admin',
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const callerB = appRouter.createCaller(
      createCtx({ tenantId: tenantOther, userId: otherAdmin, role: 'admin' })
    );
    const otherSettings = await callerB.ai.settings.get();
    expect(otherSettings.enabled).toBe(false);
    expect(otherSettings.monthlyBudgetUsd).toBe(0);
  });
});

describe('ai.usage', () => {
  it('returns paginated rows scoped to the active tenant', async () => {
    const db = getDatabase();
    const baseTime = Date.now();
    for (let i = 0; i < 3; i += 1) {
      await db.insert(aiAuditLog).values({
        id: nanoid(),
        tenantId,
        siteId,
        userId: adminId,
        feature: 'completeTest',
        providerId: 'anthropic',
        modelId: 'claude-haiku-4-5',
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0.0001 * (i + 1),
        durationMs: 100,
        errorCode: null,
        createdAt: new Date(baseTime + i * 1000).toISOString(),
      });
    }
    // Cross-tenant noise that must not surface.
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

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    const page = await caller.ai.usage({ limit: 2 });
    expect(page.items).toHaveLength(2);
    page.items.forEach(item => {
      expect(item.tenantId).toBe(tenantId);
    });
    expect(page.nextCursor).toBeDefined();
  });
});

describe('ai.usageByBreakdown', () => {
  it('aggregates by site for the active tenant', async () => {
    const db = getDatabase();
    const otherSiteId = nanoid();
    const now = new Date().toISOString();
    const branchCompany = nanoid();
    await db.insert(companies).values({
      id: branchCompany,
      tenantId,
      name: 'Branch Co',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: otherSiteId,
      tenantId,
      companyId: branchCompany,
      name: 'Branch',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    for (const [site, cost] of [
      [siteId, 0.4],
      [siteId, 0.1],
      [otherSiteId, 0.25],
    ] as const) {
      await db.insert(aiAuditLog).values({
        id: nanoid(),
        tenantId,
        siteId: site,
        userId: adminId,
        feature: 'completeTest',
        providerId: 'anthropic',
        modelId: 'claude-haiku-4-5',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: cost,
        durationMs: 1,
        errorCode: null,
        createdAt: now,
      });
    }
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    const buckets = await caller.ai.usageByBreakdown({ scope: 'site' });
    const bySite = Object.fromEntries(buckets.map(b => [b.scopeKey, b]));
    expect(bySite[siteId]?.totalCostUsd).toBeCloseTo(0.5, 6);
    expect(bySite[siteId]?.callCount).toBe(2);
    expect(bySite[otherSiteId]?.totalCostUsd).toBeCloseTo(0.25, 6);
  });
});

describe('ai.completeTest', () => {
  it('throws AI_DISABLED when the tenant has not enabled AI', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    let caught: unknown;
    try {
      await caller.ai.completeTest();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause;
    expect((cause as ServerErrorWithCode).errorCode).toBe('AI_DISABLED');
  });

  it('throws AI_PROVIDER_ERROR when ANTHROPIC_API_KEY is missing', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    await caller.ai.settings.update({ enabled: true, monthlyBudgetUsd: 5 });

    const original = process.env.ANTHROPIC_API_KEY;
    try {
      delete process.env.ANTHROPIC_API_KEY;
      let caught: unknown;
      try {
        await caller.ai.completeTest();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TRPCError);
      const cause = (caught as TRPCError).cause;
      expect((cause as ServerErrorWithCode).errorCode).toBe('AI_PROVIDER_ERROR');
    } finally {
      if (original !== undefined) {
        process.env.ANTHROPIC_API_KEY = original;
      }
    }
  });

  it('rejects cashier callers with FORBIDDEN', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: cashierId, role: 'cashier', siteId })
    );
    let caught: unknown;
    try {
      await caller.ai.completeTest();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe('FORBIDDEN');
  });
});

describe('ai.copilot.chat', () => {
  it('allows manager callers through the role guard and preserves AI_DISABLED', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: managerId, role: 'manager', siteId })
    );

    let caught: unknown;
    try {
      await caller.ai.copilot.chat({
        messages: [{ role: 'user', content: 'Cuanto vendi ayer en Sur?' }],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    expect((cause as ServerErrorWithCode).errorCode).toBe('AI_DISABLED');
  });

  it('rejects cashier callers with FORBIDDEN', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: cashierId, role: 'cashier', siteId })
    );

    let caught: unknown;
    try {
      await caller.ai.copilot.chat({
        messages: [{ role: 'user', content: 'Show sales today' }],
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe('FORBIDDEN');
  });

  it('keeps provider-missing failures on the existing AI_PROVIDER_ERROR code', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    await caller.ai.settings.update({ enabled: true, monthlyBudgetUsd: 5 });

    const original = process.env.ANTHROPIC_API_KEY;
    try {
      delete process.env.ANTHROPIC_API_KEY;
      let caught: unknown;
      try {
        await caller.ai.copilot.chat({
          messages: [{ role: 'user', content: 'Show sales today' }],
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(TRPCError);
      const cause = (caught as TRPCError).cause;
      expect(cause).toBeInstanceOf(ServerErrorWithCode);
      expect((cause as ServerErrorWithCode).errorCode).toBe('AI_PROVIDER_ERROR');
    } finally {
      if (original !== undefined) {
        process.env.ANTHROPIC_API_KEY = original;
      }
    }
  });

  it('returns the existing AI_BUDGET_EXCEEDED code before calling the provider', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    await caller.ai.settings.update({ enabled: true, monthlyBudgetUsd: 1 });
    await getDatabase().insert(aiAuditLog).values({
      id: nanoid(),
      tenantId,
      siteId,
      userId: adminId,
      feature: 'completeTest',
      providerId: 'anthropic',
      modelId: 'claude-haiku-4-5',
      inputTokens: 10,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 1.5,
      durationMs: 10,
      errorCode: null,
      createdAt: new Date().toISOString(),
    });

    const original = process.env.ANTHROPIC_API_KEY;
    try {
      process.env.ANTHROPIC_API_KEY = 'test-key';
      let caught: unknown;
      try {
        await caller.ai.copilot.chat({
          messages: [{ role: 'user', content: 'Show sales today' }],
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(TRPCError);
      const cause = (caught as TRPCError).cause;
      expect(cause).toBeInstanceOf(ServerErrorWithCode);
      expect((cause as ServerErrorWithCode).errorCode).toBe('AI_BUDGET_EXCEEDED');
    } finally {
      if (original === undefined) {
        delete process.env.ANTHROPIC_API_KEY;
      } else {
        process.env.ANTHROPIC_API_KEY = original;
      }
    }
  });
});

describe('runReadOnlySQL', () => {
  it('rejects mutations, pragmas, multiple statements, and non-snapshot tables', () => {
    const blocked = [
      'UPDATE sales_summary SET total = 0',
      'DELETE FROM sales_summary',
      'DROP TABLE sales_summary',
      'PRAGMA table_info(sales_summary)',
      'ATTACH DATABASE "x" AS x',
      'SELECT 1; SELECT 2',
      'SELECT * FROM sales',
    ];

    for (const query of blocked) {
      let caught: unknown;
      try {
        validateReadOnlySQL(query);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TRPCError);
      const cause = (caught as TRPCError).cause;
      expect(cause).toBeInstanceOf(ServerErrorWithCode);
      expect((cause as ServerErrorWithCode).errorCode).toBe('AI_COPILOT_SQL_REJECTED');
    }

    expect(() =>
      validateReadOnlySQL(
        'WITH daily AS (SELECT sale_date, SUM(total) AS revenue FROM sales_summary GROUP BY sale_date) SELECT * FROM daily'
      )
    ).not.toThrow();
  });

  it('executes only against the tenant-scoped in-memory analytics snapshot', async () => {
    const db = getDatabase();
    const now = new Date().toISOString();

    const saleNumber = `AI-SALE-${nanoid(6)}`;
    await insertCompletedSale({
      tenantId,
      siteId,
      cashierId: adminId,
      saleNumber,
      total: 120,
      createdAt: now,
    });

    const otherAdmin = nanoid();
    const otherCompany = nanoid();
    const otherSite = nanoid();
    await db.insert(users).values({
      id: otherAdmin,
      tenantId: tenantOther,
      email: `other-ai-${nanoid(6)}@example.com`,
      passwordHash: await hash('AIPass123!'),
      name: 'Other AI Admin',
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companies).values({
      id: otherCompany,
      tenantId: tenantOther,
      name: `Other AI Co ${nanoid(4)}`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: otherSite,
      tenantId: tenantOther,
      companyId: otherCompany,
      name: 'Sur',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await insertCompletedSale({
      tenantId: tenantOther,
      siteId: otherSite,
      cashierId: otherAdmin,
      saleNumber: `OTHER-SALE-${nanoid(6)}`,
      total: 999,
      createdAt: now,
    });

    const result = await runReadOnlySQL(db, tenantId, {
      query: `SELECT site_name, SUM(total) AS revenue FROM sales_summary WHERE sale_number = '${saleNumber}' GROUP BY site_name`,
    });

    expect(result.columns).toEqual(['site_name', 'revenue']);
    expect(result.rows).toEqual([
      {
        site_name: 'Main Site',
        revenue: 120,
      },
    ]);
    expect(result.chart).toEqual({
      type: 'bar',
      labelKey: 'site_name',
      valueKey: 'revenue',
    });
  });
});
