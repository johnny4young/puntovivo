// Product create/update payload builder, extracted from ProductsPage.tsx
// (ENG-178 slice 32). Pure: maps the form values to the tRPC mutation input,
// normalizing the provider list (legacy single providerId + the multi-provider
// assignments) through normalizeProductProviders.

import { normalizeProductProviders } from './providerState';
import type { ProductFormValues } from './ProductFormModal';

function buildProviderPayload(values: ProductFormValues) {
  const normalizedProviders = normalizeProductProviders({
    providerId: values.providerId,
    providerAssignments: values.providerAssignments,
  });

  return {
    providerId: normalizedProviders.primaryProviderId,
    providerAssignments: normalizedProviders.providerAssignments,
  };
}

/**
 * Build the create/update payload from the product form values. The shape
 * matches the `products.create` / `products.update` tRPC inputs (the caller
 * adds `id` + `version` for the update path). Provider fields are normalized
 * so the single `providerId` and the multi-provider assignments stay
 * consistent; fraction step/minimum are nulled out when not sold by fraction.
 */
export function buildProductPayload(
  values: ProductFormValues,
  options: { includeStock?: boolean } = {}
) {
  const providerPayload = buildProviderPayload(values);

  return {
    name: values.name,
    sku: values.sku,
    description: values.description || null,
    categoryId: values.categoryId || null,
    providerId: providerPayload.providerId,
    vatRateId: values.vatRateId || null,
    locationId: values.locationId || null,
    barcode: values.barcode || null,
    imageUrl: values.imageUrl || null,
    cost: values.cost,
    initialCost: values.initialCost,
    price: values.price,
    price2: values.price2,
    price3: values.price3,
    marginPercent1: values.marginPercent1,
    marginPercent2: values.marginPercent2,
    marginPercent3: values.marginPercent3,
    marginAmount1: values.marginAmount1,
    marginAmount2: values.marginAmount2,
    marginAmount3: values.marginAmount3,
    taxRate: values.taxRate,
    ...(options.includeStock === false ? {} : { stock: values.stock }),
    minStock: values.minStock,
    sellByFraction: values.sellByFraction,
    fractionStep: values.sellByFraction ? values.fractionStep : null,
    fractionMinimum: values.sellByFraction ? values.fractionMinimum : null,
    tracksLots: values.tracksLots,
    isActive: values.isActive,
    unitAssignments: values.unitAssignments.map(assignment => ({
      unitId: assignment.unitId,
      equivalence: assignment.equivalence,
      price: assignment.price,
      isBase: assignment.isBase,
    })),
    providerAssignments: providerPayload.providerAssignments,
  };
}
