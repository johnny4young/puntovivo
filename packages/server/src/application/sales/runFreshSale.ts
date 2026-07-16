/**
 * ENG-178 — Fresh-sale path of the `completeSale` use-case, extracted
 * from the former monolithic `completeSale.ts` during the megafile
 * decomposition.
 *
 * The `db.transaction(...)` body, the header-total computation, and the
 * price-override detection move VERBATIM; the orchestration that was
 * inlined identically in both sale paths (payment plan, credit
 * pre-flight, credit ledger, fiscal emit, journal effects, KDS enqueue)
 * is delegated to the shared leaves (`pricing`, `creditPolicy`,
 * `fiscalPostHook`, `journal-effects`). Behavior parity is the explicit
 * acceptance criterion — proven by the unchanged caller suite.
 *
 * @module application/sales/runFreshSale
 */

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { UserRole } from '@puntovivo/shared/roles';
import {
  getCheckoutApprovalDiscountAmount,
  type CheckoutApprovalContext,
} from '@puntovivo/shared/checkout-approval';
import {
  inventoryMovements,
  products,
  salePayments,
  saleItems,
  sales,
  sequentials,
} from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';
import { resolveTenantCurrency } from '../../lib/currency.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  evaluateCheckoutLossPrevention,
  recordCheckoutLossPreventionTriggers,
} from '../../services/loss-prevention/index.js';
import { checkoutApprovalResourceId } from '../../services/manager-approvals.js';
import {
  assertCashSessionStillOpen,
  insertCashMovement,
  requireActiveCashSession,
} from '../../services/cash-session.js';
import { applyInventoryBalanceDelta } from '../../services/inventory-balances.js';
import { consumeLotsForSaleLine } from '../../services/inventory-lots/index.js';
import { assignProductSerialsToSaleLine } from '../../services/product-serials.js';
import { inArray } from 'drizzle-orm';
import {
  detectPriceOverrides,
  getSaleSequentialContext,
  resolveSaleItems,
  validateCustomer,
} from './item-resolution.js';
import { resolveFreshSaleTotals, resolveSalePaymentPlan } from './pricing.js';
import { runCreditPreflight } from './creditPolicy.js';
import type { PersistedPaymentEffect } from './journal-effects.js';
import type { CompleteSaleSaleRecord } from './sale-read.js';
import type {
  CompleteSaleContext,
  CompleteSaleInput,
  CompleteSaleLogger,
  CompleteSaleResult,
} from './types.js';
import { resolveFreshCheckoutTiming } from './checkout-timing.js';
import { finalizeFreshSale } from './finalizeFreshSale.js';
import {
  claimCheckoutApprovals,
  consumeCheckoutApprovals,
  enqueueCheckoutApprovalConsumptions,
  releaseCheckoutApprovals,
  requiredCheckoutApprovalActions,
} from './checkout-approvals.js';

/**
 * Fresh-sale path (formerly `sales.create`): resolve the cart from scratch,
 * compute the header (`resolveFreshSaleTotals`), and persist the whole sale
 * in one transaction. The header-total + payment-plan invariants (uniform
 * 2-decimal rounding, the negative-base guard, tip / service charge folding)
 * live in `pricing.ts`; see `completeSale` for the shared money + fiscal rules.
 *
 * Preconditions: the customer is valid, an active cash session exists for
 * `(tenant, site, cashier)` (`requireActiveCashSession`), and a sale
 * sequential is configured for the site.
 *
 * Postconditions: one committed sale (header + items + payments + stock +
 * inventory movement/balance + cash movement + sync queue + audit logs);
 * fiscal emission + journal effects fire best-effort post-commit.
 */
export async function runFreshSale(
  ctx: CompleteSaleContext,
  log: CompleteSaleLogger,
  input: Extract<CompleteSaleInput, { mode: 'fresh' }>
): Promise<CompleteSaleResult<CompleteSaleSaleRecord>> {
  const now = new Date().toISOString();
  const checkoutTiming = resolveFreshCheckoutTiming(input.status, input.checkoutStartedAt, now);
  const saleId = nanoid();

  await validateCustomer(ctx.db, ctx.tenantId, input.customerId);
  const activeCashSession = await requireActiveCashSession(
    ctx.db,
    ctx.tenantId,
    ctx.siteId,
    ctx.user.id
  );

  const sequentialContext = await getSaleSequentialContext(ctx.db, ctx.tenantId, ctx.siteId);
  const saleSiteId = activeCashSession.siteId;
  const resolvedItems = await resolveSaleItems(ctx.db, ctx.tenantId, saleSiteId, input.items);

  // ENG-178 — fresh-sale header math (subtotal/tax re-round, header
  // discount + negative-base guard, tip + service charge folded into
  // total) lives in resolveFreshSaleTotals; see its jsdoc for the
  // ENG-176a / ENG-039d / ENG-039d3 invariants.
  const {
    subtotal,
    taxAmount,
    headerDiscount,
    tipAmount,
    tipMethod,
    serviceChargeAmount,
    serviceChargeRate,
    total,
  } = await resolveFreshSaleTotals({
    db: ctx.db,
    tenantId: ctx.tenantId,
    resolvedSubtotal: resolvedItems.subtotal,
    resolvedTaxAmount: resolvedItems.taxAmount,
    discountAmount: input.discountAmount,
    tipAmount: input.tipAmount,
    tipMethod: input.tipMethod,
    serviceChargeAmount: input.serviceChargeAmount,
    status: input.status,
  });

  // Phase 2 Tier-2 step 5 — resolve the tender list (split or legacy),
  // payment status, change, and cash collected. `collectCash` carries
  // the fresh-only gate: a fresh sale persisted as a draft never hits
  // the drawer, so cash collected stays 0 until it lands `completed`.
  const { resolvedPayments, creditSaleAmount, paymentStatus, change, cashCollectedAmount } =
    resolveSalePaymentPlan({
      amountReceived: input.amountReceived,
      payments: input.payments,
      paymentMethod: input.paymentMethod,
      requestedStatus: input.paymentStatus,
      total,
      collectCash: input.status === 'completed',
    });

  // ENG-014 — credit-sale pre-flight. Only the credit portion creates a
  // `customer_ledger_entries.kind='sale'` row; the non-credit tenders
  // settle through the cash session as usual. The invariant + the
  // customer-required throw run BEFORE the sale tx so a cupo violation
  // never decrements stock / inserts a sale row that would have to be
  // voided.
  const creditProjection = await runCreditPreflight({
    db: ctx.db,
    tenantId: ctx.tenantId,
    creditSaleAmount,
    customerId: input.customerId,
    allowOverride: input.creditOverride === true,
    enabled: input.status === 'completed',
  });

  const nextSequentialValue = sequentialContext.currentValue + 1;
  const saleNumber = `${sequentialContext.prefix}${String(nextSequentialValue).padStart(6, '0')}`;
  const productStockState = new Map(resolvedItems.productStocks);

  const overrides = detectPriceOverrides(resolvedItems.rows);

  // Capture the row ids that will end up in operation_effects so we
  // emit them after the commit. better-sqlite3 transactions are
  // synchronous; everything that needs an awaitable side-effect (the
  // journal write or `enqueueSync`) runs OUTSIDE the tx callback.
  let cashMovementId: string | null = null;
  let priceOverrideAuditEmitted = false;
  let priceOverrideAuditId: string | null = null;
  const inventoryMovementIds: string[] = [];
  const paymentEffects: PersistedPaymentEffect[] = [];
  const lotShortfalls: Array<{ productId: string; shortfall: number }> = [];
  // ENG-192 — distinct lots this sale drew down. Collected inside the tx so
  // the mutated inventory_lots rows can be enqueued to the sync outbox
  // post-commit (they are marked sync-pending by consumeLotsForSaleLine, but
  // nothing pushed them to sync_outbox before this).
  const consumedLotIds = new Set<string>();

  // ENG-176b — resolve the tenant default currency once per sale and
  // propagate it to every row written below (sales header + each
  // sale_item). settle = sale and rate = 1.0 until ENG-156 lights up
  // multi-currency operations.
  const saleCurrencyCode = resolveTenantCurrency(ctx.db, ctx.tenantId);

  // Auditoría 2026-07 — which products on this cart opt into lot tracking.
  // Fetched once so the per-line stock loop can FEFO-consume their lots
  // inside the same transaction; non-lot products keep the plain path.
  const lotTrackedProductIds = new Set<string>();
  const serialTrackedProductIds = new Set<string>();
  {
    const cartProductIds = [...new Set(resolvedItems.rows.map(row => row.productId))];
    if (cartProductIds.length > 0) {
      const lotRows = await ctx.db
        .select({
          id: products.id,
          tracksLots: products.tracksLots,
          tracksSerials: products.tracksSerials,
        })
        .from(products)
        .where(
          and(eq(products.tenantId, ctx.tenantId), inArray(products.id, cartProductIds))
        )
        .all();
      for (const row of lotRows) {
        if (row.tracksLots) lotTrackedProductIds.add(row.id);
        if (row.tracksSerials) serialTrackedProductIds.add(row.id);
      }
    }
  }

  const approvalContext: CheckoutApprovalContext = {
    mode: 'fresh',
    saleId: null,
    customerId: input.customerId ?? null,
    items: input.items.map(item => ({
      productId: item.productId,
      unitId: item.unitId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discount: item.discount,
    })),
    paymentMethod: input.paymentMethod,
    payments: (input.payments ?? []).map(payment => ({
      method: payment.method,
      amount: payment.amount,
      reference: payment.reference,
    })),
    amountReceived: input.amountReceived ?? null,
    discountAmount: getCheckoutApprovalDiscountAmount(input.items, headerDiscount),
    total,
    creditAmount: creditSaleAmount,
    tipAmount,
    serviceChargeAmount,
    currencyCode: saleCurrencyCode,
  };
  const baselineApprovalActions = requiredCheckoutApprovalActions({
    role: ctx.user.role as UserRole,
    isCompletion: input.status === 'completed',
    // ENG-142a — discount authority is tenant policy, not a hard-coded
    // cashier boolean. Credit and override rules remain in the shared kernel.
    hasDiscount: false,
    hasCreditTender: creditSaleAmount > 0,
    creditOverride: input.creditOverride === true,
  });
  const lossPreventionEvaluation = await evaluateCheckoutLossPrevention({
    db: ctx.db,
    tenantId: ctx.tenantId,
    role: ctx.user.role,
    isCompletion: input.status === 'completed',
    items: approvalContext.items,
    discountAmount: approvalContext.discountAmount,
  });
  const requiredApprovalActions = [
    ...new Set([...baselineApprovalActions, ...lossPreventionEvaluation.requiredActions]),
  ];
  recordCheckoutLossPreventionTriggers({
    db: ctx.db,
    tenantId: ctx.tenantId,
    actorId: ctx.user.id,
    siteId: saleSiteId,
    checkoutResourceId: checkoutApprovalResourceId(approvalContext),
    mode: 'fresh',
    evaluation: lossPreventionEvaluation,
    providedActions: (input.approvalRequests ?? []).map(reference => reference.action),
    operationId: ctx.envelope?.operationId,
  });
  const approvalClaims = claimCheckoutApprovals({
    db: ctx.db,
    tenantId: ctx.tenantId,
    siteId: saleSiteId,
    requesterId: ctx.user.id,
    requiredActions: requiredApprovalActions,
    references: input.approvalRequests,
    context: approvalContext,
  });

  try {
    ctx.db.transaction(tx => {
      // ENG-042 TOCTOU defense — see helper jsdoc.
      assertCashSessionStillOpen(tx, ctx.tenantId, activeCashSession.id);

      tx.update(sequentials)
        .set({
          currentValue: nextSequentialValue,
          updatedAt: now,
        })
        .where(eq(sequentials.id, sequentialContext.id))
        .run();

      tx.insert(sales)
        .values({
          id: saleId,
          tenantId: ctx.tenantId,
          saleNumber,
          customerId: input.customerId,
          // ENG-039c — restaurant table FK passed through from the
          // tRPC layer (already tenant/site-scoped + active-validated there).
          tableId: input.tableId ?? null,
          subtotal,
          taxAmount,
          discountAmount: headerDiscount,
          // ENG-176b — currency seam: every row stamps the tenant
          // default currency. ENG-156 will replace these defaults with
          // explicit operator-supplied currency + rate when the sale
          // crosses currencies.
          currencyCode: saleCurrencyCode,
          exchangeRateAtSale: 1,
          settleCurrencyCode: null,
          // ENG-039d — tip persisted alongside the existing money columns.
          tipAmount,
          tipMethod,
          // ENG-039d3 — service charge persisted alongside tip; both feed
          // `total` so payment + receipt rendering stay consistent.
          serviceChargeAmount,
          serviceChargeRate,
          total,
          // Echo the dominant tender onto the legacy `paymentMethod`
          // column so older screens that read it directly keep
          // rendering sensibly.
          paymentMethod: resolvedPayments.dominantMethod,
          paymentStatus,
          status: input.status,
          cashSessionId: activeCashSession.id,
          notes: input.notes,
          createdBy: ctx.user.id,
          ...checkoutTiming,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      // Phase 2 Tier-2 step 5 — persist one row per tender.
      for (const payment of resolvedPayments.rows) {
        const paymentId = nanoid();
        // ENG-176a-rounding — sale_payments.amount carries a precision
        // CHECK; round at the write boundary because split-payment
        // resolvers can compute fractional shares
        // (`total * weight`) that leave sub-cent drift.
        const tenderAmount = roundMoney(payment.amount);
        tx.insert(salePayments)
          .values({
            id: paymentId,
            tenantId: ctx.tenantId,
            saleId,
            method: payment.method,
            amount: tenderAmount,
            reference: payment.reference,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();
        paymentEffects.push({
          id: paymentId,
          method: payment.method,
          amount: tenderAmount,
        });
      }

      for (const row of resolvedItems.rows) {
        tx.insert(saleItems)
          .values({
            id: row.id,
            saleId,
            productId: row.productId,
            quantity: row.quantity,
            unitPrice: row.unitPrice,
            unitId: row.unitId,
            unitEquivalence: row.unitEquivalence,
            discount: row.discount,
            taxRate: row.taxRate,
            taxAmount: row.taxAmount,
            costAtSale: row.costAtSale,
            total: row.total,
            // ENG-176b — line inherits the header currency seam so a
            // future row-level join can answer "what currency was this
            // line in?" without re-joining to sales.
            currencyCode: saleCurrencyCode,
            exchangeRateAtSale: 1,
            settleCurrencyCode: null,
            // ENG-039d2 — per-line modifier captured at sale creation.
            notes: row.notes,
          })
          .run();

        if (serialTrackedProductIds.has(row.productId)) {
          if (input.status !== 'draft' && input.status !== 'completed') {
            throwServerError({
              trpcCode: 'BAD_REQUEST',
              errorCode: 'PRODUCT_SERIAL_SALE_STATUS_INVALID',
              message: 'Serialized products can only be created as draft or completed sales',
            });
          }
          assignProductSerialsToSaleLine(tx as unknown as typeof ctx.db, {
            tenantId: ctx.tenantId,
            siteId: saleSiteId,
            productId: row.productId,
            saleItemId: row.id,
            serialIds: row.serialIds,
            normalizedQuantity: row.normalizedQuantity,
            targetStatus: input.status === 'completed' ? 'sold' : 'reserved',
            now,
            syncContext: { ...ctx, db: tx as unknown as typeof ctx.db },
          });
        } else if (row.serialIds.length > 0) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'PRODUCT_SERIAL_SELECTION_NOT_ALLOWED',
            message: 'Serial numbers were supplied for a product that does not track serials',
          });
        }

        const effectivePreviousStock = productStockState.get(row.productId) ?? 0;
        const newStock = effectivePreviousStock - row.normalizedQuantity;
        productStockState.set(row.productId, newStock);

        const inventoryMovementId = nanoid();
        tx.insert(inventoryMovements)
          .values({
            id: inventoryMovementId,
            tenantId: ctx.tenantId,
            productId: row.productId,
            type: 'sale',
            quantity: row.normalizedQuantity,
            previousStock: effectivePreviousStock,
            newStock,
            reference: saleId,
            notes: `Sale ${saleNumber} · ${sequentialContext.siteName}`,
            createdBy: ctx.user.id,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();
        inventoryMovementIds.push(inventoryMovementId);

        // Phase 2 API-103 — debit the cash session's site so per-site
        // balances reflect where the sale actually happened.
        applyInventoryBalanceDelta(tx, {
          tenantId: ctx.tenantId,
          siteId: saleSiteId,
          productId: row.productId,
          delta: -row.normalizedQuantity,
          initialOnHandIfMissing: effectivePreviousStock,
          serialAware: serialTrackedProductIds.has(row.productId),
          now,
        });

        // Auditoría 2026-07 — FEFO lot consumption for lot-tracked products.
        // Runs after the sale_item insert (the provenance FK needs it) and the
        // balance debit. A shortfall means the lots under-count the balance
        // that already gated this sale; we do not block the register, we
        // record it for the drift report.
        if (lotTrackedProductIds.has(row.productId)) {
          const { selection, shortfall } = consumeLotsForSaleLine(tx, {
            tenantId: ctx.tenantId,
            siteId: saleSiteId,
            productId: row.productId,
            saleItemId: row.id,
            quantity: row.normalizedQuantity,
            now,
          });
          for (const allocation of selection.allocations) {
            consumedLotIds.add(allocation.lotId);
          }
          if (shortfall > 0) {
            lotShortfalls.push({ productId: row.productId, shortfall });
          }
        }
      }

      cashMovementId = insertCashMovement({
        tx,
        tenantId: ctx.tenantId,
        sessionId: activeCashSession.id,
        type: 'sale',
        amount: cashCollectedAmount,
        referenceId: saleId,
        note: `Sale ${saleNumber} · ${sequentialContext.siteName}`,
        createdBy: ctx.user.id,
        createdAt: now,
      });

      if (overrides.length > 0) {
        // ENG-007 — single audit row summarizing every overridden line.
        priceOverrideAuditId = writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user.id,
          action: 'sale.price_override',
          resourceType: 'sale',
          resourceId: saleId,
          before: null,
          after: {
            saleNumber,
            overrideCount: overrides.length,
          },
          metadata: { overrides },
        });
        priceOverrideAuditEmitted = priceOverrideAuditId !== null;
      }

      // ENG-007 closure — admin authorised a credit sale whose projected
      // balance exceeded the customer's cupo. `overrideApplied` is true
      // only when (exceedsLimit && allowOverride === true), so the row
      // never fires for admin-completed sales that stayed under the
      // limit. Keeps the audit log clean of admin-completion noise.
      if (creditProjection?.overrideApplied === true && input.customerId) {
        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user.id,
          action: 'sale.credit_override',
          resourceType: 'sale',
          resourceId: saleId,
          before: null,
          after: {
            customerId: input.customerId,
            creditLimit: creditProjection.creditLimit,
            currentBalance: creditProjection.currentBalance,
            projectedBalance: creditProjection.projectedBalance,
            attemptedAmount: creditProjection.attemptedAmount,
          },
          metadata: {
            actorRole: ctx.user.role,
            saleNumber,
          },
        });
      }
      consumeCheckoutApprovals({
        tx,
        tenantId: ctx.tenantId,
        requesterId: ctx.user.id,
        claims: approvalClaims,
        saleId,
        saleNumber,
      });
    });
  } catch (error) {
    releaseCheckoutApprovals(ctx.db, ctx.tenantId, approvalClaims);
    throw error;
  }

  await enqueueCheckoutApprovalConsumptions(ctx, approvalClaims);

  return finalizeFreshSale({
    ctx,
    log,
    input,
    sale: {
      id: saleId,
      number: saleNumber,
      siteId: saleSiteId,
      cashSessionId: activeCashSession.id,
    },
    amounts: { subtotal, taxAmount, headerDiscount, total },
    payment: {
      creditSaleAmount,
      paymentStatus,
      change,
      dominantMethod: resolvedPayments.dominantMethod,
      cashCollectedAmount,
      effects: paymentEffects,
    },
    persistence: {
      inventoryMovementIds,
      cashMovementId,
      priceOverrideAuditEmitted,
      priceOverrideAuditId,
    },
    inventory: {
      consumedLotIds: [...consumedLotIds],
      lotShortfalls,
    },
    creditProjection,
  });
}
