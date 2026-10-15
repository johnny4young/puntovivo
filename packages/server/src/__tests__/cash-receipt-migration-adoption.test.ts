import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ensureMigrationBaseline } from '../db/migration-baseline.js';

const folder = resolve(process.cwd(), 'src/db/migrations');
const ocrSql = readFileSync(join(folder, '0094_ocr_confirmation_idempotency.sql'), 'utf8');
const indexName = 'idx_purchases_tenant_ocr_extract';
const cases = [
  ['complete', true],
  ['missing confirmation hash', false],
  ['missing both columns', false],
  ['non-unique index', false],
  ['wrong index columns', false],
  ['case-insensitive index', false],
  ['descending index', false],
  ['wrong predicate', false],
  ['non-partial index', false],
  ['wrong column type', false],
  ['non-null column', false],
  ['mixed schema', false],
] as const;

describe('cash-receipt migration adoption', () => {
  for (const [shape, canAdopt] of cases) {
    it(`advances only a complete post-transitional purchase-only shape: ${shape}`, () => {
      const sqlite = new Database(':memory:');
      try {
        sqlite.exec(
          'CREATE TABLE purchases(id TEXT, tenant_id TEXT); CREATE TABLE purchase_items(id TEXT)'
        );
        let canonical = ocrSql;
        if (shape === 'wrong column type')
          canonical = canonical.replace(
            'ADD `ocr_confirmation_hash` text',
            'ADD `ocr_confirmation_hash` integer'
          );
        if (shape === 'non-null column')
          canonical = canonical.replace(
            'ADD `ocr_confirmation_hash` text',
            "ADD `ocr_confirmation_hash` text NOT NULL DEFAULT ''"
          );
        sqlite.exec(canonical);
        if (shape === 'missing confirmation hash')
          sqlite.exec('ALTER TABLE purchases DROP COLUMN ocr_confirmation_hash');
        if (shape === 'missing both columns') {
          sqlite.exec(`DROP INDEX ${indexName}`);
          sqlite.exec('ALTER TABLE purchases DROP COLUMN ocr_extract_audit_id');
          sqlite.exec('ALTER TABLE purchases DROP COLUMN ocr_confirmation_hash');
        }
        if (shape === 'non-unique index') {
          sqlite.exec(`DROP INDEX ${indexName}`);
          sqlite.exec(
            `CREATE INDEX ${indexName} ON purchases(tenant_id,ocr_extract_audit_id) WHERE ocr_extract_audit_id IS NOT NULL`
          );
        }
        if (shape === 'wrong index columns') {
          sqlite.exec(`DROP INDEX ${indexName}`);
          sqlite.exec(
            `CREATE UNIQUE INDEX ${indexName} ON purchases(ocr_extract_audit_id,tenant_id) WHERE ocr_extract_audit_id IS NOT NULL`
          );
        }
        if (shape === 'case-insensitive index' || shape === 'descending index') {
          sqlite.exec(`DROP INDEX ${indexName}`);
          const modifier = shape === 'case-insensitive index' ? 'COLLATE NOCASE' : 'DESC';
          sqlite.exec(
            `CREATE UNIQUE INDEX ${indexName} ON purchases(tenant_id,ocr_extract_audit_id ${modifier}) WHERE ocr_extract_audit_id IS NOT NULL`
          );
        }
        if (shape === 'wrong predicate') {
          sqlite.exec(`DROP INDEX ${indexName}`);
          sqlite.exec(
            `CREATE UNIQUE INDEX ${indexName} ON purchases(tenant_id,ocr_extract_audit_id) WHERE ocr_extract_audit_id IS NULL`
          );
        }
        if (shape === 'non-partial index') {
          sqlite.exec(`DROP INDEX ${indexName}`);
          sqlite.exec(
            `CREATE UNIQUE INDEX ${indexName} ON purchases(tenant_id,ocr_extract_audit_id)`
          );
        }
        if (shape === 'mixed schema') sqlite.exec('CREATE TABLE tenants(id TEXT)');
        ensureMigrationBaseline(sqlite, folder);
        for (const tag of [
          '0093_ai_budget_reservations',
          '0094_ocr_confirmation_idempotency',
          '0095_mighty_raza',
        ]) {
          const hash = createHash('sha256')
            .update(readFileSync(join(folder, `${tag}.sql`)))
            .digest('hex');
          expect(
            Boolean(sqlite.prepare('SELECT id FROM __drizzle_migrations WHERE hash=?').get(hash))
          ).toBe(canAdopt);
        }
      } finally {
        sqlite.close();
      }
    });
  }
});
