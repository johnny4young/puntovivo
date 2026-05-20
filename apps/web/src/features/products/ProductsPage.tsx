import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { ColumnDef } from '@tanstack/react-table';
import { Pencil, Plus, RefreshCw, Search, Sparkles, Tag, Trash2 } from 'lucide-react';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import { TableExportActions } from '@/components/tables/TableExportActions';
import { cn } from '@/lib/utils';
import {
  ProductFormModal,
  type LookupOption,
  type ProductFormValues,
  type VatRateOption,
} from '@/features/products/ProductFormModal';
import { EmbeddingDriftBanner } from '@/features/products/EmbeddingDriftBanner';
import { EmptyStateReadinessNudge } from '@/components/feedback/EmptyStateReadinessNudge';
import { productExportColumns } from '@/features/products/productExport';
import { normalizeProductProviders } from '@/features/products/providerState';
import { useAuth } from '@/features/auth/AuthProvider';
import { useIsModuleActive } from '@/features/modules';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import type { Product, UserRole } from '@/types';

function canManageProducts(role: UserRole | undefined): boolean {
  return role === 'admin' || role === 'manager';
}

// ENG-048 — when ProductsPage runs in semantic-search mode the rows
// carry an extra optional `similarity` score. Using the loose row type
// here keeps the literal-mode columns identical and lets the optional
// "Match" column read the score from the semantic-mode rows without
// changing the public `Product` type for unrelated callers.
type DisplayProduct = Product & { similarity?: number };

const columns = (
  onEdit: (product: Product) => void,
  onDelete: (product: Product) => void,
  canEdit: boolean,
  canDelete: boolean,
  showSimilarity: boolean
): ColumnDef<DisplayProduct>[] => [
  {
    accessorKey: 'name',
    header: () => i18next.t('products:table.product'),
    size: 240,
    cell: ({ row }) => (
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100">
          <Tag className="h-4 w-4 text-primary-700" />
        </div>
        <div>
          <p className="font-medium text-secondary-900">{row.original.name}</p>
          <p className="text-xs text-secondary-500">{row.original.sku}</p>
        </div>
      </div>
    ),
  },
  {
    accessorKey: 'categoryName',
    header: () => i18next.t('products:table.category'),
    size: 150,
    cell: ({ row }) => row.original.categoryName ?? '-',
  },
  {
    accessorKey: 'providerName',
    header: () => i18next.t('products:table.provider'),
    size: 160,
    cell: ({ row }) => row.original.providerName ?? '-',
  },
  {
    accessorKey: 'locationName',
    header: () => i18next.t('products:table.location'),
    size: 180,
    cell: ({ row }) => row.original.locationName ?? '-',
  },
  {
    accessorKey: 'price',
    header: () => i18next.t('products:table.tier1'),
    size: 110,
    cell: ({ row }) => formatCurrency(row.original.price),
  },
  {
    accessorKey: 'price2',
    header: () => i18next.t('products:table.tier2'),
    size: 110,
    cell: ({ row }) => formatCurrency(row.original.price2),
  },
  {
    accessorKey: 'price3',
    header: () => i18next.t('products:table.tier3'),
    size: 110,
    cell: ({ row }) => formatCurrency(row.original.price3),
  },
  {
    accessorKey: 'stock',
    header: () => i18next.t('products:table.stock'),
    size: 90,
    cell: ({ row }) => {
      const isLow = row.original.stock < row.original.minStock;
      return (
        <span className={isLow ? 'font-medium text-danger-500' : ''}>
          {row.original.stock}
          {isLow ? ` (${i18next.t('products:table.low')})` : ''}
        </span>
      );
    },
  },
  {
    accessorKey: 'isActive',
    header: () => i18next.t('products:table.status'),
    size: 110,
    cell: ({ row }) => (
      <span className={`badge ${row.original.isActive ? 'badge-success' : 'badge-secondary'}`}>
        {row.original.isActive ? i18next.t('products:table.active') : i18next.t('products:table.inactive')}
      </span>
    ),
  },
  ...(showSimilarity
    ? [
        {
          id: 'similarity',
          header: () => i18next.t('products:table.match'),
          size: 140,
          cell: ({ row }: { row: { original: DisplayProduct } }) => {
            const sim = row.original.similarity;
            if (typeof sim !== 'number') return <span className="text-secondary-400">-</span>;
            const pct = Math.max(0, Math.min(100, Math.round(sim * 100)));
            const toneClass =
              pct >= 80
                ? 'bg-success-500'
                : pct >= 60
                  ? 'bg-primary'
                  : 'bg-warning-500';
            return (
              <div
                className="flex items-center gap-2"
                title={i18next.t('semanticSearch:score.tooltip', { score: sim.toFixed(2) })}
              >
                <div className="h-2 w-20 overflow-hidden rounded-full bg-secondary-100">
                  <div className={`h-full rounded-full ${toneClass}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="text-[11px] font-mono tabular-nums text-secondary-700">{pct}%</span>
              </div>
            );
          },
        } satisfies ColumnDef<DisplayProduct>,
      ]
    : []),
  {
    id: 'actions',
    size: 100,
    cell: ({ row }) => (
      <div className="flex items-center gap-1">
        <button
          className="btn-ghost btn-icon h-8 w-8"
          onClick={() => onEdit(row.original)}
          disabled={!canEdit}
        >
          <Pencil className="h-4 w-4" />
        </button>
        {canDelete && (
          <button
            className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
            onClick={() => onDelete(row.original)}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    ),
  },
];

export function ProductsPage() {
  const { t } = useTranslation(['products', 'errors']);
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const canManage = canManageProducts(user?.role);
  const canDelete = user?.role === 'admin';
  const canRegenerate = user?.role === 'admin';
  const semanticModuleActive = useIsModuleActive('semantic-search');
  const canUseSemantic = canManage && semanticModuleActive;

  // ENG-048 — semantic search UI surface. The toggle flips between the
  // existing client-side text filter (DataTable's internal globalFilter
  // on the "name" column) and the server-side cosine-similarity ranking
  // exposed by `products.semanticSearch`. We debounce by 300ms so each
  // keystroke does not trigger a network roundtrip + OpenAI embed call.
  // The mutation `regenerateEmbeddings` is admin-only and is the way to
  // bring a freshly seeded catalog (or one whose products have been
  // edited heavily) up to date — the UI surfaces "X embedded" toast on
  // success and a translated warning when AI is disabled / unconfigured.
  const [semanticEnabled, setSemanticEnabled] = useState(false);
  const [semanticQuery, setSemanticQuery] = useState('');
  const [debouncedSemanticQuery, setDebouncedSemanticQuery] = useState('');
  const semanticModeEnabled = canUseSemantic && semanticEnabled;
  const literalFallbackSearch =
    semanticModeEnabled && debouncedSemanticQuery.length > 0 ? debouncedSemanticQuery : undefined;
  const productsQuery = trpc.products.list.useQuery({
    page: 1,
    perPage: 50,
    search: literalFallbackSearch,
  });

  useEffect(() => {
    if (!semanticModeEnabled) {
      // Only schedule the reset if there is something to clear, so the
      // effect does not trigger an extra render on every disable cycle.
      if (debouncedSemanticQuery !== '') {
        const clearHandle = window.setTimeout(() => setDebouncedSemanticQuery(''), 0);
        return () => window.clearTimeout(clearHandle);
      }
      return;
    }
    const handle = window.setTimeout(() => {
      setDebouncedSemanticQuery(semanticQuery.trim());
    }, 300);
    return () => window.clearTimeout(handle);
  }, [semanticModeEnabled, semanticQuery, debouncedSemanticQuery]);

  const semanticSearchQuery = trpc.products.semanticSearch.useQuery(
    { query: debouncedSemanticQuery, limit: 25 },
    { enabled: semanticModeEnabled && debouncedSemanticQuery.length > 0 }
  );

  // ENG-040 — drift health drives the warning banner above the
  // toolbar. Gated on the same module + role surface as the rest of
  // the semantic toolbar so non-activated tenants don't fire the
  // query at all; the server also rejects with MODULE_NOT_ACTIVATED
  // if it ever sneaks through.
  const embeddingHealthQuery = trpc.products.embeddingHealth.useQuery(undefined, {
    enabled: canUseSemantic,
  });

  const regenerateMutation = trpc.products.regenerateEmbeddings.useMutation({
    onSuccess: async data => {
      if (!data.ok) {
        toast.warning({ title: t('semantic.regenerateUnavailable') });
        return;
      }
      toast.success({
        title: t('semantic.regenerated', { count: data.embedded }),
      });
      // Refresh both semantic search results and the drift banner, so the
      // existing toolbar CTA clears the same health signal as the banner CTA.
      await Promise.all([
        utils.products.embeddingHealth.invalidate(),
        utils.products.semanticSearch.invalidate(),
      ]);
    },
    onError: onErrorToast(toast, t, { titleKey: 'products:semantic.regenerateError' }),
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
  const editingProductDetailQuery = trpc.products.getById.useQuery(
    { id: editingProduct?.id ?? '' },
    { enabled: !!editingProduct?.id }
  );

  const createMutation = trpc.products.create.useMutation({
    onSuccess: async () => {
      await utils.products.list.invalidate();
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
    onError: onErrorToast(toast, t, { titleKey: 'products:toast.updateError' }),
  });
  const deleteMutation = trpc.products.delete.useMutation({
    onSuccess: async () => {
      await utils.products.list.invalidate();
      setProductToDelete(null);
      toast.success({ title: t('toast.deactivated') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'products:toast.deactivateError' }),
  });

  const products: Product[] = (productsQuery.data?.items ?? []).map(product => ({
    ...product,
    isActive: product.isActive ?? false,
    syncStatus: product.syncStatus ?? undefined,
    syncVersion: product.syncVersion ?? undefined,
  }));

  // ENG-048 — when semantic mode is active and the server returned
  // results, replace the rendered rows; the rest of the UI keeps
  // working unchanged because the row shape matches the standard list
  // selection plus an extra optional `similarity` field.
  const semanticUnavailable =
    semanticModeEnabled && semanticSearchQuery.data?.mode === 'unavailable';
  const semanticIsActive =
    semanticModeEnabled &&
    debouncedSemanticQuery.length > 0 &&
    semanticSearchQuery.data?.mode === 'semantic';
  const semanticResults: Array<Product & { similarity?: number }> = useMemo(() => {
    if (!semanticIsActive) return [];
    const items = semanticSearchQuery.data?.mode === 'semantic'
      ? semanticSearchQuery.data.results
      : [];
    return items.map(item => {
      const normalized = {
        ...item,
        isActive: item.isActive ?? false,
        syncStatus: item.syncStatus ?? undefined,
        syncVersion: item.syncVersion ?? undefined,
      } as Product;
      return { ...normalized, similarity: item.similarity };
    });
  }, [semanticIsActive, semanticSearchQuery.data]);

  const displayProducts: Array<Product & { similarity?: number }> = semanticIsActive
    ? semanticResults
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

  const buildProviderPayload = (values: ProductFormValues) => {
    const normalizedProviders = normalizeProductProviders({
      providerId: values.providerId,
      providerAssignments: values.providerAssignments,
    });

    return {
      providerId: normalizedProviders.primaryProviderId,
      providerAssignments: normalizedProviders.providerAssignments,
    };
  };

  const handleSubmit = async (values: ProductFormValues) => {
    const providerPayload = buildProviderPayload(values);
    const payload = {
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
      stock: values.stock,
      minStock: values.minStock,
      sellByFraction: values.sellByFraction,
      fractionStep: values.sellByFraction ? values.fractionStep : null,
      fractionMinimum: values.sellByFraction ? values.fractionMinimum : null,
      isActive: values.isActive,
      unitAssignments: values.unitAssignments.map(assignment => ({
        unitId: assignment.unitId,
        equivalence: assignment.equivalence,
        price: assignment.price,
        isBase: assignment.isBase,
      })),
      providerAssignments: providerPayload.providerAssignments,
    };

    if (editingProduct) {
      await updateMutation.mutateAsync({
        id: editingProduct.id,
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

      {canUseSemantic && <EmbeddingDriftBanner data={embeddingHealthQuery.data} />}

      {/* ENG-104 — when the tenant has no products yet, surface a
          nudge toward the readiness checklist for admins. */}
      {!productsQuery.isLoading &&
        !productsQuery.error &&
        products.length === 0 && <EmptyStateReadinessNudge scope="products" />}

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

            {canUseSemantic && (
              <>
                {/* ENG-048 — semantic toolbar: toggle, dedicated input, regen button */}
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={semanticEnabled}
                    aria-label={t('semantic.toggleLabel')}
                    title={t('semantic.toggleHint')}
                    onClick={() => setSemanticEnabled(current => !current)}
                    className={cn(
                      'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                      semanticEnabled
                        ? 'border-primary-200 bg-primary-50 text-primary-700'
                        : 'border-line bg-card text-secondary-600 hover:bg-secondary-50'
                    )}
                  >
                    <Sparkles className="h-3.5 w-3.5" />
                    {t('semantic.toggleLabel')}
                  </button>

                  {semanticModeEnabled && (
                    <div className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-400" />
                      <input
                        type="text"
                        className="input pl-10"
                        placeholder={t('table.searchSemantic')}
                        value={semanticQuery}
                        onChange={event => setSemanticQuery(event.target.value)}
                        aria-label={t('table.searchSemantic')}
                      />
                    </div>
                  )}

                  {canRegenerate && (
                    <button
                      type="button"
                      onClick={() => regenerateMutation.mutate()}
                      disabled={regenerateMutation.isPending}
                      className="btn-outline flex items-center gap-2"
                    >
                      <RefreshCw
                        className={cn(
                          'h-4 w-4',
                          regenerateMutation.isPending && 'animate-spin'
                        )}
                      />
                      {regenerateMutation.isPending
                        ? t('semantic.regenerating')
                        : t('semantic.regenerate')}
                    </button>
                  )}
                </div>

                {semanticModeEnabled && (
                  <p className="text-xs text-secondary-500">
                    {semanticUnavailable
                      ? t('semantic.unavailable')
                      : semanticIsActive
                        ? t('semantic.modeBadge')
                        : t('semantic.toggleHint')}
                  </p>
                )}

                {semanticModeEnabled && semanticSearchQuery.isFetching && (
                  <p className="text-xs text-secondary-500">{t('semantic.searching')}</p>
                )}
              </>
            )}

            <DataTable
              columns={columns(
                product => {
                  setEditingProduct(product);
                  setModalInstanceKey(current => current + 1);
                  setIsModalOpen(true);
                },
                product => setProductToDelete(product),
                canManage,
                canDelete,
                semanticIsActive
              )}
              data={displayProducts}
              searchKey={semanticModeEnabled ? undefined : 'name'}
              searchPlaceholder={t('table.search')}
              pageSize={10}
            />

            {semanticIsActive && displayProducts.length === 0 && !semanticSearchQuery.isFetching && (
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
        confirmText={deleteMutation.isPending ? t('deactivate.submitting') : t('deactivate.confirm')}
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
    </div>
  );
}
