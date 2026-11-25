import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { DatabaseInstance } from '../db/types.js';
import { orders, purchases, quotations, sales } from '../db/schema.js';

export type SequentialDocumentType = 'sale' | 'purchase' | 'order' | 'quotation';

const NUMBER_COLUMNS: Record<
  SequentialDocumentType,
  { table: SQLiteTable; tenantId: SQLiteColumn; number: SQLiteColumn }
> = {
  sale: { table: sales, tenantId: sales.tenantId, number: sales.saleNumber },
  purchase: { table: purchases, tenantId: purchases.tenantId, number: purchases.purchaseNumber },
  order: { table: orders, tenantId: orders.tenantId, number: orders.orderNumber },
  quotation: {
    table: quotations,
    tenantId: quotations.tenantId,
    number: quotations.quotationNumber,
  },
};

/**
 * Highest counter value already issued as `<prefix><digits>` for a document type.
 * Numbers are unique per tenant (not per site), so the scan is tenant-wide.
 */
export function getHighestIssuedSequentialValue(
  db: Pick<DatabaseInstance, 'select'>,
  args: { tenantId: string; documentType: SequentialDocumentType; prefix: string }
): number {
  const { table, tenantId, number } = NUMBER_COLUMNS[args.documentType];
  const prefixLength = args.prefix.length;
  const suffix: SQL = sql`substr(${number}, ${prefixLength + 1})`;
  const row = db
    .select({ highest: sql<number | null>`MAX(CAST(${suffix} AS INTEGER))` })
    .from(table)
    .where(
      and(
        eq(tenantId, args.tenantId),
        sql`substr(${number}, 1, ${prefixLength}) = ${args.prefix}`,
        sql`${suffix} <> ''`,
        sql`${suffix} NOT GLOB '*[^0-9]*'`
      )
    )
    .get();
  return row?.highest ?? 0;
}
