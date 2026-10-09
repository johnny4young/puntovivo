/**
 * Playwright web-suite global setup.
 *
 * Initializes the suite-owned standalone-server DB at
 * `packages/server/data/local.db` through the real migration/seed path before
 * opening it for direct fixture writes. Playwright starts the owned webServer
 * first, which migrates the same file with `seedData: false`; this setup adds
 * the default seed through the server's own lifecycle (migrations re-run as an
 * idempotent no-op) instead of importing ESM-only source seed modules into
 * Playwright's CJS transform. Delegates to `e2e/shared/baseline.ts` for tenant
 * prep: cleanup prior E2E artefacts, ensure a secondary site, seed the
 * 4 template users. See that module for the semantics.
 *
 * @module e2e/web/global-setup
 */

import type { FullConfig } from '@playwright/test';
import Database from 'better-sqlite3';
import { execFileSync } from 'node:child_process';
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
  // uses. Run the compiled module in a child process: Playwright transforms
  // this TS setup to CJS while the source DB migration resolver requires ESM
  // import.meta, and importing the compiled ESM graph into this runner would
  // cache shared dist modules as ESM, so spec files that later import server
  // source through the CJS transform would fail to load them.
  // All four Web E2E commands build the server before this setup runs.
  const dbModuleUrl = pathToFileURL(resolve('packages/server/dist/db/index.js')).href;
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `const { closeDatabase, initDatabase } = await import(${JSON.stringify(dbModuleUrl)});
try {
  await initDatabase({ dbPath: ${JSON.stringify(DB_PATH)}, runMigrations: true, seedData: true, verbose: false });
} finally {
  closeDatabase();
}`,
    ],
    { env: { ...process.env, PUNTOVIVO_SUPPRESS_CREDENTIAL_BANNER: 'true' }, stdio: 'inherit' }
  );

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
