/** Real SQLite outbox recovery and bounded worker lifecycle; no timers leak into caller-only tests. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { kdsOrders, kdsOrderLines, kdsOutbox, sales, sites, users } from '../db/schema.js';
import { insertKitchenEvent } from '../application/kds/events.js';
import { createKitchenWorker, type KitchenWorker } from '../services/kds/worker.js';

let server: PuntovivoServer;
let folder: string;
let dbPath: string;
let tenantId: string;
let siteId: string;
let actorId: string;
const workers: KitchenWorker[] = [];

beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'puntovivo-kds-worker-'));
  dbPath = join(folder, 'recovery.db');
  server = await createServer({ dbPath, verbose: false });
  const db = getDatabase();
  const admin = db.select().from(users).where(eq(users.email, 'admin@localhost')).get()!;
  actorId = admin.id;
  tenantId = admin.tenantId;
  siteId = db.select().from(sites).where(eq(sites.tenantId, tenantId)).get()!.id;
});
afterEach(async () => {
  for (const worker of workers.splice(0)) await worker.stop();
  await server.close();
  await rm(folder, { recursive: true, force: true });
});

function pendingTicket() {
  const db = getDatabase();
  return db.transaction(
    tx => {
      const saleId = nanoid();
      tx.insert(sales)
        .values({
          id: saleId,
          tenantId,
          saleNumber: saleId,
          createdBy: actorId,
          subtotal: 10,
          total: 10,
        })
        .run();
      const order = tx
        .insert(kdsOrders)
        .values({
          id: nanoid(),
          tenantId,
          siteId,
          saleId,
          saleNumber: saleId,
          snapshotVersion: 2,
          itemsJson: '[]',
        })
        .returning()
        .get();
      const lineId = nanoid();
      tx.insert(kdsOrderLines)
        .values({
          id: lineId,
          tenantId,
          orderId: order.id,
          sourceSaleItemId: nanoid(),
          productId: nanoid(),
          productName: 'Preparation',
          quantity: 1,
          modifiers: [],
          currentSaleId: saleId,
        })
        .run();
      const eventId = insertKitchenEvent(tx as unknown as typeof db, order, {
        kind: 'submitted',
        actorId,
        facts: { lineCount: 1 },
      });
      return { order, eventId, lineId };
    },
    { behavior: 'immediate' }
  );
}
function worker(broadcast = vi.fn()) {
  const result = createKitchenWorker({
    db: getDatabase(),
    broadcaster: { broadcast },
    intervalMs: 60_000,
  });
  workers.push(result);
  return { result, broadcast };
}

it('two worker instances claim the same durable notification exactly once', async () => {
  const { order, eventId } = pendingTicket();
  const broadcast = vi.fn();
  const a = worker(broadcast).result;
  const b = worker(broadcast).result;
  await Promise.all([a.tickOnce(tenantId), b.tickOnce(tenantId)]);
  expect(broadcast).toHaveBeenCalledTimes(1);
  expect(broadcast).toHaveBeenCalledWith(
    'kds.order.updated',
    { eventId, orderId: order.id, siteId },
    tenantId
  );
  expect(
    getDatabase().select().from(kdsOutbox).where(eq(kdsOutbox.eventId, eventId)).get()?.status
  ).toBe('delivered');
  expect(
    getDatabase().select().from(kdsOrderLines).where(eq(kdsOrderLines.orderId, order.id)).all()
  ).toHaveLength(1);
});

it('reclaims a stale crashed claim but never steals a recent claim', async () => {
  const stale = pendingTicket();
  const fresh = pendingTicket();
  const db = getDatabase();
  for (const [eventId, lockedAt] of [
    [stale.eventId, new Date(Date.now() - 10 * 60_000).toISOString()],
    [fresh.eventId, new Date().toISOString()],
  ]) {
    db.update(kdsOutbox)
      .set({ status: 'submitting', claimToken: 'old-worker', lockedAt })
      .where(eq(kdsOutbox.eventId, eventId!))
      .run();
  }
  const { result, broadcast } = worker();
  await result.drainOnce();
  expect(broadcast).toHaveBeenCalledTimes(1);
  expect(
    db.select().from(kdsOutbox).where(eq(kdsOutbox.eventId, stale.eventId)).get()?.status
  ).toBe('delivered');
  expect(
    db.select().from(kdsOutbox).where(eq(kdsOutbox.eventId, fresh.eventId)).get()?.status
  ).toBe('submitting');
});

it('checks persisted event scope before broadcasting a tampered payload', async () => {
  const { eventId } = pendingTicket();
  const db = getDatabase();
  const row = db.select().from(kdsOutbox).where(eq(kdsOutbox.eventId, eventId)).get()!;
  db.update(kdsOutbox)
    .set({ payload: { ...row.payload, siteId: 'foreign-site' } })
    .where(eq(kdsOutbox.id, row.id))
    .run();
  const { result, broadcast } = worker();
  await result.tickOnce(tenantId);
  expect(broadcast).not.toHaveBeenCalled();
  expect(db.select().from(kdsOutbox).where(eq(kdsOutbox.id, row.id)).get()).toMatchObject({
    status: 'dead_letter',
    lastError: { errorCode: 'KDS_SNAPSHOT_INVALID' },
  });
});

it('does not process a different tenant or lose a ticket when broadcasting fails', async () => {
  const { eventId, order } = pendingTicket();
  const broadcast = vi.fn(() => {
    throw new Error('transport secret must not be exposed');
  });
  const { result } = worker(broadcast);
  await expect(result.tickOnce('other-tenant')).resolves.toEqual({ processed: false });
  expect(broadcast).not.toHaveBeenCalled();
  await result.tickOnce(tenantId);
  expect(
    getDatabase().select().from(kdsOutbox).where(eq(kdsOutbox.eventId, eventId)).get()
  ).toMatchObject({
    status: 'retrying',
    attempts: 1,
    lastError: { providerMessage: 'KDS_NOTIFICATION_UNAVAILABLE', recoverable: true },
  });
  expect(
    getDatabase().select().from(kdsOrders).where(eq(kdsOrders.id, order.id)).get()?.status
  ).toBe('pending');
});

it('starts with an immediate drain and stop closes admission, including repeated stop', async () => {
  pendingTicket();
  const { result, broadcast } = worker();
  result.start();
  await result.drainOnce();
  expect(broadcast).toHaveBeenCalledTimes(1);
  await Promise.all([result.stop(), result.stop()]);
  pendingTicket();
  await expect(result.tickOnce(tenantId)).resolves.toEqual({ processed: false });
  expect(broadcast).toHaveBeenCalledTimes(1);
  result.start();
  await result.drainOnce();
  expect(broadcast).toHaveBeenCalledTimes(2);
});

it('stop drains admitted claims without broadcasting after cancellation', async () => {
  const { eventId } = pendingTicket();
  const { result, broadcast } = worker();
  const running = result.tickOnce(tenantId);
  const stopped = result.stop();
  await stopped;
  await running;
  expect(broadcast).not.toHaveBeenCalled();
  expect(
    getDatabase().select().from(kdsOutbox).where(eq(kdsOutbox.eventId, eventId)).get()?.status
  ).toBe('queued');
});

it('recovers the exact ticket after process death between claim and notification', async () => {
  const { order, eventId, lineId } = pendingTicket();
  // Close the parent owner; the child then persists a claim and dies without
  // closing/checkpointing SQLite or running worker cleanup.
  await server.close();
  const schemaUrl = pathToFileURL(join(process.cwd(), 'src/db/schema.ts')).href;
  const dbUrl = pathToFileURL(join(process.cwd(), 'src/db/index.ts')).href;
  const kernelUrl = pathToFileURL(join(process.cwd(), 'src/services/kds/worker.ts')).href;
  const script = `
    import { initDatabase, getDatabase } from ${JSON.stringify(dbUrl)};
    import { kdsOutbox } from ${JSON.stringify(schemaUrl)};
    import { createKitchenOutboxKernel } from ${JSON.stringify(kernelUrl)};
    import { eq, sql } from 'drizzle-orm';
    await initDatabase({ dbPath: ${JSON.stringify(dbPath)} });
    const db = getDatabase();
    const claim = await createKitchenOutboxKernel().claimNext(db, { tenantId: ${JSON.stringify(tenantId)}, workerId: 'crashing-kitchen', nowIso: '2020-01-01T00:00:00.000Z' });
    if (!claim) process.exit(4);
    process.kill(process.pid, 'SIGKILL');
  `;
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', script],
    { cwd: process.cwd(), timeout: 20_000, encoding: 'utf8' }
  );
  expect(child.error, child.stderr).toBeUndefined();
  expect(child.signal, child.stderr).toBe('SIGKILL');
  server = await createServer({ dbPath, verbose: false });
  const db = getDatabase();
  expect(db.select().from(kdsOrders).where(eq(kdsOrders.id, order.id)).get()?.itemsJson).toBe(
    order.itemsJson
  );
  expect(db.select().from(kdsOrderLines).where(eq(kdsOrderLines.id, lineId)).get()?.status).toBe(
    'pending'
  );
  const { result, broadcast } = worker();
  await result.drainOnce();
  expect(broadcast).toHaveBeenCalledTimes(1);
  expect(db.select().from(kdsOutbox).where(eq(kdsOutbox.eventId, eventId)).get()?.status).toBe(
    'delivered'
  );
  expect(db.select().from(kdsOrders).where(eq(kdsOrders.id, order.id)).all()).toHaveLength(1);
});

it.each(['payload', 'last_error'])(
  'quarantines malformed raw %s JSON before Drizzle decoding can poison the queue',
  async column => {
    const first = pendingTicket();
    const next = pendingTicket();
    const db = getDatabase();
    db.run(
      sql`UPDATE kds_outbox SET ${sql.raw(column)} = ${'{'} WHERE event_id = ${first.eventId}`
    );
    const { result, broadcast } = worker();
    await result.drainOnce();
    expect(broadcast).toHaveBeenCalledTimes(1);
    expect(broadcast).toHaveBeenCalledWith(
      'kds.order.updated',
      { eventId: next.eventId, orderId: next.order.id, siteId },
      tenantId
    );
    expect(
      db
        .select({ status: kdsOutbox.status })
        .from(kdsOutbox)
        .where(eq(kdsOutbox.eventId, first.eventId))
        .get()?.status
    ).toBe('dead_letter');
  }
);
