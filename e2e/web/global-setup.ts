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
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { seedDefaultData } from '../../packages/server/src/db/seed.js';
import * as schema from '../../packages/server/src/db/schema.js';
import {
  prepareBaseline,
  prepareCompanionBaseline,
  prepareFirstSaleBaseline,
} from '../shared/baseline.js';

const DB_PATH = 'packages/server/data/local.db';

export default async function globalSetup(_config: FullConfig) {
  const db = new Database(DB_PATH);
  try {
    // Demo identities are an explicit fixture concern, never an interactive
    // runtime default. This path is the suite-owned unencrypted local.db only.
    await seedDefaultData(drizzle(db, { schema }));
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
