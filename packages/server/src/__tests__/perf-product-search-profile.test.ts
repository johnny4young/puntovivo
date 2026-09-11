/**
 * Literal product-search relevance and scale contract.
 *
 * The isolated gate grows the same deterministic catalog through 1k, 10k, and
 * 50k products twice, once per tenant shape, each in its own in-memory
 * database:
 *
 * - retail: products only, the shape of a store without pharmacy data;
 * - pharmacy: the same products with a pharmacy profile on every row.
 *
 * At every tier it drives the real tRPC procedure across the exact, FTS5, and
 * compatibility fallback lanes, checks deterministic relevance and tenant
 * scope, and records p95 without contention from the coverage pool. The
 * substring lanes answer to per-shape budgets: profile content slows broad FTS
 * and adds a regulated-metadata lane, so one mixed fixture would either bill
 * retail stores for pharmacy data or let a pharmacy regression hide under
 * retail headroom.
 *
 * @module __tests__/perf-product-search-profile.test
 */

import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { performance } from 'node:perf_hooks';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { kdsRoutingRules, sites, tenants, users } from '../db/schema.js';
import { computePercentile, loadPerfBudget } from '../perf/budgets.js';
import { buildProductFtsQuery } from '../services/products/fts-search.js';
import {
  findSemanticProductCandidates,
  SEMANTIC_CANDIDATE_LIMIT,
} from '../services/products/semantic-candidates.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

type SearchResult = Awaited<
  ReturnType<ReturnType<typeof appRouter.createCaller>['products']['search']>
>;

const budget = loadPerfBudget().productSearchProfile;
const measuredBuildElapsedMs: Record<string, number> = {};
const measuredPharmacyBuildElapsedMs: Record<string, number> = {};
const measuredP95: Record<string, Record<string, number>> = {};
const measuredPharmacyP95: Record<string, Record<string, number>> = {};
const measuredQueryPlans: Record<string, string[]> = {};
const requiredQueryKeys = ['exactSku', 'ftsSelective', 'ftsBroad', 'substringFallback'] as const;
const requiredBudgetKeys = [...requiredQueryKeys, 'semanticCandidatePool'] as const;
const requiredPharmacyBudgetKeys = [
  'catalogSubstringFallback',
  'metadataSubstringFallback',
] as const;

let server: PuntovivoServer | undefined;
let tenantId: string;
let userId: string;
let siteId: string;

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

function ceiling(baseline: number): number {
  return baseline * (1 + budget.thresholdPercent / 100);
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

function attachPharmacySearchRange(fromExclusive: number, toInclusive: number): void {
  const sqlite = liveClient();
  const now = '2026-08-08T00:00:00.000Z';
  const insert = sqlite.prepare(
    `INSERT INTO pharmacy_product_profiles (
         product_id, tenant_id, active_ingredient, generic_name, manufacturer,
         sanitary_registration, sanitary_registration_normalized,
         registration_expires_at, classification, requires_cold_chain,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, '2030-12-31', 'otc', 0, ?, ?)`
  );
  sqlite.transaction(() => {
    for (let sequence = fromExclusive + 1; sequence <= toInclusive; sequence += 1) {
      const padded = paddedSequence(sequence);
      const isTierTarget = budget.catalogSizes.includes(sequence);
      insert.run(
        targetId(sequence),
        tenantId,
        isTierTarget ? `PharmaActive${sequence} Needle` : `PharmaActive Family${sequence % 100}`,
        `PharmaGeneric${sequence}`,
        `PharmaLaboratory${sequence % 250}`,
        `INVIMA-PERF-${padded}`,
        `INVIMA-PERF-${padded}`,
        now,
        now
      );
    }
  })();
}

/** Boot one isolated catalog database, seeded with a cross-tenant collision. */
async function bootCatalogServer(): Promise<void> {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!admin) throw new Error('Expected seeded admin');
  tenantId = admin.tenantId;
  userId = admin.id;
  const site = db.select().from(sites).where(eq(sites.tenantId, tenantId)).get();
  const tenant = db.select().from(tenants).where(eq(tenants.id, tenantId)).get();
  if (!site || !tenant) throw new Error('Expected seeded site and tenant');
  siteId = site.id;
  db.update(tenants)
    .set({
      settings: { ...tenant.settings, modules: { ...tenant.settings?.modules, kds: true } },
    })
    .where(eq(tenants.id, tenantId))
    .run();

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
}

async function closeCatalogServer(): Promise<void> {
  if (server) await server.close();
  server = undefined;
}

/** One FTS row per product, the expected profile count, and a sound index. */
function expectCatalogConsistency(size: number, profiles: number): void {
  const sqlite = liveClient();
  const countFor = (table: 'products' | 'product_search_fts' | 'pharmacy_product_profiles') =>
    (
      sqlite
        .prepare(`SELECT count(*) AS count FROM ${table} WHERE tenant_id = ?`)
        .get(tenantId) as {
        count: number;
      }
    ).count;
  expect(countFor('products')).toBe(size);
  expect(countFor('product_search_fts')).toBe(size);
  expect(countFor('pharmacy_product_profiles')).toBe(profiles);
  expect(() =>
    sqlite
      .prepare("INSERT INTO product_search_fts(product_search_fts) VALUES('integrity-check')")
      .run()
  ).not.toThrow();
}

async function measureSearch(
  query: string,
  validate: (result: SearchResult) => void,
  filters: { pharmacyOnly?: boolean } = {}
): Promise<number> {
  const caller = appRouter.createCaller(buildCtx());
  const invoke = () => caller.products.search({ q: query, limit: budget.maxResults, ...filters });
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

async function measureSemanticCandidatePool(): Promise<number> {
  const invoke = () => findSemanticProductCandidates(getDatabase(), tenantId, 'catalog widget');
  const validate = (result: Awaited<ReturnType<typeof invoke>>) => {
    expect(result).toHaveLength(SEMANTIC_CANDIDATE_LIMIT);
    expect(result.every(candidate => candidate.source === 'fts')).toBe(true);
    expect(result.map(candidate => candidate.productId)).not.toContain(
      'search-profile-foreign-product'
    );
  };
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

/**
 * The generic operator lanes, measured on whichever catalog is loaded. Both
 * shapes answer to the same exact, FTS, and hybrid-pool budgets; only the
 * substring lane is budgeted per shape by the caller.
 */
async function measureGenericLanes(
  size: number,
  record: Record<string, number>
): Promise<{ substringFallback: number }> {
  const baselines = budget.p95[String(size)]!;
  const padded = paddedSequence(size);
  const expectedId = targetId(size);
  const queries = {
    exactSku: `PERF-SKU-${padded}`,
    ftsSelective: `scale${size} need`,
    ftsBroad: 'catalog wid',
    substringFallback: `Marker${size}`,
  } as const;

  const measured: Partial<Record<(typeof requiredQueryKeys)[number], number>> = {};
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
    measured[queryKey] = p95;
    if (queryKey !== 'substringFallback') {
      record[queryKey] = Number(p95.toFixed(2));
      expect(p95, `${size} ${queryKey} p95`).toBeLessThanOrEqual(ceiling(baselines[queryKey]!));
    }
  }

  const semanticCandidateP95 = await measureSemanticCandidatePool();
  record.semanticCandidatePool = Number(semanticCandidateP95.toFixed(2));
  expect(semanticCandidateP95, `${size} semanticCandidatePool p95`).toBeLessThanOrEqual(
    ceiling(baselines.semanticCandidatePool!)
  );

  return { substringFallback: measured.substringFallback! };
}

async function measureKitchenRouting(size: number): Promise<void> {
  const caller = appRouter.createCaller(buildCtx());
  const expectedId = targetId(size);
  const invoke = (search: string, configuredOnly = false, cursor?: string) =>
    caller.kds.routingTargets({
      siteId,
      targetKind: 'product',
      search,
      configuredOnly,
      cursor,
      limit: budget.maxResults,
    });
  const cases = [
    {
      key: 'kitchenRoutingSku',
      invoke: () => invoke(`PERF-SKU-${paddedSequence(size)}`),
      ids: [expectedId],
      nextCursor: null,
    },
    {
      key: 'kitchenRoutingName',
      invoke: () => invoke(`InternalMarker${size}`),
      ids: [expectedId],
      nextCursor: null,
    },
    {
      key: 'kitchenRoutingPage',
      invoke: () => invoke('Catalog Widget'),
      ids: Array.from({ length: budget.maxResults }, (_, index) => targetId(index + 1)),
      nextCursor: targetId(budget.maxResults),
    },
    {
      key: 'kitchenRoutingLastPage',
      invoke: () => invoke('', false, targetId(size - budget.maxResults)),
      ids: Array.from({ length: budget.maxResults }, (_, index) =>
        targetId(size - budget.maxResults + index + 1)
      ),
      nextCursor: null,
    },
    {
      key: 'kitchenRoutingConfigured',
      invoke: () => invoke('', true),
      ids: budget.catalogSizes.filter(tier => tier <= size).map(targetId),
      nextCursor: null,
    },
  ];
  for (const testCase of cases) {
    const validate = (result: Awaited<ReturnType<typeof invoke>>) => {
      expect(result.items.map(item => item.id)).toEqual(testCase.ids);
      expect(result.nextCursor).toBe(testCase.nextCursor);
      for (const item of result.items) {
        expect(item.rule?.id ?? null).toBe(
          budget.catalogSizes.some(tier => targetId(tier) === item.id)
            ? `search-profile-route-${item.id}`
            : null
        );
      }
    };
    validate(await testCase.invoke());
    for (let iteration = 0; iteration < budget.warmupIterations; iteration += 1) {
      await testCase.invoke();
    }
    const samples: number[] = [];
    for (let iteration = 0; iteration < budget.samplesPerQuery; iteration += 1) {
      const start = performance.now();
      const result = await testCase.invoke();
      samples.push(performance.now() - start);
      validate(result);
    }
    const p95 = computePercentile(samples, 95);
    measuredP95[String(size)]![testCase.key] = Number(p95.toFixed(2));
    // This UI uses literal substring matching, not ranked FTS. Reuse the
    // existing substring budget rather than relaxing it for the joined query.
    expect(p95, `${size} ${testCase.key} p95`).toBeLessThanOrEqual(
      ceiling(budget.p95[String(size)]!.substringFallback!)
    );
  }
}

describe('product literal-search scale profile', () => {
  afterAll(() => {
    if (Object.keys(measuredP95).length > 0 || Object.keys(measuredPharmacyP95).length > 0) {
      process.stdout.write(
        `product-search-profile measured=${JSON.stringify({ buildElapsedMs: measuredBuildElapsedMs, pharmacyBuildElapsedMs: measuredPharmacyBuildElapsedMs, p95: measuredP95, pharmacyP95: measuredPharmacyP95, queryPlans: measuredQueryPlans })}\n`
      );
    }
  });

  it('declares every per-shape budget at every catalog tier', () => {
    for (const size of budget.catalogSizes) {
      expect(Object.keys(budget.p95[String(size)] ?? {}).sort(), `${size} retail budgets`).toEqual(
        [...requiredBudgetKeys].sort()
      );
      expect(
        Object.keys(budget.pharmacyP95[String(size)] ?? {}).sort(),
        `${size} pharmacy budgets`
      ).toEqual([...requiredPharmacyBudgetKeys].sort());
    }
  });

  describe('retail catalog without pharmacy profiles', () => {
    beforeAll(bootCatalogServer);
    afterAll(closeCatalogServer);

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
        measuredBuildElapsedMs[sizeKey] = Number(cumulativeBuildElapsedMs.toFixed(2));
        const buildBaseline = budget.buildElapsedMs[sizeKey];
        expect(buildBaseline, `missing build budget for ${size}`).toBeDefined();
        expect(cumulativeBuildElapsedMs).toBeLessThanOrEqual(ceiling(buildBaseline!));
        expectCatalogConsistency(size, 0);

        measuredP95[sizeKey] = {};
        const { substringFallback } = await measureGenericLanes(size, measuredP95[sizeKey]!);
        measuredP95[sizeKey]!.substringFallback = Number(substringFallback.toFixed(2));
        expect(substringFallback, `${size} substringFallback p95`).toBeLessThanOrEqual(
          ceiling(budget.p95[sizeKey]!.substringFallback!)
        );

        const expectedId = targetId(size);
        getDatabase()
          .insert(kdsRoutingRules)
          .values({
            id: `search-profile-route-${expectedId}`,
            tenantId,
            siteId,
            targetKind: 'product',
            targetId: expectedId,
            route: 'exclude',
          })
          .run();
        await measureKitchenRouting(size);

        const ftsQuery = buildProductFtsQuery(tenantId, `scale${size} need`);
        if (!ftsQuery) throw new Error('Expected selective profile FTS query');
        const plan = sqlite
          .prepare(
            `EXPLAIN QUERY PLAN
             SELECT product_search_fts.product_id
             FROM product_search_fts
             INNER JOIN products ON products.rowid = product_search_fts.rowid
               AND products.id = product_search_fts.product_id
             WHERE product_search_fts MATCH ?
               AND product_search_fts.tenant_id = ?
               AND products.tenant_id = ?
             LIMIT ?`
          )
          .all(ftsQuery, tenantId, tenantId, budget.maxResults) as Array<{ detail: string }>;
        measuredQueryPlans[sizeKey] = plan.map(row => row.detail);
        const planDetails = measuredQueryPlans[sizeKey]!.join('\n');
        expect(planDetails).toContain('VIRTUAL TABLE INDEX');
        expect(planDetails).toContain('SEARCH products USING INTEGER PRIMARY KEY (rowid=?)');
      }
    }, 60_000);
  });

  describe('pharmacy catalog with a profile on every product', () => {
    beforeAll(bootCatalogServer);
    afterAll(closeCatalogServer);

    it('keeps pharmacy relevance, plans, and p95 bounded at every catalog tier', async () => {
      const sqlite = liveClient();
      let currentSize = 0;

      for (const size of budget.catalogSizes) {
        // Product construction is gated by the retail phase; this phase gates
        // only the profile attachment it adds.
        insertCatalogRange(currentSize, size);
        const pharmacyBuildStartedAt = performance.now();
        attachPharmacySearchRange(currentSize, size);
        const pharmacyBuildElapsedMs = performance.now() - pharmacyBuildStartedAt;
        currentSize = size;
        const sizeKey = String(size);
        measuredPharmacyBuildElapsedMs[sizeKey] = Number(pharmacyBuildElapsedMs.toFixed(2));
        const pharmacyBuildBaseline = budget.pharmacyBuildElapsedMs[sizeKey];
        expect(pharmacyBuildBaseline, `missing pharmacy build budget for ${size}`).toBeDefined();
        expect(
          pharmacyBuildElapsedMs,
          `${size} pharmacy profile build elapsed`
        ).toBeLessThanOrEqual(ceiling(pharmacyBuildBaseline!));
        expectCatalogConsistency(size, size);

        const baselines = budget.p95[sizeKey]!;
        const pharmacyBaselines = budget.pharmacyP95[sizeKey]!;
        const record: Record<string, number> = {};
        measuredPharmacyP95[sizeKey] = record;
        const padded = paddedSequence(size);
        const expectedId = targetId(size);

        const { substringFallback } = await measureGenericLanes(size, record);
        record.catalogSubstringFallback = Number(substringFallback.toFixed(2));
        expect(
          substringFallback,
          `${size} pharmacy catalogSubstringFallback p95`
        ).toBeLessThanOrEqual(ceiling(pharmacyBaselines.catalogSubstringFallback!));

        const pharmacyFtsP95 = await measureSearch(
          `pharmaactive${size} need`,
          result => {
            expect(result.items.map(item => item.id)).toEqual([expectedId]);
          },
          { pharmacyOnly: true }
        );
        record.pharmacyFts = Number(pharmacyFtsP95.toFixed(2));
        expect(pharmacyFtsP95, `${size} pharmacyFts p95`).toBeLessThanOrEqual(
          ceiling(baselines.ftsSelective!)
        );

        const pharmacyRegistrationP95 = await measureSearch(
          `INVIMA-PERF-${padded}`,
          result => {
            expect(result.items.map(item => item.id)).toEqual([expectedId]);
          },
          { pharmacyOnly: true }
        );
        record.pharmacyRegistration = Number(pharmacyRegistrationP95.toFixed(2));
        expect(pharmacyRegistrationP95, `${size} pharmacyRegistration p95`).toBeLessThanOrEqual(
          ceiling(baselines.exactSku!)
        );

        // A within-token fragment of the active ingredient: no FTS prefix
        // phrase reaches it, so a pharmacy-only search scans regulated
        // metadata through the joined literal lane.
        const metadataSubstringP95 = await measureSearch(
          `Active${size}`,
          result => {
            expect(result.items.map(item => item.id)).toEqual([expectedId]);
          },
          { pharmacyOnly: true }
        );
        record.metadataSubstringFallback = Number(metadataSubstringP95.toFixed(2));
        expect(
          metadataSubstringP95,
          `${size} pharmacy metadataSubstringFallback p95`
        ).toBeLessThanOrEqual(ceiling(pharmacyBaselines.metadataSubstringFallback!));

        const registrationPlan = sqlite
          .prepare(
            `EXPLAIN QUERY PLAN
             SELECT products.id
             FROM pharmacy_product_profiles
             INNER JOIN products ON products.id = pharmacy_product_profiles.product_id
             WHERE pharmacy_product_profiles.tenant_id = ?
               AND pharmacy_product_profiles.sanitary_registration_normalized = ?
               AND products.tenant_id = ?
             LIMIT ?`
          )
          .all(tenantId, `INVIMA-PERF-${padded}`, tenantId, budget.maxResults) as Array<{
          detail: string;
        }>;
        measuredQueryPlans[`${sizeKey}:pharmacyRegistration`] = registrationPlan.map(
          row => row.detail
        );
        expect(
          registrationPlan.some(row => row.detail.includes('idx_pharmacy_profiles_registration'))
        ).toBe(true);
      }
    }, 60_000);
  });
});
