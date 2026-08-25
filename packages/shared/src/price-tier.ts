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
 * - Tiers 2 and 3 apply to the BASE unit only, where they map to the
 *   product's price2 / price3 columns. Non-base assignments carry a
 *   single operator-set price with no tier variants, so they are
 *   unchanged by the tier.
 * - A zero or negative tier price means "not configured": fall back to
 *   the assignment price instead of selling at 0.
 */

export const PRICE_TIERS = [1, 2, 3] as const;

export type PriceTier = (typeof PRICE_TIERS)[number];

export function isPriceTier(value: unknown): value is PriceTier {
  return value === 1 || value === 2 || value === 3;
}

export interface TierUnitPriceInput {
  tier: PriceTier;
  /** The unit assignment's own catalog price (tier-1 price for that unit). */
  assignmentPrice: number;
  isBaseUnit: boolean;
  /** The product's three catalog prices (base-unit denominated). */
  productPrices: { price: number; price2: number; price3: number };
}

export function resolveTierUnitPrice(input: TierUnitPriceInput): number {
  if (input.tier === 1 || !input.isBaseUnit) {
    return input.assignmentPrice;
  }
  const tierPrice = input.tier === 2 ? input.productPrices.price2 : input.productPrices.price3;
  return tierPrice > 0 ? tierPrice : input.assignmentPrice;
}
