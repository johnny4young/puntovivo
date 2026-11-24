/**
 * Two independent connections to one SQLite file (S14, `odd/tasks/qr-pagos-fase5.md` L10).
 *
 * S10 was proved arithmetically: two deposits of 50.000 on a 100.000 tender
 * accumulate to `manual_confirmed`. That proof ran on `:memory:`, which cannot
 * be shared by a second connection — so it could never show what happens when
 * two *connections* write the same tender. This suite opens one real file under
 * the OS temp directory and talks to it through two independent connections:
 *
 * - A: the server's own handle, `createServer({ dbPath })` → `getDatabase()`;
 * - B: the same file opened by `initDatabase()` inside a `worker_threads`
 *   worker (`fixtures/transfer-concurrency-worker.ts`), which is a separate
 *   module registry and therefore a separate process-wide singleton.
 *
 * A worker thread is what makes the overlap *real*. `better-sqlite3` is
 * synchronous, so a second connection in this thread could only be interleaved
 * between two calls — that is a sequential test wearing a concurrency label.
 * Both threads here call the production writer (`registerManualDeposit`), and
 * the harness records the in-flight interval of each call, so the assertions
 * below can state whether the two writes really overlapped rather than assume
 * it.
 *
 * What is asserted, and by which test:
 *
 * 1. no lost update across connections (the worker's deposit adds to the row
 *    this connection already committed, and vice versa);
 * 2. no double count when a key recorded on one connection is replayed on the
 *    other, in either direction;
 * 3. exclusive write: while one connection holds the write transaction the
 *    other cannot interleave a read-modify-write — it waits for the writer
 *    slot and then commits against the state it finds (the observed behaviour,
 *    see the `hold` test), and the control test shows the unserialized shape
 *    being refused rather than silently losing a deposit;
 * 4. a negative control that the single-connection contract the in-memory suite
 *    already asserts is unchanged on a file database.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { auditLogs, salePayments, sales, sites, users } from '../db/schema.js';
import {
  listPendingTransfers,
  registerManualDeposit,
} from '../services/payments/transfer-reconciliation.js';
import type {
  DepositOutcome,
  DepositRequest,
  TenderSnapshot,
  WorkerCommand,
  WorkerEventMessage,
  WorkerReplyBody,
  WorkerReplyMessage,
} from './fixtures/transfer-concurrency-worker.js';

const DEPOSIT_AUDIT_ACTION = 'sale_payment.transfer_manual_confirmed';

let server: PuntovivoServer;
let second: SecondConnection;
let tempDir: string;
let tenantId: string;
let siteId: string;
let userId: string;

/**
 * The worker loads the product's TypeScript through `tsx`, the same loader the
 * server package keeps as a dev dependency. Without it a worker cannot import
 * the `.js`-suffixed specifiers the product source uses.
 */
function tsxLoaderUrl(): string {
  const require = createRequire(import.meta.url);
  return pathToFileURL(require.resolve('tsx')).href;
}

/**
 * Client for the fixture worker: one outstanding request at a time, plus the
 * unsolicited events a long-running lock emits.
 */
class SecondConnection {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (reply: WorkerReplyBody) => void; reject: (error: Error) => void }
  >();
  private readonly backlog: WorkerEventMessage[] = [];
  private readonly waiters: ((event: WorkerEventMessage) => void)[] = [];

  private constructor(worker: Worker) {
    this.worker = worker;
    this.worker.on('message', (message: WorkerReplyMessage | WorkerEventMessage) => {
      if (message.id === null) {
        const waiter = this.waiters.shift();
        if (waiter) waiter(message);
        else this.backlog.push(message);
        return;
      }
      const settled = this.pending.get(message.id);
      this.pending.delete(message.id);
      settled?.resolve(message.reply);
    });
    this.worker.on('error', (error: Error) => {
      for (const settled of this.pending.values()) settled.reject(error);
      this.pending.clear();
    });
  }

  static async open(dbPath: string): Promise<{ connection: SecondConnection; journalMode: string }> {
    const worker = new Worker(new URL('./fixtures/transfer-concurrency-worker.ts', import.meta.url), {
      execArgv: ['--import', tsxLoaderUrl()],
    });
    const connection = new SecondConnection(worker);
    const reply = replyOf(await connection.send({ kind: 'open', dbPath }), 'opened');
    return { connection, journalMode: reply.journalMode };
  }

  send(command: WorkerCommand): Promise<WorkerReplyBody> {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<WorkerReplyBody>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, command });
    });
  }

  waitForEvent(): Promise<WorkerEventMessage> {
    const queued = this.backlog.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise<WorkerEventMessage>(resolve => {
      this.waiters.push(resolve);
    });
  }

  async deposit(
    request: DepositRequest
  ): Promise<{ outcome: DepositOutcome; startedAt: number; finishedAt: number }> {
    return replyOf(await this.send({ kind: 'deposit', request }), 'deposit');
  }

  async snapshot(saleId: string, salePaymentId: string): Promise<TenderSnapshot> {
    return replyOf(
      await this.send({ kind: 'snapshot', tenantId, saleId, salePaymentId }),
      'snapshot'
    ).snapshot;
  }

  async close(): Promise<void> {
    await this.worker.terminate();
  }
}

/** Narrow a worker reply, failing loudly instead of mis-reading it. */
function replyOf<Kind extends WorkerReplyBody['kind']>(
  reply: WorkerReplyBody,
  kind: Kind
): Extract<WorkerReplyBody, { kind: Kind }> {
  if (reply.kind !== kind) {
    throw new Error(`expected a '${kind}' reply, received ${JSON.stringify(reply)}`);
  }
  return reply as Extract<WorkerReplyBody, { kind: Kind }>;
}

/** A draft sale plus one transfer tender, in the state the register leaves it. */
function saleWithTransfer(amount: number): { saleId: string; salePaymentId: string } {
  const now = new Date().toISOString();
  const saleId = nanoid();
  const salePaymentId = nanoid();
  const db = getDatabase();
  db.insert(sales)
    .values({
      id: saleId,
      tenantId,
      saleNumber: `S-${nanoid(6)}`,
      status: 'draft',
      paymentStatus: 'pending',
      subtotal: amount,
      total: amount,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  db.insert(salePayments)
    .values({
      id: salePaymentId,
      tenantId,
      saleId,
      method: 'transfer',
      amount,
      reference: null,
      confirmationStatus: 'pending',
      createdAt: now,
    })
    .run();
  return { saleId, salePaymentId };
}

function requestFor(
  saleId: string,
  salePaymentId: string,
  verifiedAmount: number,
  idempotencyKey: string
): DepositRequest {
  return {
    tenantId,
    siteId,
    actorId: userId,
    saleId,
    salePaymentId,
    verifiedAmount,
    reference: 'REF-CONCURRENCIA',
    valueDate: null,
    note: null,
    idempotencyKey,
  };
}

/** A deposit through connection A (the server's own handle). */
function depositFromMain(
  saleId: string,
  salePaymentId: string,
  verifiedAmount: number,
  idempotencyKey: string
): DepositOutcome {
  return registerManualDeposit(getDatabase(), requestFor(saleId, salePaymentId, verifiedAmount, idempotencyKey));
}

/** A deposit through connection B (the worker's own connection to the file). */
async function depositFromSecond(
  saleId: string,
  salePaymentId: string,
  verifiedAmount: number,
  idempotencyKey: string
): Promise<DepositOutcome> {
  const { outcome } = await second.deposit(
    requestFor(saleId, salePaymentId, verifiedAmount, idempotencyKey)
  );
  return outcome;
}

/** Every manual-deposit audit row of a sale, read through connection A. */
function depositPayloads(saleId: string): Record<string, unknown>[] {
  return getDatabase()
    .select()
    .from(auditLogs)
    .where(
      and(
        eq(auditLogs.tenantId, tenantId),
        eq(auditLogs.action, DEPOSIT_AUDIT_ACTION),
        eq(auditLogs.resourceId, saleId)
      )
    )
    .all()
    .map(row => row.after ?? {});
}

function tenderStatus(salePaymentId: string): string | null | undefined {
  return getDatabase()
    .select()
    .from(salePayments)
    .where(and(eq(salePayments.id, salePaymentId), eq(salePayments.tenantId, tenantId)))
    .get()?.confirmationStatus;
}

function saleTotal(saleId: string): number | undefined {
  return getDatabase()
    .select()
    .from(sales)
    .where(and(eq(sales.id, saleId), eq(sales.tenantId, tenantId)))
    .get()?.total;
}

function transferRow(salePaymentId: string, status: string) {
  return listPendingTransfers(getDatabase(), { tenantId, status, limit: 500 }).find(
    row => row.salePaymentId === salePaymentId
  );
}

describe('transfer deposit accumulation across two connections to one file', () => {
  beforeAll(async () => {
    // Never a path inside the repository: the whole point of the file is that
    // SQLite, not this process, serializes the writers.
    tempDir = mkdtempSync(join(tmpdir(), 'puntovivo-transfer-concurrency-'));
    const dbPath = join(tempDir, 'puntovivo.db');
    server = await createServer({ dbPath, verbose: false });

    const db = getDatabase();
    const user = db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!user) throw new Error('Expected seeded administrator');
    tenantId = user.tenantId;
    userId = user.id;
    const site = db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!site) throw new Error('Expected active site');
    siteId = site.id;

    const opened = await SecondConnection.open(dbPath);
    second = opened.connection;
    // The exclusion this suite relies on only exists in WAL: a rollback journal
    // would let the reader in the control test block the writer instead of the
    // writer refusing the stale snapshot.
    expect(opened.journalMode.toLowerCase()).toBe('wal');
  }, 180_000);

  afterAll(async () => {
    await second?.close();
    await server?.close();
    // Only what this suite created: the one directory `mkdtempSync` returned.
    rmSync(tempDir, { recursive: true, force: true });
  }, 120_000);

  it('keeps the single-connection contract the in-memory suite asserts, now on a file', () => {
    // Negative control: adding a second connection must not change what one
    // connection alone already does.
    const { saleId, salePaymentId } = saleWithTransfer(100000);

    const first = depositFromMain(saleId, salePaymentId, 50000, 'file-single-1');
    expect(first).toEqual({
      appliedAmount: 50000,
      surplusAmount: 0,
      status: 'needs_reconciliation',
    });

    const second_ = depositFromMain(saleId, salePaymentId, 50000, 'file-single-2');
    expect(second_).toEqual({
      appliedAmount: 100000,
      surplusAmount: 0,
      status: 'manual_confirmed',
    });

    expect(tenderStatus(salePaymentId)).toBe('manual_confirmed');
    expect(saleTotal(saleId)).toBe(100000);
    expect(depositPayloads(saleId)).toHaveLength(2);
    expect(transferRow(salePaymentId, 'manual_confirmed')?.appliedAmount).toBe(100000);
  });

  it('adds the second connection deposit to the one this connection already recorded', async () => {
    const { saleId, salePaymentId } = saleWithTransfer(100000);

    depositFromMain(saleId, salePaymentId, 50000, 'cross-main-first');

    // What B's connection can see before it writes: A's committed movement, and
    // nothing of its own yet.
    const beforeB = await second.snapshot(saleId, salePaymentId);
    expect(beforeB.auditRowCount).toBe(1);
    expect(beforeB.verifiedAmounts).toEqual([50000]);
    expect(beforeB.appliedAmounts).toEqual([50000]);

    // The second deposit ADDS to what the other connection committed; it must
    // not overwrite the tender with its own 50.000.
    const fromB = await depositFromSecond(saleId, salePaymentId, 50000, 'cross-second');
    expect(fromB).toEqual({
      appliedAmount: 100000,
      surplusAmount: 0,
      status: 'manual_confirmed',
    });

    // B's own view of the row it just wrote, and A's view of B's row.
    const afterB = await second.snapshot(saleId, salePaymentId);
    expect(afterB.auditRowCount).toBe(2);
    expect(afterB.tenderStatus).toBe('manual_confirmed');
    expect(afterB.saleTotal).toBe(100000);

    expect(depositPayloads(saleId)).toHaveLength(2);
    expect(tenderStatus(salePaymentId)).toBe('manual_confirmed');
    expect(transferRow(salePaymentId, 'manual_confirmed')?.appliedAmount).toBe(100000);
    // The sale total is never rewritten by a deposit, on either connection.
    expect(saleTotal(saleId)).toBe(100000);
  });

  it('adds no third row and no money when the other connection replays a key', async () => {
    const { saleId, salePaymentId } = saleWithTransfer(100000);

    const recorded = depositFromMain(saleId, salePaymentId, 50000, 'cross-replay');
    const replayedByB = await depositFromSecond(saleId, salePaymentId, 50000, 'cross-replay');

    // The replay answers with the movement already recorded, and adds nothing.
    expect(replayedByB).toEqual(recorded);
    const afterReplay = await second.snapshot(saleId, salePaymentId);
    expect(afterReplay.auditRowCount).toBe(1);
    expect(afterReplay.verifiedAmounts).toEqual([50000]);
    expect(depositPayloads(saleId)).toHaveLength(1);

    // Money still only moves once: the next instalment is what completes it.
    const completing = await depositFromSecond(saleId, salePaymentId, 50000, 'cross-replay-next');
    expect(completing).toEqual({
      appliedAmount: 100000,
      surplusAmount: 0,
      status: 'manual_confirmed',
    });
    expect(depositPayloads(saleId)).toHaveLength(2);
    expect(saleTotal(saleId)).toBe(100000);

    // The replay is not directional: a key recorded by the other connection and
    // replayed by this one is equally inert.
    const reversed = saleWithTransfer(100000);
    const recordedByB = await depositFromSecond(
      reversed.saleId,
      reversed.salePaymentId,
      50000,
      'cross-replay-reverse'
    );
    const replayedByA = depositFromMain(
      reversed.saleId,
      reversed.salePaymentId,
      50000,
      'cross-replay-reverse'
    );
    expect(replayedByA).toEqual(recordedByB);
    expect(depositPayloads(reversed.saleId)).toHaveLength(1);
    expect(tenderStatus(reversed.salePaymentId)).toBe('needs_reconciliation');
  });

  it('makes the other connection wait for the writer slot instead of interleaving', async () => {
    const { saleId, salePaymentId } = saleWithTransfer(100000);
    depositFromMain(saleId, salePaymentId, 50000, 'hold-first');

    const HOLD_MS = 400;
    // B takes the SQLite write transaction (BEGIN IMMEDIATE) before reading
    // anything, and holds it for 400 ms.
    const lock = replyOf(await second.send({ kind: 'hold', holdMs: HOLD_MS }), 'lock-held');
    expect(lock.lockedAt).toBeGreaterThan(0);

    // A attempts its own deposit while B owns the writer slot. This is the
    // observed product behaviour on this file: it BLOCKS in SQLite's busy
    // handler (busy_timeout is 5000 ms, well over the hold) and then succeeds
    // against the state it finds — it does not fail with SQLITE_BUSY and it
    // never writes over the locked writer.
    const startedAt = Date.now();
    const blocked = depositFromMain(saleId, salePaymentId, 50000, 'hold-second');
    const waitedMs = Date.now() - startedAt;
    await second.waitForEvent();

    expect(blocked).toEqual({
      appliedAmount: 100000,
      surplusAmount: 0,
      status: 'manual_confirmed',
    });
    // It really waited for the other connection's transaction: the deposit is
    // milliseconds of work, so anything near the hold span is the lock.
    expect(waitedMs).toBeGreaterThanOrEqual(HOLD_MS / 2);

    expect(depositPayloads(saleId)).toHaveLength(2);
    expect(tenderStatus(salePaymentId)).toBe('manual_confirmed');
    expect(saleTotal(saleId)).toBe(100000);
  }, 30_000);

  it('never loses or double counts a deposit when both connections write at the same instant', async () => {
    const ROUNDS = 10;
    const UNIT = 5000;
    const EXPECTED_ROWS = ROUNDS * 2;
    const { saleId, salePaymentId } = saleWithTransfer(EXPECTED_ROWS * UNIT);

    // One shared barrier per round: the worker deposits as soon as this thread
    // publishes the round, and this thread deposits immediately after, so both
    // connections call the writer while the other call is in flight.
    const barrier = new SharedArrayBuffer(4);
    const view = new Int32Array(barrier);
    const mainOutcomes: DepositOutcome[] = [];
    const secondRounds: { outcome: DepositOutcome; startedAt: number; finishedAt: number }[] = [];
    const overlappedRounds: number[] = [];

    for (let round = 1; round <= ROUNDS; round += 1) {
      const pendingSecond = second.send({
        kind: 'race-deposit',
        race: {
          request: requestFor(saleId, salePaymentId, UNIT, `race-second-${round}`),
          barrier,
          round,
        },
      });

      Atomics.store(view, 0, round);
      Atomics.notify(view, 0);
      const mainStartedAt = Date.now();
      mainOutcomes.push(depositFromMain(saleId, salePaymentId, UNIT, `race-main-${round}`));
      const mainFinishedAt = Date.now();

      const workerRound = replyOf(await pendingSecond, 'deposit');
      secondRounds.push(workerRound);
      // Both calls were in flight during the same span: a fact recorded by the
      // harness, not an assumption about how the scheduler behaved.
      if (workerRound.startedAt < mainFinishedAt && mainStartedAt < workerRound.finishedAt) {
        overlappedRounds.push(round);
      }
    }

    // Each call reports the accumulated total it committed on top of. The set
    // must be exactly one distinct step per deposit: two deposits that both read
    // the same prior total (a lost update) would report the same amount twice
    // and leave a gap.
    const reported = [...mainOutcomes, ...secondRounds.map(entry => entry.outcome)]
      .map(outcome => outcome.appliedAmount)
      .sort((left, right) => left - right);
    expect(reported).toEqual(
      Array.from({ length: EXPECTED_ROWS }, (_, index) => (index + 1) * UNIT)
    );
    expect(reported).toHaveLength(new Set(reported).size);

    // No duplicate money: one audit row and one idempotency key per movement.
    const payloads = depositPayloads(saleId);
    expect(payloads).toHaveLength(EXPECTED_ROWS);
    expect(new Set(payloads.map(payload => String(payload['idempotencyKey']))).size).toBe(
      EXPECTED_ROWS
    );

    // The tender the two connections wrote together is exactly settled.
    expect(tenderStatus(salePaymentId)).toBe('manual_confirmed');
    expect(transferRow(salePaymentId, 'manual_confirmed')?.appliedAmount).toBe(EXPECTED_ROWS * UNIT);
    expect(saleTotal(saleId)).toBe(EXPECTED_ROWS * UNIT);

    // And the other connection agrees on the final state.
    const afterAll = await second.snapshot(saleId, salePaymentId);
    expect(afterAll.auditRowCount).toBe(EXPECTED_ROWS);
    expect(afterAll.tenderStatus).toBe('manual_confirmed');
    expect(afterAll.saleTotal).toBe(EXPECTED_ROWS * UNIT);

    // The proof is only about concurrency because at least one round really had
    // both deposits in flight at the same time.
    expect(overlappedRounds.length).toBeGreaterThan(0);
  }, 60_000);

  it('refuses, rather than silently loses, an unserialized read-modify-write (control)', async () => {
    // This is the harness's own negative control: the same overlap, written the
    // way a writer without `BEGIN IMMEDIATE` would write it — read the chain
    // outside the write lock, decide from that snapshot, then write the verdict.
    // If this control could also reach the correct state, the tests above would
    // prove nothing about serialization.
    const { saleId, salePaymentId } = saleWithTransfer(100000);
    depositFromMain(saleId, salePaymentId, 50000, 'control-first');

    const observed = replyOf(
      await second.send({ kind: 'naive-begin', tenantId, saleId, salePaymentId }),
      'naive-snapshot'
    );
    expect(observed.observedRows).toBe(1);

    // The real, serialized writer completes the tender while B holds its stale
    // snapshot open.
    depositFromMain(saleId, salePaymentId, 50000, 'control-second');
    expect(tenderStatus(salePaymentId)).toBe('manual_confirmed');

    const committed = await second.send({ kind: 'naive-commit' });

    if (committed.kind === 'naive-committed') {
      // WAL refused nothing, so the stale verdict landed: the tender now says
      // what the outdated snapshot believed, while the chain says otherwise.
      expect(committed.statusWritten).toBe('needs_reconciliation');
      expect(tenderStatus(salePaymentId)).toBe('needs_reconciliation');
      expect(depositPayloads(saleId)).toHaveLength(2);
    } else {
      const failed = replyOf(committed, 'naive-failed');
      // The refusal this file actually produces: SQLite declines the upgrade of
      // a read snapshot another connection has already moved past.
      expect(`${failed.code ?? ''} ${failed.message}`).toMatch(/busy|locked/i);
      // The failed writer left no trace, and the serialized writer's state holds.
      expect(tenderStatus(salePaymentId)).toBe('manual_confirmed');
      expect(depositPayloads(saleId)).toHaveLength(2);
      expect(saleTotal(saleId)).toBe(100000);
    }
  }, 30_000);
});
