import { lazy, Suspense, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Plus, RefreshCw, Search, Sparkles } from 'lucide-react';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import { TableExportActions } from '@/components/tables/TableExportActions';
import { StatusStrip } from '@/components/ui';
import { cn } from '@/lib/utils';
import {
  ProductFormModal,
  type LookupOption,
  type ProductFormValues,
  type VatRateOption,
} from '@/features/products/ProductFormModal';
import { ProductDetailsDrawer } from '@/features/products/ProductDetailsDrawer';
import { EmbeddingDriftBanner } from '@/features/products/EmbeddingDriftBanner';
import { EmptyStateReadinessNudge } from '@/components/feedback/EmptyStateReadinessNudge';
import { productExportColumns } from '@/features/products/productExport';
import { productsColumns, type DisplayProduct } from '@/features/products/productsColumns';
import { useProductsSemanticSearch } from '@/features/products/useProductsSemanticSearch';
import { buildProductPayload } from '@/features/products/productPayload';
import { useAuth } from '@/features/auth/AuthProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError, extractServerErrorCode } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import type { Product, UserRole } from '@/types';

const VariantMatrixModal = lazy(() =>
  import('./VariantMatrixModal').then(module => ({ default: module.VariantMatrixModal }))
);

function canManageProducts(role: UserRole | undefined): boolean {
  return role === 'admin' || role === 'manager';
}

function createMarginWindow() {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { fromDate: from.toISOString(), toDate: to.toISOString(), limit: 500 };
}

export function ProductsPage() {
  // `semanticSearch` is referenced via bare `i18next.t('semanticSearch:…')`
  // in the match column; declare it here so the lazy namespace loads (and the page
  // suspends) before those tooltips render, instead of showing a raw key.
  const { t } = useTranslation(['products', 'errors', 'semanticSearch']);
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const canManage = canManageProducts(user?.role);
  const canDelete = user?.role === 'admin';
  const canRegenerate = user?.role === 'admin';
  const isAdmin = user?.role === 'admin';

  // realized 30-day gross margin per product for the owner-mode
  // traffic light. Admin-only: the procedure is managerOrAdmin on the server,
  // and the column is an owner decision surface, so `enabled` keeps every
  // other role from even issuing the query.
  const [marginWindow] = useState(createMarginWindow);
  const marginQuery = trpc.reports.profit.margin.useQuery(marginWindow, {
    enabled: isAdmin,
    staleTime: 5 * 60_000,
  });
  const marginByProduct = useMemo(() => {
    if (!isAdmin) return null;
    return new Map(
      (marginQuery.data?.products ?? []).map(row => [row.productId, row.grossMarginPct])
    );
  }, [isAdmin, marginQuery.data]);

  // the semantic-search toggle/state machine + module gate lives in
  // its own hook; the page keeps the literal `products.list` query (fed by the
  // hook's debounced `literalFallbackSearch`) and the trivial displayProducts merge.
  const semantic = useProductsSemanticSearch({ canManage, canRegenerate });

  const productsQuery = trpc.products.list.useQuery({
    page: 1,
    perPage: 50,
    search: semantic.literalFallbackSearch,
    includeVariantParents: true,
  });

  const categoriesQuery = trpc.categories.tree.useQuery();
  const providersQuery = trpc.providers.list.useQuery({ page: 1, perPage: 200 });
  const locationsQuery = trpc.locations.list.useQuery({ page: 1, perPage: 200 });
  const unitsQuery = trpc.units.list.useQuery({ page: 1, perPage: 200 });
  const vatRatesQuery = trpc.vatRates.list.useQuery({ page: 1, perPage: 200 });

  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInstanceKey, setModalInstanceKey] = useState(0);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  // row-detail Drawer for the columns trimmed off the default
  // table (provider / location / tier-2 / tier-3 prices, SKU, min stock).
  const [detailsProduct, setDetailsProduct] = useState<Product | null>(null);
  const [matrixProduct, setMatrixProduct] = useState<Product | null>(null);
  const editingProductDetailQuery = trpc.products.getById.useQuery(
    { id: editingProduct?.id ?? '' },
    { enabled: !!editingProduct?.id }
  );
  const matrixQuery = trpc.products.getVariantMatrix.useQuery(
    { parentProductId: matrixProduct?.id ?? '' },
    { enabled: matrixProduct?.catalogType === 'variant_parent' }
  );

  const createMutation = trpc.products.create.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.products.list.invalidate(),
        utils.setupReadiness.firstSale.invalidate(),
      ]);
      handleCloseModal();
      toast.success({ title: t('toast.created') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'products:toast.createError' }),
  });
  const updateMutation = trpc.products.update.useMutation({
    onSuccess: async () => {
      await utils.products.list.invalidate();
      handleCloseModal();
      toast.success({ title: t('toast.updated') });
    },
    // on a STALE_VERSION conflict refresh the cached row so the
    // next time the operator opens the form they edit the latest version.
    onError: onErrorToast(toast, t, {
      titleKey: 'products:toast.updateError',
      extra: (_description, error) => {
        if (extractServerErrorCode(error) === 'STALE_VERSION') {
          void utils.products.list.invalidate();
          void utils.products.getById.invalidate();
        }
      },
    }),
  });
  const deleteMutation = trpc.products.delete.useMutation({
    onSuccess: async () => {
      await utils.products.list.invalidate();
      setProductToDelete(null);
      toast.success({ title: t('toast.deactivated') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'products:toast.deactivateError' }),
  });
  const createVariantMatrixMutation = trpc.products.createVariantMatrix.useMutation({
    onSuccess: async result => {
      await Promise.all([
        utils.products.list.invalidate(),
        utils.products.getById.invalidate({ id: result.parentProductId }),
        utils.products.getVariantMatrix.invalidate({ parentProductId: result.parentProductId }),
      ]);
      setMatrixProduct(null);
      toast.success({
        title: t('variants.toastCreated', { count: result.variants.length }),
      });
    },
    onError: onErrorToast(toast, t, { titleKey: 'products:variants.toastError' }),
  });

  const products: Product[] = (productsQuery.data?.items ?? []).map(product => ({
    ...product,
    isActive: product.isActive ?? false,
    syncStatus: product.syncStatus ?? undefined,
    syncVersion: product.syncVersion ?? undefined,
  }));

  // when semantic mode is active and the server returned results, the
  // hook hands back the ranked + normalized rows; otherwise render the literal list.
  const displayProducts: DisplayProduct[] = semantic.semanticIsActive
    ? semantic.semanticResults
    : products;
  const categories: LookupOption[] = (categoriesQuery.data?.items ?? []).map(category => ({
    id: category.id,
    name: category.name,
  }));
  const providers: LookupOption[] = (providersQuery.data?.items ?? []).map(provider => ({
    id: provider.id,
    name: provider.name,
  }));
  const locations: LookupOption[] = (locationsQuery.data?.items ?? [])
    .filter(location => location.isActive !== false)
    .map(location => ({
      id: location.id,
      name: `${location.code} · ${location.name}`,
    }));
  const units: LookupOption[] = (unitsQuery.data?.items ?? []).map(unit => ({
    id: unit.id,
    name: unit.name,
  }));
  const vatRates: VatRateOption[] = (vatRatesQuery.data?.items ?? []).map(vatRate => ({
    id: vatRate.id,
    name: vatRate.name,
    rate: vatRate.rate,
  }));
  const selectedProduct: Product | null = editingProductDetailQuery.data
    ? {
        ...editingProductDetailQuery.data,
        isActive: editingProductDetailQuery.data.isActive ?? false,
        syncStatus: editingProductDetailQuery.data.syncStatus ?? undefined,
        syncVersion: editingProductDetailQuery.data.syncVersion ?? undefined,
        unitAssignments: (editingProductDetailQuery.data.unitAssignments ?? []).map(assignment => ({
          ...assignment,
          isBase: assignment.isBase ?? false,
        })),
        providerAssignments: editingProductDetailQuery.data.providerAssignments ?? [],
      }
    : editingProduct;

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingProduct(null);
    createMutation.reset();
    updateMutation.reset();
  };

  const handleOpenCreate = () => {
    setEditingProduct(null);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  };

  // shared edit entry point used by the table (Pencil button +
  // onRowActivate, ) AND the row-detail Drawer's Edit footer.
  const handleOpenEdit = (product: Product) => {
    setEditingProduct(product);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  };

  // read-only product detail Drawer (holds the trimmed columns).
  const handleOpenDetails = (product: Product) => setDetailsProduct(product);
  const handleCloseDetails = () => setDetailsProduct(null);
  const handleEditFromDetails = (product: Product) => {
    setDetailsProduct(null);
    handleOpenEdit(product);
  };
  const handleManageVariants = (product: Product) => {
    setDetailsProduct(null);
    createVariantMatrixMutation.reset();
    setMatrixProduct(product);
  };

  const handleSubmit = async (values: ProductFormValues) => {
    // stock is derived inventory state for a lot-tracked product.
    // Omitting it on tracked updates prevents a metadata save from replaying
    // the stale stock value captured when the modal opened.
    const payload = buildProductPayload(values, {
      includeStock:
        !editingProduct ||
        (!values.tracksLots &&
          !values.tracksSerials &&
          editingProduct.catalogType !== 'variant_parent'),
    });

    if (editingProduct) {
      await updateMutation.mutateAsync({
        id: editingProduct.id,
        // round-trip the version the form was loaded with so a
        // concurrent edit from another tab is rejected with STALE_VERSION.
        version: editingProductDetailQuery.data?.version ?? editingProduct.version,
        ...payload,
      });
      return;
    }

    await createMutation.mutateAsync(payload);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-secondary-900">{t('page.title')}</h1>
        <button
          className="btn-primary flex items-center gap-2"
          onClick={handleOpenCreate}
          disabled={!canManage}
        >
          <Plus className="h-5 w-5" />
          {t('page.add')}
        </button>
      </div>

      {!canManage && (
        <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          {t('page.permissionNote')}
        </div>
      )}

      {semantic.canUseSemantic && <EmbeddingDriftBanner data={semantic.embeddingHealthData} />}

      {/* when the tenant has no products yet, surface a
          nudge toward the readiness checklist for admins. */}
      {!productsQuery.isLoading && !productsQuery.error && products.length === 0 && (
        <EmptyStateReadinessNudge scope="products" />
      )}

      <div className="card p-6">
        {productsQuery.isLoading && <TableLoadingState message={t('table.loading')} />}
        {productsQuery.error && (
          <TableErrorState
            title={t('table.error')}
            message={productsQuery.error.message}
            onRetry={() => {
              void productsQuery.refetch();
            }}
          />
        )}
        {!productsQuery.isLoading && !productsQuery.error && (
          <div className="space-y-4">
            <TableExportActions
              data={products}
              columns={productExportColumns}
              filename="products"
              title={t('page.title')}
            />

            {isAdmin && marginQuery.error && (
              <StatusStrip
                tone="warning"
                icon={AlertTriangle}
                title={translateServerError(marginQuery.error, t, t('table.marginUnavailable'))}
                role="alert"
              />
            )}

            {semantic.canUseSemantic && (
              <>
                {/* semantic toolbar: toggle, dedicated input, regen button */}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={semantic.semanticEnabled}
                    aria-label={t('semantic.toggleLabel')}
                    title={t('semantic.toggleHint')}
                    onClick={() => semantic.setSemanticEnabled(current => !current)}
                    className={cn(
                      'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                      semantic.semanticEnabled
                        ? 'border-primary-200 bg-primary-50 text-primary-700'
                        : 'border-line bg-card text-secondary-600 hover:bg-secondary-50'
                    )}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {t('semantic.toggleLabel')}
                  </button>

                  {semantic.semanticModeEnabled && (
                    <div className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-400" />
                      <input
                        type="text"
                        className="input pl-10"
                        placeholder={t('table.searchSemantic')}
                        value={semantic.semanticQuery}
                        onChange={event => semantic.setSemanticQuery(event.target.value)}
                        aria-label={t('table.searchSemantic')}
                      />
                    </div>
                  )}

                  {semantic.canRegenerate && (
                    <button
                      type="button"
                      onClick={() => semantic.regenerate()}
                      disabled={semantic.isRegenerating}
                      className="btn-outline flex items-center gap-2"
                    >
                      <RefreshCw
                        className={cn('h-4 w-4', semantic.isRegenerating && 'animate-spin')}
                      />
                      {semantic.isRegenerating
                        ? t('semantic.regenerating')
                        : t('semantic.regenerate')}
                    </button>
                  )}
                </div>

                {semantic.semanticModeEnabled && (
                  <p className="text-xs text-secondary-500">
                    {semantic.semanticUnavailable
                      ? t('semantic.unavailable')
                      : semantic.semanticIsActive
                        ? t('semantic.modeBadge')
                        : t('semantic.toggleHint')}
                  </p>
                )}

                {semantic.semanticModeEnabled && semantic.isSearching && (
                  <p className="text-xs text-secondary-500">{t('semantic.searching')}</p>
                )}
              </>
            )}

            <DataTable
              variant="dense"
              columns={productsColumns(
                handleOpenDetails,
                handleOpenEdit,
                product => setProductToDelete(product),
                canManage,
                canDelete,
                semantic.semanticIsActive,
                marginByProduct
              )}
              data={displayProducts}
              searchKey={semantic.semanticModeEnabled ? undefined : 'name'}
              searchPlaceholder={t('table.search')}
              pageSize={10}
              // keyboard row-activate mirrors the Pencil (edit)
              // action for manager / admin; viewer / cashier have no
              // editable row so it stays a no-op.  added a separate
              // Details affordance (Eye button, all roles) that is focusable
              // in tab order, so this keyboard edit parity is unchanged.
              onRowActivate={
                canManage
                  ? product =>
                      product.catalogType === 'variant_parent'
                        ? handleOpenDetails(product)
                        : handleOpenEdit(product)
                  : undefined
              }
            />

            {semantic.semanticIsActive && displayProducts.length === 0 && !semantic.isSearching && (
              <p className="text-sm text-secondary-500">{t('semantic.noResults')}</p>
            )}
          </div>
        )}
      </div>

      <ProductFormModal
        key={`${editingProduct?.id ?? 'new-product'}-${editingProductDetailQuery.data?.updatedAt ?? 'pending'}-${modalInstanceKey}`}
        mode={editingProduct ? 'edit' : 'create'}
        isOpen={isModalOpen}
        product={selectedProduct}
        categories={categories}
        locations={locations}
        providers={providers}
        units={units}
        vatRates={vatRates}
        isSaving={createMutation.isPending || updateMutation.isPending}
        error={
          createMutation.error
            ? translateServerError(createMutation.error, t, t('errors:server.unknown'))
            : updateMutation.error
              ? translateServerError(updateMutation.error, t, t('errors:server.unknown'))
              : null
        }
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
      />

      <ConfirmModal
        isOpen={!!productToDelete}
        title={t('deactivate.title')}
        message={t('deactivate.description')}
        confirmText={
          deleteMutation.isPending ? t('deactivate.submitting') : t('deactivate.confirm')
        }
        onClose={() => setProductToDelete(null)}
        onConfirm={async () => {
          if (!productToDelete) {
            return;
          }

          await deleteMutation.mutateAsync({ id: productToDelete.id });
        }}
        loading={deleteMutation.isPending}
        variant="danger"
      />

      <ProductDetailsDrawer
        product={detailsProduct}
        onClose={handleCloseDetails}
        onEdit={canManage ? handleEditFromDetails : undefined}
        onManageVariants={canManage ? handleManageVariants : undefined}
      />

      {matrixProduct && (
        <Suspense fallback={null}>
          <VariantMatrixModal
            key={matrixProduct.id}
            isOpen
            product={matrixProduct}
            matrix={
              matrixQuery.data
                ? {
                    axes: matrixQuery.data.axes,
                    variants: matrixQuery.data.variants.map(variant => ({
                      ...variant,
                      isActive: variant.isActive ?? false,
                    })),
                  }
                : null
            }
            isLoading={matrixProduct.catalogType === 'variant_parent' && matrixQuery.isLoading}
            isSaving={createVariantMatrixMutation.isPending}
            error={
              createVariantMatrixMutation.error
                ? translateServerError(
                    createVariantMatrixMutation.error,
                    t,
                    t('errors:server.unknown')
                  )
                : matrixQuery.error
                  ? translateServerError(matrixQuery.error, t, t('errors:server.unknown'))
                  : null
            }
            onClose={() => {
              setMatrixProduct(null);
              createVariantMatrixMutation.reset();
            }}
            onSubmit={async axes => {
              await createVariantMatrixMutation.mutateAsync({
                parentProductId: matrixProduct.id,
                axes,
              });
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
