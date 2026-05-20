/**
 * ENG-030 — `ai` tRPC router integration tests via createCaller.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  aiAuditLog,
  auditLogs,
  cashSessions,
  companies,
  invoiceUploads,
  products,
  providers,
  purchaseItems,
  sales,
  sequentials,
  sites,
  tenants,
  units,
  unitXProduct,
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
    // ENG-040b slice 1 — Ollama activated.
    expect(byId.ollama.isImplemented).toBe(true);
    expect(byId.ollama.availableInTicket).toBeUndefined();
  });

  it('reports transcriptionAvailable=false for the default Anthropic tenant (ENG-040c slice 2)', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    const result = await caller.ai.settings.get();
    // Anthropic provider does not expose `transcriptionModel`, so the
    // capability hint must be false — the AI settings UI uses this
    // to disable the Test transcription button.
    expect(result.transcriptionAvailable).toBe(false);
  });

  it('reports transcriptionAvailable=true once the tenant switches to OpenAI (ENG-040c slice 2)', async () => {
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
        settings: {
          ...settings,
          ai: {
            enabled: true,
            monthlyBudgetUsd: 100,
            providerId: 'openai',
            modelId: null,
          },
        },
      })
      .where(eq(tenants.id, tenantId));

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    const result = await caller.ai.settings.get();
    expect(result.transcriptionAvailable).toBe(true);
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

describe('ai.invoiceOcr.confirm', () => {
  it('creates a draft purchase and writes the confirm audit row', async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const providerId = nanoid();
    const productId = nanoid();
    const unitId = nanoid();
    const uploadId = `ocr-upload-${nanoid(6)}`;

    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Lacteos El Campo S.A.S.',
      taxId: '900421118-3',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(units).values({
      id: unitId,
      tenantId,
      name: 'Unidad',
      abbreviation: 'un',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(products).values({
      id: productId,
      tenantId,
      name: 'Yogurt fresa 200g',
      sku: `YOG-${nanoid(4)}`,
      cost: 5000,
      price: 7000,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId,
      equivalence: 1,
      price: 7000,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sequentials).values({
      id: nanoid(),
      tenantId,
      siteId,
      documentType: 'purchase',
      prefix: 'COM-',
      currentValue: 41,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(invoiceUploads).values({
      id: uploadId,
      tenantId,
      siteId,
      userId: adminId,
      fileName: 'factura.png',
      mimeType: 'image/png',
      sizeBytes: 128,
      payloadBase64: Buffer.from('invoice fixture').toString('base64'),
      payloadHash: 'test-upload-hash',
      createdAt: now,
    });

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    await caller.ai.settings.update({
      enabled: true,
      features: { invoiceOcr: { enabled: true, provider: 'textract' } },
    });

    const result = await caller.ai.invoiceOcr.confirm({
      uploadId,
      extractAuditId: 'ai-audit-extract-1',
      providerId,
      supplier: { name: 'Lacteos El Campo S.A.S.', nit: '900421118-3' },
      invoiceNumber: 'FAC-001-2026',
      totals: { subtotal: 10_000, iva: 1900, total: 11_900, linesSum: 11_900 },
      lines: [
        {
          description: 'Yogurt fresa 200g',
          quantity: 2,
          unitPrice: 5000,
          matchedProductId: productId,
          unitId,
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.purchase.purchaseNumber).toBe('COM-000042');
    expect(result.purchase.status).toBe('draft');
    expect(result.purchase.total).toBe(10_000);

    const insertedItems = await db
      .select()
      .from(purchaseItems)
      .where(eq(purchaseItems.purchaseId, result.purchase.id))
      .all();
    expect(insertedItems).toHaveLength(1);
    expect(insertedItems[0].productId).toBe(productId);
    expect(insertedItems[0].quantity).toBe(2);

    const audit = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'ai.invoice_ocr.confirm'), eq(auditLogs.resourceId, uploadId)))
      .get();
    expect(audit?.actorId).toBe(adminId);
    expect(audit?.metadata).toMatchObject({
      purchaseId: result.purchase.id,
      purchaseNumber: 'COM-000042',
      extractAuditId: 'ai-audit-extract-1',
      payloadHash: 'test-upload-hash',
      lineCount: 1,
    });
  });

  it('rejects confirmation when reviewed totals drift by more than 100 COP', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    await caller.ai.settings.update({
      enabled: true,
      features: { invoiceOcr: { enabled: true, provider: 'textract' } },
    });

    await expect(
      caller.ai.invoiceOcr.confirm({
        uploadId: 'totals-drift-upload',
        extractAuditId: 'ai-audit-extract-2',
        providerId: 'provider-does-not-matter-before-total-guard',
        supplier: { name: 'Proveedor', nit: null },
        invoiceNumber: null,
        totals: { subtotal: 10_000, iva: 1900, total: 11_900, linesSum: 11_700 },
        lines: [
          {
            description: 'Yogurt fresa 200g',
            quantity: 2,
            unitPrice: 5000,
            matchedProductId: 'product-id',
            unitId: 'unit-id',
          },
        ],
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('rejects confirmation when the upload id was not created for this tenant', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    await caller.ai.settings.update({
      enabled: true,
      features: { invoiceOcr: { enabled: true, provider: 'textract' } },
    });

    await expect(
      caller.ai.invoiceOcr.confirm({
        uploadId: 'missing-upload-id',
        extractAuditId: 'ai-audit-extract-3',
        providerId: 'provider-not-read-before-upload-guard',
        supplier: { name: 'Proveedor', nit: null },
        invoiceNumber: null,
        totals: { subtotal: 10_000, iva: 1900, total: 11_900, linesSum: 11_900 },
        lines: [
          {
            description: 'Yogurt fresa 200g',
            quantity: 2,
            unitPrice: 5000,
            matchedProductId: 'product-not-read-before-upload-guard',
            unitId: 'unit-not-read-before-upload-guard',
          },
        ],
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
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

  it('rejects unknown providerId values via the Zod enum', async () => {
    // ENG-040b slice 1 — Ollama is now implemented, so no parked stub
    // remains in the registry. The notImplemented-rejection branch in
    // the router (it throws AI_PROVIDER_ERROR with the ticket hint)
    // stays in place for any future stub but cannot be exercised here.
    // Zod's enum validation on providerId still rejects unknown ids
    // with BAD_REQUEST — pin that boundary as the active gate.
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    let caught: unknown;
    try {
      await caller.ai.settings.update({
        // @ts-expect-error — deliberately bypass the typed input to
        // exercise the Zod enum refusal at runtime.
        providerId: 'totally-not-a-provider',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe('BAD_REQUEST');
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
    await caller.ai.settings.update({
      enabled: true,
      monthlyBudgetUsd: 5,
      features: { copilot: { enabled: true } },
    });

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
    await caller.ai.settings.update({
      enabled: true,
      monthlyBudgetUsd: 5,
      features: { copilot: { enabled: true } },
    });

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
    await caller.ai.settings.update({
      enabled: true,
      monthlyBudgetUsd: 1,
      features: { copilot: { enabled: true } },
    });
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

    const saleNumber = `AI-SALE-${nanoid(6).replaceAll('-', '0')}`;
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

describe('ai.anomalies.list', () => {
  it('rejects cashier callers with FORBIDDEN (manager+ only)', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: cashierId, role: 'cashier', siteId })
    );
    let caught: unknown;
    try {
      await caller.ai.anomalies.list({});
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe('FORBIDDEN');
  });

  it('returns an empty result without querying when ai.enabled is false', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    const result = await caller.ai.anomalies.list({});
    expect(result.enabled).toBe(false);
    expect(result.totalCount).toBe(0);
    expect(result.alerts).toEqual([]);
    expect(result.severityCounts).toEqual({ medium: 0, high: 0 });
    expect(result.kindCounts).toEqual({
      ticketsPerHourSpike: 0,
      voidRate: 0,
      refundAmount: 0,
      noSaleSessions: 0,
    });
    expect(typeof result.computedAt).toBe('string');
  });

  it('allows manager callers without requiring admin-only settings access', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: managerId, role: 'manager', siteId })
    );
    const result = await caller.ai.anomalies.list({});
    expect(result.enabled).toBe(false);
    expect(result.totalCount).toBe(0);
  });

  it('runs the detectors when ai.enabled is true (returns valid shape, may be empty)', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    await caller.ai.settings.update({
      enabled: true,
      features: { anomalies: { enabled: true } },
    });
    const result = await caller.ai.anomalies.list({});
    expect(result.enabled).toBe(true);
    expect(Array.isArray(result.alerts)).toBe(true);
    expect(result.totalCount).toBe(result.alerts.length);
    expect(result.severityCounts).toBeDefined();
    expect(result.kindCounts).toBeDefined();
  });

  it('rejects from > to with BAD_REQUEST', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    await caller.ai.settings.update({
      enabled: true,
      features: { anomalies: { enabled: true } },
    });
    let caught: unknown;
    try {
      await caller.ai.anomalies.list({
        from: '2026-04-30T00:00:00.000Z',
        to: '2026-04-29T00:00:00.000Z',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe('BAD_REQUEST');
  });

  it('does not leak alerts across tenants', async () => {
    // Tenant other no tiene settings AI activado por defecto, así que
    // su list devuelve [] aunque tengamos data en tenantId. Pinea
    // multi-tenant via su propia configuración.
    const db = getDatabase();
    const otherAdmin = nanoid();
    const now = new Date().toISOString();
    await db.insert(users).values({
      id: otherAdmin,
      tenantId: tenantOther,
      email: `other-anom-${nanoid(6)}@example.com`,
      passwordHash: await hash('AnomPass123!'),
      name: 'Other Anom Admin',
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const callerOther = appRouter.createCaller(
      createCtx({ tenantId: tenantOther, userId: otherAdmin, role: 'admin' })
    );
    const result = await callerOther.ai.anomalies.list({});
    expect(result.alerts).toEqual([]);
  });
});

describe('ai.extractInvoiceLines (ENG-040a)', () => {
  it('rejects a cashier caller with FORBIDDEN', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: cashierId, role: 'cashier', siteId })
    );
    let caught: unknown;
    try {
      await caller.ai.extractInvoiceLines({
        imageBase64: 'aGVsbG8=',
        mimeType: 'image/png',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe('FORBIDDEN');
  });

  it('rejects with AI_DISABLED when the tenant has not opted in', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    await caller.ai.settings.update({ enabled: false });
    let caught: unknown;
    try {
      await caller.ai.extractInvoiceLines({
        imageBase64: 'aGVsbG8=',
        mimeType: 'image/png',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    expect((cause as ServerErrorWithCode).errorCode).toBe('AI_DISABLED');
  });

  it('strips a data:image/...;base64, URL prefix before reaching the service', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: managerId, role: 'manager', siteId })
    );
    await appRouter
      .createCaller(createCtx({ tenantId, userId: adminId, role: 'admin', siteId }))
      .ai.settings.update({ enabled: true, monthlyBudgetUsd: 10 });
    let caught: unknown;
    try {
      await caller.ai.extractInvoiceLines({
        imageBase64: 'data:image/png;base64,aGVsbG8=',
        mimeType: 'image/png',
      });
    } catch (error) {
      caught = error;
    }
    // We expect the configured provider to be missing its API key in
    // the test environment, so the call surfaces AI_PROVIDER_ERROR
    // (not a Zod parse error caused by the data-URL prefix).
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    expect((cause as ServerErrorWithCode).errorCode).toBe('AI_PROVIDER_ERROR');
  });

  it('applies the invoice OCR quota to the legacy extract endpoint before provider calls', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    await caller.ai.settings.update({ enabled: true, monthlyBudgetUsd: 10 });
    const db = getDatabase();
    const now = new Date().toISOString();
    const rows = Array.from({ length: 200 }, () => ({
      id: nanoid(),
      tenantId,
      siteId,
      userId: adminId,
      feature: 'invoiceOcr',
      providerId: 'anthropic',
      modelId: 'claude-haiku-4-5',
      inputTokens: 10,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.001,
      durationMs: 10,
      errorCode: null,
      createdAt: now,
    }));
    await db.insert(aiAuditLog).values(rows);

    let caught: unknown;
    try {
      await caller.ai.extractInvoiceLines({
        imageBase64: 'data:image/png;base64,aGVsbG8=',
        mimeType: 'image/png',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    expect((cause as ServerErrorWithCode).errorCode).toBe('AI_QUOTA_EXCEEDED');
  });

  it('rejects an unsupported mime type via Zod', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin', siteId })
    );
    let caught: unknown;
    try {
      await caller.ai.extractInvoiceLines({
        imageBase64: 'aGVsbG8=',
        // @ts-expect-error — intentional invalid mime to exercise the Zod enum guard
        mimeType: 'image/gif',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe('BAD_REQUEST');
  });
});
