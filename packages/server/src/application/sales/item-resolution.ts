/**
 * Pre-transaction DB resolution for the `completeSale`
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
import {
  isPriceTier,
  isUnitPriceOverride,
  resolveTierUnitPrice,
  type PriceTier,
} from '@puntovivo/shared/price-tier';
import { roundQuantity } from '@puntovivo/shared/unit-math';
import { resolvePricingSettings } from '../../services/pricing-settings.js';
import type { TaxKind } from '../../db/schema.js';
import {
  ensureInventoryBalancesForSite,
  getProductStockTotals,
} from '../../services/inventory-balances.js';
import { assertSaleQuantityAllowed } from '../../services/fraction-policy.js';
import { getNormalizedSaleQuantity } from './policies.js';
import type { CompleteSaleItemInput } from './types.js';
import {
  assertTaxRateOverrideAllowed,
  loadAllowedTaxRatesByKind,
} from '../../services/tax-rate-policy.js';
import {
  assertTaxComponentsRepresentable,
  calculateTaxComponentSnapshots,
  getProductTaxComponents,
  legacyComponent,
  summarizeTaxComponents,
  type TaxComponentSnapshot,
} from '../../services/tax-components.js';
import { resolveTenantLocale } from '../../services/tenant-locale.js';

/** One priced, stock-validated cart line ready for persistence. */
export interface ResolvedSaleItem {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  /** Structured restaurant modifier delta already included in unitPrice. */
  restaurantModifierAmount: number;
  /** The customer-tier catalog price at line resolution time. */
  referenceUnitPrice: number;
  /** The tier-1 assignment price - always a legitimate price to charge. */
  retailUnitPrice: number;
  /** Frozen three-tier grid for completion-time draft revalidation. */
  catalogUnitPrices: { price: number; price2: number; price3: number };
  /** UN/ECE code of the unit at sale time, frozen onto the line. */
  unitStandardCode: string | null;
  productName: string;
  productSku: string;
  categoryId: string | null;
  unitId: string;
  unitEquivalence: number;
  discount: number;
  taxRate: number;
  /** Which tax the line levies ('iva' | 'inc'), frozen at sale time. */
  taxKind: TaxKind;
  taxAmount: number;
  taxComponents: TaxComponentSnapshot[];
  costAtSale: number;
  total: number;
  normalizedQuantity: number;
  /**
   * free-form per-line modifier captured at sale
   * creation time. Null when no modifier was entered. Items are
   * immutable after draft creation so this value round-trips
   * through suspend / resume / completeDraft unchanged.
   */
  notes: string | null;
  serialIds: string[];
  tracksSerials: boolean;
  tracksLots: boolean;
  /**
   * false for service / non-inventory items: the line skips
   * stock validation here and every inventory write downstream (fresh
   * sale, draft completion, return, void, discard).
   */
  tracksStock: boolean;
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

/**
 * Which catalog price this sale should be judged against. Walk-in resolves
 * to tier 1 (retail); identified customers must exist, belong to the tenant,
 * and remain active. An out-of-range stored tier falls back to 1 so a corrupt
 * row can never select an unintended price column.
 */
export interface ResolvedSaleCustomer {
  customerId: string | null;
  priceTier: PriceTier;
}

function requireEligibleSaleCustomer(db: DatabaseInstance, tenantId: string, customerId: string) {
  const customer = db
    .select({
      id: customers.id,
      isActive: customers.isActive,
      privacyStatus: customers.privacyStatus,
      priceTier: customers.priceTier,
    })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
    .get();

  if (!customer || customer.isActive === false || customer.privacyStatus !== 'active') {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_CUSTOMER_INVALID',
      message: 'Selected customer was not found, is inactive, or is privacy-restricted',
    });
  }
  return customer;
}

/** Recheck mutable customer eligibility while the sale owns the SQLite writer. */
export function assertSaleCustomerStillEligible(
  db: DatabaseInstance,
  tenantId: string,
  customerId: string | null
): void {
  if (customerId) requireEligibleSaleCustomer(db, tenantId, customerId);
}

export async function resolveSaleCustomer(
  db: DatabaseInstance,
  tenantId: string,
  customerId: string | null | undefined
): Promise<ResolvedSaleCustomer> {
  if (!customerId) {
    return { customerId: null, priceTier: 1 };
  }

  const customer = requireEligibleSaleCustomer(db, tenantId, customerId);

  return {
    customerId: customer.id,
    priceTier: isPriceTier(customer.priceTier) ? customer.priceTier : 1,
  };
}

export async function getSaleSequentialContext(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string | null
): Promise<SaleSequentialContext> {
  const baseConditions = [
    eq(sequentials.tenantId, tenantId),
    eq(sequentials.documentType, 'sale'),
    eq(sites.tenantId, tenantId),
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

    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_SEQUENTIAL_MISSING',
      message: 'No active sale sequential is configured for the selected site',
      details: { siteId },
    });
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
      message: 'No active sale sequential is configured for the current organization',
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
 * it accumulates into the running `subtotal` / `taxAmount` or lands in a
 * row. Critically the tax-exclusive split (`lineTotal / (1 + taxRate/100)`)
 * produces non-terminating decimals that the storage `chk_*_2dec` CHECK
 * would reject and that would stack sub-cent drift across a long line list;
 * rounding per line then re-summing the rounded values keeps every stored
 * figure cent-clean. Uniform 2-decimal, country-agnostic (see `completeSale`).
 * - Stock is validated against a per-product running remainder so two lines
 * of the same product cannot jointly oversell (`SALE_INSUFFICIENT_STOCK`);
 * the product must be active (`SALE_PRODUCT_INVALID`) and the unit
 * assignment valid + active (`SALE_UNIT_INVALID`). Service items
 * (`tracksStock=false`) skip the availability check and the remainder.
 * - `notes` is operator-facing free text; empty/whitespace collapses to
 * `null` (re-trimmed defensively for non-Zod callers) and is never
 * auto-translated.
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
  inputItems: CompleteSaleItemInput[],
  // REQUIRED (null = walk-in): the customer's price tier decides which
  // catalog price is the override-detection reference, so a tier-2
  // customer buying at price2 is not flagged as a manual override. An
  // optional parameter would let a future caller silently judge every
  // wholesale line against the retail price.
  priceTier: PriceTier
): Promise<ResolvedItemsBundle> {
  const productIds = [...new Set(inputItems.map(item => item.productId))];
  const pricing = await resolvePricingSettings(db, tenantId);
  ensureInventoryBalancesForSite(db, tenantId, siteId);

  const productRows = await db
    .select()
    .from(products)
    .where(and(eq(products.tenantId, tenantId), inArray(products.id, productIds)))
    .all();
  const productMap = new Map(productRows.map(product => [product.id, product]));
  const productTaxComponentsById = await getProductTaxComponents(db, tenantId, productIds);
  const allowedTaxRates = loadAllowedTaxRatesByKind(db, tenantId);
  const tenantLocale = await resolveTenantLocale(db, tenantId);

  const unitAssignments = await db
    .select({
      productId: unitXProduct.productId,
      unitId: unitXProduct.unitId,
      equivalence: unitXProduct.equivalence,
      // read the per-unit catalog price so the use-case can
      // detect manual price overrides.
      price: unitXProduct.price,
      price2: unitXProduct.price2,
      price3: unitXProduct.price3,
      isBase: unitXProduct.isBase,
      // Frozen onto the sale line so later catalog edits never
      // change what an emitted document (or its credit note) declares.
      standardCode: units.standardCode,
      unitName: units.name,
      unitAbbreviation: units.abbreviation,
      isActive: units.isActive,
    })
    .from(unitXProduct)
    .innerJoin(units, eq(unitXProduct.unitId, units.id))
    // unit_x_product has no tenant column, so assert the boundary on
    // units directly (same pattern as ai/voice hydrate) instead of
    // relying on the later tenant-scoped product check alone.
    .where(and(eq(units.tenantId, tenantId), inArray(unitXProduct.productId, productIds)))
    .all();

  const assignmentMap = new Map(
    unitAssignments.map(assignment => [`${assignment.productId}:${assignment.unitId}`, assignment])
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
    const modifierAmount = item.restaurantModifierAmount ?? 0;
    if (!Number.isFinite(modifierAmount) || modifierAmount < 0 || modifierAmount > item.unitPrice) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'RESTAURANT_SERVICE_LINES_INVALID',
        message: 'Restaurant modifier amount must be finite, non-negative and included in price',
      });
    }
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
    const serialIds = item.serialIds ?? [];
    if (product.tracksSerials) {
      if (
        Math.abs(assignment.equivalence - 1) > 1e-9 ||
        !Number.isInteger(normalizedQuantity) ||
        serialIds.length !== normalizedQuantity ||
        new Set(serialIds).size !== serialIds.length
      ) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'PRODUCT_SERIAL_SELECTION_REQUIRED',
          message: 'Select exactly one unique serial number per serialized base unit',
          details: {
            productId: product.id,
            requiredCount: normalizedQuantity,
            selectedCount: new Set(serialIds).size,
          },
        });
      }
    } else if (serialIds.length > 0) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'PRODUCT_SERIAL_SELECTION_NOT_ALLOWED',
        message: 'Serial numbers were supplied for a product that does not track serials',
        details: { productId: product.id },
      });
    }
    // service items (tracksStock=false) sell without stock:
    // no availability check and no running-remainder consumption, so a
    // mixed cart still validates its physical lines correctly.
    if (product.tracksStock) {
      const remainingStock = remainingSiteStockByProduct.get(item.productId) ?? 0;
      const nextRemainingStock = roundQuantity(remainingStock - normalizedQuantity, 12);

      if (nextRemainingStock < 0) {
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

      remainingSiteStockByProduct.set(item.productId, nextRemainingStock);
    }

    // Component pricing delegates its aggregate split to the shared tax
    // helper, then allocates the exact rounded total across frozen rows.
    const catalogComponents = productTaxComponentsById.get(product.id) ?? [
      legacyComponent({
        vatRateId: product.vatRateId,
        taxKind: product.taxKind,
        taxRate: product.taxRate ?? 0,
      }),
    ];
    const selectedComponents = catalogComponents;
    if (item.taxComponents) {
      const requestedIds = item.taxComponents.map(component => component.vatRateId);
      const catalogIds = catalogComponents.map(component => component.vatRateId);
      if (
        new Set(requestedIds).size !== requestedIds.length ||
        requestedIds.length !== catalogIds.length ||
        requestedIds.some((id, position) => id !== catalogIds[position])
      ) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'TAX_COMPONENTS_INVALID',
          message: 'Submitted tax components do not match the ordered product catalog',
          details: { productId: product.id },
        });
      }
    }
    const catalogSummary = summarizeTaxComponents(selectedComponents);
    const catalogTaxRate = catalogSummary.taxRate;
    let pricedComponents = selectedComponents;
    const taxRate = item.taxRate ?? catalogTaxRate;
    if (item.taxRate !== undefined) {
      if (selectedComponents.length > 1 && taxRate !== catalogTaxRate) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'TAX_COMPONENTS_INVALID',
          message: 'A legacy numeric override cannot replace a multi-component tax snapshot',
          details: { productId: product.id },
        });
      }
      assertTaxRateOverrideAllowed({
        allowedRates: allowedTaxRates,
        catalogTaxRate,
        requestedTaxRate: taxRate,
        taxKind: catalogSummary.taxKind,
        productId: product.id,
      });
      if (selectedComponents.length === 1) {
        pricedComponents = [{ ...selectedComponents[0]!, taxRate }];
      }
    }
    assertTaxComponentsRepresentable(tenantLocale.countryCode, pricedComponents);
    const split = calculateTaxComponentSnapshots({
      components: pricedComponents,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      discountPercent: item.discount,
      priceIncludesTax: pricing.priceIncludesTax,
    });
    const lineTotal = split.lineTotal;
    const lineBase = split.lineBase;
    const lineTax = split.lineTax;

    subtotal = roundMoney(subtotal + lineBase);
    taxAmount = roundMoney(taxAmount + lineTax);

    const catalogUnitPrices = {
      price: roundMoney(assignment.price),
      price2: roundMoney(
        resolveTierUnitPrice({
          tier: 2,
          assignmentPrice: assignment.price,
          assignmentPrice2: assignment.price2,
          assignmentPrice3: assignment.price3,
          isBaseUnit: assignment.isBase,
          productPrices: product,
        })
      ),
      price3: roundMoney(
        resolveTierUnitPrice({
          tier: 3,
          assignmentPrice: assignment.price,
          assignmentPrice2: assignment.price2,
          assignmentPrice3: assignment.price3,
          isBaseUnit: assignment.isBase,
          productPrices: product,
        })
      ),
    };

    rows.push({
      id: nanoid(),
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: roundMoney(item.unitPrice),
      // Tier-aware reference: the override detector judges the entered
      // price against what THIS customer's tier suggests, via the same
      // shared resolver the web cart uses to suggest it.
      referenceUnitPrice: roundMoney(
        resolveTierUnitPrice({
          tier: priceTier,
          assignmentPrice: assignment.price,
          assignmentPrice2: assignment.price2,
          assignmentPrice3: assignment.price3,
          isBaseUnit: assignment.isBase,
          productPrices: {
            price: product.price,
            price2: product.price2,
            price3: product.price3,
          },
        }) + modifierAmount
      ),
      // The line's tier-1 catalog price. Selling a tier customer at
      // RETAIL is not a manual override - it is simply not applying the
      // discount - so the detector tolerates both prices.
      retailUnitPrice: roundMoney(assignment.price + modifierAmount),
      catalogUnitPrices,
      unitStandardCode: assignment.standardCode ?? null,
      productName: product.name,
      productSku: product.sku,
      categoryId: product.categoryId,
      unitId: item.unitId,
      unitEquivalence: assignment.equivalence,
      discount: roundMoney(item.discount),
      taxRate: summarizeTaxComponents(pricedComponents).taxRate,
      taxKind: pricedComponents[0]!.taxKind,
      taxAmount: lineTax,
      taxComponents: split.components,
      costAtSale: roundMoney(product.cost),
      total: lineTotal,
      normalizedQuantity,
      // empty / whitespace-only notes collapse to null so
      // the column stays semantically two-state (modifier present
      // vs absent). The Zod schema `.trim()`s the input, but callers
      // that bypass the schema (programmatic completeSale callers,
      // future bulk-import flows) may still pass a whitespace-only
      // string, so the resolver re-trims defensively.
      notes:
        typeof item.notes === 'string' && item.notes.trim().length > 0 ? item.notes.trim() : null,
      restaurantModifierAmount: roundMoney(modifierAmount),
      serialIds,
      tracksSerials: product.tracksSerials,
      tracksLots: product.tracksLots,
      tracksStock: product.tracksStock,
    });
  }

  return {
    // Tenant-wide stock is derived from Σ(inventory_balances.on_hand).
    productStocks: getProductStockTotals(db, tenantId, productIds),
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

export interface PriceOverrideCandidate {
  id: string;
  productId: string;
  productName: string;
  referenceUnitPrice: number;
  retailUnitPrice: number;
  unitPrice: number;
  quantity: number;
}

/**
 * detect manual per-line price overrides: lines whose entered
 * `unitPrice` diverges from the unit's catalog `referenceUnitPrice` by at
 * least half a cent. The fresh-sale transaction writes a single summary
 * audit row when this returns a non-empty list.
 */
export function detectPriceOverrides(rows: readonly PriceOverrideCandidate[]): SalePriceOverride[] {
  return rows
    .filter(row =>
      // A price is an override only when it matches NEITHER the
      // customer-tier reference NOR the retail catalog price: charging
      // a tier-2 customer full retail is not applying the discount,
      // not a hand-typed price. For walk-ins both references coincide.
      isUnitPriceOverride(row)
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
