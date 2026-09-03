/**
 * Quick-create product mounter for SalesPage.
 *
 * Subscribes to `useQuickCreateStore.requestedCreateProduct`. When a
 * request lands, loads the active VAT choices required by the quick form,
 * mounts `ProductFormModal` with the pre-fill, runs the `products.create`
 * mutation, and hands the created product back to the parent via `onCreated`.
 * Categories, locations, providers and units stay unfetched until the
 * operator explicitly opens advanced settings.
 *
 * The component is null until a request appears, so the lookup
 * queries only fire when the cashier actually triggers the quick-create
 * flow, and four of the five remain deferred for the normal path.
 *
 * @module features/sales/QuickCreateProductGate
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProductTemplateVerticalId } from '@puntovivo/shared/vertical-presets';
import { useToast } from '@/components/feedback/ToastProvider';
import {
  ProductFormModal,
  type LookupOption,
  type ProductFormValues,
  type UnitLookupOption,
  type VatRateOption,
} from '@/features/products/ProductFormModal';
import { buildProductPayload } from '@/features/products/productPayload';
import { trpc } from '@/lib/trpc';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { selectRequestedCreateProduct, useQuickCreateStore } from './useQuickCreateStore';
import type { Product } from '@/types';

interface QuickCreateProductGateProps {
  /**
   * Fired when a brand-new product was persisted. The parent uses it
   * to add the product to the active cart and invalidate any product
   * caches downstream. The callback runs AFTER the mutation succeeds
   * and BEFORE the modal closes.
   */
  onCreated?: (product: Product) => void;
  templateVertical?: ProductTemplateVerticalId | null;
  pharmacyMode?: boolean;
}

export function QuickCreateProductGate({
  onCreated,
  templateVertical = null,
  pharmacyMode = false,
}: QuickCreateProductGateProps) {
  const { t } = useTranslation(['products', 'pharmacy', 'pharmacyErrors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const requested = useQuickCreateStore(selectRequestedCreateProduct);
  const consumeCreateProduct = useQuickCreateStore.getState().consumeCreateProduct;
  const [advancedRequested, setAdvancedRequested] = useState(pharmacyMode);
  // No modal-key state needed — the parent renders this component
  // conditionally (returns `null` when `requested === null`), so the
  // form modal is mounted fresh on every new request and the form
  // state never lingers between cycles.

  const categoriesQuery = trpc.categories.tree.useQuery(undefined, {
    enabled: requested !== null && advancedRequested,
  });
  const providersQuery = trpc.providers.list.useQuery(
    { page: 1, perPage: 200 },
    { enabled: requested !== null && advancedRequested }
  );
  const locationsQuery = trpc.locations.list.useQuery(
    { page: 1, perPage: 200 },
    { enabled: requested !== null && advancedRequested }
  );
  const unitsQuery = trpc.units.list.useQuery(
    { page: 1, perPage: 200 },
    { enabled: requested !== null && advancedRequested }
  );
  const vatRatesQuery = trpc.vatRates.list.useQuery(
    { page: 1, perPage: 200, isActive: true },
    { enabled: requested !== null }
  );

  const createMutation = trpc.products.create.useMutation({
    onError: onErrorToast(toast, t, { titleKey: 'products:toast.createError' }),
  });

  const categories: LookupOption[] = useMemo(
    () =>
      (categoriesQuery.data?.items ?? []).map(category => ({
        id: category.id,
        name: category.name,
      })),
    [categoriesQuery.data]
  );
  const providers: LookupOption[] = useMemo(
    () =>
      (providersQuery.data?.items ?? []).map(provider => ({
        id: provider.id,
        name: provider.name,
      })),
    [providersQuery.data]
  );
  const locations: LookupOption[] = useMemo(
    () =>
      (locationsQuery.data?.items ?? [])
        .filter(location => location.isActive !== false)
        .map(location => ({
          id: location.id,
          name: `${location.code} · ${location.name}`,
        })),
    [locationsQuery.data]
  );
  const units: UnitLookupOption[] = useMemo(
    () =>
      (unitsQuery.data?.items ?? []).map(unit => ({
        id: unit.id,
        name: unit.name,
        abbreviation: unit.abbreviation,
        isActive: unit.isActive !== false,
        dimension: unit.dimension,
        referenceFactor: unit.referenceFactor,
      })),
    [unitsQuery.data]
  );
  const vatRates: VatRateOption[] = useMemo(
    () =>
      (vatRatesQuery.data?.items ?? []).map(vatRate => ({
        id: vatRate.id,
        name: vatRate.name,
        rate: vatRate.rate,
        kind: vatRate.kind,
      })),
    [vatRatesQuery.data]
  );

  if (!requested) {
    return null;
  }

  const handleClose = () => {
    consumeCreateProduct();
    setAdvancedRequested(false);
    createMutation.reset();
  };

  const handleSubmit = async (values: ProductFormValues): Promise<Product | void> => {
    let created: Product;
    try {
      created = (await createMutation.mutateAsync(await buildProductPayload(values))) as Product;
    } catch {
      // The mutation's error state and toast own this server failure. Keep the
      // form open and return the explicit handled-error sentinel.
      return;
    }

    // These are post-create responsibilities, not mutation failures. Let an
    // invalidation or callback defect reject so observability can detect it.
    await Promise.all([
      utils.products.list.invalidate(),
      utils.products.search.invalidate(),
      utils.setupReadiness.firstSale.invalidate(),
    ]);
    toast.success({ title: t('toast.created') });
    return created;
  };

  const handleCreated = (product: Product) => {
    onCreated?.(product);
    handleClose();
  };

  return (
    <ProductFormModal
      mode="create"
      isOpen
      product={null}
      categories={categories}
      locations={locations}
      providers={providers}
      units={units}
      vatRates={vatRates}
      isSaving={createMutation.isPending}
      error={
        createMutation.error
          ? translateServerError(createMutation.error, t, t('toast.createError'))
          : null
      }
      onClose={handleClose}
      onSubmit={handleSubmit}
      defaultName={requested.defaultName ?? undefined}
      onCreated={handleCreated}
      initialExperience={pharmacyMode ? 'advanced' : 'quick'}
      origin="sale"
      templateVertical={templateVertical}
      pharmacyMode={pharmacyMode}
      onExperienceChange={experience => setAdvancedRequested(experience === 'advanced')}
      advancedLookupsPending={
        advancedRequested &&
        (categoriesQuery.isLoading ||
          providersQuery.isLoading ||
          locationsQuery.isLoading ||
          unitsQuery.isLoading)
      }
    />
  );
}
