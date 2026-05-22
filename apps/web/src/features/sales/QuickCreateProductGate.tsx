/**
 * ENG-105c — Quick-create product mounter for SalesPage.
 *
 * Subscribes to `useQuickCreateStore.requestedCreateProduct`. When a
 * request lands, lazily loads the product-form lookups (categories,
 * locations, providers, units, vat rates), mounts `ProductFormModal`
 * with the pre-fill, runs the `products.create` mutation, and hands
 * the created product back to the parent via `onCreated`.
 *
 * The component is null until a request appears, so the lookup
 * queries (~5 of them, ~few KB each) only fire when the cashier
 * actually triggers the quick-create flow. SalesPage stays light.
 *
 * @module features/sales/QuickCreateProductGate
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import {
  ProductFormModal,
  type LookupOption,
  type ProductFormValues,
  type VatRateOption,
} from '@/features/products/ProductFormModal';
import { trpc } from '@/lib/trpc';
import { onErrorToast } from '@/lib/mutationHelpers';
import {
  selectRequestedCreateProduct,
  useQuickCreateStore,
} from './useQuickCreateStore';
import type { Product } from '@/types';

interface QuickCreateProductGateProps {
  /**
   * Fired when a brand-new product was persisted. The parent uses it
   * to add the product to the active cart and invalidate any product
   * caches downstream. The callback runs AFTER the mutation succeeds
   * and BEFORE the modal closes.
   */
  onCreated?: (product: Product) => void;
}

export function QuickCreateProductGate({ onCreated }: QuickCreateProductGateProps) {
  const { t } = useTranslation('products');
  const toast = useToast();
  const utils = trpc.useUtils();
  const requested = useQuickCreateStore(selectRequestedCreateProduct);
  const consumeCreateProduct = useQuickCreateStore.getState().consumeCreateProduct;
  // No modal-key state needed — the parent renders this component
  // conditionally (returns `null` when `requested === null`), so the
  // form modal is mounted fresh on every new request and the form
  // state never lingers between cycles.

  const categoriesQuery = trpc.categories.tree.useQuery(undefined, {
    enabled: requested !== null,
  });
  const providersQuery = trpc.providers.list.useQuery(
    { page: 1, perPage: 200 },
    { enabled: requested !== null }
  );
  const locationsQuery = trpc.locations.list.useQuery(
    { page: 1, perPage: 200 },
    { enabled: requested !== null }
  );
  const unitsQuery = trpc.units.list.useQuery(
    { page: 1, perPage: 200 },
    { enabled: requested !== null }
  );
  const vatRatesQuery = trpc.vatRates.list.useQuery(
    { page: 1, perPage: 200 },
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
  const units: LookupOption[] = useMemo(
    () => (unitsQuery.data?.items ?? []).map(unit => ({ id: unit.id, name: unit.name })),
    [unitsQuery.data]
  );
  const vatRates: VatRateOption[] = useMemo(
    () =>
      (vatRatesQuery.data?.items ?? []).map(vatRate => ({
        id: vatRate.id,
        name: vatRate.name,
        rate: vatRate.rate,
      })),
    [vatRatesQuery.data]
  );

  if (!requested) {
    return null;
  }

  const handleClose = () => {
    consumeCreateProduct();
    createMutation.reset();
  };

  const handleSubmit = async (values: ProductFormValues): Promise<Product | void> => {
    const created = await createMutation.mutateAsync(values);
    await utils.products.list.invalidate();
    await utils.products.search.invalidate();
    toast.success({ title: t('toast.created') });
    return created as Product;
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
      error={createMutation.error?.message ?? null}
      onClose={handleClose}
      onSubmit={handleSubmit}
      defaultName={requested.defaultName ?? undefined}
      onCreated={handleCreated}
    />
  );
}
