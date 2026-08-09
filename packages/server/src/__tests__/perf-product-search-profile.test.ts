/**
 * Literal product-search relevance and scale contract.
 *
 * The isolated gate grows one tenant through 1k, 10k, and 50k products. At
 * every tier it drives the real tRPC procedure across the exact, FTS5, and
 * compatibility fallback lanes, checks deterministic relevance/tenant scope,
 * and records p95 without contention from the coverage pool.
 *
 * @module __tests__/perf-product-search-profile.test
 */

import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { performance } from 'node:perf_hooks';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { tenants, users } from '../db/schema.js';
import { computePercentile, loadPerfBudget } from '../perf/budgets.js';
import { buildProductFtsQuery } from '../services/products/fts-search.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

type SearchResult = Awaited<
  ReturnType<ReturnType<typeof appRouter.createCaller>['products']['search']>
>;

const budget = loadPerfBudget().productSearchProfile;
const measuredBuildElapsedMs: Record<string, number> = {};
const measuredP95: Record<string, Record<string, number>> = {};
const measuredQueryPlans: Record<string, string[]> = {};
const requiredQueryKeys = ['exactSku', 'ftsSelective', 'ftsBroad', 'substringFallback'] as const;

let server: PuntovivoServer | undefined;
let tenantId: string;
let userId: string;

function liveClient(): Database.Database {
  return (getDatabase() as unknown as { $client: Database.Database }).$client;
}

function buildCtx(): Context {
  if (!server) throw new Error('Product search profile server is not initialized');
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: {},
      user: { userId, email: 'admin@localhost', role: 'admin', tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: { id: userId, email: 'admin@localhost', role: 'admin', tenantId },
    tenantId,
    siteId: null,
  };
}

function paddedSequence(sequence: number): string {
  return String(sequence).padStart(6, '0');
}

function targetId(size: number): string {
  return `search-profile-product-${paddedSequence(size)}`;
}

function insertCatalogRange(fromExclusive: number, toInclusive: number): void {
  const sqlite = liveClient();
  const insert = sqlite.prepare(
    `INSERT INTO products (
       id, tenant_id, name, sku, description, price, barcode, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 100, ?, ?, ?)`
  );
  const now = '2026-08-08T00:00:00.000Z';
  const transaction = sqlite.transaction(() => {
    for (let sequence = fromExclusive + 1; sequence <= toInclusive; sequence += 1) {
      const padded = paddedSequence(sequence);
      const isTierTarget = budget.catalogSizes.includes(sequence);
      const name = isTierTarget
        ? `Catalog Widget ${padded} Scale${sequence} Needle InternalMarker${sequence}`
        : `Catalog Widget ${padded} Family${sequence % 100}`;
      insert.run(
        targetId(sequence),
        tenantId,
        name,
        `PERF-SKU-${padded}`,
        `Store scale reference group ${sequence % 50}`,
        `99${padded.padStart(12, '0')}`,
        now,
        now
      );
    }
  });
  transaction();
}

async function measureSearch(
  query: string,
  validate: (result: SearchResult) => void
): Promise<number> {
  const caller = appRouter.createCaller(buildCtx());
  const invoke = () => caller.products.search({ q: query, limit: budget.maxResults });
  validate(await invoke());
  for (let iteration = 0; iteration < budget.warmupIterations; iteration += 1) {
    await invoke();
  }

  const samples: number[] = [];
  for (let iteration = 0; iteration < budget.samplesPerQuery; iteration += 1) {
    const start = performance.now();
    const result = await invoke();
    samples.push(performance.now() - start);
    validate(result);
  }
  return computePercentile(samples, 95);
}

describe('product literal-search scale profile', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin');
    tenantId = admin.tenantId;
    userId = admin.id;

    const now = '2026-08-08T00:00:00.000Z';
    const foreignTenantId = 'search-profile-foreign-tenant';
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Search Profile Foreign Tenant',
      slug: foreignTenantId,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    liveClient()
      .prepare(
        `INSERT INTO products (
           id, tenant_id, name, sku, description, price, barcode, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 100, ?, ?, ?)`
      )
      .run(
        'search-profile-foreign-product',
        foreignTenantId,
        'Catalog Widget foreign Scale50000 Needle InternalMarker50000',
        'PERF-SKU-050000',
        'Cross-tenant collision',
        '99000000050000',
        now,
        now
      );
  });

  afterAll(async () => {
    if (Object.keys(measuredP95).length > 0) {
      process.stdout.write(
        `product-search-profile measured=${JSON.stringify({ buildElapsedMs: measuredBuildElapsedMs, p95: measuredP95, queryPlans: measuredQueryPlans })}\n`
      );
    }
    if (server) await server.close();
  });

  it('keeps relevance, consistency, plans, and p95 bounded at every catalog tier', async () => {
    const sqlite = liveClient();
    let cumulativeBuildElapsedMs = 0;
    let currentSize = 0;

    for (const size of budget.catalogSizes) {
      const buildStartedAt = performance.now();
      insertCatalogRange(currentSize, size);
      cumulativeBuildElapsedMs += performance.now() - buildStartedAt;
      currentSize = size;
      const sizeKey = String(size);
      const buildElapsedMs = cumulativeBuildElapsedMs;
      measuredBuildElapsedMs[sizeKey] = Number(buildElapsedMs.toFixed(2));
      const buildBaseline = budget.buildElapsedMs[sizeKey];
      expect(buildBaseline, `missing build budget for ${size}`).toBeDefined();
      expect(buildElapsedMs).toBeLessThanOrEqual(
        buildBaseline! * (1 + budget.thresholdPercent / 100)
      );

      const tenantRows = sqlite
        .prepare('SELECT count(*) AS count FROM products WHERE tenant_id = ?')
        .get(tenantId) as { count: number };
      const ftsRows = sqlite
        .prepare('SELECT count(*) AS count FROM product_search_fts WHERE tenant_id = ?')
        .get(tenantId) as { count: number };
      expect(tenantRows.count).toBe(size);
      expect(ftsRows.count).toBe(size);
      expect(() =>
        sqlite
          .prepare("INSERT INTO product_search_fts(product_search_fts) VALUES('integrity-check')")
          .run()
      ).not.toThrow();

      const padded = paddedSequence(size);
      const expectedId = targetId(size);
      const queries = {
        exactSku: `PERF-SKU-${padded}`,
        ftsSelective: `scale${size} need`,
        ftsBroad: 'catalog wid',
        substringFallback: `Marker${size}`,
      } as const;
      const baselines = budget.p95[sizeKey];
      expect(baselines, `missing p95 budgets for ${size}`).toBeDefined();
      expect(Object.keys(baselines ?? {}).sort()).toEqual([...requiredQueryKeys].sort());
      measuredP95[sizeKey] = {};

      for (const queryKey of requiredQueryKeys) {
        const p95 = await measureSearch(queries[queryKey], result => {
          const ids = result.items.map(item => item.id);
          expect(ids).not.toContain('search-profile-foreign-product');
          if (queryKey === 'ftsBroad') {
            expect(ids).toHaveLength(budget.maxResults);
          } else {
            expect(ids).toEqual([expectedId]);
          }
        });
        measuredP95[sizeKey]![queryKey] = Number(p95.toFixed(2));
        expect(p95, `${size} ${queryKey} p95`).toBeLessThanOrEqual(
          baselines![queryKey]! * (1 + budget.thresholdPercent / 100)
        );
      }

      const ftsQuery = buildProductFtsQuery(tenantId, queries.ftsSelective);
      if (!ftsQuery) throw new Error('Expected selective profile FTS query');
      const plan = sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT product_search_fts.product_id
           FROM product_search_fts
           INNER JOIN products ON products.id = product_search_fts.product_id
           WHERE product_search_fts MATCH ?
             AND product_search_fts.tenant_id = ?
             AND products.tenant_id = ?
           LIMIT ?`
        )
        .all(ftsQuery, tenantId, tenantId, budget.maxResults) as Array<{ detail: string }>;
      measuredQueryPlans[sizeKey] = plan.map(row => row.detail);
      const planDetails = measuredQueryPlans[sizeKey]!.join('\n');
      expect(planDetails).toContain('VIRTUAL TABLE INDEX');
      expect(planDetails).toContain('sqlite_autoindex_products_1');
    }
  }, 60_000);
});
