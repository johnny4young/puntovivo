/** An absent-target marker must never skip an applicable delivery, reservation or inbox migration. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ensureMigrationBaseline } from '../db/migration-baseline.js';

const folder = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const tags = [
  '0067_delivery_fulfillment',
  '0068_restaurant_reservations',
  '0069_external_order_inbox',
];
const hashes = tags.map(tag =>
  createHash('sha256')
    .update(readFileSync(join(folder, `${tag}.sql`)))
    .digest('hex')
);

describe('Fulfillment migration adoption', () => {
  for (const extraTable of [
    null,
    'delivery_orders',
    'delivery_order_events',
    'restaurant_tables',
    'restaurant_reservations',
    'reservation_events',
    'external_order_connectors',
    'external_orders',
    'external_order_events',
    'external_order_receipts',
    'external_order_nonces',
    'unrecognized_extension',
  ]) {
    it(`preserves applicable migrations outside the exact purchase-only shape (extra=${extraTable})`, () => {
      const db = new Database(':memory:');
      try {
        db.exec('CREATE TABLE purchases (id text); CREATE TABLE purchase_items (id text);');
        if (extraTable) db.exec(`CREATE TABLE ${extraTable} (id text);`);
        ensureMigrationBaseline(db, folder);
        const rows = db
          .prepare('SELECT hash FROM __drizzle_migrations ORDER BY id')
          .all() as Array<{ hash: string }>;
        for (const hash of hashes)
          expect(rows.some(row => row.hash === hash)).toBe(extraTable === null);
        // The adoption pass is stable; it cannot append duplicate no-op markers on a second boot.
        ensureMigrationBaseline(db, folder);
        expect(db.prepare('SELECT hash FROM __drizzle_migrations ORDER BY id').all()).toEqual(rows);
        expect(
          db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '__new_%'").all()
        ).toEqual([]);
      } finally {
        db.close();
      }
    });
  }
});
