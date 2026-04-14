import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18next from 'i18next';
import { ColumnDef } from '@tanstack/react-table';
import { Pencil, Plus, Tag, Trash2 } from 'lucide-react';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import { TableExportActions } from '@/components/tables/TableExportActions';
import {
  ProductFormModal,
  type LookupOption,
  type ProductFormValues,
  type VatRateOption,
} from '@/features/products/ProductFormModal';
import { productExportColumns } from '@/features/products/productExport';
import { normalizeProductProviders } from '@/features/products/providerState';
import { useAuth } from '@/features/auth/AuthProvider';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import type { Product, UserRole } from '@/types';

function canManageProducts(role: UserRole | undefined): boolean {
  return role === 'admin' || role === 'manager';
}

const columns = (
  onEdit: (product: Product) => void,
  onDelete: (product: Product) => void,
  canEdit: boolean,
  canDelete: boolean
): ColumnDef<Product>[] => [
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
  const productsQuery = trpc.products.list.useQuery({ page: 1, perPage: 50 });
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
    onError: error => {
      toast.error({
        title: t('toast.createError'),
        description: getServerErrorMessage(error),
      });
    },
  });
  const updateMutation = trpc.products.update.useMutation({
    onSuccess: async () => {
      await utils.products.list.invalidate();
      handleCloseModal();
      toast.success({ title: t('toast.updated') });
    },
    onError: error => {
      toast.error({
        title: t('toast.updateError'),
        description: getServerErrorMessage(error),
      });
    },
  });
  const deleteMutation = trpc.products.delete.useMutation({
    onSuccess: async () => {
      await utils.products.list.invalidate();
      setProductToDelete(null);
      toast.success({ title: t('toast.deactivated') });
    },
    onError: error => {
      toast.error({
        title: t('toast.deactivateError'),
        description: getServerErrorMessage(error),
      });
    },
  });

  const canManage = canManageProducts(user?.role);
  const canDelete = user?.role === 'admin';
  const products: Product[] = (productsQuery.data?.items ?? []).map(product => ({
    ...product,
    isActive: product.isActive ?? false,
    syncStatus: product.syncStatus ?? undefined,
    syncVersion: product.syncVersion ?? undefined,
  }));
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

  const getServerErrorMessage = (error: unknown) =>
    translateServerError(error, t, t('errors:server.unknown'));

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
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">{t('page.title')}</h1>
          <p className="mt-1 text-sm text-secondary-500">
            {t('page.description')}
          </p>
        </div>
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
              title={t('page.kicker')}
            />
            <DataTable
              columns={columns(
                product => {
                  setEditingProduct(product);
                  setModalInstanceKey(current => current + 1);
                  setIsModalOpen(true);
                },
                product => setProductToDelete(product),
                canManage,
                canDelete
              )}
              data={products}
              searchKey="name"
              searchPlaceholder={t('table.search')}
              pageSize={10}
            />
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
            ? getServerErrorMessage(createMutation.error)
            : updateMutation.error
              ? getServerErrorMessage(updateMutation.error)
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
