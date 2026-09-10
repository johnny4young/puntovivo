import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import Database from 'better-sqlite3';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer, type PuntovivoServer } from '../../index.js';
import { getDatabase } from '../../db/index.js';
import { products, tenants, users } from '../../db/schema.js';
import { buildProductFtsQuery, findFtsProductMatches } from './fts-search.js';
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

describe('FTS integer-key lookup lifecycle', () => {
  it('preserves ranking through rowid gaps, VACUUM and encrypted backup restore', async () => {
    const db = getDatabase();
    const sqlite = (db as typeof db & { $client: Database.Database }).$client;
    const query = 'broadcandidate';
    const match = buildProductFtsQuery(tenantId, query, 'OR');
    const oldQuery = `SELECT product_search_fts.product_id AS productId,
      bm25(product_search_fts, 0.0, 0.0, 0.0, 10.0, 8.0, 8.0, 2.0, 9.0, 9.0, 4.0, 9.0) AS score
      FROM product_search_fts JOIN products ON products.id = product_search_fts.product_id
      WHERE product_search_fts MATCH ? AND product_search_fts.tenant_id = ?
        AND products.tenant_id = ? AND products.catalog_type <> 'variant_parent'
      ORDER BY score, products.name COLLATE NOCASE, products.id LIMIT 200`;
    sqlite.prepare('DELETE FROM products WHERE id = ?').run('semantic-candidate-broad-010');
    const expected = sqlite.prepare(oldQuery).all(match, tenantId, tenantId);
    expect(findFtsProductMatches(db, tenantId, query, {}, 200, 'OR')).toEqual(expected);
    sqlite.exec('VACUUM');
    expect(findFtsProductMatches(db, tenantId, query, {}, 200, 'OR')).toEqual(expected);
    const dir = await mkdtemp(join(tmpdir(), 'puntovivo-fts-restore-'));
    let restored: Database.Database | undefined;
    try {
      const path = join(dir, 'encrypted.db');
      const key = 'a1'.repeat(32);
      const sourcePath = join(dir, 'source.db');
      sqlite.prepare('VACUUM INTO ?').run(sourcePath);
      const source = new Database(sourcePath);
      try {
        source.pragma("cipher = 'sqlcipher'");
        source.pragma('legacy = 4');
        source.pragma(`rekey = "x'${key}'"`);
        source.prepare('VACUUM INTO ?').run(path);
      } finally {
        source.close();
      }
      restored = new Database(path);
      restored.pragma("cipher = 'sqlcipher'");
      restored.pragma('legacy = 4');
      restored.pragma(`key = "x'${key}'"`);
      const restoredDb = { $client: restored } as unknown as typeof db;
      expect(findFtsProductMatches(restoredDb, tenantId, query, {}, 200, 'OR')).toEqual(expected);
    } finally {
      restored?.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.each(['missing', 'collision'] as const)(
    'fails closed for a forged FTS rowid (%s) without returning another product',
    mode => {
      const db = getDatabase();
      const sqlite = (db as typeof db & { $client: Database.Database }).$client;
      sqlite.exec('SAVEPOINT fts_identity');
      try {
        if (mode === 'collision') {
          const other = sqlite
            .prepare('SELECT rowid AS physicalRowid FROM products WHERE id = ?')
            .get('semantic-candidate-reserve') as { physicalRowid: number };
          sqlite
            .prepare('DELETE FROM product_search_fts WHERE product_id = ?')
            .run('semantic-candidate-reserve');
          sqlite
            .prepare('UPDATE product_search_fts SET rowid = ? WHERE product_id = ?')
            .run(BigInt(other.physicalRowid), 'semantic-candidate-wine');
        } else {
          sqlite
            .prepare('UPDATE product_search_fts SET rowid = rowid + 1000000 WHERE product_id = ?')
            .run('semantic-candidate-wine');
        }
        const rows = findFtsProductMatches(db, tenantId, 'vino', {}, 200, 'OR');
        expect(rows.map(row => row.productId)).not.toContain('semantic-candidate-wine');
        expect(rows.map(row => row.productId)).not.toContain('semantic-candidate-foreign-product');
      } finally {
        sqlite.exec('ROLLBACK TO fts_identity; RELEASE fts_identity');
      }
    }
  );
});
