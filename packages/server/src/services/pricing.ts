import { roundMoney as round } from '../lib/money.js';

/**
 * Cost → price ↔ margin conversions for the product catalog.
 *
 * MIRROR CONTRACT: apps/web/src/features/products/pricing.ts carries a
 * logic-identical copy (the renderer cannot import server runtime code, so
 * the form preview computes locally). Any change here MUST be replicated
 * there, or the price the form shows will disagree with what the server
 * persists.
 *
 * Every intermediate rounds through roundMoney (ENG-176a) so derived
 * margins/prices stay coherent with the transactional money path.
 */
export interface PricingInput {
  cost: number;
  marginPercent?: number | null;
  marginAmount?: number | null;
  price?: number | null;
}

export interface PricingResult {
  price: number;
  marginPercent: number;
  marginAmount: number;
}

export function calculatePricing(input: PricingInput): PricingResult {
  const cost = round(Math.max(0, input.cost));

  if (input.price !== undefined && input.price !== null) {
    const price = round(Math.max(0, input.price));
    const marginAmount = round(Math.max(0, price - cost));
    const marginPercent = cost === 0 ? 0 : round((marginAmount / cost) * 100);

    return { price, marginPercent, marginAmount };
  }

  if (input.marginPercent !== undefined && input.marginPercent !== null) {
    const marginPercent = round(Math.max(0, input.marginPercent));
    const marginAmount = round((cost * marginPercent) / 100);
    const price = round(cost + marginAmount);

    return { price, marginPercent, marginAmount };
  }

  if (input.marginAmount !== undefined && input.marginAmount !== null) {
    const marginAmount = round(Math.max(0, input.marginAmount));
    const price = round(cost + marginAmount);
    const marginPercent = cost === 0 ? 0 : round((marginAmount / cost) * 100);

    return { price, marginPercent, marginAmount };
  }

  return {
    price: cost,
    marginPercent: 0,
    marginAmount: 0,
  };
}

export interface ProductPricingDraft {
  cost: number;
  price: number;
  price2: number;
  price3: number;
  marginPercent1: number;
  marginPercent2: number;
  marginPercent3: number;
  marginAmount1: number;
  marginAmount2: number;
  marginAmount3: number;
}

export function normalizeProductPricing(input: ProductPricingDraft): ProductPricingDraft {
  const tier1 = calculatePricing({
    cost: input.cost,
    price: input.price,
    marginPercent: input.marginPercent1,
    marginAmount: input.marginAmount1,
  });
  const tier2 = calculatePricing({
    cost: input.cost,
    price: input.price2,
    marginPercent: input.marginPercent2,
    marginAmount: input.marginAmount2,
  });
  const tier3 = calculatePricing({
    cost: input.cost,
    price: input.price3,
    marginPercent: input.marginPercent3,
    marginAmount: input.marginAmount3,
  });

  return {
    cost: round(Math.max(0, input.cost)),
    price: tier1.price,
    price2: tier2.price,
    price3: tier3.price,
    marginPercent1: tier1.marginPercent,
    marginPercent2: tier2.marginPercent,
    marginPercent3: tier3.marginPercent,
    marginAmount1: tier1.marginAmount,
    marginAmount2: tier2.marginAmount,
    marginAmount3: tier3.marginAmount,
  };
}
