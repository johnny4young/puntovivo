/** Exact absent-target adoption must never skip the kitchen graph on mixed/real databases. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ensureMigrationBaseline } from '../db/migration-baseline.js';
const folder = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const tags = [
  '0063_wandering_lord_hawal',
  '0064_burly_gorilla_man',
  '0065_famous_morph',
  '0066_hard_master_chief',
];
const hashes = tags.map(tag =>
  createHash('sha256')
    .update(readFileSync(`${folder}/${tag}.sql`))
    .digest('hex')
);
describe('Kitchen migration adoption', () => {
  for (const extraTable of [
    null,
    'kds_orders',
    'fiscal_emission_intents',
    'unrecognized_extension',
  ]) {
    it(`pins absent targets only for the exact purchase-only shape (extra=${extraTable})`, () => {
      const db = new Database(':memory:');
      try {
        db.exec('CREATE TABLE purchases (id text); CREATE TABLE purchase_items (id text);');
        if (extraTable) db.exec(`CREATE TABLE ${extraTable} (id text);`);
        ensureMigrationBaseline(db, folder);
        const rows = db.prepare('SELECT hash FROM __drizzle_migrations').all() as Array<{
          hash: string;
        }>;
        for (const hash of hashes)
          expect(rows.some(row => row.hash === hash)).toBe(extraTable === null);
      } finally {
        db.close();
      }
    });
  }
});
