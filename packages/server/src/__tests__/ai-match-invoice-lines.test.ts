/**
 * ENG-040 slice 1b — `ai.matchInvoiceLines` integration tests.
 *
 * Drives the procedure via `createCaller` against an in-memory database
 * + a stubbed `ai` SDK so no real embedding round-trip is needed. The
 * embedding pipeline is exercised through the production code path
 * (`embedTexts` → `resolveEmbeddingProvider` → mocked `embedMany`); the
 * cosine math runs against vectors seeded directly into
 * `products.embedding` so each test controls which line matches which
 * product.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';
import type { EmbeddingModelV4 } from '@ai-sdk/provider';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  aiAuditLog,
  products,
  tenants,
  unitXProduct,
  units,
  users,
} from '../db/schema.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;

const embedManyMock = vi.fn();
const embedMock = vi.fn();

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    embed: (...args: unknown[]) => embedMock(...args),
    embedMany: (...args: unknown[]) => embedManyMock(...args),
  };
});

// Stub the OpenAI provider's `embeddingModel` so `resolveEmbeddingProvider`
// returns it. The shape of the returned model object is irrelevant — the
// mocked `embedMany` ignores it.
vi.mock('../services/ai/providers/openai.js', async () => {
  const actual = await vi.importActual<typeof import('../services/ai/providers/openai.js')>(
    '../services/ai/providers/openai.js'
  );
  return {
    ...actual,
    openaiProvider: {
      ...actual.openaiProvider,
      isConfigured: () => true,
      embeddingModel: (_modelId: string) => ({}) as EmbeddingModelV4<string>,
    },
  };
});

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

interface SeedProduct {
  id: string;
  name: string;
  sku: string;
  cost?: number;
  stock?: number;
  embedding?: number[] | null;
}

async function seedTenant(
  suffix: string,
  options: { aiEnabled?: boolean } = {}
): Promise<{ tenantId: string; adminId: string; cashierId: string }> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `mlines-${suffix}-${nanoid(4)}`;
  await db.insert(tenants).values({
    id: tenantId,
    name: `Matcher Tenant ${suffix}`,
    slug: `mlines-${suffix}-${nanoid(6)}`,
    settings: options.aiEnabled
      ? {
          ai: {
            enabled: true,
            monthlyBudgetUsd: 100,
            providerId: 'openai',
            modelId: null,
          },
        }
      : {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const adminId = nanoid();
  const cashierId = nanoid();
  const passwordHash = await hash('MatcherPass123!');
  await db.insert(users).values([
    {
      id: adminId,
      tenantId,
      email: `admin-${tenantId}@example.com`,
      passwordHash,
      name: 'Matcher Admin',
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: cashierId,
      tenantId,
      email: `cashier-${tenantId}@example.com`,
      passwordHash,
      name: 'Matcher Cashier',
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return { tenantId, adminId, cashierId };
}

async function seedProducts(tenantId: string, items: SeedProduct[]): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  // Each tenant gets a single "unit" row so the matcher can resolve a
  // base unit for the cart-line payload. The unit is shared across all
  // products in the test fixture.
  const unitId = `unit-${tenantId}`;
  await db.insert(units).values({
    id: unitId,
    tenantId,
    name: 'Unidad',
    abbreviation: 'UND',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  for (const product of items) {
    await db.insert(products).values({
      id: product.id,
      tenantId,
      name: product.name,
      sku: product.sku,
      price: 0,
      cost: product.cost ?? 0,
      stock: product.stock ?? 0,
      isActive: true,
      embedding:
        product.embedding === undefined
          ? null
          : product.embedding === null
            ? null
            : JSON.stringify(product.embedding),
      embeddingModel: product.embedding ? 'text-embedding-3-small' : null,
      embeddedAt: product.embedding ? now : null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(unitXProduct).values({
      id: `${product.id}-unit`,
      productId: product.id,
      unitId,
      equivalence: 1,
      price: 0,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    });
  }
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  if (server) await server.close();
});

beforeEach(() => {
  embedManyMock.mockReset();
  embedMock.mockReset();
});

describe('ai.matchInvoiceLines (ENG-040 slice 1b)', () => {
  it('returns top-1 product match per line and writes a single audit row', async () => {
    const { tenantId, adminId } = await seedTenant('happy', { aiEnabled: true });
    await seedProducts(tenantId, [
      {
        id: 'prod-cola',
        name: 'Coca Cola 1.5L',
        sku: 'CCL-15',
        cost: 4500,
        stock: 24,
        embedding: [1, 0, 0],
      },
      {
        id: 'prod-pan',
        name: 'Pan tajado 500g',
        sku: 'PAN-500',
        cost: 3000,
        stock: 12,
        embedding: [0, 1, 0],
      },
    ]);

    // Lines correspond to the two seeded products: first line is the
    // cola, second line is the bread. Embedding mock returns vectors
    // that closely align with the matching product's vector and a
    // marginally similar one for the other.
    embedManyMock.mockResolvedValue({
      embeddings: [
        [0.99, 0.01, 0.01],
        [0.02, 0.97, 0.05],
      ],
    });

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin' })
    );
    const result = await caller.ai.matchInvoiceLines({
      lines: [
        { description: 'Coca Cola 1.5L', quantity: 12, unitPrice: 4500, totalLine: 54000 },
        { description: 'Pan tajado x500g', quantity: 4, unitPrice: 3000, totalLine: 12000 },
      ],
    });

    expect(result.mode).toBe('matched');
    if (result.mode !== 'matched') throw new Error('expected matched mode');
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]?.product?.productId).toBe('prod-cola');
    expect(result.matches[0]?.product?.productName).toBe('Coca Cola 1.5L');
    expect(result.matches[0]?.product?.cost).toBe(4500);
    expect(result.matches[0]?.product?.unitName).toBe('Unidad');
    expect(result.matches[0]?.similarity).toBeGreaterThan(0.95);
    expect(result.matches[1]?.product?.productId).toBe('prod-pan');

    const audit = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.tenantId, tenantId))
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.feature).toBe('invoiceLineMatch');
    expect(audit[0]?.providerId).toBe('openai');
    expect(audit[0]?.modelId).toBe('text-embedding-3-small');
  });

  it('returns `mode: "unavailable"` when AI is disabled', async () => {
    const { tenantId, adminId } = await seedTenant('disabled', { aiEnabled: false });
    // Seed an embedded product so the no-embeddings branch is NOT the
    // trigger here — the AI-disabled branch is.
    await seedProducts(tenantId, [
      { id: 'prod-x', name: 'Producto', sku: 'X-1', embedding: [1, 0, 0] },
    ]);

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin' })
    );
    const result = await caller.ai.matchInvoiceLines({
      lines: [{ description: 'Producto', quantity: 1, unitPrice: 10, totalLine: 10 }],
    });

    expect(result.mode).toBe('unavailable');
    if (result.mode !== 'unavailable') throw new Error('expected unavailable mode');
    expect(result.reason).toBe('ai-disabled');
    expect(result.matches).toEqual([]);
    expect(embedManyMock).not.toHaveBeenCalled();
  });

  it('returns `mode: "unavailable"` when no tenant products are embedded', async () => {
    const { tenantId, adminId } = await seedTenant('no-embed', { aiEnabled: true });
    await seedProducts(tenantId, [
      // Two products, neither has an embedding vector.
      { id: 'prod-a', name: 'Producto A', sku: 'A-1' },
      { id: 'prod-b', name: 'Producto B', sku: 'B-1' },
    ]);

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin' })
    );
    const result = await caller.ai.matchInvoiceLines({
      lines: [{ description: 'Producto A', quantity: 1, unitPrice: 10, totalLine: 10 }],
    });

    expect(result.mode).toBe('unavailable');
    if (result.mode !== 'unavailable') throw new Error('expected unavailable mode');
    expect(result.reason).toBe('no-embeddings');
    expect(embedManyMock).not.toHaveBeenCalled();
  });

  it('returns `product: null` for lines whose similarity falls below the invoice OCR floor', async () => {
    const { tenantId, adminId } = await seedTenant('floor', { aiEnabled: true });
    await seedProducts(tenantId, [
      {
        id: 'prod-vino',
        name: 'Vino tinto reserva',
        sku: 'VTR-01',
        embedding: [1, 0, 0],
      },
    ]);

    // Line embedding is close enough for loose semantic search but not
    // enough for invoice OCR auto-match. Supplier invoices must stay
    // conservative so the purchase form marks the line pending.
    embedManyMock.mockResolvedValue({ embeddings: [[0.84, 0.54, 0]] });

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin' })
    );
    const result = await caller.ai.matchInvoiceLines({
      lines: [{ description: 'Detergente líquido', quantity: 1, unitPrice: 5000, totalLine: 5000 }],
    });

    expect(result.mode).toBe('matched');
    if (result.mode !== 'matched') throw new Error('expected matched mode');
    expect(result.matches[0]?.product).toBeNull();
    expect(result.matches[0]?.similarity).toBeNull();
  });

  it('isolates matches per tenant', async () => {
    const { tenantId: tenantA, adminId: adminA } = await seedTenant('iso-a', {
      aiEnabled: true,
    });
    const { tenantId: tenantB } = await seedTenant('iso-b', { aiEnabled: true });

    await seedProducts(tenantA, [
      { id: 'prod-a-only', name: 'Solo A', sku: 'A-1', embedding: [1, 0, 0] },
    ]);
    await seedProducts(tenantB, [
      { id: 'prod-b-only', name: 'Solo B', sku: 'B-1', embedding: [0, 1, 0] },
    ]);

    embedManyMock.mockResolvedValue({ embeddings: [[0, 1, 0]] });

    const caller = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    const result = await caller.ai.matchInvoiceLines({
      lines: [{ description: 'Solo B', quantity: 1, unitPrice: 1, totalLine: 1 }],
    });

    expect(result.mode).toBe('matched');
    if (result.mode !== 'matched') throw new Error('expected matched mode');
    // The query vector aligns with tenant B's product, but the caller
    // is scoped to tenant A. tenant A has no aligned product → null.
    expect(result.matches[0]?.product).toBeNull();
  });

  it('rejects cashier callers with FORBIDDEN', async () => {
    const { tenantId, cashierId } = await seedTenant('forbidden', { aiEnabled: true });

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: cashierId, role: 'cashier' })
    );
    let caught: unknown;
    try {
      await caller.ai.matchInvoiceLines({
        lines: [{ description: 'Algo', quantity: 1, unitPrice: 1, totalLine: 1 }],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe('FORBIDDEN');
  });

  it('rejects with MODULE_NOT_ACTIVATED when semantic-search module is off', async () => {
    const { tenantId, adminId } = await seedTenant('module-off', { aiEnabled: true });
    const db = getDatabase();
    const current = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .get();
    const settings = (current?.settings as Record<string, unknown>) ?? {};
    await db
      .update(tenants)
      .set({
        settings: {
          ...settings,
          // Per `isModuleActiveInSettings`, the modules blob is a flat
          // boolean map keyed by module id — no nested `{ enabled }`.
          modules: { 'semantic-search': false },
        },
      })
      .where(eq(tenants.id, tenantId));

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin' })
    );
    let caught: unknown;
    try {
      await caller.ai.matchInvoiceLines({
        lines: [{ description: 'Algo', quantity: 1, unitPrice: 1, totalLine: 1 }],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe('FORBIDDEN');
    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    expect((cause as ServerErrorWithCode).errorCode).toBe('MODULE_NOT_ACTIVATED');
  });

  it('returns matched mode with empty array for empty input', async () => {
    const { tenantId, adminId } = await seedTenant('empty', { aiEnabled: true });
    await seedProducts(tenantId, [
      { id: 'prod-e', name: 'Producto', sku: 'E-1', embedding: [1, 0, 0] },
    ]);

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin' })
    );
    const result = await caller.ai.matchInvoiceLines({ lines: [] });
    expect(result.mode).toBe('matched');
    if (result.mode !== 'matched') throw new Error('expected matched mode');
    expect(result.matches).toEqual([]);
    expect(embedManyMock).not.toHaveBeenCalled();

    const audit = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(and(eq(aiAuditLog.tenantId, tenantId), eq(aiAuditLog.feature, 'invoiceLineMatch')))
      .all();
    expect(audit).toHaveLength(0);
  });
});
