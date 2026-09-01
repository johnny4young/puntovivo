/**
 * Customer price tiers: which of the product's three catalog prices a
 * sale line should suggest and be judged against.
 *
 * One shared resolver for the server engine and the web cart so the
 * suggested price and the price-override reference can never disagree
 * (same lockstep rationale as ./tax-split).
 *
 * Contract:
 * - Tier 1 is the retail default: every unit assignment's own catalog
 *   price stands.
 * - Base-unit tiers 2 and 3 map to the product's price2 / price3
 *   columns. Non-base assignments carry their own optional price2 /
 *   price3 values so a case, pack, or kilogram can have an independent
 *   wholesale grid.
 * - A zero or negative tier price means "not configured": fall back to
 *   the assignment price instead of selling at 0.
 */

export const PRICE_TIERS = [1, 2, 3] as const;

export type PriceTier = (typeof PRICE_TIERS)[number];

/** Half-cent boundary shared by cart guidance and authoritative sale checks. */
export const PRICE_OVERRIDE_EPSILON = 0.005;

export function isPriceTier(value: unknown): value is PriceTier {
  return value === 1 || value === 2 || value === 3;
}

export interface TierUnitPriceInput {
  tier: PriceTier;
  /** The unit assignment's own catalog price (tier-1 price for that unit). */
  assignmentPrice: number;
  /** Optional tier prices for a non-base unit assignment. */
  assignmentPrice2?: number | undefined;
  assignmentPrice3?: number | undefined;
  isBaseUnit: boolean;
  /** The product's three catalog prices (base-unit denominated). */
  productPrices: { price: number; price2: number; price3: number };
}

export function resolveTierUnitPrice(input: TierUnitPriceInput): number {
  if (input.tier === 1) {
    return input.assignmentPrice;
  }
  const tierPrice = input.isBaseUnit
    ? input.tier === 2
      ? input.productPrices.price2
      : input.productPrices.price3
    : input.tier === 2
      ? input.assignmentPrice2
      : input.assignmentPrice3;
  return (tierPrice ?? 0) > 0 ? tierPrice! : input.assignmentPrice;
}

export function isUnitPriceOverride(input: {
  unitPrice: number;
  referenceUnitPrice: number;
  retailUnitPrice: number;
}): boolean {
  return (
    Math.abs(input.unitPrice - input.referenceUnitPrice) >= PRICE_OVERRIDE_EPSILON &&
    Math.abs(input.unitPrice - input.retailUnitPrice) >= PRICE_OVERRIDE_EPSILON
  );
}
