/**
 * Playwright Electron-suite global setup.
 *
 * Prepares a dedicated userData directory for the Electron smoke suite
 * so each run starts against a known-clean DB without touching the web
 * suite's `packages/server/data/local.db` or the developer's real
 * Electron userData (`~/Library/Application Support/Puntovivo Desktop/`
 * on macOS, XDG equivalents elsewhere).
 *
 * Sequence:
 *
 *   1. Wipe the template and the per-test root from prior runs (the
 *      fixture computes the exact same paths).
 *   2. Boot `initDatabase()` from the compiled server DB module against
 *      `<userDataDir>/data/local.db` so the schema + default seed land
 *      exactly like they would in a real Electron boot. This is the
 *      same code path Electron's main process uses, so we never skew
 *      the test DB shape vs production.
 *   3. Run `prepareBaseline()` on the resulting DB to pre-seed the 4
 *      template users + ensure the secondary site exists, identical
 *      to the web runner.
 *
 * After this runs, each test copies the template into its own
 * directory and launches with `--user-data-dir=<that copy>`, so
 * Electron's bootstrap (`DB_PATH = join(app.getPath('userData'),
 * 'data', 'local.db')`) resolves to a private seeded database.
 * Seeding once and copying keeps per-test isolation affordable:
 * re-running migrations for every test would dominate the suite.
 *
 * Prerequisite: `npm run build --workspace=@puntovivo/server` must
 * have run once so the compiled `dist/index.js` exists. The
 * `test:e2e:electron` root script chains the build automatically.
 *
 * @module e2e/electron/global-setup
 */

import type { FullConfig } from '@playwright/test';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareBaseline, prepareFirstSaleBaseline } from '../shared/baseline.js';
import {
  ELECTRON_E2E_DB_KEY,
  ELECTRON_E2E_TEMPLATE_DIR,
  ELECTRON_E2E_USER_DATA_ROOT,
} from './fixtures.js';

function applyE2eSqlCipherKey(db: Database.Database): void {
  db.pragma("cipher='sqlcipher'");
  db.pragma('legacy = 4');
  db.pragma(`key = "x'${ELECTRON_E2E_DB_KEY}'"`);
}

export default async function globalSetup(_config: FullConfig) {
  // Reset the userData dir so the schema + baseline are deterministic
  // across reruns. Prior runs may have accumulated test artefacts that
  // would confuse `cleanupPriorRunArtifacts`.
  for (const dir of [ELECTRON_E2E_TEMPLATE_DIR, ELECTRON_E2E_USER_DATA_ROOT]) {
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  }

  const dbPath = resolve(ELECTRON_E2E_TEMPLATE_DIR, 'data', 'local.db');
  mkdirSync(dirname(dbPath), { recursive: true });

  // Playwright transpiles globalSetup before execution. Import the
  // compiled DB module directly: the package root intentionally exports
  // the public server surface, not the low-level bootstrap helpers.
  const { initDatabase, closeDatabase } = await import(
    pathToFileURL(resolve(process.cwd(), 'packages/server/dist/db/index.js')).href
  );

  // Boot the embedded server against the tmpdir DB. This runs the full
  // drizzleMigrate + seedCatalogs + seedDefaultData sequence, so after
  // this returns we have the tenant + default admin + all catalog rows
  // in place.
  await initDatabase({
    dbPath,
    runMigrations: true,
    seedData: true,
    verbose: false,
    encryptionKey: ELECTRON_E2E_DB_KEY,
  });
  closeDatabase();

  // Now upsert the E2E template users + ensure the secondary site.
  const db = new Database(dbPath);
  try {
    applyE2eSqlCipherKey(db);
    await prepareBaseline(db);
    // The first-sale journey needs a tenant that has never sold anything. It
    // lives in its own tenant, so it composes with the baseline above instead
    // of competing with it for the seeded one.
    await prepareFirstSaleBaseline(db);
  } finally {
    db.close();
  }
}
