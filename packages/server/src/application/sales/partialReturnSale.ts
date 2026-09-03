/** Normalized partial-return service with immutable provenance. */
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  cashMovements,
  cashSessions,
  customerLedgerEntries,
  inventoryMovements,
  inventoryLots,
  loyaltyAccounts,
  loyaltyMovements,
  operationEvents,
  productSerials,
  saleReturnItemLots,
  saleReturnItemSerials,
  saleReturnItemTaxComponents,
  saleReturnItems,
  saleReturnPaymentAllocations,
  saleReturns,
  sales,
  storeCreditAccounts,
  storeCreditMovements,
} from '../../db/schema.js';
import { getProductStockTotals } from '../../services/inventory-balances.js';
import { restorePointsForReturn, revertPointsForReturn } from '../../services/loyalty.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  assertCashSessionStillOpen,
  insertCashMovement,
  requireActiveCashSession,
} from '../../services/cash-session.js';
import {
  insertFiscalIntentInTransaction,
  prepareSaleFiscalIntent,
} from '../../services/fiscal/orchestrator.js';
import type { ResolvedLine } from '../../services/fiscal/orchestrator/types.js';
import { createModuleLogger } from '../../logging/logger.js';
import { buildReturnedSaleNotes } from './policies.js';
import { reverseSaleItemsStock } from './inventory-policy.js';
import { broadcastSaleRetracted, materializeCommittedFiscalIntent } from './fiscalPostHook.js';
import { calculateRestoredInventoryLotState } from '../../services/inventory-lots/index.js';
import { getOriginalDeeCufe } from './fiscal-policy.js';
import { emitCompleteSaleEffects, type JournalEffectInput } from './journal-effects.js';
import { getSaleRecord } from './sale-read.js';
import { updateOperationSummary } from '../../services/operation-journal/journal.js';
import type { CompleteSaleContext, CompleteSaleLogger, CompleteSaleResult } from './types.js';
import type { CompleteSaleSaleRecord } from './completeSale.js';
import {
  consumeManagerApprovalGrant,
  enqueueConsumedManagerApprovalBestEffort,
  releaseManagerApprovalClaim,
} from '../../services/manager-approvals.js';
import {
  claimShiftLossPreventionApproval,
  evaluateShiftLossPrevention,
  recordShiftLossPreventionTrigger,
} from '../../services/loss-prevention/index.js';
import {
  buildReturnPlan,
  type ReturnDestination,
  type ReturnExternalReferenceInput,
  type ReturnLineInput,
  type ReturnPlan,
} from './return-planner.js';
import {
  issueStoreCreditForReturn,
  restoreStoreCreditForReturn,
} from '../../services/store-credit.js';
import { createSaleReturnCommandResultRef } from '../../services/idempotency/commandResultRef.js';

const fallbackLog = createModuleLogger('application/sales/returnSale');

async function lookupJournalEventId(
  db: DatabaseInstance,
  tenantId: string,
  operationId: string | undefined
): Promise<string | null> {
  if (!operationId) return null;
  const row = await db
    .select({ id: operationEvents.id })
    .from(operationEvents)
    .where(
      and(eq(operationEvents.tenantId, tenantId), eq(operationEvents.operationId, operationId))
    )
    .get();
  return row?.id ?? null;
}

async function safeUpdateSaleReturnedSummary(
  ctx: CompleteSaleContext,
  log: CompleteSaleLogger,
  journalEventId: string,
  summary: {
    saleReturnId: string;
    originalSaleId: string;
    siteId: string;
    cashSessionId: string | null;
    refundedAmount: number;
    currencyCode: string;
    reasonCode: string | null;
    fullyReturned: boolean;
  }
): Promise<void> {
  try {
    await updateOperationSummary(ctx.db, journalEventId, {
      ...summary,
    });
  } catch (err) {
    log.warn({ err, journalEventId }, 'operation summary update failed (non-blocking)');
  }
}

export interface ReturnSaleInput {
  id: string;
  reason?: string | null | undefined;
  approvalRequestId?: string | undefined;
  items?: ReturnLineInput[] | undefined;
  destination?: ReturnDestination | undefined;
  externalReferences?: ReturnExternalReferenceInput[] | undefined;
}

/** The pre-commit fiscal payload is built from the same immutable return plan. */
function buildReturnFiscalLines(plan: ReturnPlan): ResolvedLine[] {
  const lines: ResolvedLine[] = plan.lines.map((line, index) => ({
    lineNumber: index + 1,
    productId: line.productId,
    productName: line.productNameSnapshot,
    productSku: line.productSkuSnapshot,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountAmount: line.discountAmount,
    taxRate: line.taxRate,
    taxKind: line.taxKind,
    taxAmount: line.taxAmount,
    taxComponents: line.taxComponents,
    lineTotal: line.total,
    unitStandardCode: line.unitStandardCode,
  }));
  for (const [kind, amount] of [
    ['tip', plan.tipAmount],
    ['service_charge', plan.serviceChargeAmount],
  ] as const) {
    if (amount <= 0) continue;
    lines.push({
      lineNumber: lines.length + 1,
      productId: null,
      productName: kind === 'tip' ? 'Propina' : 'Cargo por servicio',
      productSku: null,
      quantity: 1,
      unitPrice: amount,
      discountAmount: 0,
      taxRate: 0,
      taxKind: 'iva',
      taxAmount: 0,
      taxComponents: [
        {
          componentKey: `return-adjustment:${kind}`,
          vatRateId: null,
          taxKind: 'iva',
          taxRate: 0,
          taxableAmount: amount,
          taxAmount: 0,
          position: 0,
        },
      ],
      lineTotal: amount,
      unitStandardCode: 'EA',
    });
  }
  return lines;
}

export async function previewSaleReturn(
  db: DatabaseInstance,
  tenantId: string,
  activeSiteId: string | null,
  input: Pick<ReturnSaleInput, 'id' | 'items' | 'destination'>
) {
  if (!activeSiteId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CASH_SESSION_SITE_REQUIRED',
      message: 'Select an active site before preparing a return',
    });
  }
  const sale = await db
    .select()
    .from(sales)
    .where(and(eq(sales.id, input.id), eq(sales.tenantId, tenantId)))
    .get();
  assertReturnableSale(sale);
  const destination = input.destination ?? 'original';
  if (destination === 'store_credit' && !sale.customerId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_RETURN_CUSTOMER_REQUIRED',
      message: 'Store credit requires a customer on the original sale',
    });
  }
  const plan = buildReturnPlan(db, tenantId, sale, {
    items: input.items,
    destination,
    // Provider references are final-command evidence. A read-only preview
    // must not transport them merely to calculate which tender portions
    // actually need external confirmation.
    requireExternalReferences: false,
  });
  const originalSession = sale.cashSessionId
    ? await db
        .select({ siteId: cashSessions.siteId })
        .from(cashSessions)
        .where(and(eq(cashSessions.tenantId, tenantId), eq(cashSessions.id, sale.cashSessionId)))
        .get()
    : null;
  if (originalSession && originalSession.siteId !== activeSiteId) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'SALE_RETURN_SITE_MISMATCH',
      message: 'Returns must be processed at the original sale site',
    });
  }
  if (plan.lines.some(line => line.tracksStock) && !originalSession) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'SALE_RETURN_SITE_REQUIRED',
      message: 'The original inventory site is unavailable; stock was not changed',
    });
  }
  return plan;
}

function assertReturnableSale(existing: typeof sales.$inferSelect | undefined): asserts existing {
  if (!existing) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'SALE_NOT_FOUND',
      message: 'Sale not found',
    });
  }
  if (existing.status === 'voided') {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_RETURN_VOIDED_FORBIDDEN',
      message: 'Voided sales cannot be refunded',
    });
  }
  if (existing.status !== 'completed') {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_RETURN_NOT_COMPLETED',
      message: 'Only completed sales can be refunded',
    });
  }
  if (existing.paymentStatus === 'refunded') {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_RETURN_ALREADY_REFUNDED',
      message: 'Sale is already fully refunded',
    });
  }
}

function persistReturnLines(
  tx: DatabaseInstance,
  input: { tenantId: string; returnId: string; plan: ReturnPlan; now: string }
): { restoredLotIds: string[]; returnedSerialIds: string[] } {
  const restoredLotIds = new Set<string>();
  const returnedSerialIds: string[] = [];
  for (const line of input.plan.lines) {
    const returnItemId = nanoid();
    tx.insert(saleReturnItems)
      .values({
        id: returnItemId,
        tenantId: input.tenantId,
        saleReturnId: input.returnId,
        saleItemId: line.saleItemId,
        productId: line.productId,
        productNameSnapshot: line.productNameSnapshot,
        productSkuSnapshot: line.productSkuSnapshot,
        quantity: line.quantity,
        baseQuantity: line.baseQuantity,
        unitPrice: line.unitPrice,
        unitEquivalence: line.unitEquivalence,
        unitStandardCode: line.unitStandardCode,
        discountRate: line.discountRate,
        taxKind: line.taxKind,
        taxRate: line.taxRate,
        subtotal: line.subtotal,
        discountAmount: line.discountAmount,
        taxAmount: line.taxAmount,
        total: line.total,
        costAmount: line.costAmount,
        currencyCode: line.currencyCode,
        createdAt: input.now,
      })
      .run();
    for (const component of line.taxComponents) {
      tx.insert(saleReturnItemTaxComponents)
        .values({
          id: nanoid(),
          tenantId: input.tenantId,
          saleReturnItemId: returnItemId,
          componentKey: component.componentKey,
          vatRateId: component.vatRateId,
          taxKind: component.taxKind,
          taxRate: component.taxRate,
          taxableAmount: component.taxableAmount,
          taxAmount: component.taxAmount,
          position: component.position,
          createdAt: input.now,
        })
        .run();
    }
    for (const allocation of line.lots) {
      const lot = tx
        .select()
        .from(inventoryLots)
        .where(
          and(eq(inventoryLots.tenantId, input.tenantId), eq(inventoryLots.id, allocation.lotId))
        )
        .get();
      if (!lot) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'SALE_RETURN_LOT_NOT_FOUND',
          message: 'The original inventory lot no longer exists',
        });
      }
      const restored = calculateRestoredInventoryLotState({
        lotId: allocation.lotId,
        currentOnHand: lot.onHand,
        currentUnitCost: lot.unitCost,
        currentStatus: lot.status,
        expiresAt: lot.expiresAt,
        quantity: allocation.quantity,
        unitCost: allocation.unitCost,
        now: input.now,
      });
      const updated = tx
        .update(inventoryLots)
        .set({
          onHand: restored.onHand,
          unitCost: restored.unitCost,
          // Quantity restoration never restores sellability. Quarantine and
          // expiry remain authoritative in the shared exact-lot calculator.
          status: restored.status,
          syncStatus: 'pending',
          syncVersion: (lot.syncVersion ?? 0) + 1,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(inventoryLots.tenantId, input.tenantId),
            eq(inventoryLots.id, allocation.lotId),
            eq(inventoryLots.onHand, lot.onHand),
            eq(inventoryLots.unitCost, lot.unitCost),
            eq(inventoryLots.status, lot.status),
            lot.expiresAt === null
              ? isNull(inventoryLots.expiresAt)
              : eq(inventoryLots.expiresAt, lot.expiresAt)
          )
        )
        .run();
      if (updated.changes !== 1) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'SALE_RETURN_LOT_CHANGED',
          message: 'The original lot changed while the return was being recorded',
        });
      }
      tx.insert(saleReturnItemLots)
        .values({
          id: nanoid(),
          tenantId: input.tenantId,
          saleReturnItemId: returnItemId,
          saleItemLotId: allocation.saleItemLotId,
          lotId: allocation.lotId,
          quantity: allocation.quantity,
          unitCost: allocation.unitCost,
          createdAt: input.now,
        })
        .run();
      restoredLotIds.add(allocation.lotId);
    }
    for (const serial of line.serials) {
      const current = tx
        .select()
        .from(productSerials)
        .where(
          and(
            eq(productSerials.tenantId, input.tenantId),
            eq(productSerials.id, serial.productSerialId),
            eq(productSerials.saleItemId, line.saleItemId),
            eq(productSerials.status, 'sold')
          )
        )
        .get();
      if (!current) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PRODUCT_SERIAL_UNAVAILABLE',
          message: 'A selected serialized unit is no longer returnable',
        });
      }
      const updated = tx
        .update(productSerials)
        .set({
          status: 'returned',
          saleItemId: null,
          soldAt: null,
          returnedAt: input.now,
          syncStatus: 'pending',
          syncVersion: (current.syncVersion ?? 0) + 1,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(productSerials.tenantId, input.tenantId),
            eq(productSerials.id, serial.productSerialId),
            eq(productSerials.saleItemId, line.saleItemId),
            eq(productSerials.status, 'sold')
          )
        )
        .run();
      if (updated.changes !== 1) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'PRODUCT_SERIAL_UNAVAILABLE',
          message: 'A selected serialized unit changed during the return',
        });
      }
      tx.insert(saleReturnItemSerials)
        .values({
          id: nanoid(),
          tenantId: input.tenantId,
          saleReturnItemId: returnItemId,
          saleItemSerialId: serial.saleItemSerialId,
          productSerialId: serial.productSerialId,
          serialNumber: serial.serialNumber,
          createdAt: input.now,
        })
        .run();
      returnedSerialIds.push(serial.productSerialId);
    }
  }
  return { restoredLotIds: [...restoredLotIds], returnedSerialIds };
}

/**
 * Persist replication intent before the domain transaction commits.
 *
 * A normalized return is one aggregate: its frozen line, tax, lot, serial and
 * tender children must never arrive without the header. The aggregate payload
 * therefore carries those children together, while independently mutable
 * store-credit balances and inventory identities keep their own outbox rows.
 */
function enqueueReturnStateInTransaction(
  tx: DatabaseInstance,
  input: {
    ctx: CompleteSaleContext;
    saleId: string;
    returnId: string;
    restoredLotIds: string[];
    returnedSerialIds: string[];
    inventoryMovementIds: string[];
    cashMovementId: string | null;
    customerLedgerEntryId: string | null;
  }
): {
  outboxIds: string[];
  storeCreditMovementIds: string[];
  loyaltyMovementIds: string[];
} {
  const outboxIds: string[] = [];
  const syncCtx = {
    db: tx,
    tenantId: input.ctx.tenantId,
    envelope: input.ctx.envelope ?? null,
    deviceId: input.ctx.deviceId ?? null,
  };
  const returnRow = tx
    .select()
    .from(saleReturns)
    .where(and(eq(saleReturns.tenantId, input.ctx.tenantId), eq(saleReturns.id, input.returnId)))
    .get();
  if (!returnRow) throw new Error('Committed sale return row is missing');

  const itemRows = tx
    .select()
    .from(saleReturnItems)
    .where(
      and(
        eq(saleReturnItems.tenantId, input.ctx.tenantId),
        eq(saleReturnItems.saleReturnId, input.returnId)
      )
    )
    .orderBy(asc(saleReturnItems.id))
    .all();
  const itemIds = itemRows.map(row => row.id);
  const taxRows =
    itemIds.length === 0
      ? []
      : tx
          .select()
          .from(saleReturnItemTaxComponents)
          .where(
            and(
              eq(saleReturnItemTaxComponents.tenantId, input.ctx.tenantId),
              inArray(saleReturnItemTaxComponents.saleReturnItemId, itemIds)
            )
          )
          .orderBy(
            asc(saleReturnItemTaxComponents.saleReturnItemId),
            asc(saleReturnItemTaxComponents.position),
            asc(saleReturnItemTaxComponents.id)
          )
          .all();
  const lotRows =
    itemIds.length === 0
      ? []
      : tx
          .select()
          .from(saleReturnItemLots)
          .where(
            and(
              eq(saleReturnItemLots.tenantId, input.ctx.tenantId),
              inArray(saleReturnItemLots.saleReturnItemId, itemIds)
            )
          )
          .orderBy(
            asc(saleReturnItemLots.saleReturnItemId),
            asc(saleReturnItemLots.createdAt),
            asc(saleReturnItemLots.id)
          )
          .all();
  const serialRows =
    itemIds.length === 0
      ? []
      : tx
          .select()
          .from(saleReturnItemSerials)
          .where(
            and(
              eq(saleReturnItemSerials.tenantId, input.ctx.tenantId),
              inArray(saleReturnItemSerials.saleReturnItemId, itemIds)
            )
          )
          .orderBy(
            asc(saleReturnItemSerials.saleReturnItemId),
            asc(saleReturnItemSerials.serialNumber),
            asc(saleReturnItemSerials.id)
          )
          .all();
  const paymentAllocations = tx
    .select()
    .from(saleReturnPaymentAllocations)
    .where(
      and(
        eq(saleReturnPaymentAllocations.tenantId, input.ctx.tenantId),
        eq(saleReturnPaymentAllocations.saleReturnId, input.returnId)
      )
    )
    .orderBy(asc(saleReturnPaymentAllocations.id))
    .all();
  const cashMovement = input.cashMovementId
    ? tx
        .select()
        .from(cashMovements)
        .where(
          and(
            eq(cashMovements.tenantId, input.ctx.tenantId),
            eq(cashMovements.id, input.cashMovementId)
          )
        )
        .get()
    : null;
  const receivableAdjustment = input.customerLedgerEntryId
    ? tx
        .select()
        .from(customerLedgerEntries)
        .where(
          and(
            eq(customerLedgerEntries.tenantId, input.ctx.tenantId),
            eq(customerLedgerEntries.id, input.customerLedgerEntryId)
          )
        )
        .get()
    : null;
  const loyaltyReversals = tx
    .select()
    .from(loyaltyMovements)
    .where(
      and(
        eq(loyaltyMovements.tenantId, input.ctx.tenantId),
        eq(loyaltyMovements.saleReturnId, input.returnId)
      )
    )
    .orderBy(asc(loyaltyMovements.createdAt), asc(loyaltyMovements.id))
    .all();
  const movementRows =
    input.inventoryMovementIds.length === 0
      ? []
      : tx
          .select()
          .from(inventoryMovements)
          .where(
            and(
              eq(inventoryMovements.tenantId, input.ctx.tenantId),
              inArray(inventoryMovements.id, input.inventoryMovementIds)
            )
          )
          .orderBy(asc(inventoryMovements.createdAt), asc(inventoryMovements.id))
          .all();
  const storeCreditMovementRows = tx
    .select()
    .from(storeCreditMovements)
    .where(
      and(
        eq(storeCreditMovements.tenantId, input.ctx.tenantId),
        eq(storeCreditMovements.saleReturnId, input.returnId)
      )
    )
    .orderBy(asc(storeCreditMovements.createdAt), asc(storeCreditMovements.id))
    .all();

  const taxRowsByItem = new Map<string, typeof taxRows>();
  for (const row of taxRows) {
    const group = taxRowsByItem.get(row.saleReturnItemId) ?? [];
    group.push(row);
    taxRowsByItem.set(row.saleReturnItemId, group);
  }
  const lotRowsByItem = new Map<string, typeof lotRows>();
  for (const row of lotRows) {
    const group = lotRowsByItem.get(row.saleReturnItemId) ?? [];
    group.push(row);
    lotRowsByItem.set(row.saleReturnItemId, group);
  }
  const serialRowsByItem = new Map<string, typeof serialRows>();
  for (const row of serialRows) {
    const group = serialRowsByItem.get(row.saleReturnItemId) ?? [];
    group.push(row);
    serialRowsByItem.set(row.saleReturnItemId, group);
  }

  outboxIds.push(
    enqueueSyncInTransaction(syncCtx, {
      entityType: 'sale_returns',
      entityId: input.returnId,
      operation: 'create',
      data: {
        aggregateVersion: 1,
        ...returnRow,
        items: itemRows.map(row => ({
          ...row,
          taxComponents: taxRowsByItem.get(row.id) ?? [],
          lotAllocations: lotRowsByItem.get(row.id) ?? [],
          serialAllocations: serialRowsByItem.get(row.id) ?? [],
        })),
        paymentAllocations,
        cashMovement: cashMovement ?? null,
        receivableAdjustment: receivableAdjustment ?? null,
        loyaltyReversals,
        inventoryMovements: movementRows,
      },
    }).id
  );

  const returnedAmount = Number(
    tx
      .select({ amount: sql<number>`coalesce(sum(${saleReturns.refundAmount}), 0)` })
      .from(saleReturns)
      .where(
        and(eq(saleReturns.tenantId, input.ctx.tenantId), eq(saleReturns.saleId, input.saleId))
      )
      .get()?.amount ?? 0
  );
  const saleRow = tx
    .select({ paymentStatus: sales.paymentStatus, syncVersion: sales.syncVersion })
    .from(sales)
    .where(and(eq(sales.tenantId, input.ctx.tenantId), eq(sales.id, input.saleId)))
    .get();
  outboxIds.push(
    enqueueSyncInTransaction(syncCtx, {
      entityType: 'sales',
      entityId: input.saleId,
      operation: 'update',
      data: {
        id: input.saleId,
        paymentStatus: saleRow?.paymentStatus,
        syncVersion: saleRow?.syncVersion,
        returnedAmount,
        returnId: input.returnId,
      },
    }).id
  );

  if (input.restoredLotIds.length > 0) {
    const rows = tx
      .select()
      .from(inventoryLots)
      .where(
        and(
          eq(inventoryLots.tenantId, input.ctx.tenantId),
          inArray(inventoryLots.id, input.restoredLotIds)
        )
      )
      .orderBy(asc(inventoryLots.id))
      .all();
    for (const row of rows) {
      outboxIds.push(
        enqueueSyncInTransaction(syncCtx, {
          entityType: 'inventory_lots',
          entityId: row.id,
          operation: 'update',
          data: { ...row, saleId: input.saleId, saleReturnId: input.returnId },
        }).id
      );
    }
  }
  if (input.returnedSerialIds.length > 0) {
    const rows = tx
      .select()
      .from(productSerials)
      .where(
        and(
          eq(productSerials.tenantId, input.ctx.tenantId),
          inArray(productSerials.id, input.returnedSerialIds)
        )
      )
      .orderBy(asc(productSerials.id))
      .all();
    for (const row of rows) {
      outboxIds.push(
        enqueueSyncInTransaction(syncCtx, {
          entityType: 'product_serials',
          entityId: row.id,
          operation: 'update',
          data: { ...row, saleReturnId: input.returnId },
        }).id
      );
    }
  }
  const storeCreditAccountIds = [...new Set(storeCreditMovementRows.map(row => row.accountId))];
  if (storeCreditAccountIds.length > 0) {
    const rows = tx
      .select()
      .from(storeCreditAccounts)
      .where(
        and(
          eq(storeCreditAccounts.tenantId, input.ctx.tenantId),
          inArray(storeCreditAccounts.id, storeCreditAccountIds)
        )
      )
      .all();
    for (const row of rows) {
      outboxIds.push(
        enqueueSyncInTransaction(syncCtx, {
          entityType: 'store_credit_accounts',
          entityId: row.id,
          operation: 'update',
          data: row,
        }).id
      );
    }
  }
  for (const storeCreditMovement of storeCreditMovementRows) {
    outboxIds.push(
      enqueueSyncInTransaction(syncCtx, {
        entityType: 'store_credit_movements',
        entityId: storeCreditMovement.id,
        operation: 'create',
        data: storeCreditMovement,
      }).id
    );
  }
  const loyaltyAccountIds = [...new Set(loyaltyReversals.map(row => row.accountId))];
  if (loyaltyAccountIds.length > 0) {
    const rows = tx
      .select()
      .from(loyaltyAccounts)
      .where(
        and(
          eq(loyaltyAccounts.tenantId, input.ctx.tenantId),
          inArray(loyaltyAccounts.id, loyaltyAccountIds)
        )
      )
      .all();
    for (const row of rows) {
      outboxIds.push(
        enqueueSyncInTransaction(syncCtx, {
          entityType: 'loyalty_accounts',
          entityId: row.id,
          operation: 'update',
          data: row,
        }).id
      );
    }
    for (const row of loyaltyReversals) {
      outboxIds.push(
        enqueueSyncInTransaction(syncCtx, {
          entityType: 'loyalty_movements',
          entityId: row.id,
          operation: 'create',
          data: row,
        }).id
      );
    }
  }
  return {
    outboxIds,
    storeCreditMovementIds: storeCreditMovementRows.map(row => row.id),
    loyaltyMovementIds: loyaltyReversals.map(row => row.id),
  };
}

export async function returnSale(
  ctx: CompleteSaleContext,
  input: ReturnSaleInput
): Promise<CompleteSaleResult<CompleteSaleSaleRecord>> {
  const log = ctx.log ?? fallbackLog;
  const destination = input.destination ?? 'original';
  const existing = await ctx.db
    .select()
    .from(sales)
    .where(and(eq(sales.id, input.id), eq(sales.tenantId, ctx.tenantId)))
    .get();
  assertReturnableSale(existing);
  if (destination === 'store_credit' && !existing.customerId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_RETURN_CUSTOMER_REQUIRED',
      message: 'Store credit requires a customer on the original sale',
    });
  }
  const planInput = {
    items: input.items,
    destination,
    externalReferences: input.externalReferences,
  };
  const previewPlan = buildReturnPlan(ctx.db, ctx.tenantId, existing, planInput);
  const originalSaleSession = existing.cashSessionId
    ? await ctx.db
        .select({ id: cashSessions.id, status: cashSessions.status, siteId: cashSessions.siteId })
        .from(cashSessions)
        .where(
          and(eq(cashSessions.id, existing.cashSessionId), eq(cashSessions.tenantId, ctx.tenantId))
        )
        .get()
    : null;
  const originalSaleSiteId = originalSaleSession?.siteId ?? null;
  if (originalSaleSiteId && originalSaleSiteId !== ctx.siteId) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'SALE_RETURN_SITE_MISMATCH',
      message: 'Returns must be processed at the original sale site',
    });
  }
  if (previewPlan.lines.some(line => line.tracksStock) && !originalSaleSiteId) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'SALE_RETURN_SITE_REQUIRED',
      message: 'The original inventory site is unavailable; stock was not changed',
    });
  }
  const fallbackCashSession =
    previewPlan.cashAmount > 0 && (!originalSaleSession || originalSaleSession.status !== 'open')
      ? await requireActiveCashSession(ctx.db, ctx.tenantId, ctx.siteId, ctx.user.id)
      : null;
  const refundCashSession =
    previewPlan.cashAmount > 0
      ? originalSaleSession?.status === 'open'
        ? originalSaleSession
        : fallbackCashSession
      : null;

  const lossPreventionEvaluation = evaluateShiftLossPrevention({
    db: ctx.db,
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    actorId: ctx.user.id,
    role: ctx.user.role,
    action: 'sale_refund',
    amount: previewPlan.refundAmount,
  });
  recordShiftLossPreventionTrigger({
    db: ctx.db,
    tenantId: ctx.tenantId,
    actorId: ctx.user.id,
    siteId: ctx.siteId,
    resourceType: 'sale',
    resourceId: input.id,
    evaluation: lossPreventionEvaluation,
    approvalRequestId: input.approvalRequestId,
    operationId: ctx.envelope?.operationId,
  });
  const approvalClaim = claimShiftLossPreventionApproval({
    db: ctx.db,
    tenantId: ctx.tenantId,
    siteId: ctx.siteId,
    requesterId: ctx.user.id,
    requesterRole: ctx.user.role,
    action: 'sale_refund',
    resourceType: 'sale',
    resourceId: input.id,
    requestId: input.approvalRequestId,
    evaluation: lossPreventionEvaluation,
  });

  const now = new Date().toISOString();
  const returnId = nanoid();
  const preparedFiscalIntent =
    previewPlan.refundAmount > 0 && originalSaleSiteId
      ? await prepareSaleFiscalIntent({
          db: ctx.db,
          tenantId: ctx.tenantId,
          userId: ctx.user.id,
          saleId: input.id,
          siteId: originalSaleSiteId,
          customerId: existing.customerId,
          paymentMethod: existing.paymentMethod,
          amounts: {
            subtotal: previewPlan.subtotal,
            taxAmount: previewPlan.taxAmount,
            discountAmount: previewPlan.discountAmount,
            total: previewPlan.refundAmount,
          },
          lines: buildReturnFiscalLines(previewPlan),
          completedAt: now,
          log,
          source: 'return',
          sourceId: returnId,
          kind: 'NC',
          originalCufe: await getOriginalDeeCufe(ctx.db, ctx.tenantId, input.id),
          reasonCode: input.reason ?? undefined,
        })
      : null;
  let committedPlan = previewPlan;
  let inventoryMovementIds: string[] = [];
  let restoredLotIds: string[] = [];
  let returnedSerialIds: string[] = [];
  let cashMovementId: string | null = null;
  let customerLedgerEntryId: string | null = null;
  let auditLogId: string | null = null;
  let syncOutboxIds: string[] = [];
  let storeCreditMovementIds: string[] = [];
  let loyaltyMovementIds: string[] = [];
  let fiscalIntentId: string | null = null;
  try {
    ctx.db.transaction(
      tx => {
        const current = tx
          .select()
          .from(sales)
          .where(and(eq(sales.id, input.id), eq(sales.tenantId, ctx.tenantId)))
          .get();
        assertReturnableSale(current);
        if (
          current.updatedAt !== existing.updatedAt ||
          current.syncVersion !== existing.syncVersion
        ) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'SALE_RETURN_CHANGED',
            message: 'The sale changed while the return was being prepared',
          });
        }
        committedPlan = buildReturnPlan(tx, ctx.tenantId, current, planInput);
        if (
          committedPlan.refundAmount !== previewPlan.refundAmount ||
          committedPlan.cashAmount !== previewPlan.cashAmount
        ) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'SALE_RETURN_CHANGED',
            message: 'The returnable balance changed while the return was being prepared',
          });
        }
        if (committedPlan.cashAmount > 0) {
          if (!refundCashSession) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'CASH_SESSION_REQUIRED',
              message: 'An open cash session is required for a cash refund',
            });
          }
          assertCashSessionStillOpen(tx, ctx.tenantId, refundCashSession.id);
        }
        const expectedSyncVersion =
          current.syncVersion === null
            ? isNull(sales.syncVersion)
            : eq(sales.syncVersion, current.syncVersion);
        const updatedSale = tx
          .update(sales)
          .set({
            paymentStatus: committedPlan.nextPaymentStatus,
            notes: buildReturnedSaleNotes(current.notes, input.reason),
            updatedAt: now,
            syncStatus: 'pending',
            syncVersion: (current.syncVersion ?? 0) + 1,
          })
          .where(
            and(
              eq(sales.id, input.id),
              eq(sales.tenantId, ctx.tenantId),
              eq(sales.status, 'completed'),
              ne(sales.paymentStatus, 'refunded'),
              expectedSyncVersion,
              eq(sales.updatedAt, current.updatedAt)
            )
          )
          .run();
        if (updatedSale.changes !== 1) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'SALE_RETURN_CHANGED',
            message: 'The sale changed while the return was being recorded',
          });
        }
        tx.insert(saleReturns)
          .values({
            id: returnId,
            tenantId: ctx.tenantId,
            saleId: input.id,
            destination,
            subtotal: committedPlan.subtotal,
            tipAmount: committedPlan.tipAmount,
            serviceChargeAmount: committedPlan.serviceChargeAmount,
            discountAmount: committedPlan.discountAmount,
            taxAmount: committedPlan.taxAmount,
            refundAmount: committedPlan.refundAmount,
            currencyCode: current.currencyCode,
            reason: input.reason ?? null,
            createdBy: ctx.user.id,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        const persisted = persistReturnLines(tx, {
          tenantId: ctx.tenantId,
          returnId,
          plan: committedPlan,
          now,
        });
        restoredLotIds = persisted.restoredLotIds;
        returnedSerialIds = persisted.returnedSerialIds;
        const productStocks = getProductStockTotals(tx, ctx.tenantId, [
          ...new Set(committedPlan.lines.map(line => line.productId)),
        ]);
        inventoryMovementIds = reverseSaleItemsStock({
          tx,
          tenantId: ctx.tenantId,
          siteId: originalSaleSiteId,
          userId: ctx.user.id,
          saleId: input.id,
          saleNumber: current.saleNumber,
          reversalKind: 'return',
          items: committedPlan.lines,
          productStockState: productStocks,
          now,
        });
        for (const allocation of committedPlan.allocations) {
          tx.insert(saleReturnPaymentAllocations)
            .values({
              id: nanoid(),
              tenantId: ctx.tenantId,
              saleReturnId: returnId,
              salePaymentId: allocation.salePaymentId,
              originalMethod: allocation.originalMethod,
              destination: allocation.destination,
              amount: allocation.amount,
              loyaltyPoints: allocation.loyaltyPoints,
              externalReference: allocation.externalReference,
              createdAt: now,
            })
            .run();
        }
        if (committedPlan.customerLedgerReceivableAmount > 0) {
          if (!current.customerId) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'SALE_RETURN_CUSTOMER_REQUIRED',
              message: 'The original credit balance has no customer',
            });
          }
          customerLedgerEntryId = nanoid();
          tx.insert(customerLedgerEntries)
            .values({
              id: customerLedgerEntryId,
              tenantId: ctx.tenantId,
              customerId: current.customerId,
              kind: 'adjustment',
              amount: -committedPlan.customerLedgerReceivableAmount,
              referenceSaleId: input.id,
              note: `Return ${returnId} for sale ${current.saleNumber}`,
              createdBy: ctx.user.id,
              createdAt: now,
            })
            .run();
        }
        for (const allocation of committedPlan.allocations) {
          if (allocation.originalMethod === 'loyalty' && allocation.salePaymentId) {
            restorePointsForReturn(tx, {
              tenantId: ctx.tenantId,
              saleId: input.id,
              saleReturnId: returnId,
              salePaymentId: allocation.salePaymentId,
              points: allocation.loyaltyPoints,
              amount: allocation.amount,
              createdBy: ctx.user.id,
              nowIso: now,
            });
          }
          if (allocation.originalMethod === 'store_credit' && allocation.salePaymentId) {
            restoreStoreCreditForReturn(tx, {
              tenantId: ctx.tenantId,
              saleId: input.id,
              saleReturnId: returnId,
              salePaymentId: allocation.salePaymentId,
              amount: allocation.amount,
              createdBy: ctx.user.id,
              now,
            });
          }
        }
        if (committedPlan.storeCreditIssueAmount > 0) {
          issueStoreCreditForReturn(tx, {
            tenantId: ctx.tenantId,
            customerId: current.customerId!,
            saleReturnId: returnId,
            saleId: input.id,
            amount: committedPlan.storeCreditIssueAmount,
            currencyCode: current.currencyCode,
            createdBy: ctx.user.id,
            note: input.reason ?? `Return of sale ${current.saleNumber}`,
            now,
          });
        }
        if (committedPlan.cashAmount > 0 && refundCashSession) {
          cashMovementId = insertCashMovement({
            tx,
            tenantId: ctx.tenantId,
            sessionId: refundCashSession.id,
            type: 'refund',
            amount: committedPlan.cashAmount,
            // Preserve the reporting/read contract keyed by sale id. The
            // immutable return id remains in the normalized return, audit and
            // operation journal rather than changing the legacy cash-note API.
            referenceId: input.id,
            note: `Refunded sale ${current.saleNumber}`,
            createdBy: ctx.user.id,
            createdAt: now,
          });
        }
        const cumulative = tx
          .select({ amount: sql<number>`coalesce(sum(${saleReturns.refundAmount}), 0)` })
          .from(saleReturns)
          .where(and(eq(saleReturns.tenantId, ctx.tenantId), eq(saleReturns.saleId, input.id)))
          .get()?.amount;
        revertPointsForReturn(tx, {
          tenantId: ctx.tenantId,
          saleId: input.id,
          saleReturnId: returnId,
          saleTotal: current.total,
          cumulativeRefundAmount: Number(cumulative ?? committedPlan.refundAmount),
          fullyReturned: committedPlan.fullyReturned,
          nowIso: now,
        });
        auditLogId = writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user.id,
          action: 'sale.return',
          resourceType: 'sale',
          resourceId: input.id,
          before: {
            paymentStatus: current.paymentStatus,
            total: current.total,
            returnedAmount: Number(cumulative ?? 0) - committedPlan.refundAmount,
          },
          after: {
            paymentStatus: committedPlan.nextPaymentStatus,
            // refundId is the historical audit contract; returnId names the
            // normalized domain row. Keep both until all external readers
            // have migrated.
            refundId: returnId,
            returnId,
            refundAmount: committedPlan.refundAmount,
            destination,
            lineCount: committedPlan.lines.length,
          },
          metadata: {
            saleId: input.id,
            returnId,
            saleNumber: current.saleNumber,
            ...(input.reason ? { reason: input.reason } : {}),
            ...(refundCashSession ? { refundCashSessionId: refundCashSession.id } : {}),
            lossPreventionCashSessionId: lossPreventionEvaluation.cashSessionId,
            ...(approvalClaim
              ? { approvalRequestId: approvalClaim.requestId, approvedBy: approvalClaim.approverId }
              : {}),
          },
        });
        if (approvalClaim) {
          consumeManagerApprovalGrant({
            tx,
            tenantId: ctx.tenantId,
            requesterId: ctx.user.id,
            claim: approvalClaim,
            consumedResourceType: 'sale_return',
            consumedResourceId: returnId,
            metadata: { saleId: input.id, saleNumber: current.saleNumber },
          });
        }
        const returnSync = enqueueReturnStateInTransaction(tx as unknown as typeof ctx.db, {
          ctx,
          saleId: input.id,
          returnId,
          restoredLotIds,
          returnedSerialIds,
          inventoryMovementIds,
          cashMovementId,
          customerLedgerEntryId,
        });
        syncOutboxIds = returnSync.outboxIds;
        storeCreditMovementIds = returnSync.storeCreditMovementIds;
        loyaltyMovementIds = returnSync.loyaltyMovementIds;
        fiscalIntentId = insertFiscalIntentInTransaction(
          tx as unknown as typeof ctx.db,
          preparedFiscalIntent
        );
        ctx.completeInTransaction?.(
          tx as unknown as typeof ctx.db,
          createSaleReturnCommandResultRef(input.id)
        );
      },
      { behavior: 'immediate' }
    );
  } catch (error) {
    if (approvalClaim) releaseManagerApprovalClaim(ctx.db, ctx.tenantId, approvalClaim);
    throw error;
  }

  if (approvalClaim) await enqueueConsumedManagerApprovalBestEffort(ctx, approvalClaim);
  // A zero-value inventory return has no monetary credit note. Otherwise the
  // return transaction already persisted the fiscal obligation; this hook is
  // only a fast path and is safe to miss during a process crash.
  const fiscalResult = fiscalIntentId
    ? await materializeCommittedFiscalIntent({
        db: ctx.db,
        tenantId: ctx.tenantId,
        intentId: fiscalIntentId,
        log,
      })
    : null;
  const updated = await getSaleRecord(ctx.db, ctx.tenantId, input.id);
  const journalEventId = await lookupJournalEventId(
    ctx.db,
    ctx.tenantId,
    ctx.envelope?.operationId
  );
  if (journalEventId) {
    await safeUpdateSaleReturnedSummary(ctx, log, journalEventId, {
      saleReturnId: returnId,
      originalSaleId: input.id,
      siteId: originalSaleSiteId ?? ctx.siteId,
      cashSessionId: refundCashSession?.id ?? null,
      refundedAmount: committedPlan.refundAmount,
      currencyCode: committedPlan.currencyCode,
      reasonCode: input.reason ?? null,
      fullyReturned: committedPlan.fullyReturned,
    });
    const effects: JournalEffectInput[] = [
      {
        kind: 'sale_row',
        resourceType: 'sales',
        resourceId: input.id,
        effectData: { paymentStatus: committedPlan.nextPaymentStatus, returnId },
      },
      {
        kind: 'sale_return_row',
        resourceType: 'sale_returns',
        resourceId: returnId,
        effectData: { refundAmount: committedPlan.refundAmount, destination },
      },
      ...inventoryMovementIds.map(resourceId => ({
        kind: 'inventory_movement' as const,
        resourceType: 'inventory_movements',
        resourceId,
      })),
      ...syncOutboxIds.map(resourceId => ({
        kind: 'outbox_enqueue:sync' as const,
        resourceType: 'sync_outbox',
        resourceId,
      })),
    ];
    if (cashMovementId) {
      effects.push({
        kind: 'cash_movement',
        resourceType: 'cash_movements',
        resourceId: cashMovementId,
        effectData: { sessionId: refundCashSession?.id, amount: committedPlan.cashAmount },
      });
    }
    if (customerLedgerEntryId) {
      effects.push({
        kind: 'customer_ledger_entry',
        resourceType: 'customer_ledger_entries',
        resourceId: customerLedgerEntryId,
      });
    }
    for (const resourceId of storeCreditMovementIds) {
      effects.push({
        kind: 'store_credit_movement',
        resourceType: 'store_credit_movements',
        resourceId,
      });
    }
    for (const resourceId of loyaltyMovementIds) {
      effects.push({
        kind: 'loyalty_movement',
        resourceType: 'loyalty_movements',
        resourceId,
      });
    }
    if (auditLogId) {
      effects.push({
        kind: 'audit_log',
        resourceType: 'audit_logs',
        resourceId: auditLogId,
        effectData: { action: 'sale.return' },
      });
    }
    if (fiscalResult?.id) {
      effects.push({
        kind: 'fiscal_emit',
        resourceType: 'fiscal_documents',
        resourceId: fiscalResult.id,
      });
    }
    await emitCompleteSaleEffects(ctx.db, log, journalEventId, effects);
  }
  if (committedPlan.fullyReturned) {
    broadcastSaleRetracted(ctx, { id: input.id, saleNumber: updated.saleNumber }, 'returned');
  }
  return { sale: updated as CompleteSaleSaleRecord, change: 0, journalEventId };
}
