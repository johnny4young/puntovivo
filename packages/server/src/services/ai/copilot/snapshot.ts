/**
 * co-pilot tenant-scoped analytics snapshot + read-only execution.
 *
 * The model never queries the production SQLite connection directly. This
 * module loads the tenant-scoped, time-bounded completed-sales + line-item
 * rows into a fresh in-memory SQLite snapshot (`sales_summary` /
 * `sale_line_items`) and executes the validated read-only query against THAT
 * snapshot only, then normalizes the rows + infers a chart. Split out of
 * `copilot.ts` ().
 *
 * @module services/ai/copilot/snapshot
 */
import Database from 'better-sqlite3';
import { TRPCError } from '@trpc/server';
import { and, desc, eq, gte, lte, type SQL } from 'drizzle-orm';

import { resolveCachedNodeBinding } from '../../../db/native-binding.js';
import type { DatabaseInstance } from '../../../db/index.js';
import {
  cashSessions,
  customers,
  products,
  saleItems,
  sales,
  sites,
  users,
} from '../../../db/schema.js';
import { ServerErrorWithCode, throwServerError } from '../../../lib/errorCodes.js';

import {
  LINE_ITEMS_SNAPSHOT_ROW_LIMIT,
  RESULT_ROW_LIMIT,
  SALES_SNAPSHOT_ROW_LIMIT,
} from './constants.js';
import { rejectSQL, resolveWindow, validateReadOnlySQL } from './sql.js';
import type {
  CopilotCellValue,
  CopilotChart,
  CopilotRow,
  CopilotSQLResult,
  CopilotWindow,
  SnapshotOptions,
  SnapshotRow,
} from './types.js';

function normalizeValue(value: unknown): CopilotCellValue {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value === 'boolean') {
    return value ? 1 : 0;
  }
  return String(value);
}

function normalizeRow(row: SnapshotRow): CopilotRow {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, normalizeValue(value)])
  );
}

function inferChart(columns: string[], rows: CopilotRow[]): CopilotChart | null {
  if (rows.length === 0 || rows.length > 25) {
    return null;
  }

  const valueKey = columns.find(column => rows.some(row => typeof row[column] === 'number'));
  if (!valueKey) {
    return null;
  }

  const labelKey =
    columns.find(
      column => column !== valueKey && rows.some(row => typeof row[column] === 'string')
    ) ??
    columns.find(column => column !== valueKey) ??
    null;
  if (!labelKey) {
    return null;
  }

  return { type: 'bar', labelKey, valueKey };
}

async function assertTenantSite(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string
): Promise<void> {
  const row = await db
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();

  if (!row) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_COPILOT_SQL_REJECTED',
      message: 'Requested analytics site is not available for this tenant',
    });
  }
}

async function loadSalesSnapshot(
  db: DatabaseInstance,
  tenantId: string,
  window: CopilotWindow,
  siteId: string | null
) {
  const filters: SQL[] = [
    eq(sales.tenantId, tenantId),
    eq(sales.status, 'completed'),
    gte(sales.createdAt, window.from),
    lte(sales.createdAt, window.to),
  ];
  if (siteId) {
    filters.push(eq(cashSessions.siteId, siteId));
  }

  const rows = await db
    .select({
      saleId: sales.id,
      saleNumber: sales.saleNumber,
      soldAt: sales.createdAt,
      siteId: cashSessions.siteId,
      siteName: sites.name,
      cashierId: users.id,
      cashierName: users.name,
      customerName: customers.name,
      subtotal: sales.subtotal,
      taxAmount: sales.taxAmount,
      discountAmount: sales.discountAmount,
      total: sales.total,
      paymentMethod: sales.paymentMethod,
      paymentStatus: sales.paymentStatus,
      status: sales.status,
    })
    .from(sales)
    .innerJoin(cashSessions, eq(sales.cashSessionId, cashSessions.id))
    .innerJoin(sites, eq(cashSessions.siteId, sites.id))
    .innerJoin(users, eq(sales.createdBy, users.id))
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .where(and(...filters))
    .orderBy(desc(sales.createdAt))
    .limit(SALES_SNAPSHOT_ROW_LIMIT + 1);

  if (rows.length > SALES_SNAPSHOT_ROW_LIMIT) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_COPILOT_QUERY_LIMIT_EXCEEDED',
      message: 'Analytics question needs a narrower date range or site filter',
      details: { rowLimit: SALES_SNAPSHOT_ROW_LIMIT },
    });
  }

  return rows;
}

async function loadLineItemSnapshot(
  db: DatabaseInstance,
  tenantId: string,
  window: CopilotWindow,
  siteId: string | null
) {
  const filters: SQL[] = [
    eq(sales.tenantId, tenantId),
    eq(sales.status, 'completed'),
    gte(sales.createdAt, window.from),
    lte(sales.createdAt, window.to),
  ];
  if (siteId) {
    filters.push(eq(cashSessions.siteId, siteId));
  }

  const rows = await db
    .select({
      saleId: sales.id,
      saleNumber: sales.saleNumber,
      soldAt: sales.createdAt,
      siteId: cashSessions.siteId,
      siteName: sites.name,
      productId: products.id,
      productName: products.name,
      sku: products.sku,
      quantity: saleItems.quantity,
      unitPrice: saleItems.unitPrice,
      discount: saleItems.discount,
      taxRate: saleItems.taxRate,
      taxAmount: saleItems.taxAmount,
      costAtSale: saleItems.costAtSale,
      lineTotal: saleItems.total,
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .innerJoin(cashSessions, eq(sales.cashSessionId, cashSessions.id))
    .innerJoin(sites, eq(cashSessions.siteId, sites.id))
    .innerJoin(products, eq(saleItems.productId, products.id))
    .where(and(...filters))
    .orderBy(desc(sales.createdAt))
    .limit(LINE_ITEMS_SNAPSHOT_ROW_LIMIT + 1);

  if (rows.length > LINE_ITEMS_SNAPSHOT_ROW_LIMIT) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_COPILOT_QUERY_LIMIT_EXCEEDED',
      message: 'Analytics question needs a narrower date range or site filter',
      details: { rowLimit: LINE_ITEMS_SNAPSHOT_ROW_LIMIT },
    });
  }

  return rows;
}

function createSnapshotDatabase() {
  // Route through the cached Node-ABI addon like initDatabase does, so the
  // analytics snapshot keeps working when the on-disk default carries the
  // Electron build (undefined under Electron → normal lookup).
  const sqlite = new Database(':memory:', {
    nativeBinding: resolveCachedNodeBinding(),
  });
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE sales_summary (
      sale_id TEXT PRIMARY KEY,
      sale_number TEXT NOT NULL,
      sold_at TEXT NOT NULL,
      sale_date TEXT NOT NULL,
      site_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      cashier_id TEXT NOT NULL,
      cashier_name TEXT NOT NULL,
      customer_name TEXT,
      subtotal REAL NOT NULL,
      tax_amount REAL NOT NULL,
      discount_amount REAL NOT NULL,
      total REAL NOT NULL,
      payment_method TEXT NOT NULL,
      payment_status TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE sale_line_items (
      sale_id TEXT NOT NULL,
      sale_number TEXT NOT NULL,
      sold_at TEXT NOT NULL,
      sale_date TEXT NOT NULL,
      site_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      sku TEXT NOT NULL,
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      discount REAL NOT NULL,
      tax_rate REAL NOT NULL,
      tax_amount REAL NOT NULL,
      cost_at_sale REAL NOT NULL,
      line_total REAL NOT NULL
    );

    CREATE INDEX idx_sales_summary_date_site ON sales_summary(sale_date, site_name);
    CREATE INDEX idx_sale_line_items_date_site ON sale_line_items(sale_date, site_name);
    CREATE INDEX idx_sale_line_items_product ON sale_line_items(product_name);
  `);
  return sqlite;
}

function insertSnapshotRows(
  sqlite: Database.Database,
  saleRows: Awaited<ReturnType<typeof loadSalesSnapshot>>,
  lineRows: Awaited<ReturnType<typeof loadLineItemSnapshot>>
) {
  const insertSale = sqlite.prepare(`
    INSERT INTO sales_summary (
      sale_id, sale_number, sold_at, sale_date, site_id, site_name,
      cashier_id, cashier_name, customer_name, subtotal, tax_amount,
      discount_amount, total, payment_method, payment_status, status
    ) VALUES (
      @saleId, @saleNumber, @soldAt, date(@soldAt), @siteId, @siteName,
      @cashierId, @cashierName, @customerName, @subtotal, @taxAmount,
      @discountAmount, @total, @paymentMethod, @paymentStatus, @status
    )
  `);
  const insertLine = sqlite.prepare(`
    INSERT INTO sale_line_items (
      sale_id, sale_number, sold_at, sale_date, site_id, site_name,
      product_id, product_name, sku, quantity, unit_price, discount,
      tax_rate, tax_amount, cost_at_sale, line_total
    ) VALUES (
      @saleId, @saleNumber, @soldAt, date(@soldAt), @siteId, @siteName,
      @productId, @productName, @sku, @quantity, @unitPrice, @discount,
      @taxRate, @taxAmount, @costAtSale, @lineTotal
    )
  `);

  const tx = sqlite.transaction(() => {
    for (const row of saleRows) {
      insertSale.run(row);
    }
    for (const row of lineRows) {
      insertLine.run(row);
    }
  });
  tx();
}

export async function runReadOnlySQL(
  db: DatabaseInstance,
  tenantId: string,
  options: SnapshotOptions,
  now: Date = new Date()
): Promise<CopilotSQLResult> {
  const safeQuery = validateReadOnlySQL(options.query);
  const window = resolveWindow(options.context, now);
  const requestedSiteId = options.context?.siteId ?? null;
  if (requestedSiteId) {
    await assertTenantSite(db, tenantId, requestedSiteId);
  }

  const [saleRows, lineRows] = await Promise.all([
    loadSalesSnapshot(db, tenantId, window, requestedSiteId),
    loadLineItemSnapshot(db, tenantId, window, requestedSiteId),
  ]);

  const sqlite = createSnapshotDatabase();
  try {
    insertSnapshotRows(sqlite, saleRows, lineRows);
    sqlite.pragma('query_only = ON');

    const cappedQuery = `SELECT * FROM (${safeQuery}) LIMIT ${RESULT_ROW_LIMIT + 1}`;
    const statement = sqlite.prepare(cappedQuery);
    const rawRows = statement.all() as SnapshotRow[];
    const truncated = rawRows.length > RESULT_ROW_LIMIT;
    const rows = rawRows.slice(0, RESULT_ROW_LIMIT).map(normalizeRow);
    const columns = statement.columns().map(column => column.name);

    return {
      sql: safeQuery,
      columns,
      rows,
      rowCount: rows.length,
      truncated,
      chart: inferChart(columns, rows),
      window,
    };
  } catch (error) {
    if (
      error instanceof TRPCError ||
      (error instanceof Error && error.cause instanceof ServerErrorWithCode)
    ) {
      throw error;
    }
    rejectSQL(error instanceof Error ? error.message : 'Analytics SQL failed');
  } finally {
    sqlite.close();
  }
}
