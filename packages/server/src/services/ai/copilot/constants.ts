/**
 * ENG-031 — co-pilot bounds + limits.
 *
 * The analytics window default, the snapshot / result row caps, the SQL
 * length ceiling, the analytics-table allowlist + the forbidden-keyword
 * guard, and the public `copilotLimits` projection. Split out of
 * `copilot.ts` (ENG-178).
 *
 * @module services/ai/copilot/constants
 */
export const DEFAULT_WINDOW_DAYS = 90;
export const SALES_SNAPSHOT_ROW_LIMIT = 2_000;
export const LINE_ITEMS_SNAPSHOT_ROW_LIMIT = 10_000;
export const RESULT_ROW_LIMIT = 200;
export const SQL_MAX_LENGTH = 3_000;

export const ALLOWED_TABLES = new Set(['sales_summary', 'sale_line_items']);
export const FORBIDDEN_SQL = /\b(insert|update|delete|drop|alter|create|replace|truncate|merge|upsert|pragma|attach|detach|vacuum|reindex|analyze|begin|commit|rollback|savepoint|release|load_extension|readfile)\b/i;

export const copilotLimits = {
  defaultWindowDays: DEFAULT_WINDOW_DAYS,
  salesSnapshotRowLimit: SALES_SNAPSHOT_ROW_LIMIT,
  lineItemsSnapshotRowLimit: LINE_ITEMS_SNAPSHOT_ROW_LIMIT,
  resultRowLimit: RESULT_ROW_LIMIT,
};
