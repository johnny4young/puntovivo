/**
 * tRPC p95 latency CI gate.
 *
 * Runs a curated set of read procedures with measured warmup +
 * samples and asserts the p95 fits inside the per-procedure budget
 * declared in the repo-wide `perf-budget.json`. A regression past
 * `thresholdPercent` is a CI fail; CI never silently swallows a
 * legitimate latency increase.
 *
 * The procedure list lives in the JSON budget, not in this file, so
 * adding a procedure to the gate is a one-line JSON edit. The
 * harness drives each procedure by calling the tRPC router via
 * `createCaller` — no HTTP layer, no JWT verification overhead.
 *
 * Mitigations against CI runner jitter:
 * - `warmupIterations` discarded measurements (JIT settling).
 * - `samplesPerProcedure` per procedure (= 50 by default).
 * - p95 (not p99) for less tail noise.
 * - 20% threshold over budget.
 *
 * @module __tests__/perf-trpc-latency.test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { performance } from 'node:perf_hooks';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  customers,
  products,
  sites,
  users,
  type NewCustomer,
  type NewProduct,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { computePercentile, loadPerfBudget } from '../perf/budgets.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;

const SEED_PRODUCTS = 30;
const SEED_CUSTOMERS = 20;

function buildCtx(): Context {
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
    siteId,
  };
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!admin) throw new Error('Expected seeded admin');
  tenantId = admin.tenantId;
  userId = admin.id;
  const siteRow = await db.select().from(sites).where(eq(sites.tenantId, tenantId)).get();
  if (!siteRow) throw new Error('Expected at least one seeded site');
  siteId = siteRow.id;

  // Realistic-ish seed: enough rows so the query optimizer is not
  // measured on the trivial empty-table path, but small enough that
  // the suite remains fast.
  const now = new Date().toISOString();
  for (let i = 0; i < SEED_PRODUCTS; i++) {
    const product: NewProduct = {
      id: nanoid(),
      tenantId,
      name: `Perf Product ${i}`,
      sku: `SKU-PERF-${i}`,
      price: 100 + i,
      price2: 100 + i,
      price3: 100 + i,
      cost: 50,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 19,
      initialCost: 50,
      stock: 100,
      minStock: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(products).values(product);
  }
  for (let i = 0; i < SEED_CUSTOMERS; i++) {
    const customer: NewCustomer = {
      id: nanoid(),
      tenantId,
      name: `Perf Customer ${i}`,
      taxId: `8001234${String(i).padStart(2, '0')}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(customers).values(customer);
  }
});

afterAll(async () => {
  await server.close();
});

/**
 * Dispatch map: budget key → caller invocation. Adding a procedure
 * to the gate means adding a JSON key in `perf-budget.json` AND a
 * branch here so the suite knows how to call it. Inputs are minimal
 * pagination + identity defaults.
 */
async function invokeProcedureForLatency(key: string): Promise<void> {
  const caller = appRouter.createCaller(buildCtx());
  switch (key) {
    case 'products.list':
      await caller.products.list({ page: 1, perPage: 50 });
      return;
    case 'customers.list':
      await caller.customers.list({ page: 1, perPage: 50 });
      return;
    case 'reports.fiscal.list':
      await caller.reports.fiscal.list({ limit: 50, offset: 0 });
      return;
    case 'auditLogs.list':
      await caller.auditLogs.list({ limit: 50 });
      return;
    case 'setupReadiness.get':
      await caller.setupReadiness.get();
      return;
    default:
      throw new Error(
        `perf-trpc-latency.test: no caller branch for ${key} — add one in invokeProcedureForLatency`
      );
  }
}

describe('tRPC p95 latency budgets', () => {
  it('computePercentile matches the canonical formula', () => {
    // Linear interpolation (NumPy default): rank = (p/100) * (n-1).
    // p50 of [10,20,30] → rank 1 → exact 20.
    expect(computePercentile([10, 20, 30], 50)).toBe(20);
    // p95 of [1..100] → rank 94.05 → interpolation between
    // sorted[94]=95 and sorted[95]=96 → 95 * 0.95 + 96 * 0.05 = 95.05.
    // `toBeCloseTo` with 2-decimal precision pins the interpolation
    // behaviour without overcommitting to a strict equality the
    // helper does not promise.
    expect(
      computePercentile(
        Array.from({ length: 100 }, (_, i) => i + 1),
        95
      )
    ).toBeCloseTo(95.05, 2);
    expect(computePercentile([], 95)).toBe(0);
  });

  const budget = loadPerfBudget();
  const procedures = Object.keys(budget.trpcLatencyMs.p95);
  // Sanity: the budget cannot be empty — that would silently skip
  // every assertion.
  expect(procedures.length).toBeGreaterThan(0);

  for (const procedureKey of procedures) {
    const budgetMs = budget.trpcLatencyMs.p95[procedureKey]!;
    const ceiling = budgetMs * (1 + budget.trpcLatencyMs.thresholdPercent / 100);
    it(`${procedureKey} p95 stays under ${budgetMs}ms (+ ${budget.trpcLatencyMs.thresholdPercent}%)`, async () => {
      // Warmup — JIT settling. Discard timings.
      for (let i = 0; i < budget.trpcLatencyMs.warmupIterations; i++) {
        await invokeProcedureForLatency(procedureKey);
      }
      // Recorded samples.
      const samples: number[] = [];
      for (let i = 0; i < budget.trpcLatencyMs.samplesPerProcedure; i++) {
        const start = performance.now();
        await invokeProcedureForLatency(procedureKey);
        samples.push(performance.now() - start);
      }
      const p95 = computePercentile(samples, 95);
      if (p95 > ceiling) {
        throw new Error(
          `perf regression for ${procedureKey}: ` +
            `p95 ${p95.toFixed(2)}ms exceeds ${budgetMs}ms + ${budget.trpcLatencyMs.thresholdPercent}% ceiling ${ceiling.toFixed(2)}ms.\n` +
            `samples (ms): ${samples.map(s => s.toFixed(2)).join(', ')}`
        );
      }
      // Surface the measured value in vitest output so future
      // bumpers can update perf-budget.json with the right number.
      expect(p95).toBeLessThanOrEqual(ceiling);
    }, 30_000);
  }
});
