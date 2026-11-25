/**
 * Building blocks shared by the commands that repartition suspended drafts:
 * `sales.splitDraft` and `restaurantServices.regroupChecks`.
 *
 * @module application/sales/draft-split
 */
import { and, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { cashSessions, salePayments, sales, sequentials, sites } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { allocateNextSequential } from '../../services/sequential-allocation.js';

/** Only a transaction handle can allocate a document number. */
export type DraftSplitTransaction = Parameters<Parameters<DatabaseInstance['transaction']>[0]>[0];
type SaleRow = typeof sales.$inferSelect;

/** A draft whose frozen amounts cannot be repartitioned. */
export function invalidDraftSplit(message: string, details?: Record<string, unknown>): never {
  throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'SALE_SPLIT_INVALID_STATUS',
    message,
    ...(details ? { details } : {}),
  });
}

/** The stored header must equal its own arithmetic and the gross of its frozen lines. */
export function assertDraftHeaderMatchesLines(
  sale: Pick<
    SaleRow,
    | 'id'
    | 'subtotal'
    | 'taxAmount'
    | 'discountAmount'
    | 'tipAmount'
    | 'serviceChargeAmount'
    | 'total'
  >,
  lines: { count: number; gross: number }
): void {
  const expectedTotal = roundMoney(
    sale.subtotal + sale.taxAmount - sale.discountAmount + sale.tipAmount + sale.serviceChargeAmount
  );
  const storedGross = roundMoney(sale.subtotal + sale.taxAmount);
  if (
    lines.count === 0 ||
    !Number.isFinite(expectedTotal) ||
    expectedTotal !== roundMoney(sale.total) ||
    roundMoney(lines.gross) !== storedGross
  ) {
    invalidDraftSplit('The suspended draft header is inconsistent with its frozen amounts', {
      saleId: sale.id,
      lineCount: lines.count,
      expectedTotal,
      storedTotal: sale.total,
      lineGross: lines.gross,
      storedGross,
    });
  }
}

/**
 * Customer-value tenders are only valid on a completed sale and carry
 * indivisible ledger references, so a draft holding one fails closed.
 */
export function assertDraftTenderDivisible(sale: Pick<SaleRow, 'paymentMethod'>): void {
  if (sale.paymentMethod === 'loyalty' || sale.paymentMethod === 'store_credit') {
    invalidDraftSplit('Customer-value tenders cannot be split on a draft sale', {
      paymentMethod: sale.paymentMethod,
    });
  }
}

/** Site of each cash session, in one query. */
export function readCashSessionSites(
  tx: DatabaseInstance,
  tenantId: string,
  cashSessionIds: readonly string[]
): Map<string, string> {
  if (cashSessionIds.length === 0) return new Map();
  return new Map(
    tx
      .select({ id: cashSessions.id, siteId: cashSessions.siteId })
      .from(cashSessions)
      .where(
        and(eq(cashSessions.tenantId, tenantId), inArray(cashSessions.id, [...cashSessionIds]))
      )
      .all()
      .map(session => [session.id, session.siteId] as const)
  );
}

/** A draft's register and its table must sit at the same site when both are known. */
export function assertDraftSessionAtTableSite(
  sessionSiteId: string | null | undefined,
  tableSiteId: string | null | undefined
): void {
  if (sessionSiteId && tableSiteId && sessionSiteId !== tableSiteId) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'Draft cash session and restaurant table belong to different sites',
    });
  }
}

/**
 * The active sale sequential of a site, or the given one re-validated
 * against it. One definition keeps the tenant predicate on `sites`.
 */
export function requireActiveSaleSequential(
  tx: DatabaseInstance,
  args: { tenantId: string; siteId: string; sequentialId?: string }
): string {
  const row = tx
    .select({ id: sequentials.id })
    .from(sequentials)
    .innerJoin(sites, eq(sequentials.siteId, sites.id))
    .where(
      and(
        eq(sequentials.tenantId, args.tenantId),
        eq(sequentials.documentType, 'sale'),
        eq(sequentials.siteId, args.siteId),
        eq(sites.tenantId, args.tenantId),
        eq(sites.isActive, true),
        ...(args.sequentialId ? [eq(sequentials.id, args.sequentialId)] : [])
      )
    )
    .get();
  if (!row) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_SEQUENTIAL_MISSING',
      message: 'No active sale sequential is configured for the draft source site',
    });
  }
  return row.id;
}

/**
 * Insert an empty suspended draft that inherits the commercial terms of
 * `source` (customer, tier, currency seam, tender, register, author). The
 * caller moves lines in and then writes the header amounts.
 */
export function insertSuspendedChildDraft(
  transaction: DraftSplitTransaction,
  args: {
    tenantId: string;
    source: SaleRow;
    sequentialId: string;
    tableId: string | null;
    label: string | null;
    actorId: string;
    now: string;
    id?: string;
  }
): SaleRow {
  const { source, now } = args;
  const saleNumber = allocateNextSequential(transaction, {
    tenantId: args.tenantId,
    sequentialId: args.sequentialId,
    updatedAt: now,
  }).number;
  return transaction
    .insert(sales)
    .values({
      id: args.id ?? nanoid(),
      tenantId: args.tenantId,
      saleNumber,
      customerId: source.customerId ?? null,
      priceTier: source.priceTier,
      tableId: args.tableId,
      subtotal: 0,
      taxAmount: 0,
      discountAmount: 0,
      total: 0,
      // A child never crosses currencies: its lines stay priced as they were.
      currencyCode: source.currencyCode,
      exchangeRateAtSale: source.exchangeRateAtSale,
      settleCurrencyCode: source.settleCurrencyCode,
      paymentMethod: source.paymentMethod,
      paymentStatus: 'pending',
      status: 'draft',
      cashSessionId: source.cashSessionId,
      notes: null,
      suspendedAt: now,
      suspendedBy: args.actorId,
      suspendedLabel: args.label,
      createdBy: source.createdBy,
      syncStatus: 'pending',
      syncVersion: 1,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

/**
 * Replace a draft's provisional tender with one row for its new total, so
 * `sale_payments` keeps describing the bill. A null amount only clears it.
 */
export function rebuildProvisionalDraftPayment(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    saleId: string;
    method: SaleRow['paymentMethod'];
    amount: number | null;
    now: string;
  }
): void {
  tx.delete(salePayments)
    .where(and(eq(salePayments.tenantId, args.tenantId), eq(salePayments.saleId, args.saleId)))
    .run();
  if (args.amount === null) return;
  tx.insert(salePayments)
    .values({
      id: nanoid(),
      tenantId: args.tenantId,
      saleId: args.saleId,
      method: args.method,
      amount: args.amount,
      reference: null,
      loyaltyPoints: null,
      syncStatus: 'pending',
      syncVersion: 1,
      createdAt: args.now,
    })
    .run();
}
