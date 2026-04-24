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
 *   1. Wipe `ELECTRON_E2E_USER_DATA_DIR` from prior runs (the fixture
 *      computes the exact same path).
 *   2. Boot `initDatabase()` from the compiled server DB module against
 *      `<userDataDir>/data/local.db` so the schema + default seed land
 *      exactly like they would in a real Electron boot. This is the
 *      same code path Electron's main process uses, so we never skew
 *      the test DB shape vs production.
 *   3. Run `prepareBaseline()` on the resulting DB to pre-seed the 4
 *      template users + ensure the secondary site exists, identical
 *      to the web runner.
 *
 * After this runs, the Playwright `_electron.launch()` fixture can
 * pass `--user-data-dir=<userDataDir>` and Electron's bootstrap
 * (`DB_PATH = join(app.getPath('userData'), 'data', 'local.db')`)
 * will resolve to the exact same file we just seeded.
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
import { prepareBaseline } from '../shared/baseline.js';
import { ELECTRON_E2E_USER_DATA_DIR } from './fixtures.js';

export default async function globalSetup(_config: FullConfig) {
  // Reset the userData dir so the schema + baseline are deterministic
  // across reruns. Prior runs may have accumulated test artefacts that
  // would confuse `cleanupPriorRunArtifacts`.
  if (existsSync(ELECTRON_E2E_USER_DATA_DIR)) {
    rmSync(ELECTRON_E2E_USER_DATA_DIR, { recursive: true, force: true });
  }
  mkdirSync(ELECTRON_E2E_USER_DATA_DIR, { recursive: true });

  const dbPath = resolve(ELECTRON_E2E_USER_DATA_DIR, 'data', 'local.db');
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
  });
  closeDatabase();

  // Now upsert the E2E template users + ensure the secondary site.
  const db = new Database(dbPath);
  try {
    await prepareBaseline(db);
  } finally {
    db.close();
  }
}
