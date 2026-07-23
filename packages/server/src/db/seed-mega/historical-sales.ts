/**
 * MEGA seed: historical sales + items + payments + audit
 * trail.
 *
 * Bulk-inserts ~`salesPerActiveDay` sales per closed cash session.
 * Each sale carries 1-4 items, a single payment row, and produces
 * matching audit_logs. ~10% of completed sales also receive a
 * `sale_returns` row + a refund audit row; ~5% are voided (status
 * flipped to `voided` + audit row).
 *
 * Bulk SQL bypasses the live `sales.create` orchestration — historical
 * data is pre-shaped so we don't pay the per-row tRPC cost. The
 * recent-via-tRPC pass (last 3 days) exercises the envelope path so
 * idempotency / audit / fiscal stay verified end-to-end.
 *
 * @module db/seed-mega/historical-sales
 */

import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import {
  auditLogs,
  customerLedgerEntries,
  inventoryMovements,
  paymentMethodEnum,
  saleItems,
  salePayments,
  saleReturns,
  sales,
  saleStatusEnum,
  sequentials,
} from '../schema.js';

type PaymentMethod = (typeof paymentMethodEnum)[number];
type SaleStatus = (typeof saleStatusEnum)[number];
import { businessHourIso, laterIso } from './time-helpers.js';
import type { MegaContext, MegaTarget } from './types.js';

interface CreatedHistoricalSales {
  salesCount: number;
  refundsCount: number;
  voidsCount: number;
  auditRowsCount: number;
  inventoryMovementsCount: number;
  customerLedgerEntriesCount: number;
}

interface ClosedSession {
  id: string;
  siteId: string;
  cashierId: string;
  daysAgo: number;
  openedAtIso: string;
  closedAtIso: string;
}

const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'transfer', 'credit'];

export async function seedHistoricalSales(
  ctx: MegaContext,
  target: MegaTarget,
  closedSessions: ClosedSession[]
): Promise<CreatedHistoricalSales> {
  const { db, clock, tenantId, products, customers, sites } = ctx;
  if (closedSessions.length === 0) {
    return {
      salesCount: 0,
      refundsCount: 0,
      voidsCount: 0,
      auditRowsCount: 0,
      inventoryMovementsCount: 0,
      customerLedgerEntriesCount: 0,
    };
  }

  // ----- Per-site sale-number sequentials -----
  // Reuse the existing per-site sequentials so every fresh row gets a
  // monotonically increasing `saleNumber`. The seed reads the current
  // value, computes the new max, and writes it back at the end so we
  // don't fight Drizzle for one-row updates per insert.
  const siteSequentialMap = new Map<string, { id: string; prefix: string; current: number }>();
  for (const site of sites) {
    const seq = await db.select().from(sequentials).where(eq(sequentials.tenantId, tenantId)).all();
    const sitePrefixed = seq.find(s => s.siteId === site.id);
    if (sitePrefixed) {
      siteSequentialMap.set(site.id, {
        id: sitePrefixed.id,
        prefix: sitePrefixed.prefix,
        current: sitePrefixed.currentValue,
      });
    } else {
      // Fallback when seq doesn't exist — should not happen in MEGA
      // because the foundation seed creates them.
      siteSequentialMap.set(site.id, {
        id: nanoid(),
        prefix: `VTA-${site.name.slice(0, 1)}-`,
        current: 0,
      });
    }
  }

  const saleRows: Array<typeof sales.$inferInsert> = [];
  const itemRows: Array<typeof saleItems.$inferInsert> = [];
  const paymentRows: Array<typeof salePayments.$inferInsert> = [];
  const movementRows: Array<typeof inventoryMovements.$inferInsert> = [];
  const returnRows: Array<typeof saleReturns.$inferInsert> = [];
  const auditRows: Array<typeof auditLogs.$inferInsert> = [];
  const ledgerRows: Array<typeof customerLedgerEntries.$inferInsert> = [];

  let salesCount = 0;
  let refundsCount = 0;
  let voidsCount = 0;
  let movementsCount = 0;

  // Synthetic running stock per product to keep newStock/previousStock
  // monotonic-ish. We don't strictly track real stock here — historical
  // data is allowed to drift; the smoke does not expect coherent stock
  // history pre-recent.
  const stockSnapshot = new Map<string, number>();
  for (const p of products) stockSnapshot.set(p.id, p.initialStock);

  closedSessions.forEach((session, sessionIdx) => {
    const salesForSession = target.salesPerActiveDay;

    for (let i = 0; i < salesForSession; i += 1) {
      const ledgerSeed = (sessionIdx * 31 + i * 7) % 1000;
      const isVoid = ledgerSeed < target.voidRate * 1000;
      const isRefunded = !isVoid && ledgerSeed < (target.voidRate + target.refundRate) * 1000;

      const itemsCount = 1 + (ledgerSeed % 4);
      const customerIdx = ledgerSeed % (customers.length || 1);
      const customer = customers[customerIdx];
      const paymentMethod = PAYMENT_METHODS[(ledgerSeed >> 1) % PAYMENT_METHODS.length]!;

      const saleId = nanoid();
      const baseAtIso = businessHourIso(clock, session.daysAgo, sessionIdx * 17 + i);

      // Build items
      let subtotal = 0;
      let taxAmount = 0;
      const builtItems: Array<{
        id: string;
        productId: string;
        quantity: number;
        unitPrice: number;
        taxRate: number;
        cost: number;
        total: number;
        taxLine: number;
        previousStock: number;
        newStock: number;
      }> = [];
      for (let li = 0; li < itemsCount; li += 1) {
        const product = products[(ledgerSeed * 13 + li * 5) % products.length]!;
        const quantity = 1 + ((ledgerSeed + li) % 4);
        const lineSubtotal = product.price * quantity;
        const lineTax = lineSubtotal * (product.taxRate / 100);
        const lineTotal = lineSubtotal + lineTax;
        subtotal += lineSubtotal;
        taxAmount += lineTax;

        const previousStock = stockSnapshot.get(product.id) ?? 0;
        const newStock = Math.max(0, previousStock - quantity);
        stockSnapshot.set(product.id, newStock);

        builtItems.push({
          id: nanoid(),
          productId: product.id,
          quantity,
          unitPrice: product.price,
          taxRate: product.taxRate,
          cost: product.cost,
          total: lineTotal,
          taxLine: lineTax,
          previousStock,
          newStock,
        });
      }

      const total = subtotal + taxAmount;

      // ----- Sequential bump per-site -----
      const seqEntry = siteSequentialMap.get(session.siteId)!;
      seqEntry.current += 1;
      const saleNumber = `${seqEntry.prefix}${String(seqEntry.current).padStart(6, '0')}`;

      const status: SaleStatus = isVoid ? 'voided' : 'completed';

      saleRows.push({
        id: saleId,
        tenantId,
        saleNumber,
        customerId: customer ? customer.id : null,
        subtotal,
        taxAmount,
        discountAmount: 0,
        total,
        paymentMethod,
        paymentStatus: isVoid || isRefunded ? 'refunded' : 'paid',
        status,
        cashSessionId: session.id,
        notes: isVoid
          ? 'Anulada por seed mega — testeo audit log'
          : isRefunded
            ? 'Devuelta por seed mega'
            : null,
        createdBy: session.cashierId,
        createdAt: baseAtIso,
        updatedAt: laterIso(baseAtIso, 60_000),
      });

      builtItems.forEach(item => {
        itemRows.push({
          id: item.id,
          saleId,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          unitId: products.find(p => p.id === item.productId)?.baseUnitId,
          unitEquivalence: 1,
          discount: 0,
          taxRate: item.taxRate,
          taxAmount: item.taxLine,
          costAtSale: item.cost,
          total: item.total,
        });
        movementRows.push({
          id: nanoid(),
          tenantId,
          productId: item.productId,
          type: 'sale',
          quantity: -item.quantity,
          previousStock: item.previousStock,
          newStock: item.newStock,
          reference: saleNumber,
          notes: 'Venta histórica seed mega',
          createdBy: session.cashierId,
          createdAt: baseAtIso,
        });
      });
      movementsCount += builtItems.length;

      paymentRows.push({
        id: nanoid(),
        tenantId,
        saleId,
        method: paymentMethod,
        amount: total,
        reference: paymentMethod === 'card' ? `AUTH-${ledgerSeed.toString(16)}` : null,
        createdAt: baseAtIso,
      });

      // Historical credit sales must exercise the same receivable read model
      // as live sales. Reversal rows preserve an append-only, zero-net trail
      // for returned/voided credit tickets instead of erasing the event.
      if (paymentMethod === 'credit' && customer) {
        ledgerRows.push({
          id: nanoid(),
          tenantId,
          customerId: customer.id,
          occurredAt: baseAtIso,
          kind: 'sale',
          amount: total,
          referenceSaleId: saleId,
          note: 'Venta a crédito histórica seed mega',
          createdBy: session.cashierId,
          createdAt: baseAtIso,
        });
      }

      // sale.create audit row
      auditRows.push({
        id: nanoid(),
        tenantId,
        actorId: session.cashierId,
        action: 'sale.create',
        resourceType: 'sale',
        resourceId: saleId,
        before: null,
        after: { saleNumber, total, paymentMethod },
        metadata: { itemsCount: builtItems.length, siteId: session.siteId },
        createdAt: baseAtIso,
      });

      if (isRefunded) {
        const returnId = nanoid();
        const refundedAtIso = laterIso(baseAtIso, 3 * 60 * 60 * 1000);
        const refundAmount = total;
        returnRows.push({
          id: returnId,
          tenantId,
          saleId,
          refundAmount,
          reason: 'Cliente devolvió producto — seed mega',
          createdBy: ctx.managers[0]?.id ?? session.cashierId,
          createdAt: refundedAtIso,
          updatedAt: refundedAtIso,
        });
        // Reverse inventory movement
        builtItems.forEach(item => {
          movementRows.push({
            id: nanoid(),
            tenantId,
            productId: item.productId,
            type: 'return',
            quantity: item.quantity,
            previousStock: item.newStock,
            newStock: item.newStock + item.quantity,
            reference: saleNumber,
            notes: 'Devolución seed mega',
            createdBy: ctx.managers[0]?.id ?? session.cashierId,
            createdAt: refundedAtIso,
          });
          stockSnapshot.set(
            item.productId,
            (stockSnapshot.get(item.productId) ?? 0) + item.quantity
          );
        });
        movementsCount += builtItems.length;
        // sale.return audit row
        auditRows.push({
          id: nanoid(),
          tenantId,
          actorId: ctx.managers[0]?.id ?? session.cashierId,
          action: 'sale.return',
          resourceType: 'sale',
          resourceId: saleId,
          before: { status: 'completed', paymentStatus: 'paid' },
          after: {
            status: 'completed',
            paymentStatus: 'refunded',
            refundedAmount: refundAmount,
            returnId,
          },
          metadata: { reason: 'Cliente devolvió producto' },
          createdAt: refundedAtIso,
        });
        if (paymentMethod === 'credit' && customer) {
          ledgerRows.push({
            id: nanoid(),
            tenantId,
            customerId: customer.id,
            occurredAt: refundedAtIso,
            kind: 'adjustment',
            amount: -refundAmount,
            referenceSaleId: saleId,
            note: 'Reversión por devolución histórica seed mega',
            createdBy: ctx.managers[0]?.id ?? session.cashierId,
            createdAt: refundedAtIso,
          });
        }
        refundsCount += 1;
      }

      if (isVoid) {
        const voidedAtIso = laterIso(baseAtIso, 30 * 60 * 1000);
        // Inventory reversal for void
        builtItems.forEach(item => {
          movementRows.push({
            id: nanoid(),
            tenantId,
            productId: item.productId,
            type: 'adjustment',
            quantity: item.quantity,
            previousStock: item.newStock,
            newStock: item.newStock + item.quantity,
            reference: saleNumber,
            notes: 'Anulación seed mega',
            createdBy: ctx.managers[0]?.id ?? session.cashierId,
            createdAt: voidedAtIso,
          });
          stockSnapshot.set(
            item.productId,
            (stockSnapshot.get(item.productId) ?? 0) + item.quantity
          );
        });
        movementsCount += builtItems.length;
        // sale.void audit row
        auditRows.push({
          id: nanoid(),
          tenantId,
          actorId: ctx.adminUserId,
          action: 'sale.void',
          resourceType: 'sale',
          resourceId: saleId,
          before: { status: 'completed', paymentStatus: 'paid', total },
          after: { status: 'voided', paymentStatus: 'refunded' },
          metadata: { reason: 'Error operativo — seed mega' },
          createdAt: voidedAtIso,
        });
        if (paymentMethod === 'credit' && customer) {
          ledgerRows.push({
            id: nanoid(),
            tenantId,
            customerId: customer.id,
            occurredAt: voidedAtIso,
            kind: 'adjustment',
            amount: -total,
            referenceSaleId: saleId,
            note: 'Reversión por anulación histórica seed mega',
            createdBy: ctx.adminUserId,
            createdAt: voidedAtIso,
          });
        }
        voidsCount += 1;
      }

      salesCount += 1;
    }
  });

  // ----- Persist in chunks -----
  await chunkedInsert(db, sales, saleRows);
  await chunkedInsert(db, saleItems, itemRows);
  await chunkedInsert(db, salePayments, paymentRows);
  await chunkedInsert(db, inventoryMovements, movementRows);
  await chunkedInsert(db, saleReturns, returnRows);
  await chunkedInsert(db, auditLogs, auditRows);
  await chunkedInsert(db, customerLedgerEntries, ledgerRows);

  // ----- Bump the sequentials so future tRPC sales pick up after the seed -----
  for (const [, entry] of siteSequentialMap) {
    await db
      .update(sequentials)
      .set({ currentValue: entry.current, updatedAt: clock.nowIso })
      .where(eq(sequentials.id, entry.id))
      .run();
  }

  return {
    salesCount,
    refundsCount,
    voidsCount,
    auditRowsCount: auditRows.length,
    inventoryMovementsCount: movementsCount,
    customerLedgerEntriesCount: ledgerRows.length,
  };
}

async function chunkedInsert<T extends Record<string, unknown>>(
  db: MegaContext['db'],
  table: Parameters<typeof db.insert>[0],
  rows: T[]
): Promise<void> {
  if (rows.length === 0) return;
  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- reason: seed bulk-insert into a parametric Drizzle table (Parameters<typeof db.insert>[0]); the generic-table builder rejects the typed ref. Seed-only, exempt per .
    await (db.insert(table) as any).values(chunk).run();
  }
}
