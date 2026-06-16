/**
 * ENG-178 — Pre-transaction DB resolution for the `completeSale`
 * use-case, extracted verbatim from the former monolithic
 * `completeSale.ts` during the megafile decomposition.
 *
 * Owns the read-side primitives the fresh-sale path runs before opening
 * its transaction: customer validity, the active sale sequential, and the
 * priced + stock-validated cart rows. All three are byte-for-byte moves
 * from `completeSale.ts`; pure money math (totals, payment plan) lives in
 * `pricing.ts`.
 *
 * @module application/sales/item-resolution
 */

import { and, asc, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  customers,
  inventoryBalances,
  products,
  sequentials,
  sites,
  unitXProduct,
  units,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { ensureInventoryBalancesForSite } from '../../services/inventory-balances.js';
import { assertSaleQuantityAllowed } from '../../services/fraction-policy.js';
import { getNormalizedSaleQuantity } from './policies.js';
import type { CompleteSaleItemInput } from './types.js';

/** One priced, stock-validated cart line ready for persistence. */
export interface ResolvedSaleItem {
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

/** The active sale sequential resolved for the (tenant, site) pair. */
export interface SaleSequentialContext {
  id: string;
  prefix: string;
  currentValue: number;
  siteId: string;
  siteName: string;
}

/** Output of {@link resolveSaleItems}: priced rows + running totals. */
export interface ResolvedItemsBundle {
  productStocks: Map<string, number>;
  subtotal: number;
  taxAmount: number;
  rows: ResolvedSaleItem[];
}

export async function validateCustomer(
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

export async function getSaleSequentialContext(
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

/**
 * Resolve the cart lines into priced, stock-validated rows and accumulate the
 * tax-exclusive subtotal + tax.
 *
 * Invariants:
 * - Each derived monetary quantity is `roundMoney`-ed to two decimals BEFORE
 *   it accumulates into the running `subtotal` / `taxAmount` or lands in a
 *   row. Critically the tax-exclusive split (`lineTotal / (1 + taxRate/100)`)
 *   produces non-terminating decimals that the storage `chk_*_2dec` CHECK
 *   would reject and that would stack sub-cent drift across a long line list;
 *   rounding per line then re-summing the rounded values keeps every stored
 *   figure cent-clean. Uniform 2-decimal, country-agnostic (see `completeSale`).
 * - Stock is validated against a per-product running remainder so two lines
 *   of the same product cannot jointly oversell (`SALE_INSUFFICIENT_STOCK`);
 *   the product must be active (`SALE_PRODUCT_INVALID`) and the unit
 *   assignment valid + active (`SALE_UNIT_INVALID`).
 * - `notes` is operator-facing free text; empty/whitespace collapses to
 *   `null` (re-trimmed defensively for non-Zod callers) and is never
 *   auto-translated.
 *
 * Preconditions: `inputItems` has passed the sale input schema, and the
 * `(tenantId, siteId)` pair identifies the site whose inventory will be
 * validated.
 *
 * Postconditions: returns the resolved rows + the accumulated `subtotal` /
 * `taxAmount`; performs no writes (stock is only checked here, decremented
 * later inside the sale transaction).
 */
export async function resolveSaleItems(
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

/** One overridden line surfaced into the price-override audit row. */
export interface SalePriceOverride {
  saleItemId: string;
  productId: string;
  productName: string;
  referenceUnitPrice: number;
  unitPrice: number;
  quantity: number;
}

/**
 * ENG-007 — detect manual per-line price overrides: lines whose entered
 * `unitPrice` diverges from the unit's catalog `referenceUnitPrice` by at
 * least half a cent. The fresh-sale transaction writes a single summary
 * audit row when this returns a non-empty list.
 */
export function detectPriceOverrides(rows: ResolvedSaleItem[]): SalePriceOverride[] {
  const PRICE_OVERRIDE_EPSILON = 0.005;
  return rows
    .filter(
      row => Math.abs(row.unitPrice - row.referenceUnitPrice) >= PRICE_OVERRIDE_EPSILON
    )
    .map(row => ({
      saleItemId: row.id,
      productId: row.productId,
      productName: row.productName,
      referenceUnitPrice: row.referenceUnitPrice,
      unitPrice: row.unitPrice,
      quantity: row.quantity,
    }));
}
