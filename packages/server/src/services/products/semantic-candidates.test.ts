import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { createServer, type PuntovivoServer } from '../../index.js';
import { getDatabase } from '../../db/index.js';
import { products, tenants, users } from '../../db/schema.js';
import { findSemanticProductCandidates, SEMANTIC_CANDIDATE_LIMIT } from './semantic-candidates.js';

let server: PuntovivoServer;
let tenantId: string;

const now = '2026-08-08T00:00:00.000Z';

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!admin) throw new Error('Expected seeded admin');
  tenantId = admin.tenantId;

  await db.insert(products).values([
    {
      id: 'semantic-candidate-wine',
      tenantId,
      name: 'Vino corriente',
      sku: 'D1-WINE',
      price: 10,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'semantic-candidate-reserve',
      tenantId,
      name: 'Reserva especial',
      sku: 'D1-RESERVE',
      price: 10,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'semantic-candidate-substring',
      tenantId,
      name: 'D1MarkerWithinToken',
      sku: 'D1-SUBSTRING',
      price: 10,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'semantic-candidate-parent',
      tenantId,
      name: 'Vino reserva parent',
      sku: 'D1-PARENT',
      catalogType: 'variant_parent',
      price: 10,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  const foreignTenantId = 'semantic-candidate-foreign';
  await db.insert(tenants).values({
    id: foreignTenantId,
    name: 'Semantic candidate foreign tenant',
    slug: foreignTenantId,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(products).values({
    id: 'semantic-candidate-foreign-product',
    tenantId: foreignTenantId,
    name: 'Vino reserva foreign',
    sku: 'D1-FOREIGN',
    price: 10,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(products).values(
    Array.from({ length: SEMANTIC_CANDIDATE_LIMIT + 20 }, (_, index) => ({
      id: `semantic-candidate-broad-${String(index).padStart(3, '0')}`,
      tenantId,
      name: `Broadcandidate product ${String(index).padStart(3, '0')}`,
      sku: `D1-BROAD-${String(index).padStart(3, '0')}`,
      price: 10,
      createdAt: now,
      updatedAt: now,
    }))
  );
});

afterAll(async () => {
  if (server) await server.close();
});

describe('semantic product candidate retrieval', () => {
  it('uses OR-token FTS recall while preserving tenant and sellable-row boundaries', async () => {
    const candidates = await findSemanticProductCandidates(getDatabase(), tenantId, 'vino reserva');
    const ids = candidates.map(candidate => candidate.productId);

    expect(ids).toContain('semantic-candidate-wine');
    expect(ids).toContain('semantic-candidate-reserve');
    expect(ids).not.toContain('semantic-candidate-parent');
    expect(ids).not.toContain('semantic-candidate-foreign-product');
    expect(candidates.every(candidate => candidate.source === 'fts')).toBe(true);
  });

  it('deduplicates exact and FTS lanes while retaining exact priority', async () => {
    const candidates = await findSemanticProductCandidates(getDatabase(), tenantId, 'D1-WINE');
    const matches = candidates.filter(
      candidate => candidate.productId === 'semantic-candidate-wine'
    );

    expect(matches).toEqual([{ productId: 'semantic-candidate-wine', source: 'exact' }]);
    expect(candidates[0]).toEqual({ productId: 'semantic-candidate-wine', source: 'exact' });
  });

  it('uses the substring compatibility lane only when FTS cannot resolve the query', async () => {
    await expect(
      findSemanticProductCandidates(getDatabase(), tenantId, 'MarkerWithin')
    ).resolves.toEqual([{ productId: 'semantic-candidate-substring', source: 'substring' }]);
  });

  it('never returns more than the request-local semantic hard cap', async () => {
    const candidates = await findSemanticProductCandidates(
      getDatabase(),
      tenantId,
      'broadcandidate',
      Number.POSITIVE_INFINITY
    );

    expect(candidates).toHaveLength(SEMANTIC_CANDIDATE_LIMIT);
    expect(new Set(candidates.map(candidate => candidate.productId)).size).toBe(
      SEMANTIC_CANDIDATE_LIMIT
    );
  });
});
