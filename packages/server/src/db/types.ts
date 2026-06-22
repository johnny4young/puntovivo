/**
 * Database type surface (leaf).
 *
 * Holds the Drizzle-bound database instance type so connection,
 * catalog-seed, and any future db submodule can reference it without
 * importing the connection lifecycle module (which would create a cycle).
 *
 * @module db/types
 */

import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type * as schema from './schema.js';

/**
 * The Drizzle ORM database handle, bound to the full `schema` so every
 * table/relation is statically typed at the call site. This is the type
 * `initDatabase()` resolves to and that `getDatabase()` returns.
 */
export type DatabaseInstance = BetterSQLite3Database<typeof schema>;
