import type { Product } from '@/types';
import { normalizeProductProviderSelections } from './providerState';
import type { ProductFormValues } from './productForm.types';

export function createDefaultValues(): ProductFormValues {
  return {
    name: '',
    sku: '',
    description: '',
    categoryId: '',
    providerId: '',
    vatRateId: '',
    locationId: '',
    barcode: '',
    imageUrl: '',
    cost: 0,
    initialCost: 0,
    price: 0,
    price2: 0,
    price3: 0,
    marginPercent1: 0,
    marginPercent2: 0,
    marginPercent3: 0,
    marginAmount1: 0,
    marginAmount2: 0,
    marginAmount3: 0,
    taxRate: 0,
    stock: 0,
    minStock: 0,
    sellByFraction: false,
    fractionStep: 0.01,
    fractionMinimum: 0.01,
    isActive: true,
    unitAssignments: [{ unitId: '', equivalence: 1, price: 0, isBase: true }],
    providerAssignments: [],
  };
}

export function mapProductToForm(product: Product | null): ProductFormValues {
  if (!product) {
    return createDefaultValues();
  }

  const normalizedProviders = normalizeProductProviderSelections(product);

  return {
    name: product.name,
    sku: product.sku,
    description: product.description ?? '',
    categoryId: product.categoryId ?? '',
    providerId: normalizedProviders.primaryProviderId ?? '',
    vatRateId: product.vatRateId ?? '',
    locationId: product.locationId ?? '',
    barcode: product.barcode ?? '',
    imageUrl: product.imageUrl ?? '',
    cost: product.cost,
    initialCost: product.initialCost,
    price: product.price,
    price2: product.price2,
    price3: product.price3,
    marginPercent1: product.marginPercent1,
    marginPercent2: product.marginPercent2,
    marginPercent3: product.marginPercent3,
    marginAmount1: product.marginAmount1,
    marginAmount2: product.marginAmount2,
    marginAmount3: product.marginAmount3,
    taxRate: product.taxRate,
    stock: product.stock,
    minStock: product.minStock,
    sellByFraction: product.sellByFraction,
    fractionStep: product.fractionStep ?? 0.01,
    fractionMinimum: product.fractionMinimum ?? 0.01,
    isActive: product.isActive,
    unitAssignments:
      product.unitAssignments?.length
        ? product.unitAssignments.map(assignment => ({
            unitId: assignment.unitId,
            equivalence: assignment.equivalence,
            price: assignment.price,
            isBase: assignment.isBase,
          }))
        : [{ unitId: '', equivalence: 1, price: product.price, isBase: true }],
    providerAssignments: normalizedProviders.providerAssignments,
  };
}

export function parseNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Builds the `error` prop for SimpleFormField under
 * `exactOptionalPropertyTypes`: the prop is omitted entirely when there is
 * no message rather than passed as `undefined`.
 */
export function errorProp(message: string | undefined): { error?: string } {
  return message ? { error: message } : {};
}

/**
 * Visual required marker. Renders the asterisk as a CSS `::after` pseudo
 * element on the field label so it stays presentation-only: it never lands
 * in the label's text content (keeping `getByLabelText('Name')` exact and
 * the accessible name clean — the required semantic is carried by
 * `aria-required` on the control instead).
 */
export const REQUIRED_LABEL = "[&>label]:after:ml-0.5 [&>label]:after:text-danger-600 [&>label]:after:content-['*']";
