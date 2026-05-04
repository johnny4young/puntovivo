/**
 * ENG-054 — Post-commit sale reader.
 *
 * `getSaleRecord` is the canonical read used by the sale lifecycle to
 * return a fully-hydrated sale (header + items + payments + return
 * info) to the caller. It used to live as a private helper in
 * `trpc/routers/sales.ts`; ENG-054 moved it here so the application
 * service can call it without depending on the router file.
 *
 * The function is a pure read — it does not write, does not throw on
 * not-found at the DB layer. It throws `SALE_NOT_FOUND` when the
 * sale row is missing so callers can handle the same error code
 * everywhere.
 *
 * @module application/sales/sale-read
 */

import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  customers,
  products,
  salePayments,
  saleItems,
  saleReturns,
  sales,
  units,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';

export async function getSaleRecord(
  db: DatabaseInstance,
  tenantId: string,
  saleId: string
) {
  const sale = await db
    .select({
      id: sales.id,
      tenantId: sales.tenantId,
      saleNumber: sales.saleNumber,
      customerId: sales.customerId,
      customerName: customers.name,
      subtotal: sales.subtotal,
      taxAmount: sales.taxAmount,
      discountAmount: sales.discountAmount,
      total: sales.total,
      paymentMethod: sales.paymentMethod,
      paymentStatus: sales.paymentStatus,
      status: sales.status,
      notes: sales.notes,
      createdBy: sales.createdBy,
      // ENG-018 — park-and-resume bookkeeping. Surfacing these on the
      // read side lets the resume panel and the sale-details modal show
      // who suspended the draft without a second round trip.
      suspendedAt: sales.suspendedAt,
      suspendedBy: sales.suspendedBy,
      suspendedLabel: sales.suspendedLabel,
      // ENG-019 — reprint counters drive the "reimpresa N veces" banner.
      reprintCount: sales.reprintCount,
      lastReprintedAt: sales.lastReprintedAt,
      lastReprintedBy: sales.lastReprintedBy,
      syncStatus: sales.syncStatus,
      syncVersion: sales.syncVersion,
      createdAt: sales.createdAt,
      updatedAt: sales.updatedAt,
      returnId: saleReturns.id,
      returnReason: saleReturns.reason,
      refundAmount: saleReturns.refundAmount,
      returnedAt: saleReturns.createdAt,
    })
    .from(sales)
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .leftJoin(saleReturns, eq(saleReturns.saleId, sales.id))
    .where(and(eq(sales.id, saleId), eq(sales.tenantId, tenantId)))
    .get();

  if (!sale) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'SALE_NOT_FOUND',
      message: 'Sale not found',
    });
  }

  const items = await db
    .select({
      id: saleItems.id,
      saleId: saleItems.saleId,
      productId: saleItems.productId,
      productName: products.name,
      productSku: products.sku,
      quantity: saleItems.quantity,
      unitPrice: saleItems.unitPrice,
      unitId: saleItems.unitId,
      unitEquivalence: saleItems.unitEquivalence,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      discount: saleItems.discount,
      taxRate: saleItems.taxRate,
      taxAmount: saleItems.taxAmount,
      costAtSale: saleItems.costAtSale,
      total: saleItems.total,
    })
    .from(saleItems)
    .leftJoin(products, eq(saleItems.productId, products.id))
    .leftJoin(units, eq(saleItems.unitId, units.id))
    .where(eq(saleItems.saleId, saleId))
    .all();

  // Phase 2 Tier-2 step 5 — every sale has at least one payment row now.
  const payments = await db
    .select({
      id: salePayments.id,
      method: salePayments.method,
      amount: salePayments.amount,
      reference: salePayments.reference,
      createdAt: salePayments.createdAt,
    })
    .from(salePayments)
    .where(eq(salePayments.saleId, saleId))
    .orderBy(salePayments.createdAt)
    .all();

  return { ...sale, items, payments };
}
