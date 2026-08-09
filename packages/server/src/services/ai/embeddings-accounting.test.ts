import type { EmbeddingModelV4, LanguageModelV4 } from '@ai-sdk/provider';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../../index.js';
import { getDatabase } from '../../db/index.js';
import { aiAuditLog, companies, products, sites, tenants, users } from '../../db/schema.js';
import type { AIProvider, AIProviderId, ModelPricing } from './providers/types.js';
import {
  embedText,
  embedTexts,
  loadSemanticCandidateEmbeddings,
  semanticSearchProducts,
  type EmbeddingProviderFactory,
  type EmbeddingRuntime,
} from './embeddings.js';
import { SEMANTIC_CANDIDATE_LIMIT } from '../products/semantic-candidates.js';

let server: PuntovivoServer;
let tenantId: string;
let siteId: string;
let userId: string;

const model = {} as EmbeddingModelV4;

function makeProvider(
  options: {
    id?: AIProviderId;
    modelId?: string;
    pricing?: Readonly<Record<string, ModelPricing>>;
  } = {}
): AIProvider {
  const id = options.id ?? 'openai';
  const modelId = options.modelId ?? 'text-embedding-3-small';
  const pricing = options.pricing ?? {
    [modelId]: { input: 0.02, output: 0, cacheRead: 0.02, cacheWrite: 0.02 },
  };
  return {
    id,
    defaultModelId: id === 'ollama' ? 'llama3.2' : 'gpt-4.1-mini',
    defaultEmbeddingModelId: modelId,
    pricing: {
      models: pricing,
      calculateCostUsd(requestedModelId, usage) {
        const row = pricing[requestedModelId];
        if (!row) return 0;
        return (usage.inputTokens / 1_000_000) * row.input;
      },
    },
    isConfigured: () => true,
    languageModel: () => ({}) as LanguageModelV4,
    embeddingModel: () => model,
    cacheControlForSystemPrompt: () => undefined,
  };
}

function factoryFor(provider: AIProvider): EmbeddingProviderFactory {
  return () => provider;
}

function invocation(capability: 'semanticSearch' | 'catalogEmbeddings' = 'semanticSearch') {
  return {
    db: getDatabase(),
    tenantId,
    siteId,
    userId,
    capability,
  } as const;
}

async function setSettings(input: {
  enabled?: boolean;
  budget?: number;
  providerId?: AIProviderId;
}): Promise<void> {
  await getDatabase()
    .update(tenants)
    .set({
      settings: {
        ai: {
          enabled: input.enabled ?? true,
          monthlyBudgetUsd: input.budget ?? 10,
          providerId: input.providerId ?? 'openai',
          modelId: null,
        },
      },
      updatedAt: new Date().toISOString(),
    })
    .where(eq(tenants.id, tenantId));
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const now = new Date().toISOString();
  tenantId = `embedding-accounting-${nanoid(6)}`;
  const companyId = nanoid();
  siteId = nanoid();
  userId = nanoid();
  await db.insert(tenants).values({
    id: tenantId,
    name: 'Embedding accounting tenant',
    slug: tenantId,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: 'Embedding accounting company',
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sites).values({
    id: siteId,
    tenantId,
    companyId,
    name: 'Embedding accounting site',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: userId,
    tenantId,
    email: 'embedding-accounting@example.com',
    passwordHash: 'test-only-hash',
    name: 'Embedding operator',
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(async () => {
  if (server) await server.close();
});

beforeEach(async () => {
  await getDatabase().delete(aiAuditLog).run();
  await getDatabase().delete(products).where(eq(products.tenantId, tenantId)).run();
  await setSettings({});
});

describe('embedding budget and usage accounting', () => {
  it('records a priced semantic query with tenant, site, user, tokens, and estimate', async () => {
    const provider = makeProvider();
    const embedOne = vi.fn(async () => ({ embedding: [1, 0, 0], tokens: 1_000 }));
    const runtime: EmbeddingRuntime = {
      embedOne,
      embedBatch: vi.fn(),
    };

    const result = await embedText(invocation(), 'vino reserva', {
      runtime,
      providerFactory: factoryFor(provider),
    });
    expect(result).toEqual({ embedding: [1, 0, 0], model: 'text-embedding-3-small' });
    expect(embedOne).toHaveBeenCalledTimes(1);

    const rows = await getDatabase().select().from(aiAuditLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId,
      siteId,
      userId,
      feature: 'semanticSearch',
      providerId: 'openai',
      modelId: 'text-embedding-3-small',
      inputTokens: 1_000,
      costState: 'estimated',
      errorCode: null,
    });
    expect(rows[0]?.costUsd).toBeCloseTo(0.000_02, 10);
    expect(rows[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('blocks a semantic query at the budget gate and preserves text fallback', async () => {
    await setSettings({ budget: 0 });
    const provider = makeProvider();
    const embedOne = vi.fn();
    const result = await semanticSearchProducts(
      {
        db: getDatabase(),
        tenantId,
        siteId,
        userId,
      },
      'pan integral',
      [],
      25,
      {
        runtime: { embedOne, embedBatch: vi.fn() },
        providerFactory: factoryFor(provider),
      }
    );

    expect(result).toBeNull();
    expect(embedOne).not.toHaveBeenCalled();
    const rows = await getDatabase().select().from(aiAuditLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feature: 'semanticSearch',
      costState: 'not_incurred',
      costUsd: 0,
      errorCode: 'AI_BUDGET_EXCEEDED',
    });
  });

  it('scores only bounded tenant candidates from the active embedding model', async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const foreignTenantId = `embedding-foreign-${nanoid(6)}`;
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Embedding foreign tenant',
      slug: foreignTenantId,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(products).values([
      {
        id: 'semantic-current-best',
        tenantId,
        name: 'Current best',
        sku: 'SEM-BEST',
        price: 10,
        embedding: JSON.stringify([1, 0]),
        embeddingModel: 'text-embedding-3-small',
        embeddedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'semantic-current-second',
        tenantId,
        name: 'Current second',
        sku: 'SEM-SECOND',
        price: 10,
        embedding: JSON.stringify([0.8, 0.6]),
        embeddingModel: 'text-embedding-3-small',
        embeddedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'semantic-current-outside-shortlist',
        tenantId,
        name: 'Outside shortlist',
        sku: 'SEM-OUTSIDE',
        price: 10,
        embedding: JSON.stringify([1, 0]),
        embeddingModel: 'text-embedding-3-small',
        embeddedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'semantic-stale-model',
        tenantId,
        name: 'Stale model',
        sku: 'SEM-STALE',
        price: 10,
        embedding: JSON.stringify([1, 0]),
        embeddingModel: 'text-embedding-legacy',
        embeddedAt: now,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'semantic-foreign-candidate',
        tenantId: foreignTenantId,
        name: 'Foreign candidate',
        sku: 'SEM-FOREIGN',
        price: 10,
        embedding: JSON.stringify([1, 0]),
        embeddingModel: 'text-embedding-3-small',
        embeddedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const provider = makeProvider();
    const result = await semanticSearchProducts(
      { db, tenantId, siteId, userId },
      'vino reserva',
      [
        'semantic-current-second',
        'semantic-stale-model',
        'semantic-foreign-candidate',
        'semantic-current-best',
      ],
      25,
      {
        runtime: {
          embedOne: vi.fn(async () => ({ embedding: [1, 0], tokens: 2 })),
          embedBatch: vi.fn(),
        },
        providerFactory: factoryFor(provider),
      }
    );

    expect(result).toEqual([
      { productId: 'semantic-current-best', similarity: 1 },
      { productId: 'semantic-current-second', similarity: 0.8 },
    ]);
    expect(result?.map(row => row.productId)).not.toContain('semantic-current-outside-shortlist');
    expect(result?.map(row => row.productId)).not.toContain('semantic-stale-model');
    expect(result?.map(row => row.productId)).not.toContain('semantic-foreign-candidate');
  });

  it('reapplies the semantic candidate cap at the embedding storage boundary', async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const ids = Array.from(
      { length: SEMANTIC_CANDIDATE_LIMIT + 1 },
      (_, index) => `semantic-boundary-${String(index).padStart(3, '0')}`
    );
    for (let start = 0; start < ids.length; start += 100) {
      await db.insert(products).values(
        ids.slice(start, start + 100).map((id, offset) => ({
          id,
          tenantId,
          name: `Semantic boundary ${start + offset}`,
          sku: `SEM-BOUNDARY-${start + offset}`,
          price: 10,
          embedding: JSON.stringify([1, 0]),
          embeddingModel: 'text-embedding-3-small',
          embeddedAt: now,
          createdAt: now,
          updatedAt: now,
        }))
      );
    }

    const loaded = await loadSemanticCandidateEmbeddings(
      db,
      tenantId,
      ids,
      'text-embedding-3-small'
    );
    const loadedIds = loaded.map(row => row.productId);

    expect(loaded).toHaveLength(SEMANTIC_CANDIDATE_LIMIT);
    expect(loadedIds).not.toContain(ids.at(-1));
  });

  it('records provider failures as unknown remote cost and returns fallback', async () => {
    const provider = makeProvider();
    const result = await embedText(invocation(), 'café molido', {
      runtime: {
        embedOne: vi.fn(async () => {
          throw new Error('provider unavailable');
        }),
        embedBatch: vi.fn(),
      },
      providerFactory: factoryFor(provider),
    });

    expect(result).toBeNull();
    const rows = await getDatabase().select().from(aiAuditLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feature: 'semanticSearch',
      costState: 'unknown',
      costUsd: 0,
      errorCode: 'AI_PROVIDER_ERROR',
    });
  });

  it('marks a model-factory failure as not incurred because no provider call started', async () => {
    const provider = {
      ...makeProvider(),
      embeddingModel: () => {
        throw new Error('model factory unavailable');
      },
    } satisfies AIProvider;
    const embedOne = vi.fn();

    const result = await embedText(invocation(), 'café molido', {
      runtime: { embedOne, embedBatch: vi.fn() },
      providerFactory: factoryFor(provider),
    });

    expect(result).toBeNull();
    expect(embedOne).not.toHaveBeenCalled();
    const rows = await getDatabase().select().from(aiAuditLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feature: 'semanticSearch',
      costState: 'not_incurred',
      costUsd: 0,
      errorCode: 'AI_PROVIDER_ERROR',
    });
  });

  it('records Ollama embeddings as local zero external cost', async () => {
    await setSettings({ providerId: 'ollama' });
    const provider = makeProvider({ id: 'ollama', modelId: 'nomic-embed-text', pricing: {} });
    const result = await embedTexts(invocation('catalogEmbeddings'), ['uno', 'dos'], {
      runtime: {
        embedOne: vi.fn(),
        embedBatch: vi.fn(async () => ({
          embeddings: [
            [1, 0],
            [0, 1],
          ],
          tokens: 12,
        })),
      },
      providerFactory: factoryFor(provider),
    });

    expect(result?.embeddings).toHaveLength(2);
    const rows = await getDatabase().select().from(aiAuditLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feature: 'catalogEmbeddings',
      providerId: 'ollama',
      modelId: 'nomic-embed-text',
      inputTokens: 12,
      costUsd: 0,
      costState: 'local_zero',
      errorCode: null,
    });
  });

  it('marks a successful remote model without pricing as unknown instead of free', async () => {
    const provider = makeProvider({ modelId: 'text-embedding-future', pricing: {} });
    await embedText(invocation(), 'producto futuro', {
      runtime: {
        embedOne: vi.fn(async () => ({ embedding: [1, 1], tokens: 30 })),
        embedBatch: vi.fn(),
      },
      providerFactory: factoryFor(provider),
    });

    const rows = await getDatabase().select().from(aiAuditLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      modelId: 'text-embedding-future',
      inputTokens: 30,
      costUsd: 0,
      costState: 'unknown',
      errorCode: null,
    });
  });

  it('normalizes invalid token usage before pricing and persistence', async () => {
    const provider = makeProvider();
    const result = await embedText(invocation(), 'uso sin conteo', {
      runtime: {
        embedOne: vi.fn(async () => ({ embedding: [1, 0], tokens: Number.NaN })),
        embedBatch: vi.fn(),
      },
      providerFactory: factoryFor(provider),
    });

    expect(result?.embedding).toEqual([1, 0]);
    const rows = await getDatabase().select().from(aiAuditLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      inputTokens: 0,
      costUsd: 0,
      costState: 'estimated',
      errorCode: null,
    });
  });

  it('rejects a provider batch with missing vectors and records unknown remote cost', async () => {
    const provider = makeProvider();
    const embedBatch = vi.fn(async () => ({ embeddings: [[1, 0]], tokens: 20 }));

    const result = await embedTexts(invocation('catalogEmbeddings'), ['uno', 'dos'], {
      runtime: { embedOne: vi.fn(), embedBatch },
      providerFactory: factoryFor(provider),
    });

    expect(result).toBeNull();
    expect(embedBatch).toHaveBeenCalledTimes(1);
    const rows = await getDatabase().select().from(aiAuditLog).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      feature: 'catalogEmbeddings',
      inputTokens: 0,
      costUsd: 0,
      costState: 'unknown',
      errorCode: 'AI_PROVIDER_ERROR',
    });
  });

  it('rechecks the budget before every catalog chunk and discards partial output', async () => {
    await setSettings({ budget: 0.5 });
    const expensivePricing = {
      'text-embedding-expensive': {
        input: 1_000_000,
        output: 0,
        cacheRead: 1_000_000,
        cacheWrite: 1_000_000,
      },
    } satisfies Readonly<Record<string, ModelPricing>>;
    const provider = makeProvider({
      modelId: 'text-embedding-expensive',
      pricing: expensivePricing,
    });
    const embedBatch = vi.fn(async (_model: EmbeddingModelV4, values: string[]) => ({
      embeddings: values.map(() => [1, 0]),
      tokens: 1,
    }));
    const values = Array.from({ length: 257 }, (_, index) => `product-${index}`);

    const result = await embedTexts(invocation('catalogEmbeddings'), values, {
      runtime: { embedOne: vi.fn(), embedBatch },
      providerFactory: factoryFor(provider),
    });

    expect(result).toBeNull();
    expect(embedBatch).toHaveBeenCalledTimes(1);
    const rows = await getDatabase().select().from(aiAuditLog).orderBy(aiAuditLog.createdAt).all();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      feature: 'catalogEmbeddings',
      costUsd: 1,
      costState: 'estimated',
      errorCode: null,
    });
    expect(rows[1]).toMatchObject({
      feature: 'catalogEmbeddings',
      costUsd: 0,
      costState: 'not_incurred',
      errorCode: 'AI_BUDGET_EXCEEDED',
    });
  });
});
