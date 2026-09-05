/**
 * Outbox worker tests.
 *
 * Verifies `tickOutbox` against the synthetic outbox kernel from
 * `outbox-kernel.test.ts`. Each test rebuilds a fresh kernel + a
 * processor function so the worker behaviour stays decoupled from
 * the kernel internals.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
import { __withExpectedTestLogs } from '../logging/logger.js';

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

beforeEach(() => {
  getDatabase().delete(workerOutbox).run();
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
    const row = await db.select().from(workerOutbox).where(eq(workerOutbox.id, id)).get();
    expect(row?.status).toBe('succeeded');
  });

  it('returns idle when there are no claimable rows', async () => {
    const db = getDatabase();
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
    const result = await __withExpectedTestLogs(
      [
        {
          level: 'warn',
          module: 'outbox-worker',
          message: 'outbox row failed',
        },
      ],
      () =>
        tickOutbox(db, tenantId, {
          kernel,
          workerId: 'w-throws',
          process: async () => {
            throw new Error('processor blew up');
          },
        })
    );
    expect(result.processed).toBe(true);
    if (result.processed) {
      expect(['retrying', 'dead_letter']).toContain(result.outcome);
    }
    const row = await db.select().from(workerOutbox).where(eq(workerOutbox.id, id)).get();
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toMatchObject({ errorCode: 'OUTBOX_PROCESSOR_THREW' });
  });

  it('respects deadLetterAfter via the kernel retry budget', async () => {
    const db = getDatabase();
    const { id } = await kernel.enqueue(db, {
      tenantId,
      payload: { saleId: 'tick-budget' },
    });
    // Run enough ticks to exhaust the budget (max 3). Each tick
    // sleeps long enough to clear the 5ms backoff.
    await __withExpectedTestLogs(
      [
        {
          level: 'warn',
          module: 'outbox-worker',
          message: 'outbox row failed',
          count: 3,
        },
      ],
      async () => {
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
      }
    );
    const row = await db.select().from(workerOutbox).where(eq(workerOutbox.id, id)).get();
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

describe('worker settlement fencing', () => {
  it.each([true, false])(
    'ignores an old result (ok=%s), including its persistence and metadata callbacks',
    async ok => {
      const db = getDatabase();
      const { id } = await kernel.enqueue(db, { tenantId, payload: { saleId: 'stale' } });
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let writes = 0;
      const a = tickOutbox(db, tenantId, {
        kernel,
        workerId: 'a',
        process: async () => {
          started.resolve();
          await release.promise;
          const persist = () => {
            writes += 1;
          };
          return ok
            ? { ok: true, persist }
            : {
                ok: false,
                persist,
                error: { errorCode: 'OLD', providerMessage: 'old', recoverable: true },
              };
        },
        onSettled: () => {
          writes += 1;
        },
      });
      await started.promise;
      db.update(workerOutbox)
        .set({ status: 'queued', claimToken: null, lockedAt: null })
        .where(eq(workerOutbox.id, id))
        .run();
      await expect(
        tickOutbox(db, tenantId, { kernel, workerId: 'b', process: async () => ({ ok: true }) })
      ).resolves.toMatchObject({ outcome: 'completed' });
      const before = db.select().from(workerOutbox).where(eq(workerOutbox.id, id)).get();
      release.resolve();
      await expect(a).resolves.toEqual({ processed: true, rowId: id, outcome: 'lost_claim' });
      expect(writes).toBe(0);
      expect(db.select().from(workerOutbox).where(eq(workerOutbox.id, id)).get()).toEqual(before);
    }
  );

  it.each(['persist', 'onSettled'] as const)(
    'rolls back acknowledgment and effects when %s fails, without classifying a provider failure',
    async stage => {
      const db = getDatabase();
      const { id } = await kernel.enqueue(db, { tenantId, payload: { saleId: 'atomic' } });
      await expect(
        tickOutbox(db, tenantId, {
          kernel,
          workerId: 'atomic',
          process: async () => ({
            ok: true,
            persist: tx => {
              tx.update(workerOutbox).set({ priority: 42 }).where(eq(workerOutbox.id, id)).run();
              if (stage === 'persist') throw new Error('disk full');
            },
          }),
          onSettled: () => {
            if (stage === 'onSettled') throw new Error('disk full');
          },
        })
      ).rejects.toThrow('disk full');
      expect(db.select().from(workerOutbox).where(eq(workerOutbox.id, id)).get()).toMatchObject({
        status: 'processing',
        priority: 0,
        attempts: 0,
        lastError: null,
        claimToken: expect.any(String),
      });
    }
  );
});
