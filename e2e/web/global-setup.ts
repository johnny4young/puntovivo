/**
 * Playwright web-suite global setup.
 *
 * Opens the shared standalone-server DB at `packages/server/data/local.db`
 * (created by `npm run dev:server` via Playwright's `webServer` block)
 * and delegates to `e2e/shared/baseline.ts` for tenant prep: cleanup
 * prior E2E artefacts, ensure a secondary site, seed the 4 template
 * users. See that module for the semantics.
 *
 * @module e2e/web/global-setup
 */

import type { FullConfig } from '@playwright/test';
import Database from 'better-sqlite3';
import { prepareBaseline } from '../shared/baseline.js';

const DB_PATH = 'packages/server/data/local.db';

export default async function globalSetup(_config: FullConfig) {
  const db = new Database(DB_PATH);
  try {
    await prepareBaseline(db);
  } finally {
    db.close();
  }
}
