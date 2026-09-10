import { check, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

/**
 * Exact inventory storage guards. NULL retains unknown historical evidence;
 * signed global pools/deltas preserve negative-stock policy. This only checks
 * row-local structure: the domain transaction owns balance/pool coordination.
 */
export function inventoryValueChecks(
  table: string,
  options: {
    cents: AnySQLiteColumn[];
    nonnegative?: AnySQLiteColumn[];
    versions?: AnySQLiteColumn[];
    quantities?: AnySQLiteColumn[];
    together?: AnySQLiteColumn[][];
    emptyPool?: { quantity: AnySQLiteColumn; values: AnySQLiteColumn[] };
  }
) {
  const versions = options.versions ?? [];
  const nonnegative = new Set([...(options.nonnegative ?? []), ...versions]);
  const checks = [...options.cents, ...versions].map(column =>
    check(
      `chk_${table}_${column.name}_safe_integer`,
      sql`${column} IS NULL OR (typeof(${column}) = 'integer' AND ${column} BETWEEN ${sql.raw(nonnegative.has(column) ? '0' : '-9007199254740991')} AND 9007199254740991)`
    )
  );
  for (const column of options.quantities ?? []) {
    checks.push(
      check(
        `chk_${table}_${column.name}_finite_quantity`,
        sql`${column} IS NULL OR (typeof(${column}) IN ('integer', 'real') AND ${column} BETWEEN -1.7976931348623157e308 AND 1.7976931348623157e308)`
      )
    );
  }
  for (const [index, columns] of (options.together ?? []).entries()) {
    checks.push(
      check(
        `chk_${table}_valuation_basis_${index}`,
        sql`(${sql.join(
          columns.map(column => sql`${column} IS NULL`),
          sql` AND `
        )}) OR (${sql.join(
          columns.map(column => sql`${column} IS NOT NULL`),
          sql` AND `
        )})`
      )
    );
  }
  if (options.emptyPool) {
    const { quantity, values } = options.emptyPool;
    checks.push(
      check(
        `chk_${table}_empty_value`,
        sql`${quantity} IS NULL OR ${quantity} <> 0 OR (${sql.join(
          values.map(column => sql`${column} = 0`),
          sql` AND `
        )})`
      )
    );
  }
  return checks;
}
