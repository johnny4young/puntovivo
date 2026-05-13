/**
 * ENG-040c slice 3 — `ai.parseCartCommand` integration tests.
 *
 * Drives the procedure via `createCaller` against an in-memory
 * database. The AI SDK `generateObject` is mocked so no real
 * provider round-trip is needed; the OpenAI provider's
 * `embeddingModel` factory is stubbed so the embeddings step
 * resolves without an `OPENAI_API_KEY`. Cosine math runs against
 * vectors seeded directly into `products.embedding` so each test
 * controls which hints map to which products.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';
import type { EmbeddingModelV3 } from '@ai-sdk/provider';

const generateObjectMock = vi.fn();
const embedManyMock = vi.fn();

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return {
    ...actual,
    generateObject: (...args: unknown[]) => generateObjectMock(...args),
    embedMany: (...args: unknown[]) => embedManyMock(...args),
  };
});

vi.mock('../services/ai/providers/openai.js', async () => {
  const actual = await vi.importActual<typeof import('../services/ai/providers/openai.js')>(
    '../services/ai/providers/openai.js'
  );
  return {
    ...actual,
    openaiProvider: {
      ...actual.openaiProvider,
      isConfigured: () => true,
      embeddingModel: (_modelId: string) => ({}) as EmbeddingModelV3<string>,
    },
  };
});

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
  options: { aiEnabled?: boolean } = {}
): Promise<{ tenantId: string; cashierId: string; managerId: string }> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `vcc-${suffix}-${nanoid(4)}`;
  await db.insert(tenants).values({
    id: tenantId,
    name: `VCC Tenant ${suffix}`,
    slug: `vcc-${suffix}-${nanoid(6)}`,
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
  const cashierId = nanoid();
  const managerId = nanoid();
  const passwordHash = await hash('VccPass123!');
  await db.insert(users).values([
    {
      id: cashierId,
      tenantId,
      email: `cashier-${tenantId}@example.com`,
      passwordHash,
      name: 'VCC Cashier',
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: managerId,
      tenantId,
      email: `manager-${tenantId}@example.com`,
      passwordHash,
      name: 'VCC Manager',
      role: 'manager',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return { tenantId, cashierId, managerId };
}

interface SeedProduct {
  id: string;
  name: string;
  embedding?: number[] | null;
  price?: number;
  taxRate?: number;
}

async function seedProducts(tenantId: string, items: SeedProduct[]): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
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
      sku: `${product.id}-sku`,
      price: product.price ?? 1000,
      taxRate: product.taxRate ?? 0,
      cost: 0,
      stock: 10,
      isActive: true,
      embedding: product.embedding ? JSON.stringify(product.embedding) : null,
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
      price: product.price ?? 1000,
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
  generateObjectMock.mockReset();
  embedManyMock.mockReset();
});

describe('ai.parseCartCommand (ENG-040c slice 3)', () => {
  it('returns mode=parsed with matched products on the happy path', async () => {
    const { tenantId, cashierId } = await seedTenant('happy', { aiEnabled: true });
    await seedProducts(tenantId, [
      { id: 'p-cola', name: 'Coca Cola 1.5L', embedding: [1, 0, 0], price: 5000 },
      { id: 'p-pan', name: 'Pan tajado', embedding: [0, 1, 0], price: 3000 },
    ]);

    generateObjectMock.mockResolvedValue({
      object: {
        items: [
          { productHint: 'coca cola', quantity: 2 },
          { productHint: 'pan', quantity: 1 },
        ],
        confidence: 'high',
        reason: null,
      },
      usage: { inputTokens: 50, outputTokens: 20, totalTokens: 70 },
    });
    // Embeddings batch returns vectors aligned with each product.
    embedManyMock.mockResolvedValue({
      embeddings: [
        [0.99, 0.01, 0.01],
        [0.02, 0.97, 0.05],
      ],
    });

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: cashierId, role: 'cashier' })
    );
    const result = await caller.ai.parseCartCommand({
      transcript: 'agrega dos cocas y un pan',
    });

    expect(result.mode).toBe('parsed');
    if (result.mode !== 'parsed') throw new Error('expected parsed mode');
    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]?.productHint).toBe('coca cola');
    expect(result.matches[0]?.quantity).toBe(2);
    expect(result.matches[0]?.product?.productId).toBe('p-cola');
    expect(result.matches[0]?.product?.unitPrice).toBe(5000);
    expect(result.matches[1]?.product?.productId).toBe('p-pan');

    const audit = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.tenantId, tenantId))
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.feature).toBe('voiceCartCommand');
    expect(audit[0]?.userId).toBe(cashierId);
    expect(audit[0]?.errorCode).toBeNull();
  });

  it('throws AI_DISABLED + writes no audit row when AI is off', async () => {
    const { tenantId, cashierId } = await seedTenant('disabled', { aiEnabled: false });

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: cashierId, role: 'cashier' })
    );
    let caught: unknown;
    try {
      await caller.ai.parseCartCommand({ transcript: 'agrega una coca' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    expect((cause as ServerErrorWithCode).errorCode).toBe('AI_DISABLED');
    expect(generateObjectMock).not.toHaveBeenCalled();
    expect(embedManyMock).not.toHaveBeenCalled();

    const audit = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.tenantId, tenantId))
      .all();
    expect(audit).toHaveLength(0);
  });

  it('returns mode=unrecognized when the parser yields zero items', async () => {
    const { tenantId, cashierId } = await seedTenant('unrecognized', {
      aiEnabled: true,
    });

    generateObjectMock.mockResolvedValue({
      object: {
        items: [],
        confidence: 'low',
        reason: 'No identifiqué productos',
      },
      usage: { inputTokens: 30, outputTokens: 5, totalTokens: 35 },
    });

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: cashierId, role: 'cashier' })
    );
    const result = await caller.ai.parseCartCommand({
      transcript: 'hola buenos días',
    });

    expect(result.mode).toBe('unrecognized');
    if (result.mode !== 'unrecognized') throw new Error('expected unrecognized mode');
    expect(result.reason).toBe('No identifiqué productos');
    expect(result.transcript).toBe('hola buenos días');
    // Audit row still written so the operator sees parser cost.
    const audit = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.tenantId, tenantId))
      .all();
    expect(audit).toHaveLength(1);
    expect(audit[0]?.errorCode).toBeNull();
    expect(embedManyMock).not.toHaveBeenCalled();
  });

  it('returns product=null for hints that fall below the cosine floor', async () => {
    const { tenantId, cashierId } = await seedTenant('floor', { aiEnabled: true });
    await seedProducts(tenantId, [
      { id: 'p-vino', name: 'Vino tinto', embedding: [1, 0, 0] },
    ]);

    generateObjectMock.mockResolvedValue({
      object: {
        items: [{ productHint: 'detergente líquido', quantity: 1 }],
        confidence: 'medium',
        reason: null,
      },
      usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 },
    });
    // Query vector nearly orthogonal to the seeded vino vector — below floor.
    embedManyMock.mockResolvedValue({ embeddings: [[0.05, 0.99, 0.05]] });

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: cashierId, role: 'cashier' })
    );
    const result = await caller.ai.parseCartCommand({
      transcript: 'agrega un detergente líquido',
    });

    expect(result.mode).toBe('parsed');
    if (result.mode !== 'parsed') throw new Error('expected parsed mode');
    expect(result.matches[0]?.product).toBeNull();
  });

  it('rejects with MODULE_NOT_ACTIVATED when semantic-search module is off', async () => {
    const { tenantId, cashierId } = await seedTenant('module-off', { aiEnabled: true });
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
          modules: { 'semantic-search': false },
        },
      })
      .where(eq(tenants.id, tenantId));

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: cashierId, role: 'cashier' })
    );
    let caught: unknown;
    try {
      await caller.ai.parseCartCommand({ transcript: 'agrega una coca' });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe('FORBIDDEN');
    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    expect((cause as ServerErrorWithCode).errorCode).toBe('MODULE_NOT_ACTIVATED');
  });

  it('allows manager callers (gate is tenant-level, not role-level)', async () => {
    const { tenantId, managerId } = await seedTenant('manager', { aiEnabled: true });
    await seedProducts(tenantId, [
      { id: 'p-x', name: 'Producto X', embedding: [1, 0, 0] },
    ]);

    generateObjectMock.mockResolvedValue({
      object: {
        items: [{ productHint: 'producto x', quantity: 1 }],
        confidence: 'high',
        reason: null,
      },
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    });
    embedManyMock.mockResolvedValue({ embeddings: [[0.99, 0.01, 0.01]] });

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: managerId, role: 'manager' })
    );
    const result = await caller.ai.parseCartCommand({ transcript: 'agrega producto x' });
    expect(result.mode).toBe('parsed');
  });

  it('isolates tenants — A cannot match B catalog', async () => {
    const { tenantId: tA, cashierId: cashierA } = await seedTenant('iso-a', {
      aiEnabled: true,
    });
    const { tenantId: tB } = await seedTenant('iso-b', { aiEnabled: true });
    await seedProducts(tA, []);
    await seedProducts(tB, [
      { id: 'p-only-in-b', name: 'Solo B', embedding: [1, 0, 0] },
    ]);

    generateObjectMock.mockResolvedValue({
      object: {
        items: [{ productHint: 'solo b', quantity: 1 }],
        confidence: 'high',
        reason: null,
      },
      usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
    });
    embedManyMock.mockResolvedValue({ embeddings: [[1, 0, 0]] });

    const caller = appRouter.createCaller(
      createCtx({ tenantId: tA, userId: cashierA, role: 'cashier' })
    );
    const result = await caller.ai.parseCartCommand({ transcript: 'agrega solo b' });
    expect(result.mode).toBe('parsed');
    if (result.mode !== 'parsed') throw new Error('expected parsed mode');
    // Catalog for tenant A is empty — the hint resolves to null.
    expect(result.matches[0]?.product).toBeNull();

    // Tenant A audit row is the only one for A.
    const auditA = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.tenantId, tA))
      .all();
    expect(auditA).toHaveLength(1);
    const auditB = await getDatabase()
      .select()
      .from(aiAuditLog)
      .where(eq(aiAuditLog.tenantId, tB))
      .all();
    expect(auditB).toHaveLength(0);
  });

  it('Zod rejects empty + oversize transcripts before the service runs', async () => {
    const { tenantId, cashierId } = await seedTenant('zod', { aiEnabled: true });

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: cashierId, role: 'cashier' })
    );

    let caughtEmpty: unknown;
    try {
      await caller.ai.parseCartCommand({ transcript: '   ' });
    } catch (err) {
      caughtEmpty = err;
    }
    expect(caughtEmpty).toBeInstanceOf(TRPCError);

    let caughtBig: unknown;
    try {
      await caller.ai.parseCartCommand({ transcript: 'a'.repeat(1001) });
    } catch (err) {
      caughtBig = err;
    }
    expect(caughtBig).toBeInstanceOf(TRPCError);

    expect(generateObjectMock).not.toHaveBeenCalled();
  });
});
