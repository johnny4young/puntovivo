/** Workforce no-op adoption is restricted to the existing exact purchase-only compatibility shape. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { ensureMigrationBaseline } from '../db/migration-baseline.js';

const folder = fileURLToPath(new URL('../db/migrations/', import.meta.url));
const hashes = [
  '0070_employment_contracts',
  '0071_employee_time_off',
  '0072_employee_availability',
  '0073_employee_schedule_plans',
  '0074_employee_shift_swaps',
  '0075_employee_attendance_reconciliation',
].map(tag =>
  createHash('sha256')
    .update(readFileSync(join(folder, `${tag}.sql`)))
    .digest('hex')
);
describe('Workforce migration adoption', () => {
  it.each([
    null,
    'tenants',
    'users',
    'sites',
    'employee_shifts',
    'scheduled_shifts',
    'employment_contracts',
    'employment_contract_events',
    'employee_time_off',
    'employee_time_off_events',
    'employee_availability',
    'employee_availability_events',
    'employee_schedule_plans',
    'employee_schedule_occurrences',
    'employee_schedule_plan_events',
    'employee_shift_swaps',
    'employee_shift_swap_claims',
    'employee_shift_swap_events',
    'employee_shift_reconciliations',
    'employee_shift_reconciliation_events',
    'unrecognized_extension',
  ])('never skips workforce migrations when any extra table exists: %s', extra => {
    const db = new Database(':memory:');
    try {
      db.exec('CREATE TABLE purchases(id text); CREATE TABLE purchase_items(id text);');
      if (extra) db.exec(`CREATE TABLE ${extra}(id text);`);
      const tables = db
        .prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name")
        .all();
      ensureMigrationBaseline(db, folder);
      const rows = db
        .prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY id')
        .all() as { hash: string; created_at: number }[];
      for (const hash of hashes) expect(rows.some(row => row.hash === hash)).toBe(extra === null);
      expect(
        db
          .prepare(
            "SELECT name,sql FROM sqlite_master WHERE type='table' AND name<>'__drizzle_migrations' ORDER BY name"
          )
          .all()
      ).toEqual(tables);
      ensureMigrationBaseline(db, folder);
      expect(
        db.prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY id').all()
      ).toEqual(rows);
    } finally {
      db.close();
    }
  });
  it('leaves a fresh database unadopted so the complete schema is created', () => {
    const db = new Database(':memory:');
    try {
      ensureMigrationBaseline(db, folder);
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([]);
    } finally {
      db.close();
    }
  });
  it('never advances a previously tracked partial database past pending migrations', () => {
    const db = new Database(':memory:');
    try {
      db.exec(
        "CREATE TABLE purchases(id text); CREATE TABLE purchase_items(id text); CREATE TABLE __drizzle_migrations(id INTEGER PRIMARY KEY,hash text NOT NULL,created_at numeric); INSERT INTO __drizzle_migrations(hash,created_at) VALUES ('existing',1);"
      );
      ensureMigrationBaseline(db, folder);
      expect(db.prepare('SELECT hash,created_at FROM __drizzle_migrations').all()).toEqual([
        { hash: 'existing', created_at: 1 },
      ]);
    } finally {
      db.close();
    }
  });
});
