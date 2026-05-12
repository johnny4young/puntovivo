/**
 * ENG-040 — `products.embeddingHealth` integration tests.
 *
 * Drives the procedure via `createCaller` against an in-memory
 * database. No real embedding round-trip is needed — drift is a
 * pure read over `products.embedding_model` vs the active
 * provider's `defaultEmbeddingModelId`. The OpenAI provider stub
 * mirrors `ai-match-invoice-lines.test.ts` so the resolver layers
 * (`resolveAISettings` → `getProvider` → `embeddingModel` capability
 * gate) all behave like the live wire.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';
import type { EmbeddingModelV3 } from '@ai-sdk/provider';

// Same stub the ENG-040 slice 1b test uses: OpenAI advertises an
// embedding model factory + reports configured. The procedure never
// calls the factory (drift is a DB-only read), but `resolveActive
// EmbeddingModelId` walks the same capability gate as `embedText`.
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
import { products, tenants, users } from '../db/schema.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { appRouter } from '../trpc/router.js';
import { resolveActiveEmbeddingModelId } from '../services/ai/embeddings.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;

function createCtx(opts: {
  tenantId: string;
  userId: string;
  role: 'admin' | 'cashier' | 'manager';
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
    siteId: null,
  };
}

interface SeedProduct {
  id: string;
  name: string;
  embedding?: number[] | null;
  embeddingModel?: string | null;
}

async function seedTenant(
  suffix: string,
  options: { aiEnabled?: boolean } = {}
): Promise<{ tenantId: string; adminId: string; managerId: string }> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `health-${suffix}-${nanoid(4)}`;
  await db.insert(tenants).values({
    id: tenantId,
    name: `Health Tenant ${suffix}`,
    slug: `health-${suffix}-${nanoid(6)}`,
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
  const managerId = nanoid();
  const passwordHash = await hash('HealthPass123!');
  await db.insert(users).values([
    {
      id: adminId,
      tenantId,
      email: `admin-${tenantId}@example.com`,
      passwordHash,
      name: 'Health Admin',
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
      name: 'Health Manager',
      role: 'manager',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return { tenantId, adminId, managerId };
}

async function seedProducts(tenantId: string, items: SeedProduct[]): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  for (const product of items) {
    await db.insert(products).values({
      id: product.id,
      tenantId,
      name: product.name,
      sku: `${product.id}-sku`,
      price: 0,
      cost: 0,
      stock: 0,
      isActive: true,
      embedding:
        product.embedding === undefined || product.embedding === null
          ? null
          : JSON.stringify(product.embedding),
      embeddingModel: product.embeddingModel ?? null,
      embeddedAt: product.embedding ? now : null,
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

describe('resolveActiveEmbeddingModelId (ENG-040 helper)', () => {
  it('returns OpenAI default model id when AI is enabled + OpenAI provider', async () => {
    const { tenantId } = await seedTenant('resolver-openai', { aiEnabled: true });
    const modelId = await resolveActiveEmbeddingModelId(getDatabase(), tenantId);
    expect(modelId).toBe('text-embedding-3-small');
  });

  it('returns null when AI is disabled on the tenant', async () => {
    const { tenantId } = await seedTenant('resolver-off', { aiEnabled: false });
    const modelId = await resolveActiveEmbeddingModelId(getDatabase(), tenantId);
    expect(modelId).toBeNull();
  });

  it('returns null when the tenant points at a non-embedding provider', async () => {
    const { tenantId } = await seedTenant('resolver-anthropic');
    const db = getDatabase();
    await db
      .update(tenants)
      .set({
        settings: {
          ai: {
            enabled: true,
            monthlyBudgetUsd: 100,
            providerId: 'anthropic',
            modelId: null,
          },
        },
      })
      .where(eq(tenants.id, tenantId));
    const modelId = await resolveActiveEmbeddingModelId(db, tenantId);
    // Anthropic has no `embeddingModel`, so the gate short-circuits.
    expect(modelId).toBeNull();
  });
});

describe('products.embeddingHealth (ENG-040)', () => {
  it('returns mode="unavailable" when AI is disabled', async () => {
    const { tenantId, adminId } = await seedTenant('off', { aiEnabled: false });
    await seedProducts(tenantId, [
      {
        id: 'p-1',
        name: 'Producto 1',
        embedding: [1, 0, 0],
        embeddingModel: 'text-embedding-3-small',
      },
      { id: 'p-2', name: 'Producto 2' },
    ]);

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin' })
    );
    const result = await caller.products.embeddingHealth();

    expect(result.mode).toBe('unavailable');
    expect(result.activeModelId).toBeNull();
    expect(result.totalProducts).toBe(2);
    expect(result.embeddedCount).toBe(1);
    expect(result.unembeddedCount).toBe(1);
    expect(result.staleCount).toBe(0);
    expect(result.staleSampleModelIds).toEqual([]);
  });

  it('returns staleCount=0 when every embedded row matches the active model', async () => {
    const { tenantId, adminId } = await seedTenant('aligned', { aiEnabled: true });
    await seedProducts(tenantId, [
      {
        id: 'p-aligned-1',
        name: 'Aligned 1',
        embedding: [1, 0, 0],
        embeddingModel: 'text-embedding-3-small',
      },
      {
        id: 'p-aligned-2',
        name: 'Aligned 2',
        embedding: [0, 1, 0],
        embeddingModel: 'text-embedding-3-small',
      },
    ]);

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin' })
    );
    const result = await caller.products.embeddingHealth();

    expect(result.mode).toBe('available');
    expect(result.activeModelId).toBe('text-embedding-3-small');
    expect(result.totalProducts).toBe(2);
    expect(result.embeddedCount).toBe(2);
    expect(result.staleCount).toBe(0);
    expect(result.staleSampleModelIds).toEqual([]);
    expect(result.lastEmbeddedAt).not.toBeNull();
  });

  it('returns staleCount > 0 + staleSampleModelIds when catalog is mixed', async () => {
    const { tenantId, adminId } = await seedTenant('drift', { aiEnabled: true });
    await seedProducts(tenantId, [
      {
        id: 'p-active-1',
        name: 'Active 1',
        embedding: [1, 0, 0],
        embeddingModel: 'text-embedding-3-small',
      },
      // Two rows on a now-stale model id — both should count once each
      // and the sample should de-duplicate to a single id.
      {
        id: 'p-stale-1',
        name: 'Stale 1',
        embedding: [0, 1, 0],
        embeddingModel: 'nomic-embed-text',
      },
      {
        id: 'p-stale-2',
        name: 'Stale 2',
        embedding: [0, 0, 1],
        embeddingModel: 'nomic-embed-text',
      },
      // Unembedded row — does not affect staleCount.
      { id: 'p-naked', name: 'Naked' },
    ]);

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin' })
    );
    const result = await caller.products.embeddingHealth();

    expect(result.mode).toBe('available');
    expect(result.activeModelId).toBe('text-embedding-3-small');
    expect(result.totalProducts).toBe(4);
    expect(result.embeddedCount).toBe(3);
    expect(result.unembeddedCount).toBe(1);
    expect(result.staleCount).toBe(2);
    expect(result.staleSampleModelIds).toEqual(['nomic-embed-text']);
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
          modules: { 'semantic-search': false },
        },
      })
      .where(eq(tenants.id, tenantId));

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: adminId, role: 'admin' })
    );
    let caught: unknown;
    try {
      await caller.products.embeddingHealth();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe('FORBIDDEN');
    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    expect((cause as ServerErrorWithCode).errorCode).toBe('MODULE_NOT_ACTIVATED');
  });

  it('isolates drift per tenant', async () => {
    const { tenantId: tenantA, adminId: adminA } = await seedTenant('iso-a', {
      aiEnabled: true,
    });
    const { tenantId: tenantB } = await seedTenant('iso-b', { aiEnabled: true });

    // Tenant A is mid-drift; tenant B is fully aligned.
    await seedProducts(tenantA, [
      {
        id: 'a-stale',
        name: 'A stale',
        embedding: [1, 0, 0],
        embeddingModel: 'nomic-embed-text',
      },
    ]);
    await seedProducts(tenantB, [
      {
        id: 'b-aligned',
        name: 'B aligned',
        embedding: [0, 1, 0],
        embeddingModel: 'text-embedding-3-small',
      },
    ]);

    const callerA = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    const resultA = await callerA.products.embeddingHealth();
    expect(resultA.mode).toBe('available');
    expect(resultA.staleCount).toBe(1);
    expect(resultA.totalProducts).toBe(1);

    // Tenant B's clean state must NOT be polluted by tenant A's drift.
    // Use a synthetic caller scoped to tenant B without seeding a B-admin —
    // the procedure derives scope from ctx.tenantId, not from the userId row.
    const callerB = appRouter.createCaller(
      createCtx({ tenantId: tenantB, userId: adminA, role: 'admin' })
    );
    const resultB = await callerB.products.embeddingHealth();
    expect(resultB.mode).toBe('available');
    expect(resultB.staleCount).toBe(0);
    expect(resultB.totalProducts).toBe(1);
  });

  it('allows manager callers (read-only nudge)', async () => {
    const { tenantId, managerId } = await seedTenant('manager-read', { aiEnabled: true });
    await seedProducts(tenantId, [
      {
        id: 'mr-1',
        name: 'Read 1',
        embedding: [1, 0, 0],
        embeddingModel: 'nomic-embed-text',
      },
    ]);

    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: managerId, role: 'manager' })
    );
    const result = await caller.products.embeddingHealth();
    expect(result.mode).toBe('available');
    expect(result.staleCount).toBe(1);
  });
});
