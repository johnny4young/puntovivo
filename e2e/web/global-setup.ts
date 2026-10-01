/**
 * Playwright web-suite global setup.
 *
 * Initializes the suite-owned standalone-server DB at
 * `packages/server/data/local.db` through the real migration/seed path before
 * opening it for direct fixture writes. Global setup can run before
 * Playwright's webServer, so it must not rely on server boot to create the
 * directory or schema. Delegates to `e2e/shared/baseline.ts` for tenant
 * prep: cleanup prior E2E artefacts, ensure a secondary site, seed the
 * 4 template users. See that module for the semantics.
 *
 * @module e2e/web/global-setup
 */

import type { FullConfig } from '@playwright/test';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  prepareBaseline,
  prepareCompanionBaseline,
  prepareFirstSaleBaseline,
} from '../shared/baseline.js';

const DB_PATH = resolve('packages/server/data/local.db');

export default async function globalSetup(_config: FullConfig) {
  // This is the same migration + catalog/default-seed lifecycle the server
  // uses. Import the compiled module: Playwright transforms this TS setup to
  // CJS, while the source DB migration resolver requires ESM import.meta.
  // All four Web E2E commands build the server before this setup runs.
  const { closeDatabase, initDatabase } = await import(
    pathToFileURL(resolve('packages/server/dist/db/index.js')).href
  );
  process.env.PUNTOVIVO_SUPPRESS_CREDENTIAL_BANNER = 'true';
  try {
    await initDatabase({ dbPath: DB_PATH, runMigrations: true, seedData: true, verbose: false });
  } finally {
    closeDatabase();
  }

  const db = new Database(DB_PATH);
  try {
    // Demo identities are an explicit fixture concern, never an interactive
    // runtime default. This path is the suite-owned unencrypted local.db only.
    db.prepare(
      "UPDATE installation_setup SET completed_at = datetime('now'), completion_kind = 'adopted' WHERE id = 'local' AND completed_at IS NULL"
    ).run();
    await prepareBaseline(db);
    await prepareFirstSaleBaseline(db);
    await prepareCompanionBaseline(db);
  } finally {
    db.close();
  }
}
