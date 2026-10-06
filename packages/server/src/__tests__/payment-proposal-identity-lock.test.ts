import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import * as schema from '../db/schema.js';
import { savePaymentProposal } from '../services/payments/reconciliation/proposals.js';

let directory: string;
let competing: Database.Database;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'puntovivo-proposal-identity-lock-'));
  const path = join(directory, 'identity.db');
  await initDatabase({ dbPath: path, seedData: false });
  competing = new Database(path);
  competing.pragma('busy_timeout = 0');
  competing.pragma('foreign_keys = ON');
});

afterAll(() => {
  competing?.close();
  closeDatabase();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

it('locks provider identity before reading and rejects a competing corrected proposal', async () => {
  const db = getDatabase();
  const otherDb = drizzle(competing, { schema });
  const tenantId = 'proposal-identity-lock';
  db.insert(schema.tenants).values({ id: tenantId, name: 'Identity lock', slug: tenantId }).run();
  const candidates = ['identity-lock-left', 'identity-lock-right'].map(id => ({
    id,
    tenantId,
    railId: 'wompi' as const,
    kind: 'charge' as const,
    status: 'approved' as const,
    amount: 123.45,
    currencyCode: 'COP',
    reference: id,
    payload: {},
    createdAt: '2026-10-01T12:00:00.000Z',
    updatedAt: '2026-10-01T12:00:00.000Z',
  }));
  db.insert(schema.paymentOutbox).values(candidates).run();
  const rows = db.select().from(schema.paymentOutbox).all();
  const statement = {
    railId: 'wompi' as const,
    reference: 'unmatched-identity-lock',
    providerTransactionId: 'shared-provider-identity',
    amount: 123.45,
    currencyCode: 'COP',
    status: 'settled' as const,
    settledAt: '2026-10-01T12:00:00.000Z',
    fee: 0,
  };
  const decision = {
    ok: true as const,
    salePaymentId: rows[0]!.id,
    confidence: 'high' as const,
    explanation: 'Synthetic competing connections',
    costUsd: 0,
    auditLogId: 'stub-lock',
  };
  const transaction = db.transaction.bind(db);
  const spy = vi.spyOn(db, 'transaction').mockImplementationOnce((callback, config) =>
    transaction(tx => {
      expect(config?.behavior).toBe('immediate');
      // Two real connections: the second cannot acquire the writer lock even
      // before the first callback reads evidence. This is deterministic lock
      // exclusion, not a scheduler-dependent multi-process stress test.
      expect(() => competing.exec('BEGIN IMMEDIATE')).toThrow(/locked/);
      expect(competing.inTransaction).toBe(false);
      return callback(tx);
    }, config)
  );
  let first;
  try {
    first = await savePaymentProposal(db, tenantId, statement, rows, rows[0]!, decision);
  } finally {
    spy.mockRestore();
  }
  expect(first).toMatchObject({ status: 'pending', selectedOutboxId: rows[0]!.id });
  await expect(
    savePaymentProposal(otherDb, tenantId, { ...statement, fee: 1 }, rows, rows[1]!, {
      ...decision,
      salePaymentId: rows[1]!.id,
    })
  ).rejects.toThrow('already has a human review proposal');
  expect(await savePaymentProposal(otherDb, tenantId, statement, rows, rows[0]!, decision)).toEqual(
    first
  );
  expect(otherDb.select().from(schema.paymentReconciliationProposals).all()).toHaveLength(1);
  expect(
    otherDb
      .select()
      .from(schema.paymentOutbox)
      .all()
      .map(row => row.status)
  ).toEqual(['approved', 'approved']);
  expect(competing.pragma('foreign_key_check')).toEqual([]);
  expect(competing.pragma('integrity_check', { simple: true })).toBe('ok');
});
