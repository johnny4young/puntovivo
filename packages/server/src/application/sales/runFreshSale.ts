import { assertExternalAcceptance, bindExternalSale } from '../external-orders/sale-binding.js';
import { assertNoReservationHold } from '../reservations/invariants.js';
/**
 * Fresh-sale path of the `completeSale` use-case, extracted
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

import { submitKitchenSaleInTransaction } from '../kds/submit.js';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { UserRole } from '@puntovivo/shared/roles';
import { roundQuantity } from '@puntovivo/shared/unit-math';
import {
  getCheckoutApprovalDiscountAmount,
  type CheckoutApprovalContext,
} from '@puntovivo/shared/checkout-approval';
import {
  inventoryMovements,
  inventoryBalances,
  products,
  salePayments,
  saleItems,
  saleItemTaxComponents,
  sales,
  tenants,
} from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';
import { resolveTenantCurrency } from '../../lib/currency.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { QUANTITY_EPSILON } from '../../lib/quantity.js';
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
import { allocateNextSequential } from '../../services/sequential-allocation.js';
import {
  consumeLotsForSaleLine,
  enqueueInventoryLotUpdatesForSaleInTransaction,
} from '../../services/inventory-lots/index.js';
import { assignProductSerialsToSaleLine } from '../../services/product-serials.js';
import { inArray } from 'drizzle-orm';
import {
  assertSaleCustomerStillEligible,
  detectPriceOverrides,
  getSaleSequentialContext,
  resolveSaleCustomer,
  resolveSaleItems,
} from './item-resolution.js';
import { resolveFreshSaleTotals, resolveSalePaymentPlan } from './pricing.js';
import { earnPointsForSale, resolveLoyaltySettings } from '../../services/loyalty.js';
import {
  enforceCreditLimit,
  recordCreditSaleLedgerInTransaction,
  runCreditPreflight,
} from './creditPolicy.js';
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
import { resolveSaleHeaderReceiptSnapshots } from './receipt-snapshots.js';
import { assertQuotationConversion, finalizeQuotationConversion } from './quotation-conversion.js';
import { createSaleCompletionCommandResultRef } from '../../services/idempotency/commandResultRef.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import { assertSaleExchange, finalizeSaleExchange } from './exchange.js';
import {
  assertCustomerValueTenderInputs,
  captureEarnedLoyaltyRefs,
  createCustomerValueRedemptionRefs,
  enqueueCustomerValueRedemptions,
  loyaltyEarningBase,
  redeemCustomerValueTender,
} from './customer-value-tenders.js';
import { applyPromotionQuote, promotionPricingLines } from './promotion-pricing.js';
import {
  assertPromotionQuoteFingerprint,
  persistSaleItemPromotionSnapshots,
  quotePromotions,
  type PromotionCheckoutQuote,
} from '../../services/promotions.js';
import { parsePricingSettings } from '../../services/pricing-settings.js';
import { resolveTenantBusinessClock } from '../../services/pharmacy/business-clock.js';
import { allocatePharmacyEvidenceForSale } from '../pharmacy/checkout.js';
import {
  assertDineInStillActive,
  openRestaurantCheckInTransaction,
} from '../restaurant/service-lifecycle.js';
import {
  insertFiscalIntentInTransaction,
  prepareSaleFiscalIntent,
} from '../../services/fiscal/orchestrator/intents.js';
import type { ResolvedLine } from '../../services/fiscal/orchestrator/types.js';

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
 * inventory movement/balance + cash movement + sync queue + audit logs, plus
 * a frozen fiscal intent when applicable); fiscal materialization, provider
 * delivery, and journal effects run best-effort after commit.
 */
export async function runFreshSale(
  ctx: CompleteSaleContext,
  log: CompleteSaleLogger,
  input: Extract<CompleteSaleInput, { mode: 'fresh' }>
): Promise<CompleteSaleResult<CompleteSaleSaleRecord>> {
  if (
    input.restaurant &&
    (input.status !== 'draft' || input.tableId !== input.restaurant.tableId)
  ) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'Atomic restaurant service metadata requires a matching draft table',
    });
  }
  const businessClock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
  const now = businessClock.nowIso;
  const checkoutTiming = resolveFreshCheckoutTiming(input.status, input.checkoutStartedAt, now);
  const saleId = nanoid();

  const resolvedCustomer = await resolveSaleCustomer(ctx.db, ctx.tenantId, input.customerId);
  // Modern clients send the ticket's explicit tier. Omission keeps the
  // pre-contract behavior for legacy clients by inheriting the customer tier.
  const appliedPriceTier = input.priceTier ?? resolvedCustomer.priceTier;
  const activeCashSession = await requireActiveCashSession(
    ctx.db,
    ctx.tenantId,
    ctx.siteId,
    ctx.user.id
  );

  const sequentialContext = await getSaleSequentialContext(ctx.db, ctx.tenantId, ctx.siteId);
  const saleSiteId = activeCashSession.siteId;
  const [manualResolvedItems, headerReceiptSnapshots] = await Promise.all([
    resolveSaleItems(ctx.db, ctx.tenantId, saleSiteId, input.items, appliedPriceTier),
    resolveSaleHeaderReceiptSnapshots(ctx.db, ctx.tenantId, {
      customerId: resolvedCustomer.customerId,
      siteId: saleSiteId,
      cashierId: ctx.user.id,
    }),
  ]);
  let resolvedItems = manualResolvedItems;
  let appliedPromotionQuote: PromotionCheckoutQuote | null = null;
  if (input.promotionFingerprint) {
    if (input.status !== 'completed' || input.sourceQuotationId) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'PROMOTION_STATE_INVALID',
        message: 'Promotion quotes cannot reprice drafts or accepted quotations',
      });
    }
    const tenantSettings = await ctx.db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, ctx.tenantId))
      .get();
    const pricing = parsePricingSettings(tenantSettings?.settings);
    appliedPromotionQuote = quotePromotions(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: saleSiteId,
      customerId: resolvedCustomer.customerId,
      lines: promotionPricingLines(manualResolvedItems),
      priceIncludesTax: pricing.priceIncludesTax,
      headerDiscountAmount: input.discountAmount ?? 0,
      nowIso: now,
      businessDate: businessClock.businessDate,
    });
    assertPromotionQuoteFingerprint(appliedPromotionQuote, input.promotionFingerprint);
    resolvedItems = applyPromotionQuote(manualResolvedItems, appliedPromotionQuote);
  }

  // fresh-sale header math (subtotal/tax re-round, header
  // discount + negative-base guard, tip + service charge folded into
  // total) lives in resolveFreshSaleTotals; see its JSDoc for the
  // money, tax and payment invariants.
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

  // resolve the tender list (split or legacy),
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
  const loyaltySettings = await resolveLoyaltySettings(ctx.db, ctx.tenantId);
  assertCustomerValueTenderInputs({
    customerId: resolvedCustomer.customerId,
    payments: resolvedPayments.rows,
    legacyMethod: input.paymentMethod,
    loyaltySettings,
    isCompletion: input.status === 'completed',
  });
  const loyaltyAccrualTotal = loyaltyEarningBase(total, resolvedPayments.rows);

  // credit-sale pre-flight. Only the credit portion creates a
  // `customer_ledger_entries.kind='sale'` row; the non-credit tenders
  // settle through the cash session as usual. The invariant + the
  // customer-required throw run BEFORE the sale tx so a cupo violation
  // never decrements stock / inserts a sale row that would have to be
  // voided.
  let creditProjection = await runCreditPreflight({
    db: ctx.db,
    tenantId: ctx.tenantId,
    creditSaleAmount,
    customerId: resolvedCustomer.customerId,
    allowOverride: input.creditOverride === true,
    enabled: input.status === 'completed',
  });

  let saleNumber = '';
  const productStockState = new Map(resolvedItems.productStocks);

  const overrides = detectPriceOverrides(resolvedItems.rows);

  // Capture the row ids that will end up in operation_effects after commit.
  // Domain rows and authoritative replication intent are synchronous and
  // atomic; only observability and external hooks remain best-effort.
  let cashMovementId: string | null = null;
  let priceOverrideAuditEmitted = false;
  let priceOverrideAuditId: string | null = null;
  const inventoryMovementIds: string[] = [];
  const paymentEffects: PersistedPaymentEffect[] = [];
  const syncOutboxIds: string[] = [];
  const customerValueRefs = createCustomerValueRedemptionRefs();
  let exchangeId: string | null = null;
  // Distinct lots this sale drew down. Their post-consumption snapshots are
  // enqueued before commit so a successful ticket cannot lose replication
  // intent in the gap between COMMIT and the former post-commit hook.
  const consumedLotIds = new Set<string>();
  /** points this sale accrued (0 when the program is off). */
  let loyaltyPointsEarned = 0;

  // resolve the tenant default currency once per sale and
  // propagate it to every row written below (sales header + each
  // sale_item). settle = sale and rate = 1.0 until  lights up
  // multi-currency operations.
  const saleCurrencyCode = resolveTenantCurrency(ctx.db, ctx.tenantId);

  const fiscalLines: ResolvedLine[] = resolvedItems.rows.map((row, index) => ({
    lineNumber: index + 1,
    productId: row.productId,
    productName: row.productName,
    productSku: row.productSku,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    discountAmount: roundMoney((roundMoney(row.unitPrice * row.quantity) * row.discount) / 100),
    taxRate: row.taxRate,
    taxKind: row.taxKind,
    taxAmount: row.taxAmount,
    taxComponents: row.taxComponents,
    lineTotal: row.total,
    unitStandardCode: row.unitStandardCode,
  }));
  const preparedFiscalIntent =
    input.status === 'completed'
      ? await prepareSaleFiscalIntent({
          db: ctx.db,
          tenantId: ctx.tenantId,
          userId: ctx.user.id,
          saleId,
          siteId: saleSiteId,
          customerId: resolvedCustomer.customerId,
          paymentMethod: resolvedPayments.dominantMethod,
          amounts: {
            subtotal,
            taxAmount,
            discountAmount: headerDiscount,
            total,
          },
          lines: fiscalLines,
          completedAt: now,
          log,
        })
      : null;

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
        .where(and(eq(products.tenantId, ctx.tenantId), inArray(products.id, cartProductIds)))
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
    customerId: resolvedCustomer.customerId,
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
      loyaltyPoints: payment.loyaltyPoints ?? null,
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
    // discount authority is tenant policy, not a hard-coded
    // cashier boolean. Credit and override rules remain in the shared kernel.
    hasDiscount: false,
    // A keyboard-wedge price is operator input, not trusted label provenance.
    // Accepted quotations are already manager/admin-authored frozen terms;
    // every other off-grid price requires an exact cashier escalation.
    hasPriceOverride: overrides.length > 0 && !input.sourceQuotationId,
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

  // Reserve the single SQLite writer before the first sale mutation.
  // A deferred transaction can lose a read-to-write upgrade race and surface
  // SQLITE_BUSY immediately even though busy_timeout is enabled.
  const writeTransactionConfig = { behavior: 'immediate' } as const;

  try {
    ctx.db.transaction(tx => {
      // TOCTOU defense — see helper jsdoc.
      assertCashSessionStillOpen(tx, ctx.tenantId, activeCashSession.id);
      assertSaleCustomerStillEligible(tx, ctx.tenantId, resolvedCustomer.customerId);
      if (input.tableId && !input.restaurant) {
        // Generic tableId is retained only for legacy clients. It still belongs
        // to the dine-in module and must fail closed under the same writer lock
        // as the sale insert so a concurrent module disable cannot hide work.
        assertDineInStillActive(tx as unknown as typeof ctx.db, ctx.tenantId);
        // A later suspend failure cannot undo this first sale/stock/KDS commit.
        // Occupancy is checked now under the writer, not at the frozen fiscal time.
        assertNoReservationHold(tx as unknown as typeof ctx.db, ctx.tenantId, input.tableId);
      }

      const acceptedExternalOrder = assertExternalAcceptance(
        tx as unknown as typeof ctx.db,
        ctx,
        input,
        { subtotal, taxAmount, total },
        saleCurrencyCode,
        resolvedItems
      );
      if (input.sourceQuotationId) {
        assertQuotationConversion(tx as unknown as typeof ctx.db, {
          tenantId: ctx.tenantId,
          siteId: saleSiteId,
          quotationId: input.sourceQuotationId,
          customerId: resolvedCustomer.customerId,
          priceTier: appliedPriceTier,
          inputItems: input.items,
          resolvedItems,
          saleTotals: { subtotal, taxAmount, total },
          saleCurrency: {
            currencyCode: saleCurrencyCode,
            exchangeRateAtSale: 1,
            settleCurrencyCode: null,
          },
          now,
        });
      }
      if (appliedPromotionQuote) {
        const tenantSettings = tx
          .select({ settings: tenants.settings })
          .from(tenants)
          .where(eq(tenants.id, ctx.tenantId))
          .get();
        const pricing = parsePricingSettings(tenantSettings?.settings);
        const transactionalQuote = quotePromotions(tx as unknown as typeof ctx.db, {
          tenantId: ctx.tenantId,
          siteId: saleSiteId,
          customerId: resolvedCustomer.customerId,
          lines: promotionPricingLines(manualResolvedItems),
          priceIncludesTax: pricing.priceIncludesTax,
          headerDiscountAmount: input.discountAmount ?? 0,
          nowIso: now,
          businessDate: businessClock.businessDate,
        });
        assertPromotionQuoteFingerprint(transactionalQuote, input.promotionFingerprint);
      }
      if (input.sourceReturnId) {
        assertSaleExchange(tx as unknown as typeof ctx.db, {
          tenantId: ctx.tenantId,
          saleReturnId: input.sourceReturnId,
          replacementCustomerId: resolvedCustomer.customerId,
        });
      }

      // The pre-flight above is only a fast UX failure. Re-project while the
      // SQLite writer is reserved so concurrent credit checkouts cannot both
      // spend the same remaining cupo.
      creditProjection = enforceCreditLimit({
        db: tx as unknown as typeof ctx.db,
        tenantId: ctx.tenantId,
        creditSaleAmount,
        customerId: resolvedCustomer.customerId,
        allowOverride: input.creditOverride === true,
        enabled: input.status === 'completed',
      });

      // The pre-transaction cart resolver provides fast feedback, but another
      // register may sell the same active-site stock before this writer starts.
      // Re-check the aggregate requested quantity per product while the writer
      // is reserved; the existing tenant-wide movement snapshots remain
      // unchanged and the balance delta below stays site-scoped.
      const requiredByProduct = new Map<string, number>();
      for (const row of resolvedItems.rows) {
        if (!row.tracksStock) continue;
        requiredByProduct.set(
          row.productId,
          roundQuantity((requiredByProduct.get(row.productId) ?? 0) + row.normalizedQuantity, 12)
        );
      }
      const stockProductIds = [...requiredByProduct.keys()];
      if (stockProductIds.length > 0) {
        const currentSiteRows = tx
          .select({ productId: inventoryBalances.productId, onHand: inventoryBalances.onHand })
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, ctx.tenantId),
              eq(inventoryBalances.siteId, saleSiteId),
              inArray(inventoryBalances.productId, stockProductIds)
            )
          )
          .all();
        const currentSiteStock = new Map(
          currentSiteRows.map(row => [row.productId, row.onHand] as const)
        );
        for (const [productId, requested] of requiredByProduct) {
          const available = currentSiteStock.get(productId) ?? 0;
          if (available + QUANTITY_EPSILON < requested) {
            const productName =
              resolvedItems.rows.find(row => row.productId === productId)?.productName ?? productId;
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'SALE_INSUFFICIENT_STOCK',
              message: `Insufficient stock for product "${productName}" at the active site. Available: ${available}, requested: ${requested}`,
              details: { productName, available, requested },
            });
          }
        }
      }

      saleNumber = allocateNextSequential(tx as unknown as typeof ctx.db, {
        tenantId: ctx.tenantId,
        sequentialId: sequentialContext.id,
        updatedAt: now,
      }).number;

      tx.insert(sales)
        .values({
          id: saleId,
          tenantId: ctx.tenantId,
          saleNumber,
          customerId: resolvedCustomer.customerId,
          priceTier: appliedPriceTier,
          customerNameSnapshot: headerReceiptSnapshots.customerNameSnapshot,
          siteNameSnapshot: headerReceiptSnapshots.siteNameSnapshot,
          cashierNameSnapshot: headerReceiptSnapshots.cashierNameSnapshot,
          ...(input.status === 'completed'
            ? {
                receiptIdentitySnapshotVersion:
                  headerReceiptSnapshots.receiptIdentitySnapshotVersion,
                companyNameSnapshot: headerReceiptSnapshots.companyNameSnapshot,
                companyTaxIdSnapshot: headerReceiptSnapshots.companyTaxIdSnapshot,
                companyAddressSnapshot: headerReceiptSnapshots.companyAddressSnapshot,
                companyPhoneSnapshot: headerReceiptSnapshots.companyPhoneSnapshot,
                companyEmailSnapshot: headerReceiptSnapshots.companyEmailSnapshot,
                customerTaxIdSnapshot: headerReceiptSnapshots.customerTaxIdSnapshot,
                receiptPresentationSnapshotVersion:
                  headerReceiptSnapshots.receiptPresentationSnapshotVersion,
                receiptTemplateIdSnapshot: headerReceiptSnapshots.receiptTemplateIdSnapshot,
                receiptTemplateKindSnapshot: headerReceiptSnapshots.receiptTemplateKindSnapshot,
                receiptTemplateNameSnapshot: headerReceiptSnapshots.receiptTemplateNameSnapshot,
                receiptTemplateLayoutSnapshot: headerReceiptSnapshots.receiptTemplateLayoutSnapshot,
                receiptLogoUrlSnapshot: headerReceiptSnapshots.receiptLogoUrlSnapshot,
                receiptLocaleSnapshot: headerReceiptSnapshots.receiptLocaleSnapshot,
              }
            : {}),
          // restaurant table FK passed through from the
          // tRPC layer (already tenant/site-scoped + active-validated there).
          tableId: input.tableId ?? null,
          subtotal,
          taxAmount,
          discountAmount: headerDiscount,
          // Currency seam: every row currently stamps the tenant default.
          // A future multi-currency flow must supply an explicit currency and
          // exchange rate rather than infer them after the sale is frozen.
          currencyCode: saleCurrencyCode,
          exchangeRateAtSale: 1,
          settleCurrencyCode: null,
          // tip persisted alongside the existing money columns.
          tipAmount,
          tipMethod,
          // service charge persisted alongside tip; both feed
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
          ...(input.externalOrder
            ? {
                suspendedAt: now,
                suspendedBy: ctx.user.id,
                suspendedLabel: acceptedExternalOrder?.externalId ?? null,
              }
            : input.restaurant
              ? {
                  suspendedAt: now,
                  suspendedBy: ctx.user.id,
                  suspendedLabel: input.restaurant.checkLabel?.trim() || null,
                }
              : input.status === 'draft'
                ? {
                    // A non-restaurant draft is an active renderer workspace,
                    // not a parked check. Claim it at creation so identity
                    // changes and competing registers can recover or reject it
                    // deterministically instead of leaving reserved stock in an
                    // invisible resumedBy=NULL row.
                    resumedBy: ctx.user.id,
                    resumedDeviceId: ctx.deviceId ?? null,
                  }
                : {}),
          createdBy: ctx.user.id,
          ...checkoutTiming,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      recordCreditSaleLedgerInTransaction({
        db: tx as unknown as typeof ctx.db,
        tenantId: ctx.tenantId,
        customerId: resolvedCustomer.customerId,
        creditSaleAmount,
        saleId,
        createdBy: ctx.user.id,
        note: saleNumber,
        enabled: input.status === 'completed',
      });

      // persist one row per tender.
      for (const payment of resolvedPayments.rows) {
        const paymentId = nanoid();
        // sale_payments.amount carries a precision
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
            loyaltyPoints: payment.loyaltyPoints ?? null,
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
        if (input.status === 'completed') {
          redeemCustomerValueTender(tx, {
            tenantId: ctx.tenantId,
            customerId: resolvedCustomer.customerId,
            saleId,
            salePaymentId: paymentId,
            payment,
            currencyCode: saleCurrencyCode,
            loyaltySettings,
            createdBy: ctx.user.id,
            now,
            refs: customerValueRefs,
          });
        }
      }

      for (const [rowIndex, row] of resolvedItems.rows.entries()) {
        tx.insert(saleItems)
          .values({
            id: row.id,
            saleId,
            productId: row.productId,
            productNameSnapshot: row.productName,
            productSkuSnapshot: row.productSku,
            quantity: row.quantity,
            unitPrice: row.unitPrice,
            catalogUnitPrice1: row.catalogUnitPrices.price,
            catalogUnitPrice2: row.catalogUnitPrices.price2,
            catalogUnitPrice3: row.catalogUnitPrices.price3,
            unitId: row.unitId,
            unitEquivalence: row.unitEquivalence,
            discount: row.discount,
            manualDiscountRate:
              appliedPromotionQuote?.lines[rowIndex]?.manualDiscountRate ?? row.discount,
            taxRate: row.taxRate,
            taxKind: row.taxKind,
            unitStandardCode: row.unitStandardCode,
            taxAmount: row.taxAmount,
            costAtSale: row.costAtSale,
            total: row.total,
            // line inherits the header currency seam so a
            // future row-level join can answer "what currency was this
            // line in?" without re-joining to sales.
            currencyCode: saleCurrencyCode,
            exchangeRateAtSale: 1,
            settleCurrencyCode: null,
            // per-line modifier captured at sale creation.
            notes: row.notes,
            restaurantModifierAmount: row.restaurantModifierAmount,
            // freeze the line's inventory semantics so a later
            // tracks_stock flip cannot desynchronize the reversal from
            // what this sale actually debited.
            tracksStockSnapshot: row.tracksStock,
          })
          .run();

        if (appliedPromotionQuote) {
          const lineQuote = appliedPromotionQuote.lines[rowIndex];
          if (!lineQuote || lineQuote.lineKey !== `fresh:${rowIndex}`) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'PROMOTION_QUOTE_STALE',
              message: 'Promotion quote no longer matches the sale lines',
            });
          }
          const persistedPromotions = persistSaleItemPromotionSnapshots(
            tx as unknown as typeof ctx.db,
            {
              tenantId: ctx.tenantId,
              saleItemId: row.id,
              promotions: lineQuote.promotions,
              createdAt: now,
              sync: { envelope: ctx.envelope ?? null, deviceId: ctx.deviceId ?? null },
            }
          );
          syncOutboxIds.push(...persistedPromotions.outboxIds);
        }

        for (const component of row.taxComponents) {
          tx.insert(saleItemTaxComponents)
            .values({
              id: nanoid(),
              tenantId: ctx.tenantId,
              saleItemId: row.id,
              componentKey: component.componentKey,
              vatRateId: component.vatRateId,
              taxKind: component.taxKind,
              taxRate: component.taxRate,
              taxableAmount: component.taxableAmount,
              taxAmount: component.taxAmount,
              position: component.position,
              createdAt: now,
            })
            .run();
        }

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

        // service line (tracksStock=false): the sale item row above
        // is recorded, but the line owns no inventory — skip the movement,
        // the balance delta, and lot consumption entirely.
        if (!row.tracksStock) {
          continue;
        }

        const effectivePreviousStock = productStockState.get(row.productId) ?? 0;
        const newStock = roundQuantity(effectivePreviousStock - row.normalizedQuantity, 12);
        productStockState.set(row.productId, newStock);

        const inventoryMovementId = nanoid();
        tx.insert(inventoryMovements)
          .values({
            id: inventoryMovementId,
            tenantId: ctx.tenantId,
            productId: row.productId,
            siteId: saleSiteId,
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

        // debit the cash session's site so per-site
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
        // balance debit. Any shortfall aborts this transaction: committing an
        // aggregate balance without complete lot provenance would make FEFO,
        // expiry controls, returns, and COGS untrustworthy.
        if (lotTrackedProductIds.has(row.productId)) {
          const { selection, shortfall } = consumeLotsForSaleLine(tx, {
            tenantId: ctx.tenantId,
            siteId: saleSiteId,
            productId: row.productId,
            saleItemId: row.id,
            quantity: row.normalizedQuantity,
            now,
            businessDate: businessClock.businessDate,
          });
          for (const allocation of selection.allocations) {
            consumedLotIds.add(allocation.lotId);
          }
          if (shortfall > 0) {
            const available = selection.allocations.reduce(
              (sum, allocation) => sum + allocation.quantity,
              0
            );
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'LOT_STOCK_INCONSISTENT',
              message: 'Sellable lot stock does not cover the requested quantity',
              details: {
                productId: row.productId,
                requested: row.normalizedQuantity,
                available,
                shortfall,
              },
            });
          }
        }
      }

      if (input.restaurant) {
        const opened = openRestaurantCheckInTransaction(
          tx as unknown as typeof ctx.db,
          {
            tenantId: ctx.tenantId,
            siteId: saleSiteId,
            actorId: ctx.user.id,
            now,
            deviceId: ctx.deviceId,
            envelope: ctx.envelope,
          },
          {
            saleId,
            saleNumber,
            saleItemIds: resolvedItems.rows.map(row => row.id),
            input: input.restaurant,
          }
        );
        tx.update(sales)
          .set({ suspendedLabel: opened.tableName })
          .where(and(eq(sales.id, saleId), eq(sales.tenantId, ctx.tenantId)))
          .run();
      }

      if (input.status === 'completed') {
        const pharmacyAllocation = allocatePharmacyEvidenceForSale(
          tx as unknown as typeof ctx.db,
          {
            tenantId: ctx.tenantId,
            actorId: ctx.user.id,
            siteId: saleSiteId,
            envelope: ctx.envelope ?? null,
            deviceId: ctx.deviceId ?? null,
          },
          {
            saleId,
            evidenceIds: input.pharmacyEvidenceIds ?? [],
            countryCode: businessClock.countryCode,
            businessDate: businessClock.businessDate,
            timezone: businessClock.timezone,
            localeVersion: businessClock.localeVersion,
            nowIso: now,
          }
        );
        syncOutboxIds.push(...pharmacyAllocation.syncOutboxIds);
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

      // accrue loyalty points for a completed sale with a customer.

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

              customerId: resolvedCustomer.customerId,

              saleId,

              total: loyaltyAccrualTotal,

              settings: loyaltySettings,

              nowIso: now,
            });
            if (loyaltyPointsEarned > 0) {
              captureEarnedLoyaltyRefs(loyaltyTx as unknown as typeof ctx.db, {
                tenantId: ctx.tenantId,
                saleId,
                refs: customerValueRefs,
              });
            }
          });
        } catch (error) {
          loyaltyPointsEarned = 0;

          ctx.log?.warn?.({ err: error, saleId }, 'loyalty accrual skipped');
        }
      }

      // Drafts can attach or change customer at payment time. Their
      // immutable override evidence is therefore emitted only by the
      // completion path against the final customer tier.
      if (input.status === 'completed' && overrides.length > 0) {
        // single audit row summarizing every overridden line.
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

      // closure — admin authorised a credit sale whose projected
      // balance exceeded the customer's cupo. `overrideApplied` is true
      // only when (exceedsLimit && allowOverride === true), so the row
      // never fires for admin-completed sales that stayed under the
      // limit. Keeps the audit log clean of admin-completion noise.
      if (creditProjection?.overrideApplied === true && resolvedCustomer.customerId) {
        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user.id,
          action: 'sale.credit_override',
          resourceType: 'sale',
          resourceId: saleId,
          before: null,
          after: {
            customerId: resolvedCustomer.customerId,
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
      if (input.sourceQuotationId) {
        finalizeQuotationConversion(tx as unknown as typeof ctx.db, {
          tenantId: ctx.tenantId,
          quotationId: input.sourceQuotationId,
          saleId,
          saleNumber,
          actorId: ctx.user.id,
          operationId: ctx.envelope?.operationId,
          now,
        });
      }
      if (input.sourceReturnId) {
        exchangeId = finalizeSaleExchange(tx as unknown as typeof ctx.db, {
          tenantId: ctx.tenantId,
          saleReturnId: input.sourceReturnId,
          replacementSaleId: saleId,
          actorId: ctx.user.id,
          now,
        });
      }
      if (acceptedExternalOrder)
        bindExternalSale(tx as unknown as typeof ctx.db, ctx, acceptedExternalOrder, saleId);
      consumeCheckoutApprovals({
        tx,
        tenantId: ctx.tenantId,
        requesterId: ctx.user.id,
        claims: approvalClaims,
        saleId,
        saleNumber,
      });
      const syncContext = {
        db: tx as unknown as typeof ctx.db,
        tenantId: ctx.tenantId,
        envelope: ctx.envelope ?? null,
        deviceId: ctx.deviceId ?? null,
      };
      syncOutboxIds.push(
        ...enqueueCustomerValueRedemptions(tx as unknown as typeof ctx.db, ctx, customerValueRefs)
      );
      syncOutboxIds.push(
        enqueueSyncInTransaction(syncContext, {
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
        }).id
      );
      syncOutboxIds.push(
        ...enqueueInventoryLotUpdatesForSaleInTransaction(syncContext, [...consumedLotIds], saleId)
      );
      if (exchangeId && input.sourceReturnId) {
        syncOutboxIds.push(
          enqueueSyncInTransaction(syncContext, {
            entityType: 'sale_exchanges',
            entityId: exchangeId,
            operation: 'create',
            data: {
              id: exchangeId,
              saleReturnId: input.sourceReturnId,
              replacementSaleId: saleId,
              createdBy: ctx.user.id,
              createdAt: now,
            },
          }).id
        );
      }
      insertFiscalIntentInTransaction(tx as unknown as typeof ctx.db, preparedFiscalIntent);
      if (
        input.status === 'completed' ||
        input.tableId ||
        input.restaurant ||
        input.externalOrder
      ) {
        submitKitchenSaleInTransaction(
          tx as unknown as typeof ctx.db,
          { tenantId: ctx.tenantId, siteId: saleSiteId, actorId: ctx.user.id },
          saleId
        );
      }
      ctx.completeInTransaction?.(
        tx as unknown as typeof ctx.db,
        createSaleCompletionCommandResultRef({
          saleId,
          responseShape: 'fresh',
          change,
          loyaltyPointsEarned,
        })
      );
    }, writeTransactionConfig);
  } catch (error) {
    releaseCheckoutApprovals(ctx.db, ctx.tenantId, approvalClaims);
    throw error;
  }

  await enqueueCheckoutApprovalConsumptions(ctx, approvalClaims);

  const finalized = await finalizeFreshSale({
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
      syncOutboxIds,
    },
  });
  // surfaced so the POS can celebrate the accrual right after
  // checkout; 0 when the program is off or the sale had no customer.
  return { ...finalized, loyaltyPointsEarned };
}
