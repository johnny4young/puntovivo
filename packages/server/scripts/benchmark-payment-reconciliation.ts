/**
 * ENG-038c — Payment reconciliation matcher benchmark.
 *
 * Operator-runnable. Walks the deterministic 30-day fixture across
 * every rail and asserts the matcher meets the ≥95% AC. Exits non-zero
 * below `--threshold` (default 0.95).
 *
 *   npm run benchmark:payment-reconciliation --workspace=@puntovivo/server
 *
 * No live provider call — the harness invokes the matcher against the
 * synthetic fixture. The benchmark exists so the operator can confirm
 * the AC on demand without spinning up a full vitest run, and so future
 * tickets (live providers, refined heuristic) have a fast feedback loop.
 */
import { createServer } from '../src/index.js';
import type { DatabaseInstance } from '../src/db/index.js';
import {
  paymentOutbox,
  salePayments,
  sales,
  tenants,
  users,
} from '../src/db/schema.js';
import {
  generatePaymentStatementFixture,
  listOutboxRows,
  listPosTenders,
  listStatementRows,
  type FixtureBundle,
} from '../__fixtures__/payment-statements/index.js';
import { runReconciliationPass } from '../src/services/payments/reconciliation.js';

const TENANT_ID = 'benchmark-payment-tenant';
const ADMIN_ID = 'benchmark-payment-admin';
const FIXED_NOW = new Date('2026-05-01T01:00:00.000Z');

interface RunArgs {
  threshold: number;
  seed: number;
}

function parseArgs(argv: string[]): RunArgs {
  const args: RunArgs = { threshold: 0.95, seed: 7 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--threshold' && argv[i + 1]) {
      const next = argv[i + 1];
      if (next === undefined) continue;
      const n = Number(next);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        throw new Error(`--threshold must be a number in [0,1], got "${next}"`);
      }
      args.threshold = n;
      i++;
    } else if (a === '--seed' && argv[i + 1]) {
      const next = argv[i + 1];
      if (next === undefined) continue;
      const n = Number(next);
      if (!Number.isFinite(n)) {
        throw new Error(`--seed must be a number, got "${next}"`);
      }
      args.seed = n;
      i++;
    }
  }
  return args;
}

async function seedTenant(db: DatabaseInstance, bundle: FixtureBundle): Promise<void> {
  const now = new Date().toISOString();
  await db.insert(tenants).values({
    id: TENANT_ID,
    name: 'Benchmark payment tenant',
    slug: 'benchmark-payment-tenant',
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: ADMIN_ID,
    tenantId: TENANT_ID,
    email: 'admin@benchmark-payment.test',
    name: 'Benchmark admin',
    passwordHash: 'x',
    sessionVersion: 1,
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  for (const tender of listPosTenders(bundle)) {
    const saleId = `sale-${tender.salePaymentId}`;
    await db.insert(sales).values({
      id: saleId,
      tenantId: TENANT_ID,
      saleNumber: saleId.toUpperCase(),
      subtotal: tender.amount,
      taxAmount: 0,
      discountAmount: 0,
      total: tender.amount,
      paymentMethod: 'card',
      paymentStatus: 'paid',
      status: 'completed',
      createdBy: ADMIN_ID,
      createdAt: tender.createdAt,
      updatedAt: tender.createdAt,
    });
    await db.insert(salePayments).values({
      id: tender.salePaymentId,
      tenantId: TENANT_ID,
      saleId,
      method: 'card',
      amount: tender.amount,
      reference: tender.reference,
      createdAt: tender.createdAt,
    });
  }

  for (const row of listOutboxRows(bundle)) {
    await db.insert(paymentOutbox).values({
      id: row.id,
      tenantId: TENANT_ID,
      salePaymentId: row.salePaymentId,
      railId: row.railId,
      kind: 'charge',
      status: row.status,
      amount: row.amount,
      currencyCode: row.currencyCode,
      reference: row.reference,
      providerTransactionId: row.providerTransactionId,
      payload: { fixture: true },
      payloadVersion: 1,
      attempts: 0,
      nextRetryAt: null,
      lastError: null,
      priority: 0,
      claimToken: null,
      lockedAt: null,
      idempotencyKey: null,
      createdAt: row.createdAt,
      updatedAt: row.createdAt,
    });
  }
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + ' '.repeat(width - value.length);
}

async function main(): Promise<void> {
  const { threshold, seed } = parseArgs(process.argv.slice(2));

  const server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = server.db;

  const bundle = generatePaymentStatementFixture({
    seed,
    days: 30,
    settlementsPerRailPerDay: 6,
    mismatchRate: 0.05,
    windowEnd: FIXED_NOW.toISOString(),
    tenantId: 'benchmark-payment',
  });
  await seedTenant(db, bundle);

  const statementRows = listStatementRows(bundle);
  const startedAt = Date.now();
  const pass = await runReconciliationPass(db, TENANT_ID, statementRows, {
    now: FIXED_NOW,
  });
  const durationMs = Date.now() - startedAt;

  const totalStatementRows = statementRows.length;
  const matchRate = pass.matched / Math.max(totalStatementRows, 1);

  const ROW_HEADERS = ['Kind', 'Count'];
  const ROW_W = 30;
  const ROW_VW = 8;

  // eslint-disable-next-line no-console
  console.log('Puntovivo — Payment Reconciliation Benchmark');
  // eslint-disable-next-line no-console
  console.log(`seed=${seed} days=30 settlements/rail/day=6 mismatchRate=0.05`);
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(`Statement rows considered: ${totalStatementRows}`);
  // eslint-disable-next-line no-console
  console.log(`Matched                  : ${pass.matched}`);
  // eslint-disable-next-line no-console
  console.log(`Mismatches               : ${pass.unmatched}`);
  // eslint-disable-next-line no-console
  console.log(`Match rate               : ${(matchRate * 100).toFixed(2)}%`);
  // eslint-disable-next-line no-console
  console.log(`Threshold                : ${(threshold * 100).toFixed(2)}%`);
  // eslint-disable-next-line no-console
  console.log(`Duration                 : ${durationMs} ms`);
  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(`${pad(ROW_HEADERS[0]!, ROW_W)}${pad(ROW_HEADERS[1]!, ROW_VW)}`);
  // eslint-disable-next-line no-console
  console.log('-'.repeat(ROW_W + ROW_VW));
  for (const [kind, count] of Object.entries(pass.byKind)) {
    // eslint-disable-next-line no-console
    console.log(`${pad(kind, ROW_W)}${pad(String(count), ROW_VW)}`);
  }
  // eslint-disable-next-line no-console
  console.log('');

  await server.close();

  if (matchRate < threshold) {
    // eslint-disable-next-line no-console
    console.error(
      `FAIL — match rate ${(matchRate * 100).toFixed(2)}% below threshold ${(threshold * 100).toFixed(2)}%`
    );
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`PASS — match rate ${(matchRate * 100).toFixed(2)}% meets threshold.`);
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('Benchmark failed:', err);
  process.exit(1);
});
