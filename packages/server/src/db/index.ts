/**
 * Database Connection Module (barrel)
 *
 * Initializes the SQLite database with better-sqlite3 and Drizzle ORM.
 * Handles migrations and provides the database instance.
 *
 * The implementation lives in focused sibling modules (ENG-178 Slice 17):
 * - `connection.ts` — `initDatabase` / `getDatabase` / `closeDatabase` + singletons
 * - `options.ts` — `DatabaseOptions` + boot-time option validation
 * - `migration-baseline.ts` — the ENG-002 versioned-migration adoption shim
 * - `catalog-seed.ts` — the post-migration catalog seeders
 * - `types.ts` — the `DatabaseInstance` type
 *
 * This barrel preserves the exact public surface (and re-exports the full
 * schema) so all importers resolve through `db/index.js` unchanged.
 *
 * @module db/index
 */

export { closeDatabase, getDatabase, initDatabase } from './connection.js';
export { DEFAULT_SQLITE_BUSY_TIMEOUT_MS, type DatabaseOptions } from './options.js';
export type { DatabaseInstance } from './types.js';

// Re-export schema
export * from './schema.js';
