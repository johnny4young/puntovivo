/**
 * Store-sized SQLite performance contract.
 *
 * Unlike the small-fixture tRPC latency gate, this suite boots the deterministic
 * mega preset and refuses to measure until the expected catalog, sales,
 * inventory, audit, and customer-ledger volumes exist. It then measures hot
 * operational reads through the real tRPC caller and pins the tenant-scoped
 * indexes selected by SQLite's query planner.
 *
 * @module __tests__/perf-store-profile.test
 */

import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { performance } from 'node:perf_hooks';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { DEV_ADMIN_EMAIL, seedDevData } from '../db/seed-dev.js';
import { users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { computePercentile, loadPerfBudget } from '../perf/budgets.js';
import { calendarDayInTimeZone } from '../services/reports/day-window.js';
import { resolveTenantLocale } from '../services/tenant-locale.js';

interface QueryPlanRow {
  detail: string;
}

const budget = loadPerfBudget().storeProfile;
const operationalBudget = loadPerfBudget().operationalProfile;
const measuredP95: Record<string, number> = {};
const measuredRows: Record<string, number> = {};
const measuredQueryPlans: Record<string, string[]> = {};
const measuredOperational: Record<string, number> = {};

let server: PuntovivoServer | undefined;
let tenantId: string;
let userId: string;
let siteId: string;
let ledgerCustomerId: string;
let reportDate: string;
let seedElapsedMs = 0;

function liveClient(): Database.Database {
  return (getDatabase() as unknown as { $client: Database.Database }).$client;
}

function buildCtx(): Context {
  if (!server) throw new Error('Store profile server is not initialized');
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: {},
      user: { userId, email: DEV_ADMIN_EMAIL, role: 'admin', tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: { id: userId, email: DEV_ADMIN_EMAIL, role: 'admin', tenantId },
    tenantId,
    siteId,
  };
}

async function invokeStoreRead(key: string): Promise<void> {
  const caller = appRouter.createCaller(buildCtx());
  switch (key) {
    case 'sales.list':
      await caller.sales.list({ page: 1, perPage: 50 });
      return;
    case 'inventory.listStock':
      await caller.inventory.listStock({ page: 1, perPage: 50 });
      return;
    case 'inventory.listMovements':
      await caller.inventory.listMovements({ page: 1, perPage: 50 });
      return;
    case 'customerLedger.list':
      await caller.customerLedger.list({ customerId: ledgerCustomerId, limit: 50 });
      return;
    case 'customerLedger.getBalance':
      await caller.customerLedger.getBalance({ customerId: ledgerCustomerId });
      return;
    case 'auditLogs.list':
      await caller.auditLogs.list({ limit: 100 });
      return;
    case 'reports.dayClose.preview':
      await caller.reports.dayClose.preview({ date: reportDate });
      return;
    default:
      throw new Error(`perf-store-profile: no tRPC caller branch for ${key}`);
  }
}

function queryPlanSql(key: string): string {
  switch (key) {
    case 'sales.list':
      return 'EXPLAIN QUERY PLAN SELECT id FROM sales WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50';
    case 'inventory.listMovements':
      return 'EXPLAIN QUERY PLAN SELECT id FROM inventory_movements WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50';
    case 'customerLedger.list':
      return 'EXPLAIN QUERY PLAN SELECT id FROM customer_ledger_entries WHERE tenant_id = ? AND customer_id = ? ORDER BY occurred_at DESC LIMIT 50';
    case 'auditLogs.list':
      return 'EXPLAIN QUERY PLAN SELECT id FROM audit_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100';
    default:
      throw new Error(`perf-store-profile: no query-plan statement for ${key}`);
  }
}

// Wall-clock percentiles are meaningless while the coverage suite is running
// hundreds of files in parallel. ci:server re-runs this file in its own
// single-worker process through scripts/run-store-profile-gate.mjs.
describe.skipIf(process.env.PUNTOVIVO_STORE_PROFILE !== '1')(
  'store-sized operational profile',
  () => {
    beforeAll(async () => {
      server = await createServer({ dbPath: ':memory:', verbose: false });
      const db = getDatabase();
      const start = performance.now();
      const seeded = await seedDevData(db, { preset: budget.preset, verbose: false });
      seedElapsedMs = performance.now() - start;
      tenantId = seeded.tenantId;
      siteId = seeded.sites[0]?.id ?? '';

      const admin = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.tenantId, tenantId), eq(users.email, DEV_ADMIN_EMAIL)))
        .get();
      if (!admin || !siteId) throw new Error('Expected mega seed admin and site');
      userId = admin.id;

      const sqlite = liveClient();
      const ledgerOwner = sqlite
        .prepare(
          'SELECT customer_id AS customerId, count(*) AS entries FROM customer_ledger_entries WHERE tenant_id = ? GROUP BY customer_id ORDER BY entries DESC LIMIT 1'
        )
        .get(tenantId) as { customerId: string; entries: number } | undefined;
      if (!ledgerOwner) throw new Error('Expected mega seed customer ledger rows');
      ledgerCustomerId = ledgerOwner.customerId;

      const latestSale = sqlite
        .prepare(
          'SELECT created_at AS createdAt FROM sales WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1'
        )
        .get(tenantId) as { createdAt: string } | undefined;
      if (!latestSale) throw new Error('Expected mega seed sales');
      const locale = await resolveTenantLocale(getDatabase(), tenantId);
      const tenantToday = calendarDayInTimeZone(new Date(), locale.timezone);
      reportDate =
        latestSale.createdAt.slice(0, 10) > tenantToday
          ? tenantToday
          : latestSale.createdAt.slice(0, 10);
    }, 30_000);

    afterAll(async () => {
      if (Object.keys(measuredP95).length > 0) {
        process.stdout.write(
          `store-profile measured=${JSON.stringify({ seedElapsedMs, rows: measuredRows, p95: measuredP95, queryPlans: measuredQueryPlans, operational: measuredOperational })}\n`
        );
      }
      if (server) await server.close();
    });

    it('builds the full mega dataset within its elapsed-time budget', () => {
      const ceiling = budget.seedElapsedMs * (1 + budget.thresholdPercent / 100);
      expect(seedElapsedMs).toBeLessThanOrEqual(ceiling);

      const sqlite = liveClient();
      for (const [table, minimum] of Object.entries(budget.minimumRows)) {
        if (!/^[a-z_]+$/.test(table)) {
          throw new Error(`perf-store-profile: unsafe table budget key ${table}`);
        }
        const row = sqlite
          .prepare(`SELECT count(*) AS count FROM ${table} WHERE tenant_id = ?`)
          .get(tenantId) as { count: number };
        measuredRows[table] = row.count;
        expect(row.count, `${table} row count`).toBeGreaterThanOrEqual(minimum);
      }
    });

    it('keeps historical credit sales represented and fully reversed when refunded', () => {
      const sqlite = liveClient();
      const missingLedger = sqlite
        .prepare(
          `SELECT count(*) AS count
         FROM sales s
         WHERE s.tenant_id = ?
           AND s.payment_method = 'credit'
           AND s.customer_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1
             FROM customer_ledger_entries cle
             WHERE cle.tenant_id = s.tenant_id
               AND cle.reference_sale_id = s.id
               AND cle.kind = 'sale'
           )`
        )
        .get(tenantId) as { count: number };
      expect(missingLedger.count).toBe(0);

      const nonZeroRefunds = sqlite
        .prepare(
          `SELECT count(*) AS count
         FROM (
           SELECT s.id
           FROM sales s
           JOIN customer_ledger_entries cle
             ON cle.tenant_id = s.tenant_id
            AND cle.reference_sale_id = s.id
           WHERE s.tenant_id = ?
             AND s.payment_method = 'credit'
             AND s.payment_status = 'refunded'
           GROUP BY s.id
           HAVING abs(sum(cle.amount)) > 0.005
         )`
        )
        .get(tenantId) as { count: number };
      expect(nonZeroRefunds.count).toBe(0);
    });

    it('keeps critical tenant-scoped query plans on their declared indexes', () => {
      const sqlite = liveClient();
      for (const [key, requiredIndex] of Object.entries(budget.queryPlanIndexes)) {
        const params = key === 'customerLedger.list' ? [tenantId, ledgerCustomerId] : [tenantId];
        const rows = sqlite.prepare(queryPlanSql(key)).all(...params) as QueryPlanRow[];
        const planDetails = rows.map(row => row.detail);
        measuredQueryPlans[key] = planDetails;
        const details = planDetails.join('\n');
        expect(details, `${key} query plan`).toContain(requiredIndex);
      }
    });

    for (const [key, baselineMs] of Object.entries(budget.p95)) {
      const ceiling = baselineMs * (1 + budget.thresholdPercent / 100);
      it(`${key} p95 stays under ${baselineMs}ms (+ ${budget.thresholdPercent}%)`, async () => {
        for (let i = 0; i < budget.warmupIterations; i += 1) {
          await invokeStoreRead(key);
        }

        const samples: number[] = [];
        for (let i = 0; i < budget.samplesPerProcedure; i += 1) {
          const start = performance.now();
          await invokeStoreRead(key);
          samples.push(performance.now() - start);
        }

        const p95 = computePercentile(samples, 95);
        measuredP95[key] = Number(p95.toFixed(2));
        expect(p95).toBeLessThanOrEqual(ceiling);
      }, 30_000);
    }

    it('previews and commits one maximum-size launch product import within budget', async () => {
      const rows = Array.from({ length: operationalBudget.launchImport.rows }, (_, index) => {
        const number = String(index + 1).padStart(4, '0');
        return {
          rowNumber: index + 2,
          values: {
            name: `Performance import product ${number}`,
            sku: `PERF-IMPORT-${number}`,
            price: '12500',
            cost: '7800',
            stock: '4',
            minStock: '1',
            taxRate: '19',
          },
        };
      });
      const input = {
        dataMode: 'real' as const,
        sourceName: 'performance-launch-import.csv',
        decimalFormat: 'auto' as const,
        rows,
      };
      const caller = appRouter.createCaller(buildCtx());
      const tolerance = 1 + operationalBudget.thresholdPercent / 100;

      const previewStart = performance.now();
      const preview = await caller.launchMigration.previewProducts(input);
      const previewElapsedMs = performance.now() - previewStart;
      measuredOperational['launchImport.previewElapsedMs'] = Number(previewElapsedMs.toFixed(2));
      expect(preview.summary).toEqual({
        total: operationalBudget.launchImport.rows,
        ready: operationalBudget.launchImport.rows,
        duplicates: 0,
        invalid: 0,
      });
      expect(previewElapsedMs).toBeLessThanOrEqual(
        operationalBudget.launchImport.previewElapsedMs * tolerance
      );

      const commitStart = performance.now();
      const result = await caller.launchMigration.importProducts({
        ...input,
        confirmedRealData: true,
        previewHash: preview.previewHash,
      });
      const commitElapsedMs = performance.now() - commitStart;
      measuredOperational['launchImport.commitElapsedMs'] = Number(commitElapsedMs.toFixed(2));
      expect(result.summary).toMatchObject({
        total: operationalBudget.launchImport.rows,
        imported: operationalBudget.launchImport.rows,
        failed: 0,
      });
      expect(commitElapsedMs).toBeLessThanOrEqual(
        operationalBudget.launchImport.commitElapsedMs * tolerance
      );
    }, 30_000);
  }
);
