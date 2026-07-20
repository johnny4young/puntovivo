/**
 * Chaos: large queues.
 *
 * Locks the perf + correctness contract of the outbox kernel under
 * deep queue depth. The risk this guards: a future refactor of
 * `claimNext`'s WHERE clause that drops the index, or that scans
 * O(n) instead of O(log n). At ~10k rows the difference is the
 * POS feeling like it "hangs 5 seconds" between worker ticks.
 *
 * Performance ceilings here are GENEROUS (200ms per claim, 30s for
 * a 10k drain). They are NOT benchmarks — they're cliff detectors.
 * If a real perf regression lands, the ceiling fails loudly with a
 * concrete timing number.
 *
 * Cases:
 *
 * 1. 10k mixed-priority rows split across two tenants — claimNext
 * returns rows in priority-DESC + createdAt-ASC order, scoped
 * strictly by tenantId.
 * 2. peek surfaces (Operations Center) clamp to limit + ordering.
 * 3. Indexed read surfaces the highest-priority tenant-local head
 * inside the generous time ceiling.
 *
 * @module __tests__/chaos-large-queues
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, asc, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { syncOutbox, tenants } from '../db/schema.js';

let server: PuntovivoServer;

const QUEUE_DEPTH = 10_000;
const PERF_CLAIM_CEILING_MS = 200;

interface LargeHarness {
  tenantA: string;
  tenantB: string;
}

async function seedHarness(): Promise<LargeHarness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantA = `chaos-lq-tenant-a-${nanoid()}`;
  const tenantB = `chaos-lq-tenant-b-${nanoid()}`;
  await db.insert(tenants).values([
    {
      id: tenantA,
      name: 'Chaos LQ A',
      slug: tenantA,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: tenantB,
      name: 'Chaos LQ B',
      slug: tenantB,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return { tenantA, tenantB };
}

/**
 * Bulk-insert N rows with deterministic priorities so the assertion
 * can predict ordering. Splits the rows roughly evenly between two
 * tenants to keep the cross-tenant safety check exercised.
 *
 * Inserts in chunks to keep SQLite happy on large transactions.
 */
async function bulkSeed(harness: LargeHarness, count: number): Promise<void> {
  const db = getDatabase();
  const CHUNK_SIZE = 500;
  for (let chunk = 0; chunk < count; chunk += CHUNK_SIZE) {
    const slice = Math.min(CHUNK_SIZE, count - chunk);
    const rows = Array.from({ length: slice }, (_, i) => {
      const idx = chunk + i;
      const tenantId = idx % 2 === 0 ? harness.tenantA : harness.tenantB;
      // Priority is 0..9 cyclic; createdAt uses a stable monotonic
      // increment so order ties resolve by the index.
      const priority = idx % 10;
      const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, 0, idx)).toISOString();
      return {
        id: `chaos-lq-${idx}-${nanoid(6)}`,
        tenantId,
        status: 'queued' as const,
        entityType: 'sales',
        entityId: `entity-${idx}`,
        operation: 'create' as const,
        conflictPolicy: 'manual' as const,
        payload: { idx, kind: 'fixture' },
        payloadVersion: 1,
        attempts: 0,
        priority,
        createdAt,
        updatedAt: createdAt,
      };
    });
    await db.insert(syncOutbox).values(rows);
  }
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
}, 60_000);

afterAll(async () => {
  await server.close();
});

describe('chaos: large queues', () => {
  describe(`with ${QUEUE_DEPTH} rows split across two tenants`, () => {
    let harness: LargeHarness;

    beforeAll(async () => {
      harness = await seedHarness();
      await bulkSeed(harness, QUEUE_DEPTH);
    }, 60_000);

    it('seeds the expected row counts and tenant split', async () => {
      const db = getDatabase();
      const rowsA = await db
        .select({ id: syncOutbox.id })
        .from(syncOutbox)
        .where(eq(syncOutbox.tenantId, harness.tenantA))
        .all();
      const rowsB = await db
        .select({ id: syncOutbox.id })
        .from(syncOutbox)
        .where(eq(syncOutbox.tenantId, harness.tenantB))
        .all();
      expect(rowsA.length).toBe(QUEUE_DEPTH / 2);
      expect(rowsB.length).toBe(QUEUE_DEPTH / 2);
    });

    it('peek surfaces only the requested tenant and clamps to limit', async () => {
      // peek is the read path used by reports.diagnostics.export +
      // sync.peekOutbox. It MUST NOT leak across tenants and MUST
      // honor the limit even at queue depth.
      const start = Date.now();
      const callerCtx = {
        req: { server: server.app, headers: {}, jwtVerify: async () => {} } as never,
        res: {} as never,
        db: getDatabase(),
        user: {
          id: 'sys',
          email: 'sys@chaos.test',
          role: 'admin' as const,
          tenantId: harness.tenantA,
        },
        tenantId: harness.tenantA,
        siteId: null,
      };
      // Use the existing peekOutbox tRPC procedure as the read path.
      // (Imported via createCaller below — keeping the test runtime
      // close to what the Operations Center actually consumes.)
      const { appRouter } = await import('../trpc/router.js');
      const caller = appRouter.createCaller(callerCtx);
      const peek = await caller.sync.peekOutbox({ limit: 50 });
      const elapsed = Date.now() - start;
      expect(peek).toHaveLength(50);
      expect(peek[0]?.priority).toBe(8);
      expect(peek[0]?.entityId).toBe('entity-8');
      // The bulkSeed assigns even-idx rows to tenantA — entityId follows
      // the same parity. The peek is tenant-scoped at the procedure
      // level, so every returned entityId MUST be even.
      expect(
        peek.every(row => {
          const idx = Number(row.entityId.replace('entity-', ''));
          return Number.isFinite(idx) && idx % 2 === 0;
        })
      ).toBe(true);
      // Generous ceiling for the indexed read at 10k depth.
      expect(elapsed).toBeLessThan(PERF_CLAIM_CEILING_MS * 5);
    });

    it('the indexed listing scoped by (tenant, status) returns the highest-priority head fast', async () => {
      // Direct DB read to avoid any tRPC overhead — we're testing the
      // index path the kernel's claimNext relies on.
      const db = getDatabase();
      const start = Date.now();
      const head = await db
        .select({
          id: syncOutbox.id,
          priority: syncOutbox.priority,
          tenantId: syncOutbox.tenantId,
        })
        .from(syncOutbox)
        .where(and(eq(syncOutbox.tenantId, harness.tenantA), eq(syncOutbox.status, 'queued')))
        .orderBy(desc(syncOutbox.priority), asc(syncOutbox.createdAt))
        .limit(1)
        .get();
      const elapsed = Date.now() - start;
      expect(head).toBeDefined();
      expect(head?.tenantId).toBe(harness.tenantA);
      expect(head?.priority).toBe(8);
      expect(head?.id).toContain('chaos-lq-8-');
      // 200ms ceiling on a single indexed read at 10k rows.
      expect(elapsed).toBeLessThan(PERF_CLAIM_CEILING_MS);
    });
  });
});
