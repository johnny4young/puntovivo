/** End-to-end tRPC contract for bounded hybrid product semantic search. */
import type { EmbeddingModelV4 } from '@ai-sdk/provider';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';

const { embedMock } = vi.hoisted(() => ({
  embedMock: vi.fn(async () => ({ embedding: [1, 0], usage: { tokens: 2 } })),
}));

vi.mock('ai', async () => {
  const actual = await vi.importActual<typeof import('ai')>('ai');
  return { ...actual, embed: embedMock };
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
      embeddingModel: (_modelId: string) => ({}) as EmbeddingModelV4<string>,
    },
  };
});

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { products, tenants, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;

function createCtx(tenantId: string, userId: string): Context {
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: {},
      user: { userId, email: 'semantic@example.com', role: 'admin', tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: { id: userId, email: 'semantic@example.com', role: 'admin', tenantId },
    tenantId,
    siteId: null,
  };
}

async function seedTenant(label: string, aiEnabled: boolean = true) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `semantic-router-${label}-${nanoid(5)}`;
  const userId = nanoid();
  await db.insert(tenants).values({
    id: tenantId,
    name: `Semantic router ${label}`,
    slug: tenantId,
    settings: {
      ai: {
        enabled: aiEnabled,
        monthlyBudgetUsd: 100,
        providerId: 'openai',
        modelId: null,
      },
      modules: { 'semantic-search': true },
    },
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: userId,
    tenantId,
    email: `${tenantId}@example.com`,
    passwordHash: 'test-only-hash',
    name: 'Semantic admin',
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return { tenantId, userId, now };
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  if (server) await server.close();
});

describe('products.semanticSearch bounded hybrid route', () => {
  it('reranks only tenant-safe literal candidates from the active model', async () => {
    embedMock.mockClear();
    const db = getDatabase();
    const { tenantId, userId, now } = await seedTenant('ranked');
    const foreign = await seedTenant('foreign');
    await db.insert(products).values([
      {
        id: 'semantic-router-wine',
        tenantId,
        name: 'Vino joven',
        sku: 'SEM-WINE',
        price: 10,
        embedding: JSON.stringify([0.8, 0.6]),
        embeddingModel: 'text-embedding-3-small',
        embeddedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'semantic-router-reserve',
        tenantId,
        name: 'Reserva premium',
        sku: 'SEM-RESERVE',
        price: 10,
        embedding: JSON.stringify([1, 0]),
        embeddingModel: 'text-embedding-3-small',
        embeddedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'semantic-router-stale',
        tenantId,
        name: 'Vino stale',
        sku: 'SEM-STALE',
        price: 10,
        embedding: JSON.stringify([1, 0]),
        embeddingModel: 'text-embedding-legacy',
        embeddedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'semantic-router-outside',
        tenantId,
        name: 'Leche outside shortlist',
        sku: 'SEM-OUTSIDE',
        price: 10,
        embedding: JSON.stringify([1, 0]),
        embeddingModel: 'text-embedding-3-small',
        embeddedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'semantic-router-foreign',
        tenantId: foreign.tenantId,
        name: 'Vino reserva foreign',
        sku: 'SEM-FOREIGN',
        price: 10,
        embedding: JSON.stringify([1, 0]),
        embeddingModel: 'text-embedding-3-small',
        embeddedAt: foreign.now,
        createdAt: foreign.now,
        updatedAt: foreign.now,
      },
    ]);

    const result = await appRouter
      .createCaller(createCtx(tenantId, userId))
      .products.semanticSearch({ query: 'vino reserva', limit: 25 });

    expect(result.mode).toBe('semantic');
    if (result.mode !== 'semantic') throw new Error('Expected semantic results');
    expect(result.results.map(row => row.id)).toEqual([
      'semantic-router-reserve',
      'semantic-router-wine',
    ]);
    expect(result.results.map(row => row.similarity)).toEqual([1, 0.8]);
    expect(embedMock).toHaveBeenCalledTimes(1);
  });

  it('does not spend an embedding call when the literal candidate pool is empty', async () => {
    embedMock.mockClear();
    const { tenantId, userId } = await seedTenant('empty');

    const result = await appRouter
      .createCaller(createCtx(tenantId, userId))
      .products.semanticSearch({ query: 'zzzz-no-candidate', limit: 25 });

    expect(result).toEqual({ mode: 'semantic', results: [] });
    expect(embedMock).not.toHaveBeenCalled();
  });

  it('preserves the unavailable signal before candidate work when AI is disabled', async () => {
    embedMock.mockClear();
    const { tenantId, userId } = await seedTenant('disabled', false);

    const result = await appRouter
      .createCaller(createCtx(tenantId, userId))
      .products.semanticSearch({ query: 'zzzz-no-candidate', limit: 25 });

    expect(result).toEqual({ mode: 'unavailable', results: [] });
    expect(embedMock).not.toHaveBeenCalled();
  });
});
