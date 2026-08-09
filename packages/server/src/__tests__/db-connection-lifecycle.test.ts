/**
 * Database singleton publication and teardown regressions.
 *
 * A candidate SQLite handle is not process-owned until every boot step has
 * succeeded. Failed, overlapping, or cancelled initialization must therefore
 * leave getDatabase unavailable and must never replace an established handle.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';

const HEX_KEY = 'a'.repeat(64);

afterEach(() => {
  closeDatabase();
});

describe('database connection lifecycle', () => {
  it('rejects malformed boot inputs without creating or publishing a database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-db-init-input-'));
    const dbPath = join(dir, 'candidate.db');
    try {
      await expect(
        initDatabase({
          dbPath,
          runMigrations: false,
          seedData: false,
          encryptionKey: 'not-a-key',
        })
      ).rejects.toThrow(/64-character hex string/);

      expect(existsSync(dbPath)).toBe(false);
      expect(() => getDatabase()).toThrow(/not initialized/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('closes and withholds a candidate handle when setup fails after open', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-db-init-open-'));
    const dbPath = join(dir, 'cleartext.db');
    try {
      const cleartext = await initDatabase({ dbPath, runMigrations: false, seedData: false });
      const cleartextClient = (cleartext as unknown as { $client: { exec(sql: string): void } })
        .$client;
      cleartextClient.exec('CREATE TABLE sentinel (value TEXT NOT NULL)');
      cleartextClient.exec("INSERT INTO sentinel (value) VALUES ('preserved')");
      closeDatabase();

      await expect(
        initDatabase({
          dbPath,
          runMigrations: false,
          seedData: false,
          encryptionKey: HEX_KEY,
        })
      ).rejects.toThrow();
      expect(() => getDatabase()).toThrow(/not initialized/i);

      const reopened = await initDatabase({ dbPath, runMigrations: false, seedData: false });
      const row = (
        reopened as unknown as {
          $client: { prepare(sql: string): { get(): { value: string } } };
        }
      ).$client
        .prepare('SELECT value FROM sentinel')
        .get();
      expect(row).toEqual({ value: 'preserved' });
    } finally {
      closeDatabase();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects overlapping and duplicate initialization without replacing the owner', async () => {
    const firstBoot = initDatabase({ dbPath: ':memory:', seedData: true });

    await expect(initDatabase({ dbPath: ':memory:', seedData: false })).rejects.toThrow(
      /initialization already in progress/i
    );

    const firstDb = await firstBoot;
    expect(getDatabase()).toBe(firstDb);
    await expect(initDatabase({ dbPath: ':memory:', seedData: false })).rejects.toThrow(
      /already initialized/i
    );
    expect(getDatabase()).toBe(firstDb);
  });

  it('turns close during async initialization into cancellation before publication', async () => {
    const pendingBoot = initDatabase({ dbPath: ':memory:', seedData: true });
    closeDatabase();

    await expect(pendingBoot).rejects.toThrow(/cancelled by closeDatabase/i);
    expect(() => getDatabase()).toThrow(/not initialized/i);

    const recovered = await initDatabase({ dbPath: ':memory:', seedData: false });
    expect(getDatabase()).toBe(recovered);
  });

  it('retains ownership when native close fails so cleanup can be retried', async () => {
    const db = await initDatabase({ dbPath: ':memory:', seedData: false });
    const client = (db as unknown as { $client: { close(): void } }).$client;
    const nativeClose = client.close.bind(client);
    client.close = () => {
      throw new Error('synthetic close failure');
    };

    try {
      expect(() => closeDatabase()).toThrow(/synthetic close failure/);
      expect(getDatabase()).toBe(db);
    } finally {
      client.close = nativeClose;
    }

    closeDatabase();
    expect(() => getDatabase()).toThrow(/not initialized/i);
  });
});
