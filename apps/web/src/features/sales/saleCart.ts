import { roundMoney } from '@/lib/money';
import { resolveTierUnitPrice, type PriceTier } from '@puntovivo/shared/price-tier';
import { MIN_OPERATIONAL_QUANTITY, roundQuantity } from '@puntovivo/shared/unit-math';
import type { ProductSearchSelection, ProductUnitAssignment } from '@/types';

/** A unit the line can switch to; the product's own unit assignment. */
export type SaleUnitOption = Pick<
  ProductUnitAssignment,
  | 'unitId'
  | 'unitName'
  | 'unitAbbreviation'
  | 'unitDimension'
  | 'equivalence'
  | 'price'
  | 'price2'
  | 'price3'
  | 'isBase'
>;

// explicit `| undefined` on optional fields.
export interface SaleCartItem {
  key: string;
  /** Immutable quotation line identity used by atomic conversion. */
  sourceQuotationItemId?: string | undefined;
  productId: string;
  productName: string;
  productSku: string;
  unitId: string;
  unitName: string;
  unitEquivalence: number;
  /** 'length' lines sold by fraction are cut to measure. */
  unitDimension?: ProductUnitAssignment['unitDimension'] | undefined;
  /** Every unit of the product when it has more than one. */
  unitOptions?: SaleUnitOption[] | undefined;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  /** Frozen tax-rate identities from an accepted quotation. */
  taxComponents?: Array<{ vatRateId: string }> | undefined;
  availableStock: number;
  /** false = service line: no stock semantics anywhere in the cart. */
  tracksStock?: boolean | undefined;
  sellByFraction: boolean;
  fractionStep?: number | null | undefined;
  fractionMinimum?: number | null | undefined;
  tracksSerials?: boolean | undefined;
  serialIds?: string[] | undefined;
  /** Site whose sellable registry produced serialIds. */
  serialSiteId?: string | null | undefined;
  // customer price-tier support. The three catalog prices
  // (base-unit denominated) plus whether THIS line sells the base unit,
  // so applyPriceTier can reprice through the shared resolver. Optional:
  // persisted carts from before the columns shipped lack them and are
  // simply left untouched by a tier switch.
  tierPrices?: { price: number; price2: number; price3: number } | undefined;
  /**
   * The unit assignment's own catalog price at build time - the line's
   * tier-1 reference. Kept SEPARATE from tierPrices.price because
   * unit_x_product.price and products.price are edited on different
   * tabs and nothing forces them equal; the server judges overrides
   * against the assignment price, so the cart must anchor on it too.
   */
  catalogUnitPrice?: number | undefined;
  /** Tier 2/3 prices owned by this concrete unit assignment. */
  catalogUnitPrice2?: number | undefined;
  catalogUnitPrice3?: number | undefined;
  isBaseUnit?: boolean | undefined;
  /** True once the operator hand-edited the unit price; tier switches never clobber it. */
  priceEdited?: boolean | undefined;
}

export interface SaleCartSummary {
  itemCount: number;
  subtotal: number;
  taxAmount: number;
  total: number;
}

export function getSaleQuantityStep(item: Pick<SaleCartItem, 'sellByFraction' | 'fractionStep'>) {
  return item.sellByFraction
    ? Math.max(item.fractionStep ?? MIN_OPERATIONAL_QUANTITY, MIN_OPERATIONAL_QUANTITY)
    : 1;
}

export function getSaleMinimumQuantity(
  item: Pick<SaleCartItem, 'sellByFraction' | 'fractionStep' | 'fractionMinimum'>
) {
  if (!item.sellByFraction) {
    return 1;
  }

  const step = getSaleQuantityStep(item);
  return Math.max(item.fractionMinimum ?? step, step);
}

export function getCartItemKey(productId: string, unitId: string) {
  return `${productId}:${unitId}`;
}

export function unitLabel(
  unit: Pick<ProductUnitAssignment, 'unitId' | 'unitName' | 'unitAbbreviation'>,
  fallback?: string | null
): string {
  return unit.unitName ?? unit.unitAbbreviation ?? fallback ?? unit.unitId;
}

function toUnitOption(unit: ProductUnitAssignment): SaleUnitOption {
  // Only what the picker and repricing read, without nulls: every line persists it.
  const { unitId, unitName, unitAbbreviation, unitDimension, equivalence, price } = unit;
  return {
    unitId,
    equivalence,
    price,
    isBase: unit.isBase,
    ...(unitName ? { unitName } : {}),
    ...(unitAbbreviation ? { unitAbbreviation } : {}),
    ...(unitDimension ? { unitDimension } : {}),
    ...(unit.price2 ? { price2: unit.price2 } : {}),
    ...(unit.price3 ? { price3: unit.price3 } : {}),
  };
}

function finitePrice(value: number | undefined): number | undefined {
  return Number.isFinite(value) ? value : undefined;
}

export function buildCartItem(selection: ProductSearchSelection): SaleCartItem {
  const unitName = unitLabel(selection.unit, selection.product.baseUnitAbbreviation);
  const assignments = selection.product.unitAssignments ?? [];

  return {
    key: getCartItemKey(selection.product.id, selection.unit.unitId),
    productId: selection.product.id,
    productName: selection.product.name,
    productSku: selection.product.sku,
    unitId: selection.unit.unitId,
    unitName,
    unitEquivalence: selection.unit.equivalence,
    unitDimension: selection.unit.unitDimension ?? null,
    unitOptions: assignments.length > 1 ? assignments.map(toUnitOption) : undefined,
    quantity: getSaleMinimumQuantity(selection.product),
    unitPrice: selection.price,
    discount: 0,
    taxRate: selection.product.taxRate ?? 0,
    // A sale can only take stock from its own site, so prefer that figure.
    availableStock: selection.product.siteStock ?? selection.product.stock,
    tracksStock: selection.product.tracksStock !== false,
    sellByFraction: selection.product.sellByFraction,
    fractionStep: selection.product.fractionStep,
    fractionMinimum: selection.product.fractionMinimum,
    tracksSerials: selection.product.tracksSerials === true,
    serialIds: [],
    serialSiteId: null,
    // Tier metadata only when the selection actually carries the three
    // catalog prices - quick-create merges a partial product cast whose
    // price2/price3 are undefined, and a tierPrices of undefineds would
    // let applyPriceTier write unitPrice: undefined into the line.
    tierPrices:
      Number.isFinite(selection.product.price) &&
      Number.isFinite(selection.product.price2) &&
      Number.isFinite(selection.product.price3)
        ? {
            price: selection.product.price,
            price2: selection.product.price2,
            price3: selection.product.price3,
          }
        : undefined,
    catalogUnitPrice: Number.isFinite(selection.unit.price ?? selection.product.price)
      ? (selection.unit.price ?? selection.product.price)
      : undefined,
    catalogUnitPrice2: finitePrice(selection.unit.price2),
    catalogUnitPrice3: finitePrice(selection.unit.price3),
    isBaseUnit: selection.unit.isBase === true,
    priceEdited: false,
  };
}

export function updateCartItem(
  item: SaleCartItem,
  updates: Partial<
    Pick<SaleCartItem, 'quantity' | 'discount' | 'unitPrice' | 'serialIds' | 'serialSiteId'>
  >
): SaleCartItem {
  return {
    ...item,
    ...updates,
    // A hand-edited price is sticky: tier switches must never clobber
    // what the operator typed.
    ...(updates.unitPrice !== undefined && updates.unitPrice !== item.unitPrice
      ? { priceEdited: true }
      : {}),
  };
}

/** Lines built from a catalog pick carry their units; quotation and price-label lines do not. */
export function canChangeCartItemUnit(item: SaleCartItem): boolean {
  // Serialized products sell one serial per base unit only.
  return !item.tracksSerials && (item.unitOptions?.length ?? 0) > 1;
}

/**
 * Sell the line in another of the product's units at that unit's catalog price
 * (the cart's tier pass reprices it). The quantity keeps the same base amount
 * when it is a valid quantity in the new unit, otherwise the minimum.
 */
export function changeCartItemUnit(item: SaleCartItem, unitId: string): SaleCartItem {
  const option = item.unitOptions?.find(candidate => candidate.unitId === unitId);
  if (!option || unitId === item.unitId || !canChangeCartItemUnit(item)) return item;
  const minimum = getSaleMinimumQuantity(item);
  const converted = roundQuantity((item.quantity * item.unitEquivalence) / option.equivalence, 6);
  // The server rejects a quantity off the product's step in the sold unit.
  const steps = converted / getSaleQuantityStep(item);
  const keepsAmount = converted >= minimum && Math.abs(steps - Math.round(steps)) < 1e-9;
  return {
    ...item,
    key: getCartItemKey(item.productId, unitId),
    unitId,
    unitName: unitLabel(option),
    unitEquivalence: option.equivalence,
    unitDimension: option.unitDimension ?? null,
    quantity: keepsAmount ? converted : minimum,
    unitPrice: option.price,
    catalogUnitPrice: option.price,
    catalogUnitPrice2: finitePrice(option.price2),
    catalogUnitPrice3: finitePrice(option.price3),
    isBaseUnit: option.isBase,
    priceEdited: false,
    serialIds: [],
    serialSiteId: null,
  };
}

/** Switches one line's unit; a line already in that unit absorbs it. */
export function replaceCartItemUnit(
  items: SaleCartItem[],
  itemKey: string,
  unitId: string
): SaleCartItem[] {
  const line = items.find(item => item.key === itemKey);
  const changed = line ? changeCartItemUnit(line, unitId) : line;
  if (!line || changed === line || !changed) return items;
  const existing = items.find(item => item.key === changed.key);
  if (!existing) return items.map(item => (item === line ? changed : item));
  return items
    .filter(item => item !== line)
    .map(item =>
      item === existing
        ? updateCartItem(item, { quantity: roundQuantity(item.quantity + changed.quantity, 6) })
        : item
    );
}

/**
 * The tier the line is priced at when it sits below its list (tier-1) price,
 * or null. Hand-edited and off-grid prices never count.
 */
export function getCartItemListPrice(
  item: SaleCartItem,
  tier: PriceTier
): { listPrice: number; tier: 2 | 3 } | null {
  if (
    tier === 1 ||
    item.priceEdited === true ||
    !item.tierPrices ||
    item.catalogUnitPrice === undefined ||
    item.unitPrice >= item.catalogUnitPrice
  ) {
    return null;
  }
  const tierPrice = resolveTierUnitPrice({
    tier,
    assignmentPrice: item.catalogUnitPrice,
    assignmentPrice2: item.catalogUnitPrice2,
    assignmentPrice3: item.catalogUnitPrice3,
    isBaseUnit: item.isBaseUnit === true,
    productPrices: item.tierPrices,
  });
  return tierPrice === item.unitPrice ? { listPrice: item.catalogUnitPrice, tier } : null;
}

/**
 * Reprice every eligible line to the given customer price tier through
 * the SAME shared resolver the server uses as its override reference, so
 * a tier-priced line is never flagged as a manual override. Lines the
 * operator hand-edited, lines without tier metadata (persisted carts
 * from before the fields shipped), and locked/resumed carts (callers
 * gate those) keep their price.
 */
export function applyPriceTier(items: SaleCartItem[], tier: PriceTier): SaleCartItem[] {
  return items.map(item => {
    if (item.priceEdited === true || !item.tierPrices || item.catalogUnitPrice === undefined) {
      return item;
    }
    const tierPrices = item.tierPrices;
    const catalogUnitPrice = item.catalogUnitPrice;
    const priceAtTier = (candidate: PriceTier) =>
      resolveTierUnitPrice({
        tier: candidate,
        // Anchor on the ASSIGNMENT price captured at build time, exactly
        // like the server's override reference - products.price and the
        // base assignment price are edited independently and can drift.
        assignmentPrice: catalogUnitPrice,
        assignmentPrice2: item.catalogUnitPrice2,
        assignmentPrice3: item.catalogUnitPrice3,
        isBaseUnit: item.isBaseUnit === true,
        productPrices: tierPrices,
      });
    // Only lines sitting ON the tier grid are repriced. A price that
    // matches none of the three catalog tiers came from somewhere else -
    // a GS1 price-embedded label, a promo, an external suggestion - and
    // a tier switch (or the idempotent re-apply on every cart update)
    // must never silently reset it to catalog.
    const sitsOnTierGrid = ([1, 2, 3] as const).some(
      candidate => priceAtTier(candidate) === item.unitPrice
    );
    if (!sitsOnTierGrid) {
      return item;
    }
    const nextPrice = priceAtTier(tier);
    return nextPrice === item.unitPrice ? item : { ...item, unitPrice: nextPrice };
  });
}

export function mergeCartItem(items: SaleCartItem[], selection: ProductSearchSelection) {
  const nextItem = buildCartItem(selection);
  const existingIndex = items.findIndex(item => item.key === nextItem.key);

  if (existingIndex === -1) {
    return [...items, nextItem];
  }

  return items.map((item, index) =>
    index === existingIndex
      ? {
          ...updateCartItem(item, {
            quantity: roundQuantity(item.quantity + getSaleQuantityStep(item), 6),
          }),
          availableStock: nextItem.availableStock,
        }
      : item
  );
}

/** Keep price-encoded packages distinct from both catalog and other prices. */
export function getBarcodeCartItemKey(
  selection: ProductSearchSelection,
  priceOverride: number | null
): string {
  const baseKey = getCartItemKey(selection.product.id, selection.unit.unitId);
  return priceOverride === null
    ? baseKey
    : `${baseKey}:gs1-price:${Math.round(roundMoney(priceOverride) * 100)}`;
}

/**
 * Merge one scanner-resolved package without losing its measured quantity or
 * encoded package price.
 *
 * Weight labels add their quantity to the existing base-unit line. Price
 * labels describe one whole package, so equal encoded prices may increment a
 * dedicated line while different prices remain separate legal sale lines.
 */
export function mergeBarcodeCartItem(
  items: SaleCartItem[],
  selection: ProductSearchSelection,
  overrides: { quantity: number | null; price: number | null }
): SaleCartItem[] {
  if (overrides.quantity === null && overrides.price === null) {
    return mergeCartItem(items, selection);
  }

  const itemKey = getBarcodeCartItemKey(selection, overrides.price);
  const built = buildCartItem(selection);
  const nextItem: SaleCartItem = {
    ...built,
    key: itemKey,
    ...(overrides.price === null
      ? {}
      : {
          unitPrice: overrides.price,
          // A scale-encoded package price is not a catalog tier suggestion,
          // even if it happens to equal one of the configured tier prices.
          priceEdited: true,
          // The label prices this package, so it stays in its unit.
          unitOptions: undefined,
        }),
  };
  const existingIndex = items.findIndex(item => item.key === nextItem.key);
  if (existingIndex === -1) {
    return [
      ...items,
      overrides.quantity === null
        ? nextItem
        : updateCartItem(nextItem, { quantity: overrides.quantity }),
    ];
  }

  const increment = overrides.quantity ?? getSaleQuantityStep(nextItem);
  return items.map((item, index) =>
    index === existingIndex
      ? {
          ...updateCartItem(item, {
            quantity: roundQuantity(item.quantity + increment, 12),
          }),
          availableStock: nextItem.availableStock,
        }
      : item
  );
}
