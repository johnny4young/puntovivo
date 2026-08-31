/**
 * Post-commit orchestration for the fresh-sale path.
 *
 * The primary transaction has already committed when this helper runs. It
 * keeps every best-effort side effect in the original order: sale reload,
 * sync, credit ledger, fiscal emission, operation journal effects, and the
 * optional KDS enqueue. Lot allocation is already complete and fail-closed
 * inside the sale transaction.
 *
 * @module application/sales/finalizeFreshSale
 */

import { enqueueInventoryLotUpdatesForSale } from '../../services/inventory-lots/index.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import {
  broadcastSaleCompleted,
  emitSaleFiscalDocument,
  enqueueSaleKdsOrder,
} from './fiscalPostHook.js';
import {
  buildFreshSaleEffects,
  emitCompleteSaleEffects,
  lookupJournalEventId,
  safeUpdateSaleCompletedSummary,
  type PersistedPaymentEffect,
} from './journal-effects.js';
import { getSaleRecord, type CompleteSaleSaleRecord } from './sale-read.js';
import type {
  CompleteSaleContext,
  CompleteSaleInput,
  CompleteSaleLogger,
  CompleteSaleResult,
  SalePaymentMethod,
  SalePaymentStatus,
} from './types.js';

interface FreshSaleIdentity {
  id: string;
  number: string;
  siteId: string;
  cashSessionId: string;
}

interface FreshSaleAmounts {
  subtotal: number;
  taxAmount: number;
  headerDiscount: number;
  total: number;
}

interface FreshSalePaymentState {
  creditSaleAmount: number;
  paymentStatus: SalePaymentStatus;
  change: number;
  dominantMethod: SalePaymentMethod;
  cashCollectedAmount: number;
  effects: PersistedPaymentEffect[];
}

interface FreshSalePersistenceEffects {
  inventoryMovementIds: string[];
  cashMovementId: string | null;
  priceOverrideAuditEmitted: boolean;
  priceOverrideAuditId: string | null;
}

interface FreshSaleInventoryEffects {
  consumedLotIds: string[];
}

interface FinalizeFreshSaleArgs {
  ctx: CompleteSaleContext;
  log: CompleteSaleLogger;
  input: Extract<CompleteSaleInput, { mode: 'fresh' }>;
  sale: FreshSaleIdentity;
  amounts: FreshSaleAmounts;
  payment: FreshSalePaymentState;
  persistence: FreshSalePersistenceEffects;
  inventory: FreshSaleInventoryEffects;
}

export async function finalizeFreshSale(
  args: FinalizeFreshSaleArgs
): Promise<CompleteSaleResult<CompleteSaleSaleRecord>> {
  const { ctx, log, input, sale, amounts, payment, persistence, inventory } = args;

  const created = await getSaleRecord(ctx.db, ctx.tenantId, sale.id);

  // sync_outbox emit moved POST-tx. The helper writes the
  // operation_effects row (kind=outbox_enqueue:sync) itself when an
  // envelope context is present.
  await enqueueSync(ctx, {
    entityType: 'sales',
    entityId: sale.id,
    operation: 'create',
    data: {
      id: sale.id,
      saleNumber: sale.number,
      total: amounts.total,
      siteId: sale.siteId,
      cashSessionId: sale.cashSessionId,
      paymentStatus: payment.paymentStatus,
    },
  });

  // the FEFO consumption above mutated these lots (on_hand drawn
  // down, possibly depleted) and marked them sync-pending; enqueue each one
  // so the mutation actually reaches sync_outbox instead of waiting for the
  // next receive to touch the row.
  await enqueueInventoryLotUpdatesForSale(ctx, inventory.consumedLotIds, sale.id);

  // emit DIAN DEE when a direct-sale (non-draft) lands as
  // `completed`. Drafts never emit. Runs post-tx best-effort.
  const fiscalEmitId = await emitSaleFiscalDocument({
    db: ctx.db,
    tenantId: ctx.tenantId,
    userId: ctx.user.id,
    log,
    saleId: sale.id,
    enabled: input.status === 'completed',
  });

  // Journal effects (best-effort).
  const journalEventId = await lookupJournalEventId(
    ctx.db,
    ctx.tenantId,
    ctx.envelope?.operationId
  );
  if (journalEventId) {
    if (input.status === 'completed') {
      await safeUpdateSaleCompletedSummary(ctx, log, journalEventId, {
        saleId: sale.id,
        saleNumber: sale.number,
        siteId: sale.siteId,
        cashSessionId: sale.cashSessionId,
        customerId: input.customerId,
        subtotal: amounts.subtotal,
        taxAmount: amounts.taxAmount,
        discountAmount: amounts.headerDiscount,
        total: amounts.total,
        paymentMethod: payment.dominantMethod,
      });
    }

    const effects = buildFreshSaleEffects({
      saleId: sale.id,
      saleNumber: sale.number,
      total: amounts.total,
      dominantMethod: payment.dominantMethod,
      paymentStatus: payment.paymentStatus,
      status: input.status,
      paymentEffects: payment.effects,
      inventoryMovementIds: persistence.inventoryMovementIds,
      cashMovementId: persistence.cashMovementId,
      sessionId: sale.cashSessionId,
      cashCollectedAmount: payment.cashCollectedAmount,
      priceOverrideAuditEmitted: persistence.priceOverrideAuditEmitted,
      priceOverrideAuditId: persistence.priceOverrideAuditId,
      fiscalEmitId,
    });
    await emitCompleteSaleEffects(ctx.db, log, journalEventId, effects);
  }

  // push to the kitchen display when the sale carries a
  // tableId. Idempotent against the suspend-then-complete progression
  // via UNIQUE(tenant_id, sale_id, station); a second fire is a no-op.
  await enqueueSaleKdsOrder(ctx, input.tableId, sale.id);

  // Feed the read-only companion ticker; post-commit and best-effort.
  // Guarded on the status exactly like the fiscal emit and the
  // completed-summary above: this function also runs for drafts, and a
  // parked order is not a sale — announcing one would put money on the
  // owner's ticker that nobody took.
  if (input.status === 'completed') {
    broadcastSaleCompleted(ctx, {
      id: sale.id,
      saleNumber: created.saleNumber,
      total: created.total,
    });
  }

  return {
    sale: { ...created, change: payment.change } as CompleteSaleSaleRecord,
    change: payment.change,
    journalEventId,
  };
}
