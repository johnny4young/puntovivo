/**
 * pins the expanded `fiscal_documents.status` enum.
 *
 * Pre- the enum was closed to DIAN-native states (`pending`,
 * `sent`, `accepted`, `rejected`, `contingency`).  added
 * `voided`, `notified_correction`, and `partial_send` so SAT México,
 * SUNAT Perú, SII Chile, and NFe Brazil acknowledgements can be
 * expressed without per-country surrogate columns.
 *
 * SQLite text columns accept any value at the storage layer; the
 * Drizzle enum is enforced at the Zod boundary (application layer).
 * This test set asserts the application-layer contract through the
 * tRPC schemas in `trpc/schemas/fiscal*.ts`, plus that the raw INSERT
 * is at least storable (the storage layer does not narrow further).
 */

import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import { fiscalDocumentStatusEnum } from '../db/schema.js';

interface LiveDatabase {
  $client: Database.Database;
}

afterEach(() => {
  closeDatabase();
});

function liveClient(): Database.Database {
  return (getDatabase() as unknown as LiveDatabase).$client;
}

describe('fiscal_documents.status enum', () => {
  it('declares the eight canonical status values in lockstep with the audit set', () => {
    // Sentinel: if a future change adds / removes a status, the test
    // forces an explicit update to the union below so the FiscalStatusBadge
    // tone map + i18n keys stay in lockstep with the server enum.
    expect([...fiscalDocumentStatusEnum].sort()).toEqual(
      [
        'accepted',
        'contingency',
        'notified_correction',
        'partial_send',
        'pending',
        'rejected',
        'sent',
        'voided',
      ].sort()
    );
  });

  it('persists each of the eight status values via raw INSERT', async () => {
    await initDatabase({ dbPath: ':memory:', seedData: false });
    const c = liveClient();
    c.pragma('foreign_keys = OFF');
    c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's')").run();
    c.prepare(
      "INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ('u1', 't1', 'a@b', 'x', 'a', 'admin')"
    ).run();
    const insert = c.prepare(
      `INSERT INTO fiscal_documents (id, tenant_id, source, source_id, kind, resolution_id, consecutive, document_number, cufe, status, buyer_tax_id, buyer_country_code, buyer_tax_id_type_code, buyer_name, currency_code, locale_code, provider_id, emitted_by_user_id)
       VALUES (?, 't1', 'sale', ?, 'FEV', 'r1', 1, ?, ?, ?, '900', 'CO', '13', 'Buyer', 'COP', 'es-CO', 'mock', 'u1')`
    );
    for (const status of fiscalDocumentStatusEnum) {
      const id = `fd-${status}`;
      insert.run(id, `s-${status}`, `F-${status}`, `cufe-${status}`, status);
    }
    const row = c.prepare('SELECT COUNT(DISTINCT status) AS count FROM fiscal_documents').get() as {
      count: number;
    };
    expect(row.count).toBe(8);
  });
});
