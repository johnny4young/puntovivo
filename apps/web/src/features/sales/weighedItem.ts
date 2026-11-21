import { roundQuantity } from '@puntovivo/shared/unit-math';
import { fitSaleQuantity, type AmountQuantity } from '@/features/sales/productSelection';
import {
  buildCartItem,
  getCartItemKey,
  mergeBarcodeCartItem,
  updateCartItem,
  type SaleCartItem,
} from '@/features/sales/saleCart';
import type { ProductSearchSelection } from '@/types';

export const WEIGHT_PRESETS_KG = [0.25, 0.5, 1] as const;

/** Grams in one sale unit when the line is sold by weight, otherwise null. */
export function gramsPerUnit(selection: ProductSearchSelection): number | null {
  const factor = selection.unit.unitReferenceFactor;
  return selection.product.sellByFraction &&
    selection.unit.unitDimension === 'mass' &&
    typeof factor === 'number' &&
    factor > 0
    ? factor
    : null;
}

/** Weights always read with three decimals, at the register and in settings. */
export function kilogramFormat(locale: string): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

export function kilogramsOf(quantity: number, grams: number): number {
  return roundQuantity((quantity * grams) / 1000, 3);
}

/** Sale quantity for a weight in kilograms, under the product's step and minimum. */
export function quantityForWeight(
  kilograms: number,
  grams: number,
  product: ProductSearchSelection['product']
): Exclude<AmountQuantity, { error: 'unpriced' | 'wholeUnits' }> {
  if (!(kilograms > 0)) return { error: 'invalid' };
  return fitSaleQuantity((kilograms * 1000) / grams, product);
}

/**
 * Sets the weighed share of a product's line: `previous` is what this weighing
 * already put on the line, so a corrected weight replaces it instead of adding.
 */
export function applyWeighedQuantity(
  items: SaleCartItem[],
  selection: ProductSearchSelection,
  previous: number,
  next: number
): SaleCartItem[] {
  const key = getCartItemKey(selection.product.id, selection.unit.unitId);
  if (!items.some(item => item.key === key)) {
    return mergeBarcodeCartItem(items, selection, { quantity: next, price: null });
  }
  const built = buildCartItem(selection);
  return items.map(item =>
    item.key === key
      ? {
          ...updateCartItem(item, {
            quantity: roundQuantity(Math.max(item.quantity - previous, 0) + next, 6),
          }),
          availableStock: built.availableStock,
        }
      : item
  );
}
