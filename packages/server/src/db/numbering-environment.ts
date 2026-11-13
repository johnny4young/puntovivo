/**
 * Ranges registered before numbering carried an environment were migrated as
 * `habilitacion`; they belong to whatever DIAN environment their tenant runs.
 * Runs after migrations on every boot: only rows without a creator or a
 * resolution date (never set by the ranges API) are touched, and it is a no-op
 * once aligned.
 *
 * @module db/numbering-environment
 */
import type Database from 'better-sqlite3';
import type { DatabaseInstance } from './index.js';

export function alignLegacyNumberingEnvironment(database: DatabaseInstance): number {
  const client = (database as unknown as { $client: Database.Database }).$client;
  const present = client
    .prepare(
      "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('tenants', 'fiscal_numbering_resolutions')"
    )
    .get() as { n: number };
  if (present.n < 2) return 0;
  const columns = client
    .prepare("PRAGMA table_info('fiscal_numbering_resolutions')")
    .all() as Array<{
    name: string;
  }>;
  if (!columns.some(column => column.name === 'created_by')) return 0;
  return client
    .prepare(
      `UPDATE fiscal_numbering_resolutions
          SET environment = 'produccion'
        WHERE environment = 'habilitacion'
          AND created_by IS NULL
          AND resolution_date IS NULL
          AND tenant_id IN (
            SELECT id FROM tenants
             WHERE json_valid(settings)
               AND json_extract(settings, '$.fiscal.co.environment') = 'produccion'
          )`
    )
    .run().changes;
}
