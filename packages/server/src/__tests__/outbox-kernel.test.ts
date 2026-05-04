/**
 * ENG-053 — Outbox kernel tests.
 *
 * Exercises the kernel through a synthetic `test_outbox` table whose
 * shape matches what the five concrete outboxes (sync, fiscal,
 * payment, webhook, hardware) will provide. The test table is
 * created in-process via the same SQLite handle the seed bootstraps
 * so we don't pollute the migration history.
 *
 * The synthetic outbox status enum mirrors the ADR-0003 fiscal
 * lifecycle as the reference shape:
 *
 *   queued → submitting → succeeded | dead_letter
 *           ↘ retrying  ↗
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { tenants } from '../db/schema.js';
import {
  BOUNDED_EXPONENTIAL_BACKOFF,
  createOutboxKernel,
  type OutboxKernel,
  type OutboxRetryPolicy,
} from '../lib/outbox/index.js';

const TEST_OUTBOX_STATES = [
  'queued',
  'submitting',
  'succeeded',
  'retrying',
  'dead_letter',
] as const;
type TestOutboxStatus = (typeof TEST_OUTBOX_STATES)[number];

const testOutbox = sqliteTable(
  'test_outbox',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    status: text('status', { enum: TEST_OUTBOX_STATES }).notNull().default('queued'),
    payload: text('payload', { mode: 'json' }),
    payloadVersion: integer('payload_version').notNull().default(1),
    attempts: integer('attempts').notNull().default(0),
    nextRetryAt: text('next_retry_at'),
    lastError: text('last_error', { mode: 'json' }),
    priority: real('priority').notNull().default(0),
    claimToken: text('claim_token'),
    lockedAt: text('locked_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  table => [index('idx_test_outbox_tenant_status').on(table.tenantId, table.status)]
);

const FAST_RETRY_POLICY: OutboxRetryPolicy = {
  maxAttempts: 3,
  nextDelayMs(attempts) {
    if (attempts >= 3) return null;
    return [10, 20, 40][attempts] ?? null;
  },
};

let server: PuntovivoServer;
let tenantId: string;

interface TestPayload {
  saleId: string;
  total: number;
}

let kernel: OutboxKernel<TestOutboxStatus, TestPayload>;

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();

  // Materialize the synthetic outbox table by issuing each DDL
  // statement individually. `db.run(sql.raw(...))` only accepts a
  // single statement at a time, so the schema is split.
  await db.run(
    sql.raw(`CREATE TABLE IF NOT EXISTS test_outbox (
      id TEXT PRIMARY KEY NOT NULL,
      tenant_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      payload TEXT,
      payload_version INTEGER NOT NULL DEFAULT 1,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT,
      last_error TEXT,
      priority REAL NOT NULL DEFAULT 0,
      claim_token TEXT,
      locked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`)
  );
  await db.run(
    sql.raw(
      `CREATE INDEX IF NOT EXISTS idx_test_outbox_tenant_status ON test_outbox (tenant_id, status)`
    )
  );

  // Pick any seeded tenant.
  const t = await db.select().from(tenants).limit(1).get();
  if (!t) throw new Error('Expected a seeded tenant');
  tenantId = t.id;

  kernel = createOutboxKernel<TestOutboxStatus, TestPayload>({
    table: testOutbox,
    kind: 'sync',
    initialStatus: 'queued',
    processingStatus: 'submitting',
    succeededStatus: 'succeeded',
    retryingStatus: 'retrying',
    deadLetterStatus: 'dead_letter',
    terminalStatuses: ['succeeded', 'dead_letter'],
    retryPolicy: FAST_RETRY_POLICY,
  });
});

afterAll(async () => {
  await server.close();
});

describe('createOutboxKernel — happy path', () => {
  it('enqueues a row and exposes it via peek', async () => {
    const db = getDatabase();
    const { id } = await kernel.enqueue(db, {
      tenantId,
      payload: { saleId: 'sale-1', total: 100 },
    });
    const seen = await kernel.peek(db, { tenantId, limit: 50 });
    const row = seen.find(r => r.id === id);
    expect(row).toBeTruthy();
    expect(row?.status).toBe('queued');
    expect(row?.attempts).toBe(0);
    expect(row?.payload).toEqual({ saleId: 'sale-1', total: 100 });
  });

  it('claimNext returns the oldest queued row and tags it', async () => {
    const db = getDatabase();
    await kernel.enqueue(db, { tenantId, payload: { saleId: 'early', total: 1 } });
    const claimed = await kernel.claimNext(db, { tenantId, workerId: 'w-1' });
    expect(claimed).toBeTruthy();
    const peeked = await kernel.peek(db, { tenantId, limit: 50 });
    const fromDb = peeked.find(r => r.id === claimed!.id);
    expect(claimed?.status).toBe('submitting');
    expect(fromDb?.status).toBe('submitting');
    expect(fromDb?.claimToken).toBeTruthy();
  });

  it('complete transitions the row to succeeded', async () => {
    const db = getDatabase();
    const { id } = await kernel.enqueue(db, {
      tenantId,
      payload: { saleId: 'cs', total: 1 },
    });
    await kernel.complete(db, { id });
    const row = await db
      .select()
      .from(testOutbox)
      .where(eq(testOutbox.id, id))
      .get();
    expect(row?.status).toBe('succeeded');
    expect(row?.claimToken).toBeNull();
  });

  it('complete is a no-op on rows already in a terminal state', async () => {
    const db = getDatabase();
    const { id } = await kernel.enqueue(db, {
      tenantId,
      payload: { saleId: 'cs2', total: 1 },
    });
    await kernel.complete(db, { id });
    const before = await db
      .select()
      .from(testOutbox)
      .where(eq(testOutbox.id, id))
      .get();
    await kernel.complete(db, { id });
    const after = await db
      .select()
      .from(testOutbox)
      .where(eq(testOutbox.id, id))
      .get();
    expect(after?.updatedAt).toBe(before?.updatedAt);
  });
});

describe('createOutboxKernel — failure + retry', () => {
  it('fail with recoverable error transitions to retrying with nextRetryAt set', async () => {
    const db = getDatabase();
    const { id } = await kernel.enqueue(db, {
      tenantId,
      payload: { saleId: 'r1', total: 1 },
    });
    const result = await kernel.fail(db, {
      id,
      error: {
        errorCode: 'PROVIDER_5XX',
        providerMessage: 'temporarily unavailable',
        recoverable: true,
      },
    });
    expect(result.status).toBe('retrying');
    expect(result.nextRetryAt).toBeTruthy();
    const row = await db
      .select()
      .from(testOutbox)
      .where(eq(testOutbox.id, id))
      .get();
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toMatchObject({ errorCode: 'PROVIDER_5XX' });
    expect(row?.claimToken).toBeNull();
  });

  it('fail with non-recoverable error transitions straight to dead_letter', async () => {
    const db = getDatabase();
    const { id } = await kernel.enqueue(db, {
      tenantId,
      payload: { saleId: 'r2', total: 1 },
    });
    const result = await kernel.fail(db, {
      id,
      error: {
        errorCode: 'VALIDATION_REJECT',
        providerMessage: 'malformed payload',
        recoverable: false,
      },
    });
    expect(result.status).toBe('dead_letter');
    expect(result.nextRetryAt).toBeNull();
  });

  it('fail dead-letters once attempts reach maxAttempts', async () => {
    const db = getDatabase();
    const { id } = await kernel.enqueue(db, {
      tenantId,
      payload: { saleId: 'r3', total: 1 },
    });
    for (let i = 0; i < 3; i += 1) {
      await kernel.fail(db, {
        id,
        error: {
          errorCode: 'PROVIDER_5XX',
          providerMessage: 'still down',
          recoverable: true,
        },
      });
    }
    const row = await db
      .select()
      .from(testOutbox)
      .where(eq(testOutbox.id, id))
      .get();
    expect(row?.status).toBe('dead_letter');
    expect(row?.attempts).toBe(3);
  });

  it('claimNext skips rows whose nextRetryAt is in the future', async () => {
    const db = getDatabase();
    const { id } = await kernel.enqueue(db, {
      tenantId,
      payload: { saleId: 'r4', total: 1 },
    });
    await kernel.fail(db, {
      id,
      error: {
        errorCode: 'PROVIDER_5XX',
        providerMessage: 'transient',
        recoverable: true,
      },
    });
    const claimed = await kernel.claimNext(db, {
      tenantId,
      workerId: 'w-now',
      nowIso: new Date(Date.now() - 1).toISOString(),
    });
    expect(claimed?.id).not.toBe(id);
  });
});

describe('createOutboxKernel — concurrency', () => {
  it('two parallel claimNext calls produce different rows or one null', async () => {
    const db = getDatabase();
    await kernel.enqueue(db, { tenantId, payload: { saleId: 'c1', total: 1 } });
    const [a, b] = await Promise.all([
      kernel.claimNext(db, { tenantId, workerId: 'wA' }),
      kernel.claimNext(db, { tenantId, workerId: 'wB' }),
    ]);
    if (a && b) {
      expect(a.id).not.toBe(b.id);
    } else {
      expect(a === null || b === null).toBe(true);
    }
  });

  it('does not claim a row that completed between candidate read and update', async () => {
    const db = getDatabase();
    const { id } = await kernel.enqueue(db, {
      tenantId,
      payload: { saleId: 'race-complete', total: 1 },
    });

    let injected = false;
    const wrapBuilder = (builder: unknown): unknown =>
      new Proxy(builder as Record<PropertyKey, unknown>, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver);
          if (property === 'get' && typeof value === 'function') {
            return async (...args: unknown[]) => {
              const row = (await value.apply(target, args)) as { id?: string } | undefined;
              if (!injected && row?.id === id) {
                injected = true;
                await db
                  .update(testOutbox)
                  .set({
                    status: 'succeeded',
                    claimToken: null,
                    lockedAt: null,
                    updatedAt: new Date().toISOString(),
                  })
                  .where(eq(testOutbox.id, id))
                  .run();
              }
              return row;
            };
          }
          if (typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            const result = value.apply(target, args);
            return result && typeof result === 'object' ? wrapBuilder(result) : result;
          };
        },
      });

    const racingDb = new Proxy(db as Record<PropertyKey, unknown>, {
      get(target, property, receiver) {
        if (property === 'select') {
          return (...args: unknown[]) => wrapBuilder((db.select as (...args: unknown[]) => unknown)(...args));
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as typeof db;

    const claimed = await kernel.claimNext(racingDb, { tenantId, workerId: 'w-race' });
    expect(claimed).toBeNull();
    const row = await db
      .select()
      .from(testOutbox)
      .where(eq(testOutbox.id, id))
      .get();
    expect(row?.status).toBe('succeeded');
    expect(row?.claimToken).toBeNull();
  });
});

describe('deadLetter (manual)', () => {
  it('forces a row into the dead-letter terminal state', async () => {
    const db = getDatabase();
    const { id } = await kernel.enqueue(db, {
      tenantId,
      payload: { saleId: 'dl', total: 1 },
    });
    await kernel.deadLetter(db, { id });
    const row = await db
      .select()
      .from(testOutbox)
      .where(eq(testOutbox.id, id))
      .get();
    expect(row?.status).toBe('dead_letter');
  });
});

describe('BOUNDED_EXPONENTIAL_BACKOFF policy', () => {
  it('returns increasing delays through the bounded schedule', () => {
    const delays = [0, 1, 2, 3, 4, 5].map(n =>
      BOUNDED_EXPONENTIAL_BACKOFF.nextDelayMs(n)
    );
    expect(delays).toEqual([
      60_000,
      5 * 60_000,
      15 * 60_000,
      60 * 60_000,
      6 * 60 * 60_000,
      24 * 60 * 60_000,
    ]);
  });

  it('returns null past the budget', () => {
    expect(BOUNDED_EXPONENTIAL_BACKOFF.nextDelayMs(6)).toBeNull();
    expect(BOUNDED_EXPONENTIAL_BACKOFF.nextDelayMs(99)).toBeNull();
  });
});
