/**
 * Second connection for `transfer-deposit-concurrency.test.ts` (S14).
 *
 * `better-sqlite3` is synchronous: a second connection opened inside the test's
 * own thread could only ever be *interleaved* between two calls, never running
 * at the same time as the test's write, so it could not prove anything about
 * concurrency. A `worker_threads` worker gets its own module registry, so the
 * `initDatabase()` call below opens a genuinely independent connection to the
 * same file and its writes really do run in another thread at the same instant
 * as the parent's.
 *
 * This is a fixture, not product code. It holds no business rule of its own: it
 * opens the production connection path, calls the production writer, and
 * exposes only the three things a single-threaded test cannot do —
 *
 * 1. write a deposit as the second connection and report both timestamps, so
 *    the parent can check the two calls really overlapped in flight;
 * 2. hold the SQLite writer lock for a measured span (`hold`);
 * 3. run a deliberately **unserialized** read-modify-write (`naive-*`) as the
 *    negative control that proves the harness can catch a lost update. The
 *    control reads its snapshot outside any write lock, waits while the real
 *    writer commits, and then writes the verdict of its stale read. It is the
 *    textbook shape of the defect `BEGIN IMMEDIATE` prevents, and it is kept
 *    here — not in the product — so the failing shape is reproducible without
 *    changing product code.
 */

import { parentPort } from 'node:worker_threads';

import type Database from 'better-sqlite3';
import { and, eq } from 'drizzle-orm';

import { getDatabase, initDatabase } from '../../db/index.js';
import { auditLogs, salePayments, sales } from '../../db/schema.js';
import { registerManualDeposit } from '../../services/payments/transfer-reconciliation.js';

/** The immutable audit action one deposit movement leaves behind. */
const DEPOSIT_AUDIT_ACTION = 'sale_payment.transfer_manual_confirmed';

/** One deposit, in the shape the production writer takes. */
export interface DepositRequest {
  tenantId: string;
  siteId: string;
  actorId: string;
  saleId: string;
  salePaymentId: string;
  verifiedAmount: number;
  reference: string | null;
  valueDate: string | null;
  note: string | null;
  idempotencyKey: string;
}

/** What `registerManualDeposit` answers. */
export interface DepositOutcome {
  appliedAmount: number;
  surplusAmount: number;
  status: string;
}

/** This connection's view of a tender, read after the parent committed. */
export interface TenderSnapshot {
  auditRowCount: number;
  verifiedAmounts: number[];
  appliedAmounts: number[];
  idempotencyKeys: string[];
  tenderStatus: string | null;
  saleTotal: number | null;
}

/**
 * A deposit gated on a shared barrier, so both threads call the writer at the
 * same instant: the worker blocks until the parent publishes `round`.
 */
export interface RaceRequest {
  request: DepositRequest;
  barrier: SharedArrayBuffer;
  round: number;
}

export type WorkerCommand =
  | { kind: 'open'; dbPath: string }
  | { kind: 'deposit'; request: DepositRequest }
  | { kind: 'race-deposit'; race: RaceRequest }
  | { kind: 'snapshot'; tenantId: string; saleId: string; salePaymentId: string }
  | { kind: 'hold'; holdMs: number }
  | { kind: 'naive-begin'; tenantId: string; saleId: string; salePaymentId: string }
  | { kind: 'naive-commit' };

export type WorkerReplyBody =
  | { kind: 'opened'; journalMode: string }
  | { kind: 'deposit'; outcome: DepositOutcome; startedAt: number; finishedAt: number }
  | { kind: 'deposit-failed'; message: string; code: string | null }
  | { kind: 'snapshot'; snapshot: TenderSnapshot }
  | { kind: 'lock-held'; lockedAt: number }
  | { kind: 'naive-snapshot'; observedRows: number }
  | { kind: 'naive-committed'; statusWritten: string }
  | { kind: 'naive-failed'; message: string; code: string | null }
  | { kind: 'failed'; message: string; code: string | null };

export interface WorkerRequestMessage {
  id: number;
  command: WorkerCommand;
}

export interface WorkerReplyMessage {
  id: number;
  reply: WorkerReplyBody;
}

export interface WorkerEventMessage {
  id: null;
  event: 'hold-released';
  releasedAt: number;
}

const port = parentPort;
if (port === null) {
  throw new Error('transfer-concurrency-worker must be started from a worker thread');
}
const workerPort = port;

/** One open-control transaction, kept between its two messages. */
let control: { salePaymentId: string; observedRows: number } | null = null;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/** The native handle behind the Drizzle instance, as the db module does it. */
function nativeClient(): Database.Database {
  return (getDatabase() as unknown as { $client: Database.Database }).$client;
}

function readTenderSnapshot(args: {
  tenantId: string;
  saleId: string;
  salePaymentId: string;
}): TenderSnapshot {
  const db = getDatabase();
  const rows = db
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.tenantId, args.tenantId),
        eq(auditLogs.action, DEPOSIT_AUDIT_ACTION),
        eq(auditLogs.resourceId, args.saleId)
      )
    )
    .all();
  const payloads = rows.map(row => (row.after ?? {}) as Record<string, unknown>);
  const tender = db
    .select()
    .from(salePayments)
    .where(and(eq(salePayments.id, args.salePaymentId), eq(salePayments.tenantId, args.tenantId)))
    .get();
  const sale = db
    .select()
    .from(sales)
    .where(and(eq(sales.id, args.saleId), eq(sales.tenantId, args.tenantId)))
    .get();

  return {
    auditRowCount: rows.length,
    verifiedAmounts: payloads.map(payload => Number(payload['verifiedAmount'])),
    appliedAmounts: payloads.map(payload => Number(payload['appliedAmount'])),
    idempotencyKeys: payloads.map(payload => String(payload['idempotencyKey'])),
    tenderStatus: tender?.confirmationStatus ?? null,
    saleTotal: sale?.total ?? null,
  };
}

/** Run the production writer on this connection and time the call. */
function depositReply(request: DepositRequest): WorkerReplyBody {
  const startedAt = Date.now();
  try {
    const outcome = registerManualDeposit(getDatabase(), { ...request });
    return { kind: 'deposit', outcome, startedAt, finishedAt: Date.now() };
  } catch (error) {
    return {
      kind: 'deposit-failed',
      message: messageOf(error),
      code: errorCode(error),
    };
  }
}

/** Release the write lock taken by `hold` without letting a failure wedge it. */
function releaseHold(sqlite: Database.Database): void {
  try {
    sqlite.exec('COMMIT');
  } catch {
    try {
      sqlite.exec('ROLLBACK');
    } catch {
      // Nothing left to release: the connection is closed by the worker exit.
    }
  }
}

function rollbackQuietly(sqlite: Database.Database): void {
  try {
    sqlite.exec('ROLLBACK');
  } catch {
    // The transaction was already rolled back by SQLite.
  }
}

async function handle(command: WorkerCommand): Promise<WorkerReplyBody> {
  switch (command.kind) {
    case 'open': {
      // The production open path (SQLCipher-free file, WAL, busy_timeout, the
      // pinned PRAGMA cluster) with migrations and seeds left to the parent,
      // which already ran both.
      await initDatabase({
        dbPath: command.dbPath,
        runMigrations: false,
        seedData: false,
        verbose: false,
      });
      const journalMode = String(
        nativeClient().pragma('journal_mode', { simple: true }) as unknown
      );
      // A worker thread must never inherit the parent's handle: `getDatabase()`
      // here throws if the connection above did not publish.
      return { kind: 'opened', journalMode };
    }
    case 'deposit':
      return depositReply(command.request);
    case 'race-deposit': {
      // Blocks this thread only; the parent publishes the round right before
      // its own write, so both connections attempt the write lock together.
      Atomics.wait(new Int32Array(command.race.barrier), 0, command.race.round - 1, 30_000);
      return depositReply(command.race.request);
    }
    case 'snapshot':
      return {
        kind: 'snapshot',
        snapshot: readTenderSnapshot({
          tenantId: command.tenantId,
          saleId: command.saleId,
          salePaymentId: command.salePaymentId,
        }),
      };
    case 'hold': {
      const sqlite = nativeClient();
      // RESERVED lock, taken before any read: the same lock `BEGIN IMMEDIATE`
      // takes inside `registerManualDeposit`, held for a measured span.
      sqlite.exec('BEGIN IMMEDIATE');
      const lockedAt = Date.now();
      setTimeout(() => {
        releaseHold(sqlite);
        workerPort.postMessage({
          id: null,
          event: 'hold-released',
          releasedAt: Date.now(),
        } satisfies WorkerEventMessage);
      }, command.holdMs);
      return { kind: 'lock-held', lockedAt };
    }
    case 'naive-begin': {
      const sqlite = nativeClient();
      // Deferred on purpose: reads a snapshot WITHOUT taking the write lock.
      sqlite.exec('BEGIN');
      const row = sqlite
        .prepare(
          `SELECT COUNT(*) AS n FROM audit_logs
            WHERE tenant_id = ? AND action = ? AND resource_id = ?`
        )
        .get(command.tenantId, DEPOSIT_AUDIT_ACTION, command.saleId) as { n?: number } | undefined;
      const observedRows = row?.n ?? 0;
      control = { salePaymentId: command.salePaymentId, observedRows };
      return { kind: 'naive-snapshot', observedRows };
    }
    case 'naive-commit': {
      if (control === null) throw new Error('naive-commit without a naive-begin');
      const sqlite = nativeClient();
      const { salePaymentId, observedRows } = control;
      control = null;
      // The verdict this writer would have reached from the stale snapshot.
      const statusWritten = observedRows >= 2 ? 'manual_confirmed' : 'needs_reconciliation';
      try {
        sqlite
          .prepare('UPDATE sale_payments SET confirmation_status = ? WHERE id = ?')
          .run(statusWritten, salePaymentId);
        sqlite.exec('COMMIT');
        return { kind: 'naive-committed', statusWritten };
      } catch (error) {
        rollbackQuietly(sqlite);
        return { kind: 'naive-failed', message: messageOf(error), code: errorCode(error) };
      }
    }
  }
}

// Messages are handled one at a time: the protocol is request/response and the
// control transaction spans two of them.
let queue: Promise<void> = Promise.resolve();

workerPort.on('message', (message: WorkerRequestMessage) => {
  queue = queue
    .then(() => handle(message.command))
    .then(reply => {
      workerPort.postMessage({ id: message.id, reply } satisfies WorkerReplyMessage);
    })
    .catch((error: unknown) => {
      workerPort.postMessage({
        id: message.id,
        reply: { kind: 'failed', message: messageOf(error), code: errorCode(error) },
      } satisfies WorkerReplyMessage);
    });
});
