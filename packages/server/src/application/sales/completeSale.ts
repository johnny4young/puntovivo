/**
 * ENG-054 — `completeSale` use-case service.
 *
 * Single entry point for both the fresh-sale path (formerly
 * `sales.create`) and the draft-completion path (formerly
 * `sales.completeDraft`). The service owns:
 *
 * - All pre-checks executed BEFORE the database transaction (customer
 *   validity, cash session presence, item resolution, tender shape,
 *   draft ownership / suspension state).
 * - One synchronous `db.transaction(...)` that writes every row the
 *   sale lifecycle touches: sequential, sales header, sale items,
 *   payments, product stock, inventory movement, inventory balance,
 *   cash movement, sync queue, and audit logs.
 * - Best-effort POST-commit hooks:
 *     * fiscal document emission via `safelyEmitFiscalDocument`,
 *     * sync_outbox enqueue via `enqueueSync` (writes its own
 *       `outbox_enqueue:sync` effect when an envelope is present),
 *     * journal effects (`sale_row`, `payment_row`, `inventory_movement`,
 *       `cash_movement`, `audit_log`, `fiscal_emit`) written to
 *       `operation_effects` when the call carried a journal envelope.
 *
 * Behavior parity with the previous inline router code is the explicit
 * acceptance criterion (ROADMAP §3b ENG-054). The control flow,
 * shape of the rows written, and ordering of side effects all match
 * what `sales.create` / `sales.completeDraft` used to do — this commit
 * is a refactor, not a redesign.
 *
 * @module application/sales/completeSale
 */

import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  customers,
  inventoryBalances,
  inventoryMovements,
  operationEvents,
  products,
  salePayments,
  saleItems,
  sales,
  sequentials,
  sites,
  unitXProduct,
  units,
} from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import { enqueueKdsOrder } from '../../services/kds/enqueue.js';
import type { KdsHookContext } from '../../services/kds/types.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { resolveTenantCurrency } from '../../lib/currency.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import {
  assertCashSessionStillOpen,
  insertCashMovement,
  requireActiveCashSession,
} from '../../services/cash-session.js';
import { safelyEmitFiscalDocument } from '../../services/fiscal/orchestrator.js';
import { assertServiceChargeMatchesTenant } from '../../services/restaurant/settings.js';
import { assertSaleQuantityAllowed } from '../../services/fraction-policy.js';
import {
  applyInventoryBalanceDelta,
  ensureInventoryBalancesForSite,
} from '../../services/inventory-balances.js';
import { createModuleLogger } from '../../logging/logger.js';
import { updateOperationSummary } from '../../services/operation-journal/journal.js';
import { resolveTenantLocale } from '../../services/tenant-locale.js';
import {
  getCashCollectedAmount,
  getNormalizedSaleQuantity,
  getPaymentStatus,
  resolveSalePayments,
} from './policies.js';
import { emitCompleteSaleEffects, type JournalEffectInput } from './journal-effects.js';
import { getSaleRecord } from './sale-read.js';
import type {
  CompleteSaleContext,
  CompleteSaleInput,
  CompleteSaleItemInput,
  CompleteSaleLogger,
  CompleteSaleResult,
  CompleteSaleTender,
} from './types.js';
// ENG-090 — credit-sale plumbing. The invariant runs pre-tx so a
// cupo violation never decrements stock / inserts a sale row that
// has to be voided. `recordCreditSaleLedger` runs post-tx (mirrors
// the fiscal emit pattern) so a ledger write never blocks the
// sale completion itself.
import { requireCreditLimitNotExceeded } from '../../services/credit-limit.js';
import { recordCreditSaleLedger } from './recordCreditSaleLedger.js';

const fallbackLog = createModuleLogger('application/sales/completeSale');

/**
 * ENG-098 — adapt the application-layer context shape to the KDS
 * hook helper input. `siteId` is widened to `string | null` here
 * because the application context types it as `string` (defaulting
 * to ''); the helper short-circuits on falsy site ids.
 */
function buildKdsHookContextFromAppCtx(ctx: CompleteSaleContext): KdsHookContext {
  return {
    db: ctx.db,
    tenantId: ctx.tenantId,
    siteId: ctx.siteId || null,
    user: { id: ctx.user.id },
    sse: ctx.sse ?? null,
    log: ctx.log,
  };
}

/* ------------------------------------------------------------------ */
/*  Shared resolver types — private to the service.                   */
/* ------------------------------------------------------------------ */

interface ResolvedSaleItem {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  /** ENG-007 — `unit_x_product.price` at line resolution time. */
  referenceUnitPrice: number;
  productName: string;
  unitId: string;
  unitEquivalence: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  costAtSale: number;
  total: number;
  normalizedQuantity: number;
  /**
   * ENG-039d2 — free-form per-line modifier captured at sale
   * creation time. Null when no modifier was entered. Items are
   * immutable after draft creation so this value round-trips
   * through suspend / resume / completeDraft unchanged.
   */
  notes: string | null;
}

interface SaleSequentialContext {
  id: string;
  prefix: string;
  currentValue: number;
  siteId: string;
  siteName: string;
}

interface ResolvedItemsBundle {
  productStocks: Map<string, number>;
  subtotal: number;
  taxAmount: number;
  rows: ResolvedSaleItem[];
}

interface PersistedPaymentEffect {
  id: string;
  method: CompleteSaleTender['method'];
  amount: number;
}

/* ------------------------------------------------------------------ */
/*  Pre-transaction primitives.                                       */
/* ------------------------------------------------------------------ */

async function validateCustomer(
  db: DatabaseInstance,
  tenantId: string,
  customerId: string | null | undefined
): Promise<void> {
  if (!customerId) {
    return;
  }

  const customer = await db
    .select({ id: customers.id, isActive: customers.isActive })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
    .get();

  if (!customer || customer.isActive === false) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_CUSTOMER_INVALID',
      message: 'Selected customer was not found or is inactive',
    });
  }
}

async function getSaleSequentialContext(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string | null
): Promise<SaleSequentialContext> {
  const baseConditions = [
    eq(sequentials.tenantId, tenantId),
    eq(sequentials.documentType, 'sale'),
    eq(sites.isActive, true),
  ];

  if (siteId) {
    const siteScoped = await db
      .select({
        id: sequentials.id,
        prefix: sequentials.prefix,
        currentValue: sequentials.currentValue,
        siteId: sequentials.siteId,
        siteName: sites.name,
      })
      .from(sequentials)
      .innerJoin(sites, eq(sequentials.siteId, sites.id))
      .where(and(...baseConditions, eq(sequentials.siteId, siteId)))
      .get();

    if (siteScoped) {
      return siteScoped;
    }
  }

  const fallback = await db
    .select({
      id: sequentials.id,
      prefix: sequentials.prefix,
      currentValue: sequentials.currentValue,
      siteId: sequentials.siteId,
      siteName: sites.name,
    })
    .from(sequentials)
    .innerJoin(sites, eq(sequentials.siteId, sites.id))
    .where(and(...baseConditions))
    .orderBy(asc(sites.name))
    .get();

  if (!fallback) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_SEQUENTIAL_MISSING',
      message: 'No active sale sequential is configured for the current tenant',
    });
  }

  return fallback;
}

async function resolveSaleItems(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string,
  inputItems: CompleteSaleItemInput[]
): Promise<ResolvedItemsBundle> {
  const productIds = [...new Set(inputItems.map(item => item.productId))];
  ensureInventoryBalancesForSite(db, tenantId, siteId);

  const productRows = await db
    .select()
    .from(products)
    .where(and(eq(products.tenantId, tenantId), inArray(products.id, productIds)))
    .all();
  const productMap = new Map(productRows.map(product => [product.id, product]));

  const unitAssignments = await db
    .select({
      productId: unitXProduct.productId,
      unitId: unitXProduct.unitId,
      equivalence: unitXProduct.equivalence,
      // ENG-007 — read the per-unit catalog price so the use-case can
      // detect manual price overrides.
      price: unitXProduct.price,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      isActive: units.isActive,
    })
    .from(unitXProduct)
    .innerJoin(units, eq(unitXProduct.unitId, units.id))
    .where(inArray(unitXProduct.productId, productIds))
    .all();

  const assignmentMap = new Map(
    unitAssignments.map(assignment => [
      `${assignment.productId}:${assignment.unitId}`,
      assignment,
    ])
  );

  const siteBalanceRows = await db
    .select({
      productId: inventoryBalances.productId,
      onHand: inventoryBalances.onHand,
    })
    .from(inventoryBalances)
    .where(
      and(
        eq(inventoryBalances.tenantId, tenantId),
        eq(inventoryBalances.siteId, siteId),
        inArray(inventoryBalances.productId, productIds)
      )
    )
    .all();
  const remainingSiteStockByProduct = new Map(
    siteBalanceRows.map(balance => [balance.productId, balance.onHand])
  );

  let subtotal = 0;
  let taxAmount = 0;
  const rows: ResolvedSaleItem[] = [];

  for (const item of inputItems) {
    const product = productMap.get(item.productId);
    if (!product || product.isActive === false) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'SALE_PRODUCT_INVALID',
        message: `Product ${item.productId} was not found or is inactive`,
        details: {
          productId: item.productId,
          productName: product?.name ?? item.productId,
        },
      });
    }

    const assignment = assignmentMap.get(`${item.productId}:${item.unitId}`);
    if (!assignment || assignment.isActive === false) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'SALE_UNIT_INVALID',
        message: `Unit selection is invalid for product "${product.name}"`,
        details: { productName: product.name, unitId: item.unitId },
      });
    }

    assertSaleQuantityAllowed(item.quantity, {
      name: product.name,
      sellByFraction: product.sellByFraction ?? false,
      fractionStep: product.fractionStep,
      fractionMinimum: product.fractionMinimum,
    });

    const normalizedQuantity = getNormalizedSaleQuantity(item.quantity, assignment.equivalence);
    const remainingStock = remainingSiteStockByProduct.get(item.productId) ?? 0;

    if (remainingStock < normalizedQuantity) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'SALE_INSUFFICIENT_STOCK',
        message: `Insufficient stock for product "${product.name}" at the active site. Available: ${remainingStock}, requested: ${normalizedQuantity}`,
        details: {
          productName: product.name,
          available: remainingStock,
          requested: normalizedQuantity,
        },
      });
    }

    remainingSiteStockByProduct.set(item.productId, remainingStock - normalizedQuantity);

    // ENG-176a-rounding — round each derived monetary quantity to two
    // decimals BEFORE accumulating into the running totals or pushing
    // into the row buffer. Without this, a tax-exclusive split
    // (`lineTotal / (1 + taxRate)`) produces non-terminating decimals
    // that the storage layer's `chk_*_2dec` CHECK would reject, and
    // a long line list would stack sub-cent drift across iterations.
    const grossAmount = roundMoney(item.unitPrice * item.quantity);
    const discountAmount = roundMoney(grossAmount * (item.discount / 100));
    const lineTotal = roundMoney(grossAmount - discountAmount);
    const taxRate = item.taxRate ?? product.taxRate ?? 0;
    const lineBase = roundMoney(
      taxRate > 0 ? lineTotal / (1 + taxRate / 100) : lineTotal
    );
    const lineTax = roundMoney(lineTotal - lineBase);

    subtotal = roundMoney(subtotal + lineBase);
    taxAmount = roundMoney(taxAmount + lineTax);

    rows.push({
      id: nanoid(),
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: roundMoney(item.unitPrice),
      referenceUnitPrice: assignment.price,
      productName: product.name,
      unitId: item.unitId,
      unitEquivalence: assignment.equivalence,
      discount: roundMoney(item.discount),
      taxRate,
      taxAmount: lineTax,
      costAtSale: roundMoney(product.cost),
      total: lineTotal,
      normalizedQuantity,
      // ENG-039d2 — empty / whitespace-only notes collapse to null so
      // the column stays semantically two-state (modifier present
      // vs absent). The Zod schema `.trim()`s the input, but callers
      // that bypass the schema (programmatic completeSale callers,
      // future bulk-import flows) may still pass a whitespace-only
      // string, so the resolver re-trims defensively.
      notes:
        typeof item.notes === 'string' && item.notes.trim().length > 0
          ? item.notes.trim()
          : null,
    });
  }

  return {
    productStocks: new Map(productRows.map(product => [product.id, product.stock])),
    subtotal,
    taxAmount,
    rows,
  };
}

/* ------------------------------------------------------------------ */
/*  Journal lookup — best-effort.                                     */
/* ------------------------------------------------------------------ */

async function lookupJournalEventId(
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
      and(
        eq(operationEvents.tenantId, tenantId),
        eq(operationEvents.operationId, operationId)
      )
    )
    .get();
  return row?.id ?? null;
}

async function safeUpdateSaleCompletedSummary(
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
    log.warn(
      { err, journalEventId },
      'operation summary update failed (non-blocking)'
    );
  }
}

/* ------------------------------------------------------------------ */
/*  Public entry point.                                               */
/* ------------------------------------------------------------------ */

/** Concrete shape of the sale record returned by `completeSale`. */
export type CompleteSaleSaleRecord = Awaited<ReturnType<typeof getSaleRecord>> & {
  change?: number;
};

export async function completeSale(
  ctx: CompleteSaleContext,
  input: CompleteSaleInput
): Promise<CompleteSaleResult<CompleteSaleSaleRecord>> {
  const log = ctx.log ?? fallbackLog;

  if (input.mode === 'fresh') {
    return runFreshSale(ctx, log, input);
  }
  return runCompleteDraft(ctx, log, input);
}

/* ------------------------------------------------------------------ */
/*  Fresh-sale path.                                                  */
/* ------------------------------------------------------------------ */

async function runFreshSale(
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

  // ENG-176a-rounding — resolveSaleItems already rounded the per-line
  // accumulations; we round again at the header level so any external
  // discount applied here cannot reintroduce sub-cent drift.
  const subtotal = roundMoney(resolvedItems.subtotal);
  const taxAmount = roundMoney(resolvedItems.taxAmount);
  const headerDiscount = roundMoney(input.discountAmount ?? 0);
  const baseTotal = roundMoney(subtotal + taxAmount - headerDiscount);
  if (baseTotal < 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_DISCOUNT_EXCEEDS_TOTAL',
      message: 'Discount amount cannot exceed the sale total',
    });
  }
  // ENG-039d — tip / propina rolls into `total` so payment validation
  // (Σ tenders ≈ total, amountReceived ≥ total) keeps working without
  // a special case downstream. The Zod refinement already rejects
  // `tipMethod` without a positive amount; we additionally clamp to 0
  // here as a defensive belt against any non-Zod caller.
  const tipAmount = roundMoney(Math.max(0, input.tipAmount ?? 0));
  const tipMethod = tipAmount > 0 ? input.tipMethod ?? null : null;
  // ENG-039d3 — restaurant service charge / propina sugerida. Rolls
  // into `total` after tip so multi-tender Σ stays consistent. The
  // tenant-settings drift check fires below once we know the resolved
  // subtotal.
  const serviceChargeAmount = roundMoney(Math.max(0, input.serviceChargeAmount ?? 0));
  // Draft creation is not checkout yet: it may persist a frozen cart
  // before the customer sees payment. Enforce the mandatory service
  // charge on completed fresh sales, and still validate any draft that
  // explicitly carries a non-zero service charge so stale amounts cannot
  // be stored.
  let serviceChargeRate: number | null = null;
  if (input.status !== 'draft' || serviceChargeAmount > 0) {
    const restaurantSettings = await assertServiceChargeMatchesTenant({
      db: ctx.db,
      tenantId: ctx.tenantId,
      base: baseTotal,
      serviceChargeAmount,
    });
    serviceChargeRate =
      serviceChargeAmount > 0 ? restaurantSettings.serviceChargeRate : null;
  }
  const total = roundMoney(baseTotal + tipAmount + serviceChargeAmount);

  // Phase 2 Tier-2 step 5 — resolve the tender list (split or legacy).
  const tenderInputs: CompleteSaleTender[] | undefined = input.payments?.map(payment => ({
    method: payment.method,
    amount: payment.amount,
    reference: payment.reference ?? null,
  }));
  const resolvedPayments = resolveSalePayments({
    payments: tenderInputs,
    legacyMethod: input.paymentMethod,
    amountReceived: input.amountReceived,
    total,
  });
  const isSplitPayment = input.payments !== undefined && input.payments.length > 0;
  // ENG-014 — sum credit tenders so the status, invariant, and ledger
  // hook all key off the same number. A split with cash + credit lands
  // here with rows=[{cash, $50}, {credit, $150}], so creditSaleAmount=150.
  const creditSaleAmount = resolvedPayments.rows
    .filter(row => row.method === 'credit')
    .reduce((sum, row) => sum + row.amount, 0);

  const paymentStatus = getPaymentStatus({
    amountReceived: input.amountReceived,
    paymentMethod: resolvedPayments.dominantMethod,
    requestedStatus: input.paymentStatus,
    total,
    isSplit: isSplitPayment,
    creditAmount: creditSaleAmount,
  });
  const change =
    input.amountReceived !== undefined && input.amountReceived > total
      ? input.amountReceived - total
      : 0;

  // Cash collected is the sum of cash-method tenders when split, or the
  // legacy amountReceived-minus-change when single-tender.
  // ENG-176a-rounding — each `payment.amount` is already two-decimal
  // (resolveSalePayments rounded it), but IEEE-754 addition of two
  // 2-decimal values can drift (10.10 + 10.20 = 20.299999…). The
  // downstream `insertCashMovement` re-rounds, but defend at the
  // source so a future refactor that bypasses that downstream rounder
  // cannot silently leak drift into cash_movements.amount.
  const cashCollectedAmount =
    input.status === 'completed'
      ? isSplitPayment
        ? resolvedPayments.rows
            .filter(payment => payment.method === 'cash')
            .reduce((acc, payment) => roundMoney(acc + payment.amount), 0)
        : getCashCollectedAmount({
            paymentMethod: input.paymentMethod,
            amountReceived: input.amountReceived,
            total,
            change,
          })
      : 0;

  if (
    !isSplitPayment &&
    input.amountReceived !== undefined &&
    paymentStatus === 'paid' &&
    input.amountReceived < total
  ) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_AMOUNT_RECEIVED_BELOW_TOTAL',
      message: 'Amount received cannot be less than the sale total for a paid sale',
    });
  }

  // ENG-014 — credit-sale pre-flight. `creditSaleAmount` already
  // computed above (sum of credit tenders). Only that portion creates
  // a `customer_ledger_entries.kind='sale'` row; the non-credit
  // tenders settle through the cash session as usual. The invariant +
  // customer-required throw run BEFORE the sale tx so a cupo violation
  // never decrements stock / inserts a sale row that would have to be
  // voided.
  const hasCreditPortion = creditSaleAmount > 0;
  let creditProjection: Awaited<
    ReturnType<typeof requireCreditLimitNotExceeded>
  > | null = null;
  if (hasCreditPortion && input.status === 'completed') {
    if (!input.customerId) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'CREDIT_SALE_CUSTOMER_REQUIRED',
        message: 'Credit sales require a customer to be attached',
      });
    }
    creditProjection = await requireCreditLimitNotExceeded({
      db: ctx.db,
      tenantId: ctx.tenantId,
      customerId: input.customerId,
      attemptedAmount: creditSaleAmount,
      allowOverride: input.creditOverride === true,
    });
  }

  const nextSequentialValue = sequentialContext.currentValue + 1;
  const saleNumber = `${sequentialContext.prefix}${String(nextSequentialValue).padStart(6, '0')}`;
  const productStockState = new Map(resolvedItems.productStocks);

  const PRICE_OVERRIDE_EPSILON = 0.005;
  const overrides = resolvedItems.rows
    .filter(
      row =>
        Math.abs(row.unitPrice - row.referenceUnitPrice) >= PRICE_OVERRIDE_EPSILON
    )
    .map(row => ({
      saleItemId: row.id,
      productId: row.productId,
      productName: row.productName,
      referenceUnitPrice: row.referenceUnitPrice,
      unitPrice: row.unitPrice,
      quantity: row.quantity,
    }));

  // Capture the row ids that will end up in operation_effects so we
  // emit them after the commit. better-sqlite3 transactions are
  // synchronous; everything that needs an awaitable side-effect (the
  // journal write or `enqueueSync`) runs OUTSIDE the tx callback.
  let cashMovementId: string | null = null;
  let priceOverrideAuditEmitted = false;
  let priceOverrideAuditId: string | null = null;
  const inventoryMovementIds: string[] = [];
  const paymentEffects: PersistedPaymentEffect[] = [];

  // ENG-176b — resolve the tenant default currency once per sale and
  // propagate it to every row written below (sales header + each
  // sale_item). settle = sale and rate = 1.0 until ENG-156 lights up
  // multi-currency operations.
  const saleCurrencyCode = resolveTenantCurrency(ctx.db, ctx.tenantId);

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

      tx.update(products)
        .set({
          stock: newStock,
          syncStatus: 'pending',
          syncVersion: sql`${products.syncVersion} + 1`,
          updatedAt: now,
        })
        .where(and(eq(products.id, row.productId), eq(products.tenantId, ctx.tenantId)))
        .run();

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
  });

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

  // ENG-090 — write the customer ledger receivable for full-credit
  // sales. Best-effort post-tx: a ledger write failure does not roll
  // back the sale (the sale tx already committed). Operators can
  // retry the ledger write from the V5 Cuenta corriente panel via
  // `customerLedger.addAdjustment` if this branch ever fails.
  // `creditProjection` is captured for the future audit-metadata
  // wire-up (`projectedBalance` becomes the receipt's saldo posterior
  // when the renderer integration lands as ENG-090b).
  if (creditSaleAmount > 0 && input.customerId && input.status === 'completed') {
    try {
      await recordCreditSaleLedger({
        db: ctx.db,
        tenantId: ctx.tenantId,
        customerId: input.customerId,
        creditAmount: creditSaleAmount,
        saleId,
        createdBy: ctx.user.id,
        note: saleNumber,
      });
    } catch (err) {
      log.warn(
        {
          err,
          saleId,
          customerId: input.customerId,
          creditSaleAmount,
          projectedBalance: creditProjection?.projectedBalance ?? null,
        },
        '[completeSale] failed to write credit-sale ledger row'
      );
    }
  }
  void creditProjection;

  // ENG-020 — emit DIAN DEE when a direct-sale (non-draft) lands as
  // `completed`. Drafts never emit. Runs post-tx best-effort.
  let fiscalEmitId: string | null = null;
  if (input.status === 'completed') {
    const fiscalResult = await safelyEmitFiscalDocument({
      db: ctx.db,
      tenantId: ctx.tenantId,
      userId: ctx.user.id,
      log,
      source: 'sale',
      sourceId: saleId,
      saleId,
      kind: 'DEE',
    });
    fiscalEmitId = fiscalResult?.id ?? null;
  }

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

    const effects: JournalEffectInput[] = [];
    effects.push({
      kind: 'sale_row',
      resourceType: 'sales',
      resourceId: saleId,
      effectData: {
        saleNumber,
        total,
        paymentMethod: resolvedPayments.dominantMethod,
        paymentStatus,
        status: input.status,
      },
    });
    for (const payment of paymentEffects) {
      effects.push({
        kind: 'payment_row',
        resourceType: 'sale_payments',
        resourceId: payment.id,
        effectData: { method: payment.method, amount: payment.amount },
      });
    }
    for (const movementId of inventoryMovementIds) {
      effects.push({
        kind: 'inventory_movement',
        resourceType: 'inventory_movements',
        resourceId: movementId,
      });
    }
    if (cashMovementId) {
      effects.push({
        kind: 'cash_movement',
        resourceType: 'cash_movements',
        resourceId: cashMovementId,
        effectData: {
          sessionId: activeCashSession.id,
          amount: cashCollectedAmount,
        },
      });
    }
    if (priceOverrideAuditEmitted && priceOverrideAuditId) {
      effects.push({
        kind: 'audit_log',
        resourceType: 'audit_logs',
        resourceId: priceOverrideAuditId,
        effectData: { action: 'sale.price_override' },
      });
    }
    if (fiscalEmitId) {
      effects.push({
        kind: 'fiscal_emit',
        resourceType: 'fiscal_documents',
        resourceId: fiscalEmitId,
      });
    }
    await emitCompleteSaleEffects(ctx.db, log, journalEventId, effects);
  }

  // ENG-098 — push to the kitchen display when the sale carries a
  // tableId. Idempotent against the suspend-then-complete progression
  // via UNIQUE(tenant_id, sale_id, station); a second fire is a no-op.
  if (input.tableId) {
    await enqueueKdsOrder({
      ctx: buildKdsHookContextFromAppCtx(ctx),
      saleId,
    });
  }

  return {
    sale: { ...created, change } as CompleteSaleSaleRecord,
    change,
    journalEventId,
  };
}

/* ------------------------------------------------------------------ */
/*  Draft-completion path.                                            */
/* ------------------------------------------------------------------ */

async function runCompleteDraft(
  ctx: CompleteSaleContext,
  log: CompleteSaleLogger,
  input: Extract<CompleteSaleInput, { mode: 'fromDraft' }>
): Promise<CompleteSaleResult<CompleteSaleSaleRecord>> {
  const existing = await ctx.db
    .select()
    .from(sales)
    .where(and(eq(sales.id, input.saleId), eq(sales.tenantId, ctx.tenantId)))
    .get();

  if (!existing) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'SALE_NOT_FOUND',
      message: 'Sale not found',
    });
  }

  if (existing.status !== 'draft') {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_DRAFT_REQUIRED',
      message: 'Only draft sales can be completed',
      details: { operation: 'complete', actualStatus: existing.status },
    });
  }

  if (existing.suspendedAt) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_COMPLETE_DRAFT_SUSPENDED',
      message: 'Resume the draft with sales.resume before completing it',
      details: { saleId: input.saleId },
    });
  }

  const actorRole = ctx.user.role;
  const isCreator = existing.createdBy === ctx.user.id;
  const canOverride = actorRole === 'manager' || actorRole === 'admin';
  if (!isCreator && !canOverride) {
    throwServerError({
      trpcCode: 'FORBIDDEN',
      errorCode: 'SALE_SUSPEND_OWNERSHIP_REQUIRED',
      message: 'Only the cashier who created this draft can complete it',
      details: { operation: 'complete' },
    });
  }

  const activeCashSession = await requireActiveCashSession(
    ctx.db,
    ctx.tenantId,
    ctx.siteId,
    ctx.user.id
  );

  const lineItemCount = await ctx.db
    .select({ count: sql<number>`count(*)` })
    .from(saleItems)
    .where(eq(saleItems.saleId, input.saleId))
    .get();

  if (!lineItemCount || (lineItemCount.count ?? 0) === 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_WITHOUT_ITEMS',
      message: 'Cannot complete a draft without line items',
    });
  }

  // ENG-039d — tip / propina layered on top of the frozen draft base.
  // The draft's items + subtotal + tax + discount are immutable from
  // the create-time call (sales.create stored them with status='draft');
  // tip is captured at complete-time so the cashier can confirm it
  // after the customer settles. We recompute `baseTotal` from the
  // frozen monetary pieces rather than `existing.total` — a draft that
  // was created with a tip already baked into `total` would otherwise
  // see the second tip compound on top of the first, leaving
  // `total` out of sync with the new `tipAmount` column.
  const tipAmount = roundMoney(Math.max(0, input.tipAmount ?? 0));
  const tipMethod = tipAmount > 0 ? input.tipMethod ?? null : null;
  // ENG-039d3 — service charge layered onto the frozen draft base. The
  // same baseTotal-from-frozen-pieces logic that prevents tip compounding
  // (a draft that was opened with a service charge already in `total`
  // would otherwise see the new charge double-stacked) applies here too.
  const serviceChargeAmount = roundMoney(Math.max(0, input.serviceChargeAmount ?? 0));
  const baseTotal = roundMoney(
    (existing.subtotal ?? 0) +
    (existing.taxAmount ?? 0) -
    (existing.discountAmount ?? 0)
  );
  const restaurantSettings = await assertServiceChargeMatchesTenant({
    db: ctx.db,
    tenantId: ctx.tenantId,
    base: baseTotal,
    serviceChargeAmount,
  });
  const serviceChargeRate =
    serviceChargeAmount > 0 ? restaurantSettings.serviceChargeRate : null;
  const total = roundMoney(baseTotal + tipAmount + serviceChargeAmount);
  const tenderInputs: CompleteSaleTender[] | undefined = input.payments?.map(payment => ({
    method: payment.method,
    amount: payment.amount,
    reference: payment.reference ?? null,
  }));
  const resolvedPayments = resolveSalePayments({
    payments: tenderInputs,
    legacyMethod: input.paymentMethod,
    amountReceived: input.amountReceived,
    total,
  });
  const isSplitPayment = input.payments !== undefined && input.payments.length > 0;
  // ENG-014 — sum credit tenders so the status, invariant, and ledger
  // hook all key off the same number. A split with cash + credit lands
  // here with rows=[{cash, $50}, {credit, $150}], so creditSaleAmount=150.
  const creditSaleAmount = resolvedPayments.rows
    .filter(row => row.method === 'credit')
    .reduce((sum, row) => sum + row.amount, 0);

  const paymentStatus = getPaymentStatus({
    amountReceived: input.amountReceived,
    paymentMethod: resolvedPayments.dominantMethod,
    requestedStatus: input.paymentStatus,
    total,
    isSplit: isSplitPayment,
    creditAmount: creditSaleAmount,
  });
  const change =
    input.amountReceived !== undefined && input.amountReceived > total
      ? input.amountReceived - total
      : 0;
  // ENG-176a-rounding — see the resumeDraft path for the rationale:
  // accumulating two 2-decimal floats can drift, defend at the source.
  const cashCollectedAmount = isSplitPayment
    ? resolvedPayments.rows
        .filter(payment => payment.method === 'cash')
        .reduce((acc, payment) => roundMoney(acc + payment.amount), 0)
    : getCashCollectedAmount({
        paymentMethod: input.paymentMethod,
        amountReceived: input.amountReceived,
        total,
        change,
      });

  if (
    !isSplitPayment &&
    input.amountReceived !== undefined &&
    paymentStatus === 'paid' &&
    input.amountReceived < total
  ) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_AMOUNT_RECEIVED_BELOW_TOTAL',
      message: 'Amount received cannot be less than the sale total for a paid sale',
    });
  }

  // ENG-014 — same credit-sale pre-flight as the fresh path, but the
  // customer comes from the draft row (`existing.customerId`) rather
  // than from the input. The draft customer is locked at create-time;
  // completeDraft cannot re-assign it. `creditSaleAmount` already
  // computed above (sum of credit tenders across split payload).
  const draftCustomerId = existing.customerId;
  const hasCreditPortion = creditSaleAmount > 0;
  let creditProjection: Awaited<
    ReturnType<typeof requireCreditLimitNotExceeded>
  > | null = null;
  if (hasCreditPortion) {
    if (!draftCustomerId) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'CREDIT_SALE_CUSTOMER_REQUIRED',
        message: 'Credit sales require a customer to be attached',
      });
    }
    creditProjection = await requireCreditLimitNotExceeded({
      db: ctx.db,
      tenantId: ctx.tenantId,
      customerId: draftCustomerId,
      attemptedAmount: creditSaleAmount,
      allowOverride: input.creditOverride === true,
    });
  }

  const now = new Date().toISOString();
  const nextSyncVersion = (existing.syncVersion ?? 0) + 1;

  let cashMovementId: string | null = null;
  let completionAuditId: string | null = null;
  const paymentEffects: PersistedPaymentEffect[] = [];

  ctx.db.transaction(tx => {
    // ENG-042 TOCTOU defense.
    assertCashSessionStillOpen(tx, ctx.tenantId, activeCashSession.id);

    // Replace any placeholder payment rows the draft might have
    // carried from its initial `sales.create` call with the real
    // tenders captured at complete-time.
    tx.delete(salePayments)
      .where(
        and(eq(salePayments.saleId, input.saleId), eq(salePayments.tenantId, ctx.tenantId))
      )
      .run();

    for (const payment of resolvedPayments.rows) {
      const paymentId = nanoid();
      const tenderAmount = roundMoney(payment.amount);
      tx.insert(salePayments)
        .values({
          id: paymentId,
          tenantId: ctx.tenantId,
          saleId: input.saleId,
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

    tx.update(sales)
      .set({
        paymentMethod: resolvedPayments.dominantMethod,
        paymentStatus,
        status: 'completed',
        // Re-bind to the active session so cash reports show the
        // income where it physically arrived.
        cashSessionId: activeCashSession.id,
        notes: input.notes ?? existing.notes,
        // ENG-039d — persist the tip captured at complete-time. When
        // no tip was entered we still write 0 / null so a previously
        // partially-staged value never sticks.
        tipAmount,
        tipMethod,
        // ENG-039d3 — persist service charge captured at complete-time.
        serviceChargeAmount,
        serviceChargeRate,
        total,
        syncStatus: 'pending',
        syncVersion: nextSyncVersion,
        updatedAt: now,
      })
      .where(and(eq(sales.id, input.saleId), eq(sales.tenantId, ctx.tenantId)))
      .run();

    cashMovementId = insertCashMovement({
      tx,
      tenantId: ctx.tenantId,
      sessionId: activeCashSession.id,
      type: 'sale',
      amount: cashCollectedAmount,
      referenceId: input.saleId,
      note: `Sale ${existing.saleNumber} · completed from draft`,
      createdBy: ctx.user.id,
      createdAt: now,
    });

    // Parity with void / return / park / resume / discard / reprint:
    // every state-change on an existing sale leaves a `sale.*` audit row.
    completionAuditId = writeAuditLog({
      tx,
      tenantId: ctx.tenantId,
      actorId: ctx.user.id,
      action: 'sale.complete',
      resourceType: 'sale',
      resourceId: input.saleId,
      before: {
        status: 'draft',
        cashSessionId: existing.cashSessionId,
        paymentStatus: existing.paymentStatus,
      },
      after: {
        status: 'completed',
        cashSessionId: activeCashSession.id,
        paymentStatus,
        total,
      },
      metadata: {
        completedFromDraft: true,
        saleNumber: existing.saleNumber,
        ...(input.payments && input.payments.length > 0
          ? { tenderCount: input.payments.length }
          : {}),
        // ENG-039d — surface tip in the audit row only when captured;
        // suppressing the keys at zero keeps audit reads scannable.
        // `tipMethod` is omitted (rather than written as `null`) when
        // the caller did not specify a method.
        ...(tipAmount > 0
          ? { tipAmount, ...(tipMethod ? { tipMethod } : {}) }
          : {}),
        // ENG-039d3 — mirror the tip pattern for service charge.
        ...(serviceChargeAmount > 0
          ? {
              serviceChargeAmount,
              ...(serviceChargeRate !== null ? { serviceChargeRate } : {}),
            }
          : {}),
      },
    });

    // ENG-007 closure — admin authorised a credit sale whose projected
    // balance exceeded the customer's cupo. `overrideApplied` is true
    // only when (exceedsLimit && allowOverride === true), so the row
    // never fires for admin-completed sales that stayed under the limit.
    // `draftCustomerId` is captured from the existing sale row above
    // because the `fromDraft` input shape does not carry `customerId`.
    if (creditProjection?.overrideApplied === true && draftCustomerId) {
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.user.id,
        action: 'sale.credit_override',
        resourceType: 'sale',
        resourceId: input.saleId,
        before: null,
        after: {
          customerId: draftCustomerId,
          creditLimit: creditProjection.creditLimit,
          currentBalance: creditProjection.currentBalance,
          projectedBalance: creditProjection.projectedBalance,
          attemptedAmount: creditProjection.attemptedAmount,
        },
        metadata: {
          actorRole: ctx.user.role,
          saleNumber: existing.saleNumber,
          completedFromDraft: true,
        },
      });
    }
  });

  // ENG-064b — sync_outbox emit moved POST-tx (was inline `tx.insert`
  // before the cutover). The helper writes the operation_effects row
  // (kind=outbox_enqueue:sync) itself when the envelope is present.
  await enqueueSync(ctx, {
    entityType: 'sales',
    entityId: input.saleId,
    operation: 'update',
    data: {
      id: input.saleId,
      status: 'completed',
      completedFromDraft: true,
      total,
      paymentStatus,
    },
  });

  // ENG-090 — same best-effort ledger-write as the fresh path. The
  // draft already finalized as `completed`; a ledger failure here
  // does NOT roll the sale back.
  if (creditSaleAmount > 0 && draftCustomerId) {
    try {
      await recordCreditSaleLedger({
        db: ctx.db,
        tenantId: ctx.tenantId,
        customerId: draftCustomerId,
        creditAmount: creditSaleAmount,
        saleId: input.saleId,
        createdBy: ctx.user.id,
        note: existing.saleNumber,
      });
    } catch (err) {
      log.warn(
        {
          err,
          saleId: input.saleId,
          customerId: draftCustomerId,
          creditSaleAmount,
          projectedBalance: creditProjection?.projectedBalance ?? null,
        },
        '[completeSale.fromDraft] failed to write credit-sale ledger row'
      );
    }
  }
  void creditProjection;

  // ENG-020 — emit DIAN DEE on first completion of the draft.
  const fiscalResult = await safelyEmitFiscalDocument({
    db: ctx.db,
    tenantId: ctx.tenantId,
    userId: ctx.user.id,
    log,
    source: 'sale',
    sourceId: input.saleId,
    saleId: input.saleId,
    kind: 'DEE',
  });
  const fiscalEmitId = fiscalResult?.id ?? null;

  const completed = await getSaleRecord(ctx.db, ctx.tenantId, input.saleId);

  const journalEventId = await lookupJournalEventId(
    ctx.db,
    ctx.tenantId,
    ctx.envelope?.operationId
  );
  if (journalEventId) {
    await safeUpdateSaleCompletedSummary(ctx, log, journalEventId, {
      saleId: input.saleId,
      saleNumber: existing.saleNumber,
      siteId: activeCashSession.siteId,
      cashSessionId: activeCashSession.id,
      customerId: completed.customerId,
      subtotal: completed.subtotal,
      taxAmount: completed.taxAmount,
      discountAmount: completed.discountAmount,
      total: completed.total,
      paymentMethod: resolvedPayments.dominantMethod,
    });

    const effects: JournalEffectInput[] = [];
    effects.push({
      kind: 'sale_row',
      resourceType: 'sales',
      resourceId: input.saleId,
      effectData: {
        saleNumber: existing.saleNumber,
        total,
        paymentMethod: resolvedPayments.dominantMethod,
        paymentStatus,
        status: 'completed',
        completedFromDraft: true,
      },
    });
    for (const payment of paymentEffects) {
      effects.push({
        kind: 'payment_row',
        resourceType: 'sale_payments',
        resourceId: payment.id,
        effectData: { method: payment.method, amount: payment.amount },
      });
    }
    if (cashMovementId) {
      effects.push({
        kind: 'cash_movement',
        resourceType: 'cash_movements',
        resourceId: cashMovementId,
        effectData: {
          sessionId: activeCashSession.id,
          amount: cashCollectedAmount,
        },
      });
    }
    if (completionAuditId) {
      effects.push({
        kind: 'audit_log',
        resourceType: 'audit_logs',
        resourceId: completionAuditId,
        effectData: { action: 'sale.complete' },
      });
    }
    if (fiscalEmitId) {
      effects.push({
        kind: 'fiscal_emit',
        resourceType: 'fiscal_documents',
        resourceId: fiscalEmitId,
      });
    }
    await emitCompleteSaleEffects(ctx.db, log, journalEventId, effects);
  }

  // ENG-098 — push to the kitchen display when the underlying draft
  // carried a tableId. Idempotent against the suspend → complete
  // progression via UNIQUE(tenant_id, sale_id, station). For the
  // common path (suspend already created the card) this is a no-op
  // at the DB layer.
  if (existing.tableId) {
    await enqueueKdsOrder({
      ctx: buildKdsHookContextFromAppCtx(ctx),
      saleId: input.saleId,
    });
  }

  return {
    sale: completed as CompleteSaleSaleRecord,
    change,
    journalEventId,
  };
}
