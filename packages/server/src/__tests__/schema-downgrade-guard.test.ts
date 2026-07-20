/**
 * A-06 — schema downgrade guard.
 *
 * The reachable field failure: auto-update migrates the DB, the operator
 * rolls back to an older installer ( rollback does not exist yet),
 * and the old binary opens a DB from the future. Pre-guard, that died
 * mid-operation with `no such column`; the guard turns it into a refusal at
 * boot with the remediation in the message.
 *
 * The suite drives the REAL migrated in-memory DB (createServer) and forges
 * journals of varying lengths against it — no mocks of the tracking table.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  SchemaNewerThanAppError,
  assertSchemaNotNewerThanApp,
} from '../db/schema-downgrade-guard.js';

/** Raw better-sqlite3 handle drizzle wraps (drizzle 0.3x exposes $client). */
interface RawSqlite {
  prepare(sql: string): { get(): unknown };
  exec(sql: string): void;
}

let server: PuntovivoServer;
let sqlite: RawSqlite;
let appliedCount: number;

/** Scratch migrations folder whose journal has `entries` entries. */
function journalFolderWith(entries: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'pv-downgrade-'));
  mkdirSync(join(dir, 'meta'), { recursive: true });
  const journal = {
    version: '7',
    dialect: 'sqlite',
    entries: Array.from({ length: entries }, (_, idx) => ({
      idx,
      version: '6',
      when: 1700000000000 + idx,
      tag: `${String(idx).padStart(4, '0')}_forged`,
      breakpoints: true,
    })),
  };
  writeFileSync(join(dir, 'meta', '_journal.json'), JSON.stringify(journal));
  return dir;
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  sqlite = (getDatabase() as unknown as { $client: RawSqlite }).$client;
  const row = sqlite.prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations').get() as {
    n: number;
  };
  appliedCount = row.n;
  // The scenario needs a DB that HAS applied migrations.
  expect(appliedCount).toBeGreaterThan(0);
});

afterAll(async () => {
  await server.close();
});

describe('assertSchemaNotNewerThanApp (A-06)', () => {
  it('passes when the bundled journal matches what the DB applied', () => {
    const folder = journalFolderWith(appliedCount);
    try {
      expect(() => assertSchemaNotNewerThanApp(sqlite, folder)).not.toThrow();
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('passes on a pending UPGRADE (bundled journal is ahead of the DB)', () => {
    const folder = journalFolderWith(appliedCount + 3);
    try {
      expect(() => assertSchemaNotNewerThanApp(sqlite, folder)).not.toThrow();
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('refuses to boot when the DB is from the future (downgrade)', () => {
    // An older binary bundles FEWER migrations than this DB has applied.
    const folder = journalFolderWith(appliedCount - 1);
    try {
      expect(() => assertSchemaNotNewerThanApp(sqlite, folder)).toThrow(SchemaNewerThanAppError);
      expect(() => assertSchemaNotNewerThanApp(sqlite, folder)).toThrow(
        /NEWER than this build[\s\S]*restore the pre-update database backup/
      );
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('is a no-op on a fresh DB with no tracking table', () => {
    // Simulate the pre-first-migrate state the boot path hits on a new
    // install: the guard must defer to the normal migration flow.
    sqlite.exec('ALTER TABLE __drizzle_migrations RENAME TO __drizzle_migrations_bak');
    const folder = journalFolderWith(1);
    try {
      expect(() => assertSchemaNotNewerThanApp(sqlite, folder)).not.toThrow();
    } finally {
      sqlite.exec('ALTER TABLE __drizzle_migrations_bak RENAME TO __drizzle_migrations');
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
