/**
 * ENG-053 — Outbox worker tests.
 *
 * Verifies `tickOutbox` against the synthetic outbox kernel from
 * `outbox-kernel.test.ts`. Each test rebuilds a fresh kernel + a
 * processor function so the worker behaviour stays decoupled from
 * the kernel internals.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { tenants } from '../db/schema.js';
import {
  createOutboxKernel,
  tickOutbox,
  type OutboxKernel,
  type OutboxRetryPolicy,
} from '../lib/outbox/index.js';

const STATES = ['queued', 'processing', 'succeeded', 'retrying', 'dead_letter'] as const;
type WS = (typeof STATES)[number];

const workerOutbox = sqliteTable(
  'worker_outbox',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    status: text('status', { enum: STATES }).notNull().default('queued'),
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
  table => [index('idx_worker_outbox_tenant_status').on(table.tenantId, table.status)]
);

const FAST_POLICY: OutboxRetryPolicy = {
  maxAttempts: 3,
  nextDelayMs(attempts) {
    return attempts >= 3 ? null : 5;
  },
};

interface TestPayload {
  saleId: string;
}

let server: PuntovivoServer;
let tenantId: string;
let kernel: OutboxKernel<WS, TestPayload>;

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  await db.run(
    sql.raw(`CREATE TABLE IF NOT EXISTS worker_outbox (
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
      `CREATE INDEX IF NOT EXISTS idx_worker_outbox_tenant_status ON worker_outbox (tenant_id, status)`
    )
  );

  const t = await db.select().from(tenants).limit(1).get();
  if (!t) throw new Error('Expected a seeded tenant');
  tenantId = t.id;

  kernel = createOutboxKernel<WS, TestPayload>({
    table: workerOutbox,
    kind: 'sync',
    initialStatus: 'queued',
    processingStatus: 'processing',
    succeededStatus: 'succeeded',
    retryingStatus: 'retrying',
    deadLetterStatus: 'dead_letter',
    terminalStatuses: ['succeeded', 'dead_letter'],
    retryPolicy: FAST_POLICY,
  });
});

afterAll(async () => {
  await server.close();
});

describe('tickOutbox', () => {
  it('processes the next queued row and marks it succeeded', async () => {
    const db = getDatabase();
    const { id } = await kernel.enqueue(db, {
      tenantId,
      payload: { saleId: 'tick-success' },
    });
    const result = await tickOutbox(db, tenantId, {
      kernel,
      workerId: 'w-success',
      process: async () => ({ ok: true }),
    });
    expect(result.processed).toBe(true);
    if (result.processed) {
      expect(result.outcome).toBe('completed');
    }
    const row = await db
      .select()
      .from(workerOutbox)
      .where(eq(workerOutbox.id, id))
      .get();
    expect(row?.status).toBe('succeeded');
  });

  it('returns idle when there are no claimable rows', async () => {
    const db = getDatabase();
    // Drain any leftover rows by completing them.
    const peeked = await kernel.peek(db, { tenantId, limit: 100 });
    for (const r of peeked) {
      if (r.status === 'queued') await kernel.complete(db, { id: r.id });
    }
    const result = await tickOutbox(db, tenantId, {
      kernel,
      workerId: 'w-idle',
      process: async () => ({ ok: true }),
    });
    expect(result.processed).toBe(false);
    if (!result.processed) {
      expect(result.reason).toBe('idle');
    }
  });

  it('treats a thrown processor as a recoverable failure', async () => {
    const db = getDatabase();
    const { id } = await kernel.enqueue(db, {
      tenantId,
      payload: { saleId: 'tick-throws' },
    });
    const result = await tickOutbox(db, tenantId, {
      kernel,
      workerId: 'w-throws',
      process: async () => {
        throw new Error('processor blew up');
      },
    });
    expect(result.processed).toBe(true);
    if (result.processed) {
      expect(['retrying', 'dead_letter']).toContain(result.outcome);
    }
    const row = await db
      .select()
      .from(workerOutbox)
      .where(eq(workerOutbox.id, id))
      .get();
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toMatchObject({ errorCode: 'OUTBOX_PROCESSOR_THREW' });
  });

  it('respects deadLetterAfter via the kernel retry budget', async () => {
    const db = getDatabase();
    // Drain leftover rows from earlier tests so the worker
    // exclusively processes the budget row across all 3 ticks.
    const leftover = await kernel.peek(db, { tenantId, limit: 100 });
    for (const r of leftover) {
      if (r.status !== 'succeeded' && r.status !== 'dead_letter') {
        await kernel.deadLetter(db, { id: r.id });
      }
    }
    const { id } = await kernel.enqueue(db, {
      tenantId,
      payload: { saleId: 'tick-budget' },
    });
    // Run enough ticks to exhaust the budget (max 3). Each tick
    // sleeps long enough to clear the 5ms backoff.
    for (let i = 0; i < 3; i += 1) {
      await tickOutbox(db, tenantId, {
        kernel,
        workerId: 'w-budget',
        process: async () => ({
          ok: false,
          error: {
            errorCode: 'PROVIDER_5XX',
            providerMessage: 'down',
            recoverable: true,
          },
        }),
      });
      await new Promise(r => setTimeout(r, 12));
    }
    const row = await db
      .select()
      .from(workerOutbox)
      .where(eq(workerOutbox.id, id))
      .get();
    expect(row?.status).toBe('dead_letter');
  });

  it('logs through the configured loggerLabel', async () => {
    const db = getDatabase();
    await kernel.enqueue(db, {
      tenantId,
      payload: { saleId: 'tick-logger' },
    });
    const result = await tickOutbox(db, tenantId, {
      kernel,
      workerId: 'w-logger',
      loggerLabel: 'custom-outbox',
      process: async () => ({ ok: true }),
    });
    // No assertion on the log output itself (pino noise) — what we
    // verify is that the call succeeds with the custom label set.
    expect(result.processed).toBe(true);
  });
});
