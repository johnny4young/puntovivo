/**
 * Best-effort journal effect emission for the `completeSale`
 * use-case.
 *
 * Per `architecture/patterns/operation-journal.md`, services emit one
 * `operation_effects` row per meaningful side-effect AFTER the primary
 * transaction commits. The journal is observability, not a correctness
 * gate: a write failure here MUST NEVER roll back the sale.
 *
 * The helper:
 *
 * - Skips silently when `eventId` is null (the call did not carry an
 * envelope, e.g. an internal worker or a hand-built test ctx).
 * - Wraps each `recordEffect` in `try/catch` so a single failure does
 * not block the rest of the batch.
 * - Logs failures at warn level with the affected `kind` and
 * `resourceId` so operators can correlate against the
 * `operation_events` row they're inspecting.
 *
 * @module application/sales/journal-effects
 */

import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { operationEvents } from '../../db/schema.js';
import { recordEffect, updateOperationSummary } from '../../services/operation-journal/journal.js';
import { resolveTenantLocale } from '../../services/tenant-locale.js';
import type {
  CompleteSaleContext,
  CompleteSaleLogger,
  CompleteSaleTender,
  FreshSaleStatus,
  SalePaymentMethod,
  SalePaymentStatus,
} from './types.js';

export interface JournalEffectInput {
  kind: string;
  resourceType: string;
  resourceId: string;
  effectData?: Record<string, unknown> | null;
}

/**
 * One persisted payment row captured during the sale transaction so the
 * post-commit journal can emit a `payment_row` effect per tender.
 */
export interface PersistedPaymentEffect {
  id: string;
  method: CompleteSaleTender['method'];
  amount: number;
}

/**
 * Emit one journal effect row per entry. Calls are sequential so the
 * `operation_effects` rows land in the order the caller provided —
 * the Operations Center () renders effects ordered by
 * `created_at`, so a stable order keeps the trail readable.
 */
export async function emitCompleteSaleEffects(
  db: DatabaseInstance,
  log: CompleteSaleLogger,
  eventId: string | null,
  effects: JournalEffectInput[]
): Promise<void> {
  if (!eventId || effects.length === 0) {
    return;
  }

  for (const effect of effects) {
    try {
      await recordEffect(db, {
        operationEventId: eventId,
        kind: effect.kind,
        resourceType: effect.resourceType,
        resourceId: effect.resourceId,
        effectData: effect.effectData ?? null,
      });
    } catch (err) {
      log.warn(
        {
          err,
          eventId,
          effectKind: effect.kind,
          resourceType: effect.resourceType,
          resourceId: effect.resourceId,
        },
        'completeSale journal effect emission failed (non-blocking)'
      );
    }
  }
}

/**
 * Look up the `operation_events` row id for the call's envelope. Returns
 * null when no envelope was carried (internal worker / hand-built test
 * ctx) so the journal path is skipped silently.
 */
export async function lookupJournalEventId(
  db: DatabaseInstance,
  tenantId: string,
  operationId: string | undefined
): Promise<string | null> {
  if (!operationId) {
    return null;
  }
  const row = await db
    .select({ id: operationEvents.id })
    .from(operationEvents)
    .where(
      and(eq(operationEvents.tenantId, tenantId), eq(operationEvents.operationId, operationId))
    )
    .get();
  return row?.id ?? null;
}

/**
 * Best-effort update of the `operation_events` summary row for a
 * completed sale. A failure here is logged and swallowed — the journal
 * summary is observability, never a correctness gate.
 */
export async function safeUpdateSaleCompletedSummary(
  ctx: CompleteSaleContext,
  log: CompleteSaleLogger,
  journalEventId: string,
  summary: {
    saleId: string;
    saleNumber: string;
    siteId: string;
    cashSessionId: string;
    customerId: string | null | undefined;
    subtotal: number;
    taxAmount: number;
    discountAmount: number;
    total: number;
    paymentMethod: string;
  }
): Promise<void> {
  try {
    const locale = await resolveTenantLocale(ctx.db, ctx.tenantId);
    await updateOperationSummary(ctx.db, journalEventId, {
      ...summary,
      customerId: summary.customerId ?? null,
      currencyCode: locale.currency,
    });
  } catch (err) {
    log.warn({ err, journalEventId }, 'operation summary update failed (non-blocking)');
  }
}

/**
 * Assemble the journal `operation_effects` for the fresh-sale path:
 * sale row, one per tender, one per inventory movement, the cash
 * movement, the optional price-override audit, and the optional fiscal
 * emit — in the order the Operations Center renders them.
 */
export function buildFreshSaleEffects(args: {
  saleId: string;
  saleNumber: string;
  total: number;
  dominantMethod: SalePaymentMethod;
  paymentStatus: SalePaymentStatus;
  status: FreshSaleStatus;
  paymentEffects: PersistedPaymentEffect[];
  inventoryMovementIds: string[];
  cashMovementId: string | null;
  sessionId: string;
  cashCollectedAmount: number;
  priceOverrideAuditEmitted: boolean;
  priceOverrideAuditId: string | null;
  fiscalEmitId: string | null;
}): JournalEffectInput[] {
  const effects: JournalEffectInput[] = [];
  effects.push({
    kind: 'sale_row',
    resourceType: 'sales',
    resourceId: args.saleId,
    effectData: {
      saleNumber: args.saleNumber,
      total: args.total,
      paymentMethod: args.dominantMethod,
      paymentStatus: args.paymentStatus,
      status: args.status,
    },
  });
  for (const payment of args.paymentEffects) {
    effects.push({
      kind: 'payment_row',
      resourceType: 'sale_payments',
      resourceId: payment.id,
      effectData: { method: payment.method, amount: payment.amount },
    });
  }
  for (const movementId of args.inventoryMovementIds) {
    effects.push({
      kind: 'inventory_movement',
      resourceType: 'inventory_movements',
      resourceId: movementId,
    });
  }
  if (args.cashMovementId) {
    effects.push({
      kind: 'cash_movement',
      resourceType: 'cash_movements',
      resourceId: args.cashMovementId,
      effectData: {
        sessionId: args.sessionId,
        amount: args.cashCollectedAmount,
      },
    });
  }
  if (args.priceOverrideAuditEmitted && args.priceOverrideAuditId) {
    effects.push({
      kind: 'audit_log',
      resourceType: 'audit_logs',
      resourceId: args.priceOverrideAuditId,
      effectData: { action: 'sale.price_override' },
    });
  }
  if (args.fiscalEmitId) {
    effects.push({
      kind: 'fiscal_emit',
      resourceType: 'fiscal_documents',
      resourceId: args.fiscalEmitId,
    });
  }
  return effects;
}

/**
 * Assemble the journal `operation_effects` for the draft-completion
 * path: sale row (with `completedFromDraft`), one per tender, the cash
 * movement, the optional completion audit, and the optional fiscal emit.
 * No inventory-movement effects — the draft already debited stock at
 * create-time.
 */
export function buildDraftSaleEffects(args: {
  saleId: string;
  saleNumber: string;
  total: number;
  dominantMethod: SalePaymentMethod;
  paymentStatus: SalePaymentStatus;
  paymentEffects: PersistedPaymentEffect[];
  cashMovementId: string | null;
  sessionId: string;
  cashCollectedAmount: number;
  completionAuditId: string | null;
  fiscalEmitId: string | null;
}): JournalEffectInput[] {
  const effects: JournalEffectInput[] = [];
  effects.push({
    kind: 'sale_row',
    resourceType: 'sales',
    resourceId: args.saleId,
    effectData: {
      saleNumber: args.saleNumber,
      total: args.total,
      paymentMethod: args.dominantMethod,
      paymentStatus: args.paymentStatus,
      status: 'completed',
      completedFromDraft: true,
    },
  });
  for (const payment of args.paymentEffects) {
    effects.push({
      kind: 'payment_row',
      resourceType: 'sale_payments',
      resourceId: payment.id,
      effectData: { method: payment.method, amount: payment.amount },
    });
  }
  if (args.cashMovementId) {
    effects.push({
      kind: 'cash_movement',
      resourceType: 'cash_movements',
      resourceId: args.cashMovementId,
      effectData: {
        sessionId: args.sessionId,
        amount: args.cashCollectedAmount,
      },
    });
  }
  if (args.completionAuditId) {
    effects.push({
      kind: 'audit_log',
      resourceType: 'audit_logs',
      resourceId: args.completionAuditId,
      effectData: { action: 'sale.complete' },
    });
  }
  if (args.fiscalEmitId) {
    effects.push({
      kind: 'fiscal_emit',
      resourceType: 'fiscal_documents',
      resourceId: args.fiscalEmitId,
    });
  }
  return effects;
}
