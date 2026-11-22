import { roundQuantity } from '@puntovivo/shared/unit-math';
import {
  getSaleMinimumQuantity,
  getSaleQuantityStep,
  type SaleCartItem,
} from '@/features/sales/saleCart';
import type { Product, ProductSearchSelection } from '@/types';

/**
 * Builds the canonical cart selection from a fully hydrated product.
 *
 * Product list rows intentionally omit unit assignments. Callers that start
 * from products.list must fetch products.getById before using this helper.
 */
export function selectionFromHydratedProduct(
  product: Product,
  unitId?: string | null
): ProductSearchSelection | null {
  const assignments = product.unitAssignments ?? [];
  const baseUnit = assignments.find(assignment => assignment.isBase) ?? assignments[0];
  if (!baseUnit) return null;
  const unit = (unitId && assignments.find(assignment => assignment.unitId === unitId)) || baseUnit;

  const baseUnitPrice = baseUnit.price ?? product.price;
  return {
    product: {
      ...product,
      baseUnitId: baseUnit.unitId,
      baseUnitName: baseUnit.unitName ?? null,
      baseUnitAbbreviation: baseUnit.unitAbbreviation ?? null,
      baseUnitPrice,
    },
    unit: {
      ...unit,
      isBase: unit.isBase ?? unit === baseUnit,
    },
    price: unit === baseUnit ? baseUnitPrice : (unit.price ?? product.price),
  };
}

export type AmountQuantity =
  | { quantity: number }
  | { error: 'invalid' | 'unpriced' | 'wholeUnits' }
  | { error: 'belowMinimum'; minimum: number };

/** Units an amount buys at the unit price, under the cart's own fraction rules. */
export function quantityForAmount(
  amount: number,
  unitPrice: number,
  product: Pick<SaleCartItem, 'sellByFraction' | 'fractionStep' | 'fractionMinimum'>
): AmountQuantity {
  if (!(amount > 0)) return { error: 'invalid' };
  if (!(unitPrice > 0)) return { error: 'unpriced' };
  const exact = amount / unitPrice;
  if (!product.sellByFraction) {
    const whole = roundQuantity(exact, 6);
    return Number.isInteger(whole) && whole > 0 ? { quantity: whole } : { error: 'wholeUnits' };
  }
  return fitSaleQuantity(exact, product);
}

/** Rounds a fractional quantity to the product's step and checks its minimum. */
export function fitSaleQuantity(
  exact: number,
  product: Pick<SaleCartItem, 'sellByFraction' | 'fractionStep' | 'fractionMinimum'>
): { quantity: number } | { error: 'belowMinimum'; minimum: number } {
  const step = getSaleQuantityStep(product);
  const quantity = roundQuantity(Math.round(exact / step) * step, 6);
  const minimum = getSaleMinimumQuantity(product);
  return quantity >= minimum ? { quantity } : { error: 'belowMinimum', minimum };
}
