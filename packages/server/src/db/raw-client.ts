import type Database from 'better-sqlite3';
import type { DatabaseInstance } from './types.js';

/**
 * The better-sqlite3 handle behind a Drizzle database or transaction. Drizzle
 * exposes `$client` only on the root handle; transactions carry it on `session`.
 */
export function rawSqliteClient(db: DatabaseInstance): Database.Database | null {
  const handle = db as unknown as {
    $client?: Database.Database;
    session?: { client?: Database.Database };
  };
  const client = handle.$client ?? handle.session?.client;
  return client && typeof client.prepare === 'function' ? client : null;
}
