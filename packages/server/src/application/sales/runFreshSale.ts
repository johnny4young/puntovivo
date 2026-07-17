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
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  assertCashSessionStillOpen,
  insertCashMovement,
  requireActiveCashSession,
} from '../../services/cash-session.js';
import { applyInventoryBalanceDelta } from '../../services/inventory-balances.js';
import {
  consumeLotsForSaleLine,
  enqueueInventoryLotUpdatesForSale,
} from '../../services/inventory-lots/index.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import { inArray } from 'drizzle-orm';
import {
  detectPriceOverrides,
  getSaleSequentialContext,
  resolveSaleItems,
  validateCustomer,
} from './item-resolution.js';
import { resolveFreshSaleTotals, resolveSalePaymentPlan } from './pricing.js';
import { earnPointsForSale, resolveLoyaltySettings } from '../../services/loyalty.js';
import { runCreditPreflight, safelyRecordCreditSaleLedger } from './creditPolicy.js';
import { emitSaleFiscalDocument, enqueueSaleKdsOrder } from './fiscalPostHook.js';
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
} from './types.js';

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
  /** ENG-213 — points this sale accrued (0 when the program is off). */
  let loyaltyPointsEarned = 0;

  // ENG-176b — resolve the tenant default currency once per sale and
  // propagate it to every row written below (sales header + each
  // sale_item). settle = sale and rate = 1.0 until ENG-156 lights up
  // multi-currency operations.
  const saleCurrencyCode = resolveTenantCurrency(ctx.db, ctx.tenantId);

  // Auditoría 2026-07 — which products on this cart opt into lot tracking.
  // Fetched once so the per-line stock loop can FEFO-consume their lots
  // inside the same transaction; non-lot products keep the plain path.
  const lotTrackedProductIds = new Set<string>();
  {
    const cartProductIds = [...new Set(resolvedItems.rows.map(row => row.productId))];
    if (cartProductIds.length > 0) {
      const lotRows = await ctx.db
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            eq(products.tenantId, ctx.tenantId),
            eq(products.tracksLots, true),
            inArray(products.id, cartProductIds)
          )
        )
        .all();
      for (const row of lotRows) lotTrackedProductIds.add(row.id);
    }
  }

  // ENG-213 — loyalty rule resolved BEFORE the tx (the settings read is
  // async; the tx body is synchronous). Off by default, so an untuned
  // tenant pays one cheap settings read and nothing else.
  const loyaltySettings = await resolveLoyaltySettings(ctx.db, ctx.tenantId);

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

    // ENG-213 — accrue loyalty points for a completed sale with a customer.
    // Inside the tx so points and the sale commit together; best-effort by
    // contract — a loyalty failure must NEVER block the register, so the
    // call is wrapped and only logged. Idempotent per (account, sale).
    //
    // The nested transaction is a SAVEPOINT, and it is load-bearing: the
    // ledger row and the balance update are two writes, so a failure
    // between them would otherwise leave a movement with no matching
    // balance — and the catch would let that partial state ride to COMMIT,
    // breaking the `points ≡ Σ(movements)` parity this feature rests on.
    // The savepoint rolls back the half-write only; the sale still commits.
    if (input.status === 'completed') {
      try {
        tx.transaction(loyaltyTx => {
          loyaltyPointsEarned = earnPointsForSale(loyaltyTx, {
            tenantId: ctx.tenantId,
            customerId: input.customerId ?? null,
            saleId,
            total,
            settings: loyaltySettings,
            nowIso: now,
          });
        });
      } catch (error) {
        loyaltyPointsEarned = 0;
        ctx.log?.warn?.({ err: error, saleId }, 'loyalty accrual skipped');
      }
    }

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
  });

  // Auditoría 2026-07 — surface any lot/balance drift the FEFO consumption
  // could not fully cover. The sale already committed (stock balance gated
  // it); this is a data-integrity signal for the reconcile/discrepancy view.
  if (lotShortfalls.length > 0) {
    log.warn?.(
      { saleId, saleNumber, lotShortfalls },
      '[completeSale] lot-tracked lines had a FEFO shortfall (lots under-count the balance)'
    );
  }

  const created = await getSaleRecord(ctx.db, ctx.tenantId, saleId);

  // ENG-064b — sync_outbox emit moved POST-tx. The helper writes the
  // operation_effects row (kind=outbox_enqueue:sync) itself when an
  // envelope context is present.
  await enqueueSync(ctx, {
    entityType: 'sales',
    entityId: saleId,
    operation: 'create',
    data: {
      id: saleId,
      saleNumber,
      total,
      siteId: saleSiteId,
      cashSessionId: activeCashSession.id,
      paymentStatus,
    },
  });

  // ENG-192 — the FEFO consumption above mutated these lots (on_hand drawn
  // down, possibly depleted) and marked them sync-pending; enqueue each one
  // so the mutation actually reaches sync_outbox instead of waiting for the
  // next receive to touch the row.
  await enqueueInventoryLotUpdatesForSale(ctx, [...consumedLotIds], saleId);

  // ENG-090 — write the customer ledger receivable for full-credit
  // sales. Best-effort post-tx (a ledger write failure does not roll
  // back the already-committed sale). `creditProjection` is captured
  // for the future audit-metadata wire-up (`projectedBalance` becomes
  // the receipt's saldo posterior when ENG-090b lands).
  await safelyRecordCreditSaleLedger({
    db: ctx.db,
    log,
    tenantId: ctx.tenantId,
    customerId: input.customerId,
    creditSaleAmount,
    saleId,
    createdBy: ctx.user.id,
    note: saleNumber,
    projectedBalance: creditProjection?.projectedBalance ?? null,
    enabled: input.status === 'completed',
    logLabel: '[completeSale]',
  });
  void creditProjection;

  // ENG-020 — emit DIAN DEE when a direct-sale (non-draft) lands as
  // `completed`. Drafts never emit. Runs post-tx best-effort.
  const fiscalEmitId = await emitSaleFiscalDocument({
    db: ctx.db,
    tenantId: ctx.tenantId,
    userId: ctx.user.id,
    log,
    saleId,
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
        saleId,
        saleNumber,
        siteId: saleSiteId,
        cashSessionId: activeCashSession.id,
        customerId: input.customerId,
        subtotal,
        taxAmount,
        discountAmount: headerDiscount,
        total,
        paymentMethod: resolvedPayments.dominantMethod,
      });
    }

    const effects = buildFreshSaleEffects({
      saleId,
      saleNumber,
      total,
      dominantMethod: resolvedPayments.dominantMethod,
      paymentStatus,
      status: input.status,
      paymentEffects,
      inventoryMovementIds,
      cashMovementId,
      sessionId: activeCashSession.id,
      cashCollectedAmount,
      priceOverrideAuditEmitted,
      priceOverrideAuditId,
      fiscalEmitId,
    });
    await emitCompleteSaleEffects(ctx.db, log, journalEventId, effects);
  }

  // ENG-098 — push to the kitchen display when the sale carries a
  // tableId. Idempotent against the suspend-then-complete progression
  // via UNIQUE(tenant_id, sale_id, station); a second fire is a no-op.
  await enqueueSaleKdsOrder(ctx, input.tableId, saleId);

  return {
    sale: { ...created, change } as CompleteSaleSaleRecord,
    change,
    journalEventId,
    // ENG-213 — surfaced so the POS can celebrate the accrual right after
    // checkout; 0 when the program is off or the sale had no customer.
    loyaltyPointsEarned,
  };
}
