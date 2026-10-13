import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { pharmacyEvidenceKeys } from '../db/schema.js';
import { hasPharmacyEvidenceKey } from '../services/pharmacy/evidence-box.js';

describe('pharmacy evidence keyring lifecycle', () => {
  const createdPaths: string[] = [];
  let server: PuntovivoServer | undefined;

  afterEach(async () => {
    if (server) await server.close();
    server = undefined;
    for (const path of createdPaths.splice(0)) rmSync(path, { recursive: true, force: true });
  });

  function databasePath(): string {
    const directory = mkdtempSync(join(tmpdir(), 'puntovivo-pharmacy-key-'));
    createdPaths.push(directory);
    return join(directory, 'pharmacy.db');
  }

  async function persistedSecret(): Promise<string> {
    const row = await getDatabase().select().from(pharmacyEvidenceKeys).get();
    if (!row) throw new Error('Expected the persisted pharmacy evidence key');
    return row.secretMaterial;
  }

  it('persists generated material across restart and clears process memory on close', async () => {
    const dbPath = databasePath();
    server = await createServer({ dbPath, seedData: false, verbose: false });
    const generated = await persistedSecret();
    expect(generated.length).toBeGreaterThanOrEqual(32);
    expect(hasPharmacyEvidenceKey()).toBe(true);

    await server.close();
    server = undefined;
    expect(hasPharmacyEvidenceKey()).toBe(false);

    server = await createServer({ dbPath, seedData: false, verbose: false });
    expect(await persistedSecret()).toBe(generated);
    expect(hasPharmacyEvidenceKey()).toBe(true);
  });

  const configured = 'pharmacy-test-key-material-000000000001';

  async function persistConfiguredKey(dbPath: string): Promise<void> {
    server = await createServer({
      dbPath,
      seedData: false,
      verbose: false,
      pharmacyEvidenceKey: configured,
    });
    expect(await persistedSecret()).toBe(configured);
    await server.close();
    server = undefined;
  }

  it('accepts the same configured seed across restart', async () => {
    const dbPath = databasePath();
    await persistConfiguredKey(dbPath);
    server = await createServer({
      dbPath,
      seedData: false,
      verbose: false,
      pharmacyEvidenceKey: configured,
    });
    expect(await persistedSecret()).toBe(configured);
    expect(hasPharmacyEvidenceKey()).toBe(true);
  });

  it('fails closed on replacement of the persisted configured seed', async () => {
    const dbPath = databasePath();
    await persistConfiguredKey(dbPath);
    await expect(
      createServer({
        dbPath,
        seedData: false,
        verbose: false,
        pharmacyEvidenceKey: 'different-pharmacy-key-material-0000001',
      })
    ).rejects.toThrow('PHARMACY_EVIDENCE_KEY_MISMATCH');
    expect(hasPharmacyEvidenceKey()).toBe(false);
  });

  it.each(['too-short', ` ${configured}`])(
    'fails closed on invalid configured input %s',
    async pharmacyEvidenceKey => {
      await expect(
        createServer({
          dbPath: databasePath(),
          seedData: false,
          verbose: false,
          pharmacyEvidenceKey,
        })
      ).rejects.toThrow('PHARMACY_EVIDENCE_KEY_INVALID');
      expect(hasPharmacyEvidenceKey()).toBe(false);
    }
  );

  it('measures configured key strength in bytes consistently with SQLite', async () => {
    const multibyteKey = '🔐'.repeat(8);
    server = await createServer({
      dbPath: databasePath(),
      seedData: false,
      verbose: false,
      pharmacyEvidenceKey: multibyteKey,
    });

    expect(await persistedSecret()).toBe(multibyteKey);
  });
});
