/** Real SQLite/worker regressions for stale fiscal responses and atomic local settlement. */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  fiscalDocuments,
  fiscalNumberingResolutions,
  fiscalOutbox,
  outboxMetadata,
  sites,
  tenants,
  users,
  webhookOutbox,
} from '../db/schema.js';
import { createFiscalWorker, type FiscalOutboxPayload } from '../services/fiscal/fiscal-worker.js';
import { ColombiaMockAdapter } from '../services/fiscal/packs/co/mock-adapter.js';
import type { FiscalAdapterIssueResult } from '../services/fiscal/adapter.js';
import { __withExpectedTestLogs } from '../logging/logger.js';

let server: PuntovivoServer;
beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  await server.fiscalWorker.stop();
});
afterAll(async () => {
  await server.close();
});

function fixture() {
  const db = getDatabase();
  const tenantId = nanoid();
  const userId = nanoid();
  const siteId = nanoid();
  const resolutionId = nanoid();
  const docId = nanoid();
  const outboxId = nanoid();
  const user = db.select().from(users).limit(1).get()!;
  const site = db.select().from(sites).limit(1).get()!;
  db.insert(tenants)
    .values({
      id: tenantId,
      name: 'Lease fixture',
      slug: tenantId,
      settings: { modules: { 'events-api': true } },
    })
    .run();
  db.insert(users)
    .values({ ...user, id: userId, tenantId, email: `${userId}@lease.test` })
    .run();
  db.insert(sites)
    .values({ ...site, id: siteId, tenantId })
    .run();
  db.insert(fiscalNumberingResolutions)
    .values({
      id: resolutionId,
      tenantId,
      siteId,
      kind: 'DEE',
      resolutionNumber: 'lease',
      prefix: 'L',
      fromNumber: 1,
      toNumber: 100,
      currentNumber: 1,
      technicalKey: 'fixture',
      validFrom: '2026-01-01',
      validUntil: '2030-01-01',
    })
    .run();
  const adapter = new ColombiaMockAdapter();
  const payload: FiscalOutboxPayload = {
    countryCode: 'CO',
    providerId: adapter.providerId,
    fiscalDocumentId: docId,
    adapterInput: {
      tenantId,
      source: 'sale',
      sourceId: nanoid(),
      kind: 'DEE',
      issueDate: '2026-09-05',
      issueTime: '09:00:00-05:00',
      environment: '2',
      issuerNit: '900123456',
      currencyCode: 'COP',
      localeCode: 'es-CO',
      resolution: {
        id: resolutionId,
        resolutionNumber: 'lease',
        prefix: 'L',
        technicalKey: 'fixture',
        consecutive: 1,
        documentNumber: 'L1',
      },
      buyer: {
        taxId: '222222222222',
        taxIdTypeCode: '13',
        name: 'Consumidor final',
        email: null,
        address: null,
        city: null,
        department: null,
        country: 'CO',
      },
      subtotal: 100,
      ivaAmount: 0,
      incAmount: 0,
      icaAmount: 0,
      discountAmount: 0,
      totalAmount: 100,
      lines: [],
    },
  };
  db.insert(fiscalDocuments)
    .values({
      id: docId,
      tenantId,
      source: 'sale',
      sourceId: payload.adapterInput.sourceId,
      kind: 'DEE',
      resolutionId,
      consecutive: 1,
      documentNumber: 'L1',
      cufe: `pending-${docId}`,
      status: 'pending',
      buyerTaxId: '222222222222',
      buyerTaxIdTypeCode: '13',
      buyerName: 'Consumidor final',
      currencyCode: 'COP',
      localeCode: 'es-CO',
      providerId: adapter.providerId,
      emittedByUserId: userId,
    })
    .run();
  db.insert(fiscalOutbox)
    .values({
      id: outboxId,
      tenantId,
      fiscalDocumentId: docId,
      providerId: adapter.providerId,
      payload: { ...payload },
    })
    .run();
  const accepted = (label: string): FiscalAdapterIssueResult => ({
    status: 'accepted',
    cufe: `${label}-${docId}`,
    providerId: adapter.providerId,
    providerResponse: { label },
    xmlRef: null,
  });
  const snapshot = () => ({
    doc: db.select().from(fiscalDocuments).where(eq(fiscalDocuments.id, docId)).get(),
    row: db.select().from(fiscalOutbox).where(eq(fiscalOutbox.id, outboxId)).get(),
    events: db.select().from(webhookOutbox).where(eq(webhookOutbox.tenantId, tenantId)).all(),
    metadata: db.select().from(outboxMetadata).where(eq(outboxMetadata.tenantId, tenantId)).all(),
  });
  return { db, tenantId, docId, outboxId, adapter, accepted, snapshot };
}

describe('fiscal lease ownership', () => {
  it.each(['accepted', 'recoverable', 'permanent'] as const)(
    'ignores a stale %s result including document, CUFE, event and metadata',
    async late => {
      const f = fixture();
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      vi.spyOn(f.adapter, 'issue').mockImplementation(async () => {
        started.resolve();
        await release.promise;
        if (late === 'recoverable') throw new Error('old network error');
        if (late === 'permanent') throw new TypeError('old invalid input');
        return f.accepted('old');
      });
      const a = createFiscalWorker({ db: f.db, resolveAdapter: () => f.adapter });
      const bAdapter = new ColombiaMockAdapter();
      vi.spyOn(bAdapter, 'issue').mockResolvedValue(f.accepted('winner'));
      const b = createFiscalWorker({ db: f.db, resolveAdapter: () => bAdapter });
      const tick = a.tickOnce(f.tenantId);
      await started.promise;
      try {
        f.db
          .update(fiscalOutbox)
          .set({ status: 'queued', claimToken: null, lockedAt: null })
          .where(eq(fiscalOutbox.id, f.outboxId))
          .run();
        await expect(b.tickOnce(f.tenantId)).resolves.toMatchObject({ outcome: 'completed' });
        const before = f.snapshot();
        expect(before.doc).toMatchObject({ status: 'accepted', cufe: f.accepted('winner').cufe });
        expect(before.events).toHaveLength(1);
        release.resolve();
        await expect(tick).resolves.toMatchObject({ outcome: 'lost_claim' });
        expect(f.snapshot()).toEqual(before);
      } finally {
        release.resolve();
        await tick;
        await a.stop();
        await b.stop();
      }
    }
  );

  it('rolls back the acknowledgment on SQL failure without marking an accepted provider result rejected', async () => {
    const f = fixture();
    const issue = vi.spyOn(f.adapter, 'issue').mockResolvedValue(f.accepted('accepted'));
    const worker = createFiscalWorker({ db: f.db, resolveAdapter: () => f.adapter });
    f.db.run(
      sql.raw(
        "CREATE TEMP TRIGGER reject_fiscal_mirror BEFORE UPDATE ON fiscal_documents BEGIN SELECT RAISE(ABORT, 'fixture disk failure'); END"
      )
    );
    try {
      await expect(worker.tickOnce(f.tenantId)).rejects.toThrow('fixture disk failure');
      const state = f.snapshot();
      expect(state.doc).toMatchObject({
        status: 'pending',
        retries: 0,
        cufe: `pending-${f.docId}`,
      });
      expect(state.row).toMatchObject({
        status: 'submitting',
        attempts: 0,
        lastError: null,
        cufe: null,
        claimToken: expect.any(String),
      });
      expect(state.events).toEqual([]);
      expect(state.metadata).toEqual([]);
      expect(issue).toHaveBeenCalledTimes(1);
    } finally {
      f.db.run(sql.raw('DROP TRIGGER reject_fiscal_mirror'));
      await worker.stop();
    }
  });

  it.each(['metadata', 'event'] as const)(
    'keeps acceptance when optional %s persistence fails without sending twice',
    async auxiliary => {
      const f = fixture();
      const issue = vi.spyOn(f.adapter, 'issue').mockResolvedValue(f.accepted('accepted'));
      const worker = createFiscalWorker({ db: f.db, resolveAdapter: () => f.adapter });
      const table = auxiliary === 'metadata' ? 'outbox_metadata' : 'webhook_outbox';
      f.db.run(
        sql.raw(
          `CREATE TEMP TRIGGER reject_auxiliary BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'fixture auxiliary failure'); END`
        )
      );
      try {
        const execute = () => worker.tickOnce(f.tenantId);
        const result =
          auxiliary === 'event'
            ? await __withExpectedTestLogs(
                [
                  {
                    level: 'warn',
                    module: 'services/fiscal/fiscal-worker',
                    message: 'fiscal accepted webhook enqueue failed (non-blocking)',
                  },
                ],
                execute
              )
            : await execute();
        expect(result).toMatchObject({ outcome: 'completed' });
        expect(f.snapshot().doc).toMatchObject({ status: 'accepted' });
        expect(f.snapshot().row).toMatchObject({ status: 'accepted', claimToken: null });
        await expect(worker.tickOnce(f.tenantId)).resolves.toMatchObject({ processed: false });
        expect(issue).toHaveBeenCalledTimes(1);
      } finally {
        f.db.run(sql.raw('DROP TRIGGER reject_auxiliary'));
        await worker.stop();
      }
    }
  );
});
