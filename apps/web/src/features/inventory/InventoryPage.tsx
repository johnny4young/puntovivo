import { useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { ProductSearchDialog } from '@/components/dialogs/ProductSearchDialog';
import { DataTable } from '@/components/tables/DataTable';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  InventoryAdjustmentModal,
  type InventoryAdjustmentProduct,
  type InventoryAdjustmentFormValues,
} from '@/features/inventory/InventoryAdjustmentModal';
import { trpc } from '@/lib/trpc';
import { cn, formatCurrency, formatDateTime } from '@/lib/utils';
import type {
  Category,
  InventoryMovement,
  InventoryStockItem,
  ProductSearchSelection,
  UserRole,
} from '@/types';

type InventoryView = 'movements' | 'stock';

const movementIcons = {
  purchase: ArrowDownCircle,
  sale: ArrowUpCircle,
  adjustment: RefreshCw,
  transfer: RefreshCw,
  return: ArrowDownCircle,
} as const;

const movementColors = {
  purchase: 'text-success-500',
  sale: 'text-danger-500',
  adjustment: 'text-warning-500',
  transfer: 'text-primary-500',
  return: 'text-success-500',
} as const;

function canManageInventory(role: UserRole | undefined): boolean {
  return role === 'admin' || role === 'manager';
}

function getMovementDelta(movement: InventoryMovement): number {
  if (movement.type === 'sale' || movement.type === 'transfer') {
    return movement.previousStock - movement.newStock > 0 ? -movement.quantity : movement.quantity;
  }

  if (movement.type === 'adjustment') {
    return movement.newStock - movement.previousStock;
  }

  return movement.quantity;
}

const movementColumns: ColumnDef<InventoryMovement>[] = [
  {
    accessorKey: 'createdAt',
    header: 'Date',
    size: 180,
    cell: ({ row }) => formatDateTime(row.original.createdAt),
  },
  {
    accessorKey: 'type',
    header: 'Type',
    size: 140,
    cell: ({ row }) => {
      const type = row.original.type;
      const Icon = movementIcons[type] ?? RefreshCw;
      return (
        <div className={cn('flex items-center gap-2 font-medium capitalize', movementColors[type])}>
          <Icon className="h-4 w-4" />
          <span>{type}</span>
        </div>
      );
    },
  },
  {
    accessorKey: 'productName',
    header: 'Product',
    size: 230,
    cell: ({ row }) => (
      <div>
        <p className="font-medium text-secondary-900">{row.original.productName ?? 'Unknown product'}</p>
        <p className="text-xs text-secondary-500">
          {row.original.productSku ?? 'No SKU'}
          {row.original.categoryName ? ` · ${row.original.categoryName}` : ''}
        </p>
      </div>
    ),
  },
  {
    id: 'delta',
    header: 'Movement',
    size: 110,
    cell: ({ row }) => {
      const delta = getMovementDelta(row.original);
      return (
        <span
          className={cn(
            'font-medium',
            delta > 0 ? 'text-success-600' : delta < 0 ? 'text-danger-600' : 'text-secondary-700'
          )}
        >
          {delta > 0 ? '+' : ''}
          {delta}
        </span>
      );
    },
  },
  {
    accessorKey: 'newStock',
    header: 'Stock After',
    size: 110,
    cell: ({ row }) => <span className="font-medium text-secondary-900">{row.original.newStock}</span>,
  },
  {
    accessorKey: 'reference',
    header: 'Reference',
    size: 150,
    cell: ({ row }) => (
      <span className="font-mono text-sm text-primary-600">{row.original.reference || '—'}</span>
    ),
  },
  {
    accessorKey: 'notes',
    header: 'Notes',
    size: 220,
    cell: ({ row }) => (
      <span className="block max-w-[220px] truncate text-secondary-500">{row.original.notes || '—'}</span>
    ),
  },
];

function getStockColumns(
  onAdjust: (product: InventoryStockItem) => void,
  canManage: boolean
): ColumnDef<InventoryStockItem>[] {
  return [
    {
      accessorKey: 'name',
      header: 'Product',
      size: 250,
      cell: ({ row }) => (
        <div>
          <p className="font-medium text-secondary-900">{row.original.name}</p>
          <p className="text-xs text-secondary-500">
            {row.original.sku}
            {row.original.categoryName ? ` · ${row.original.categoryName}` : ''}
          </p>
        </div>
      ),
    },
    {
      accessorKey: 'stock',
      header: 'Stock',
      size: 100,
      cell: ({ row }) => (
        <span className={row.original.isLowStock ? 'font-medium text-danger-500' : 'font-medium text-secondary-900'}>
          {row.original.stock}
        </span>
      ),
    },
    {
      accessorKey: 'minStock',
      header: 'Min Stock',
      size: 110,
    },
    {
      accessorKey: 'price',
      header: 'Sell Price',
      size: 120,
      cell: ({ row }) => formatCurrency(row.original.price),
    },
    {
      accessorKey: 'inventoryValue',
      header: 'Valuation',
      size: 140,
      cell: ({ row }) => formatCurrency(row.original.inventoryValue),
    },
    {
      accessorKey: 'updatedAt',
      header: 'Updated',
      size: 170,
      cell: ({ row }) => formatDateTime(row.original.updatedAt),
    },
    {
      id: 'status',
      header: 'Status',
      size: 120,
      cell: ({ row }) => (
        <span className={cn('badge', row.original.isLowStock ? 'badge-danger' : 'badge-success')}>
          {row.original.isLowStock ? 'Low stock' : 'Healthy'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      size: 100,
      cell: ({ row }) => (
        <button
          className="btn-ghost btn-icon h-8 w-8"
          onClick={() => onAdjust(row.original)}
          disabled={!canManage}
          title="Adjust stock"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      ),
    },
  ];
}

function mapStockItemToAdjustmentProduct(product: InventoryStockItem): InventoryAdjustmentProduct {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    stock: product.stock,
    minStock: product.minStock,
    categoryName: product.categoryName,
  };
}

function mapSearchSelectionToAdjustmentProduct(
  selection: ProductSearchSelection
): InventoryAdjustmentProduct {
  return {
    id: selection.product.id,
    name: selection.product.name,
    sku: selection.product.sku,
    stock: selection.product.stock,
    minStock: selection.product.minStock,
    categoryName: selection.product.categoryName,
  };
}

export function InventoryPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const canManage = canManageInventory(user?.role);

  const [activeView, setActiveView] = useState<InventoryView>('movements');
  const [stockCategoryId, setStockCategoryId] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
  const [modalInstanceKey, setModalInstanceKey] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState<InventoryAdjustmentProduct | null>(null);

  const categoriesQuery = trpc.categories.tree.useQuery();
  const movementsQuery = trpc.inventory.listMovements.useQuery({
    page: 1,
    perPage: 50,
  });
  const stockQuery = trpc.inventory.listStock.useQuery({
    page: 1,
    perPage: 100,
    categoryId: stockCategoryId || undefined,
    lowStockOnly,
  });

  const adjustStockMutation = trpc.inventory.adjustStock.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.inventory.listMovements.invalidate(),
        utils.inventory.listStock.invalidate(),
        utils.products.list.invalidate(),
      ]);
      setIsAdjustmentModalOpen(false);
      setSelectedProduct(null);
    },
  });

  const categories = (categoriesQuery.data?.items ?? []) as Category[];
  const movements = (movementsQuery.data?.items ?? []) as InventoryMovement[];
  const stockItems = (stockQuery.data?.items ?? []) as InventoryStockItem[];
  const stockSummary = stockQuery.data?.summary;
  const recentAdjustments = movements.filter(movement => movement.type === 'adjustment').length;
  const recentInbound = movements
    .map(getMovementDelta)
    .filter(delta => delta > 0)
    .reduce((sum, delta) => sum + delta, 0);
  const recentOutbound = movements
    .map(getMovementDelta)
    .filter(delta => delta < 0)
    .reduce((sum, delta) => sum + Math.abs(delta), 0);

  const openAdjustmentModal = (product: InventoryAdjustmentProduct) => {
    setSelectedProduct(product);
    setModalInstanceKey(current => current + 1);
    setIsAdjustmentModalOpen(true);
  };

  const handleAdjustmentSubmit = async (values: InventoryAdjustmentFormValues) => {
    if (!selectedProduct) {
      return;
    }

    await adjustStockMutation.mutateAsync({
      productId: selectedProduct.id,
      newStock: values.newStock,
      notes: values.notes || undefined,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Inventory</h1>
          <p className="mt-1 text-sm text-secondary-500">
            Review stock positions and record counted adjustments against the live catalog.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-secondary-200 bg-white p-1">
            <button
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                activeView === 'movements'
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-secondary-600 hover:text-secondary-900'
              )}
              onClick={() => setActiveView('movements')}
            >
              Movements
            </button>
            <button
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                activeView === 'stock'
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-secondary-600 hover:text-secondary-900'
              )}
              onClick={() => setActiveView('stock')}
            >
              Stock Query
            </button>
          </div>

          <button className="btn-primary flex items-center gap-2" onClick={() => setIsSearchOpen(true)} disabled={!canManage}>
            <Search className="h-4 w-4" />
            New Adjustment
          </button>
        </div>
      </div>

      {!canManage && (
        <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          Only administrators and managers can adjust stock. Movement and stock views remain available.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="card p-4">
          <p className="text-sm text-secondary-500">Total Units</p>
          <p className="mt-2 text-2xl font-bold text-secondary-900">
            {stockQuery.isLoading ? '—' : stockSummary?.totalUnits ?? 0}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-secondary-500">Inventory Value</p>
          <p className="mt-2 text-2xl font-bold text-secondary-900">
            {stockQuery.isLoading ? '—' : formatCurrency(stockSummary?.totalValue ?? 0)}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-secondary-500">Low Stock Items</p>
          <p className="mt-2 text-2xl font-bold text-danger-500">
            {stockQuery.isLoading ? '—' : stockSummary?.lowStockCount ?? 0}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-secondary-500">Recent Flow</p>
          <p className="mt-2 text-lg font-semibold text-secondary-900">
            +{recentInbound} / -{recentOutbound}
          </p>
          <p className="mt-1 text-xs text-secondary-500">{recentAdjustments} recent adjustments</p>
        </div>
      </div>

      {activeView === 'stock' && (
        <div className="card p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <label className="block md:min-w-64">
              <span className="label">Category</span>
              <select
                className="input mt-1"
                value={stockCategoryId}
                onChange={event => setStockCategoryId(event.target.value)}
              >
                <option value="">All categories</option>
                {categories.map(category => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="inline-flex items-center gap-3 text-sm text-secondary-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-secondary-300"
                checked={lowStockOnly}
                onChange={event => setLowStockOnly(event.target.checked)}
              />
              Show low stock only
            </label>
          </div>
        </div>
      )}

      <div className="card p-6">
        {activeView === 'movements' && (
          <>
            {movementsQuery.isLoading && <p className="py-4 text-secondary-500">Loading inventory movements...</p>}
            {movementsQuery.error && <p className="py-4 text-danger-500">{movementsQuery.error.message}</p>}
            {!movementsQuery.isLoading && !movementsQuery.error && (
              <DataTable
                columns={movementColumns}
                data={movements}
                searchKey="productName"
                searchPlaceholder="Search movements by product..."
                pageSize={10}
              />
            )}
          </>
        )}

        {activeView === 'stock' && (
          <>
            {stockQuery.isLoading && <p className="py-4 text-secondary-500">Loading stock balances...</p>}
            {stockQuery.error && <p className="py-4 text-danger-500">{stockQuery.error.message}</p>}
            {!stockQuery.isLoading && !stockQuery.error && (
              <DataTable
                columns={getStockColumns(product => openAdjustmentModal(mapStockItemToAdjustmentProduct(product)), canManage)}
                data={stockItems}
                searchKey="name"
                searchPlaceholder="Search stock by product..."
                pageSize={10}
              />
            )}
          </>
        )}
      </div>

      <ProductSearchDialog
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        categories={categories}
        title="Select Product for Adjustment"
        confirmLabel="Adjust Product"
        onSelect={selection => {
          setIsSearchOpen(false);
          openAdjustmentModal(mapSearchSelectionToAdjustmentProduct(selection));
        }}
      />

      <InventoryAdjustmentModal
        key={`${selectedProduct?.id ?? 'inventory-adjustment'}-${modalInstanceKey}`}
        isOpen={isAdjustmentModalOpen}
        product={selectedProduct}
        isSaving={adjustStockMutation.isPending}
        error={adjustStockMutation.error?.message ?? null}
        onClose={() => {
          setIsAdjustmentModalOpen(false);
          setSelectedProduct(null);
        }}
        onSubmit={handleAdjustmentSubmit}
      />

      <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-3 text-sm text-secondary-600">
        This inventory slice is tenant-wide. Site-level stock normalization is still pending, so adjustments and valuation currently reflect the shared product stock model.
      </div>
    </div>
  );
}
