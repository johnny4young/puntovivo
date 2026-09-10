import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { closeDatabase, initDatabase } from '../db/index.js';
import { users, installationSetup } from '../db/schema.js';
import { ensureMigrationBaseline } from '../db/migration-baseline.js';
import { createInstallationSetup } from '../services/installation/setup.js';

describe('first-owner historical adoption', () => {
  it('does not skip ownership migration for a mixed legacy schema', () => {
    const db = new Database(':memory:');
    try {
      db.exec(
        'CREATE TABLE purchases(id TEXT); CREATE TABLE purchase_items(id TEXT); CREATE TABLE tenants(id TEXT)'
      );
      const migrations = resolve(process.cwd(), 'src/db/migrations');
      ensureMigrationBaseline(db, migrations);
      const hash = createHash('sha256')
        .update(readFileSync(join(migrations, '0081_installation_ownership.sql')))
        .digest('hex');
      expect(
        db.prepare('SELECT id FROM __drizzle_migrations WHERE hash=?').get(hash)
      ).toBeUndefined();
    } finally {
      db.close();
    }
  });

  for (const encrypted of [false, true]) {
    it(`adopts a version79 database without changing an identity or credential (encrypted=${encrypted})`, async () => {
      const directory = mkdtempSync(join(tmpdir(), 'puntovivo-owner-upgrade-'));
      const dbPath = join(directory, 'historical.db');
      const prefix = join(directory, 'migrations');
      const encryption = encrypted ? { encryptionKey: 'ef'.repeat(32) } : {};
      try {
        cpSync(resolve(process.cwd(), 'src/db/migrations'), prefix, { recursive: true });
        const journalPath = join(prefix, 'meta/_journal.json');
        const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
          entries: Array<{ idx: number }>;
        };
        journal.entries = journal.entries.filter(entry => entry.idx < 80);
        expect(journal.entries).toHaveLength(80);
        writeFileSync(journalPath, JSON.stringify(journal));
        const old = await initDatabase({
          dbPath,
          seedData: true,
          migrationsFolder: prefix,
          ...encryption,
        });
        const before = old.select().from(users).all();
        expect(before.length).toBeGreaterThan(0);
        closeDatabase();
        const current = await initDatabase({ dbPath, seedData: false, ...encryption });
        expect(current.select().from(users).all()).toEqual(before);
        expect(current.select().from(installationSetup).get()?.completionKind).toBe('adopted');
        const setup = createInstallationSetup(current);
        expect(setup.getToken()).toBeNull();
        setup.dispose();
        closeDatabase();
        const restarted = await initDatabase({ dbPath, seedData: false, ...encryption });
        expect(restarted.select().from(users).all()).toEqual(before);
        expect(restarted.select().from(installationSetup).all()).toHaveLength(1);
      } finally {
        closeDatabase();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});
