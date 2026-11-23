/**
 * Presentation expiry must run on the tick that `start()` actually installs.
 *
 * The facade `housekeepingTick()` also expires presentations, but it is only
 * reachable by whoever calls it explicitly — in this repository that is two
 * tests and nobody else. A test that goes through the facade therefore proves
 * nothing about a running app, which is exactly how the periodic path ended up
 * without the call in the first place.
 */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { paymentOutbox, sites, tenants, users } from '../db/schema.js';
import { createPaymentWorker, type PaymentWorker } from '../services/payments/payment-worker.js';
import {
  PRESENTATION_TTL_MS,
  listOpenPresentations,
  startPresentation,
} from '../services/payments/presentation.js';

let server: PuntovivoServer;
let tenantId: string;
let siteId: string;
let userId: string;

const OTHER_TENANT_ID = 'expiry-tick-other-tenant';
const OTHER_USER_ID = 'expiry-tick-other-user';
const TICK_MS = 5;
const destination = { id: 'dest-expiry-tick', label: 'Nequi principal', kind: 'nequi' };

/** Older than the TTL the sweep enforces, with a margin that cannot drift. */
const STALE_AGE_MS = PRESENTATION_TTL_MS + 60_000;

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const user = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!user) throw new Error('Expected seeded administrator');
  tenantId = user.tenantId;
  userId = user.id;
  const site = await db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();
  if (!site) throw new Error('Expected active site');
  siteId = site.id;
});

afterAll(async () => {
  await server.close();
});

afterEach(async () => {
  const db = getDatabase();
  await db.delete(paymentOutbox).where(eq(paymentOutbox.tenantId, OTHER_TENANT_ID));
  await db.delete(users).where(eq(users.tenantId, OTHER_TENANT_ID));
  await db.delete(tenants).where(eq(tenants.id, OTHER_TENANT_ID));
});

function show(key = nanoid()) {
  return startPresentation(getDatabase(), {
    tenantId,
    siteId,
    userId,
    amount: 45_000,
    destination,
    idempotencyKey: key,
  });
}

/** Backdate a presentation so the sweep must consider it stale. */
function age(id: string, ageMs: number): void {
  getDatabase()
    .update(paymentOutbox)
    .set({ createdAt: new Date(Date.now() - ageMs).toISOString() })
    .where(eq(paymentOutbox.id, id))
    .run();
}

function statusOf(id: string): string | undefined {
  return getDatabase()
    .select({ status: paymentOutbox.status })
    .from(paymentOutbox)
    .where(eq(paymentOutbox.id, id))
    .get()?.status;
}

async function seedOtherTenant(): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  await db.insert(tenants).values({
    id: OTHER_TENANT_ID,
    name: ' other tenant',
    slug: 'expiry-tick-other',
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: OTHER_USER_ID,
    tenantId: OTHER_TENANT_ID,
    email: 'admin@expiry-tick-other.test',
    name: 'Other admin',
    passwordHash: 'x',
    sessionVersion: 1,
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

/** A presentation row for the other tenant, written without going through a site. */
async function otherTenantPresentation(id: string, createdAgeMs: number): Promise<void> {
  const createdAt = new Date(Date.now() - createdAgeMs).toISOString();
  await getDatabase()
    .insert(paymentOutbox)
    .values({
      id,
      tenantId: OTHER_TENANT_ID,
      salePaymentId: null,
      railId: 'static_qr',
      kind: 'presentation',
      status: 'presented',
      amount: 30_000,
      currencyCode: 'COP',
      reference: 'EXPIRY-TICK-OTHER',
      providerTransactionId: null,
      payload: { destination },
      payloadVersion: 1,
      attempts: 0,
      nextRetryAt: null,
      lastError: null,
      priority: 0,
      claimToken: null,
      lockedAt: null,
      idempotencyKey: null,
      createdAt,
      updatedAt: createdAt,
    });
}

/**
 * Start the worker for real and wait until `settled` holds, then stop it.
 *
 * This exercises the interval `start()` installs. It never calls the
 * `housekeepingTick()` facade.
 */
async function runPeriodicTicks(worker: PaymentWorker, settled: () => boolean): Promise<void> {
  worker.start();
  try {
    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      if (settled()) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  } finally {
    await worker.stop();
  }
}

describe('presentation expiry on the periodic tick', () => {
  it('expires a stale presentation through the interval that start() installs', async () => {
    const stale = show();
    age(stale.id, STALE_AGE_MS);
    expect(statusOf(stale.id)).toBe('presented');

    const worker = createPaymentWorker({ db: getDatabase(), outboxTickMs: TICK_MS });
    await runPeriodicTicks(worker, () => statusOf(stale.id) === 'timeout');

    expect(statusOf(stale.id)).toBe('timeout');
  });

  it('drops the expired presentation from the open list the display and register read', async () => {
    const stale = show();
    age(stale.id, STALE_AGE_MS);
    expect(listOpenPresentations(getDatabase(), tenantId, siteId).map(row => row.id)).toContain(
      stale.id
    );

    const worker = createPaymentWorker({ db: getDatabase(), outboxTickMs: TICK_MS });
    await runPeriodicTicks(
      worker,
      () =>
        !listOpenPresentations(getDatabase(), tenantId, siteId).some(row => row.id === stale.id)
    );

    expect(listOpenPresentations(getDatabase(), tenantId, siteId).map(row => row.id)).not.toContain(
      stale.id
    );
  });

  it('leaves a presentation still inside its TTL alive across several ticks', async () => {
    const live = show();
    age(live.id, 1_000);

    const worker = createPaymentWorker({ db: getDatabase(), outboxTickMs: TICK_MS });
    // Several ticks' worth of wall clock, deliberately not waiting on a change.
    await runPeriodicTicks(worker, () => false);

    expect(statusOf(live.id)).toBe('presented');
  });

  it('expires after a restart: the sweep keeps no state in memory', async () => {
    const stale = show();
    age(stale.id, STALE_AGE_MS);

    const first = createPaymentWorker({ db: getDatabase(), outboxTickMs: TICK_MS });
    first.start();
    await first.stop();
    expect(statusOf(stale.id)).toBe('presented');

    const second = createPaymentWorker({ db: getDatabase(), outboxTickMs: TICK_MS });
    await runPeriodicTicks(second, () => statusOf(stale.id) === 'timeout');

    expect(statusOf(stale.id)).toBe('timeout');
  });

  it('sweeps every tenant without crossing rows, and each tenant keeps its own live ones', async () => {
    await seedOtherTenant();
    const otherStale = 'expiry-tick-other-stale';
    const otherLive = 'expiry-tick-other-live';
    await otherTenantPresentation(otherStale, STALE_AGE_MS);
    await otherTenantPresentation(otherLive, 1_000);

    const stale = show();
    age(stale.id, STALE_AGE_MS);
    const live = show();

    const worker = createPaymentWorker({ db: getDatabase(), outboxTickMs: TICK_MS });
    await runPeriodicTicks(
      worker,
      () => statusOf(otherStale) === 'timeout' && statusOf(stale.id) === 'timeout'
    );

    expect(statusOf(otherStale)).toBe('timeout');
    expect(statusOf(stale.id)).toBe('timeout');
    expect(statusOf(otherLive)).toBe('presented');
    expect(statusOf(live.id)).toBe('presented');

    // The sweep must not rewrite ownership while it expires.
    const rows = getDatabase()
      .select({ id: paymentOutbox.id, tenantId: paymentOutbox.tenantId })
      .from(paymentOutbox)
      .where(eq(paymentOutbox.kind, 'presentation'))
      .all();
    expect(rows.find(row => row.id === otherStale)?.tenantId).toBe(OTHER_TENANT_ID);
    expect(rows.find(row => row.id === stale.id)?.tenantId).toBe(tenantId);
  });
});
