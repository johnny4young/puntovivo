import { roundMoney as round } from '@/lib/money';

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
