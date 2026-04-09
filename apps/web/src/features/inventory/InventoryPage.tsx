import { useState } from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Boxes,
  ClipboardList,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { ProductSearchDialog } from '@/components/dialogs/ProductSearchDialog';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import { TableExportActions } from '@/components/tables/TableExportActions';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  InventoryAdjustmentModal,
  type InventoryAdjustmentFormValues,
  type InventoryAdjustmentProduct,
} from '@/features/inventory/InventoryAdjustmentModal';
import {
  InventoryEntryModal,
  type InventoryEntryFormValues,
} from '@/features/inventory/InventoryEntryModal';
import {
  inventoryEntryExportColumns,
  inventoryMovementExportColumns,
  inventoryStockExportColumns,
} from '@/features/inventory/inventoryExport';
import { trpc } from '@/lib/trpc';
import { cn, formatCurrency, formatDateTime, getErrorMessage } from '@/lib/utils';
import type {
  Category,
  InitialInventoryEntry,
  InventoryMovement,
  InventoryStockItem,
  ProductSearchSelection,
  UserRole,
} from '@/types';

type InventoryView = 'movements' | 'stock' | 'entries';
type SearchMode = 'adjustment' | 'entry';

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

const viewLabels: Record<InventoryView, string> = {
  movements: 'Movements',
  stock: 'Stock Query',
  entries: 'Initial Inventory',
};

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

const entryColumns: ColumnDef<InitialInventoryEntry>[] = [
  {
    accessorKey: 'createdAt',
    header: 'Date',
    size: 180,
    cell: ({ row }) => formatDateTime(row.original.createdAt),
  },
  {
    accessorKey: 'mode',
    header: 'Mode',
    size: 160,
    cell: ({ row }) => (
      <span className={cn('badge', row.original.mode === 'initial' ? 'badge-primary' : 'badge-warning')}>
        {row.original.mode === 'initial' ? 'Initial inventory' : 'Physical count'}
      </span>
    ),
  },
  {
    accessorKey: 'productName',
    header: 'Product',
    size: 240,
    cell: ({ row }) => (
      <div>
        <p className="font-medium text-secondary-900">{row.original.productName ?? 'Unknown product'}</p>
        <p className="text-xs text-secondary-500">{row.original.productSku ?? 'No SKU'}</p>
      </div>
    ),
  },
  {
    accessorKey: 'unitName',
    header: 'Unit',
    size: 140,
    cell: ({ row }) => row.original.unitAbbreviation ?? row.original.unitName ?? '—',
  },
  {
    accessorKey: 'quantity',
    header: 'Counted Qty',
    size: 110,
  },
  {
    accessorKey: 'normalizedQuantity',
    header: 'Normalized',
    size: 120,
  },
  {
    accessorKey: 'cost',
    header: 'Cost',
    size: 120,
    cell: ({ row }) => formatCurrency(row.original.cost),
  },
  {
    accessorKey: 'newStock',
    header: 'Stock After',
    size: 120,
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

function getSearchDialogCopy(mode: SearchMode | null) {
  if (mode === 'entry') {
    return {
      title: 'Select Product for Initial Inventory',
      confirmLabel: 'Record Entry',
    };
  }

  return {
    title: 'Select Product for Adjustment',
    confirmLabel: 'Adjust Product',
  };
}

interface InventoryHeaderProps {
  activeView: InventoryView;
  canManage: boolean;
  onViewChange: (view: InventoryView) => void;
  onNewEntry: () => void;
  onNewAdjustment: () => void;
}

function InventoryHeader({
  activeView,
  canManage,
  onViewChange,
  onNewEntry,
  onNewAdjustment,
}: InventoryHeaderProps) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-secondary-900">Inventory</h1>
        <p className="mt-1 text-sm text-secondary-500">
          Manage counted entries, physical counts, and stock visibility against the live catalog.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-secondary-200 bg-white p-1">
          {(Object.keys(viewLabels) as InventoryView[]).map(view => (
            <button
              key={view}
              className={cn(
                'rounded-md px-3 py-2 text-sm font-medium transition-colors',
                activeView === view
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-secondary-600 hover:text-secondary-900'
              )}
              onClick={() => onViewChange(view)}
            >
              {viewLabels[view]}
            </button>
          ))}
        </div>

        <button
          className="btn-secondary flex items-center gap-2"
          onClick={onNewEntry}
          disabled={!canManage}
        >
          <ClipboardList className="h-4 w-4" />
          New Entry
        </button>
        <button
          className="btn-primary flex items-center gap-2"
          onClick={onNewAdjustment}
          disabled={!canManage}
        >
          <Search className="h-4 w-4" />
          New Adjustment
        </button>
      </div>
    </div>
  );
}

interface InventorySummaryProps {
  isLoading: boolean;
  totalUnits: number;
  totalValue: number;
  lowStockCount: number;
  recentInbound: number;
  recentOutbound: number;
  entriesCount: number;
  entriesLoading: boolean;
  recentAdjustments: number;
}

function InventorySummaryCards({
  isLoading,
  totalUnits,
  totalValue,
  lowStockCount,
  recentInbound,
  recentOutbound,
  entriesCount,
  entriesLoading,
  recentAdjustments,
}: InventorySummaryProps) {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <div className="card p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary-50 p-2">
            <Boxes className="h-5 w-5 text-primary-600" />
          </div>
          <div>
            <p className="text-sm text-secondary-500">Total Units</p>
            <p className="text-2xl font-bold text-secondary-900">{isLoading ? '—' : totalUnits}</p>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-success-50 p-2">
            <ArrowDownCircle className="h-5 w-5 text-success-600" />
          </div>
          <div>
            <p className="text-sm text-secondary-500">Inventory Value</p>
            <p className="text-2xl font-bold text-secondary-900">
              {isLoading ? '—' : formatCurrency(totalValue)}
            </p>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-warning-50 p-2">
            <RefreshCw className="h-5 w-5 text-warning-600" />
          </div>
          <div>
            <p className="text-sm text-secondary-500">Low Stock Items</p>
            <p className="text-2xl font-bold text-danger-500">{isLoading ? '—' : lowStockCount}</p>
          </div>
        </div>
      </div>

      <div className="card p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-secondary-100 p-2">
            <ClipboardList className="h-5 w-5 text-secondary-700" />
          </div>
          <div>
            <p className="text-sm text-secondary-500">Recent Flow</p>
            <p className="text-lg font-semibold text-secondary-900">
              +{recentInbound} / -{recentOutbound}
            </p>
            <p className="mt-1 text-xs text-secondary-500">
              {entriesLoading ? 'Loading entries…' : `${entriesCount} recent entries · ${recentAdjustments} adjustments`}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

interface InventoryDataPanelProps {
  activeView: InventoryView;
  movementsLoading: boolean;
  movementsError: string | null;
  onRetryMovements: () => void;
  stockLoading: boolean;
  stockError: string | null;
  onRetryStock: () => void;
  entriesLoading: boolean;
  entriesError: string | null;
  onRetryEntries: () => void;
  movements: InventoryMovement[];
  stockItems: InventoryStockItem[];
  entries: InitialInventoryEntry[];
  canManage: boolean;
  onAdjust: (product: InventoryStockItem) => void;
}

function InventoryDataPanel({
  activeView,
  movementsLoading,
  movementsError,
  onRetryMovements,
  stockLoading,
  stockError,
  onRetryStock,
  entriesLoading,
  entriesError,
  onRetryEntries,
  movements,
  stockItems,
  entries,
  canManage,
  onAdjust,
}: InventoryDataPanelProps) {
  return (
    <div className="card p-6">
      {activeView === 'movements' && (
        <>
          {movementsLoading && (
            <TableLoadingState message="Loading inventory movements..." rowCount={8} />
          )}
          {movementsError && (
            <TableErrorState
              title="Unable to load inventory movements"
              message={movementsError}
              onRetry={onRetryMovements}
            />
          )}
          {!movementsLoading && !movementsError && (
            <div className="space-y-4">
              <TableExportActions
                key="inventory-movements-export"
                data={movements}
                columns={inventoryMovementExportColumns}
                filename="inventory-movements"
                title="Inventory Movements"
              />
              <DataTable
                columns={movementColumns}
                data={movements}
                searchKey="productName"
                searchPlaceholder="Search movements by product..."
                pageSize={10}
              />
            </div>
          )}
        </>
      )}

      {activeView === 'stock' && (
        <>
          {stockLoading && <TableLoadingState message="Loading stock balances..." rowCount={8} />}
          {stockError && (
            <TableErrorState
              title="Unable to load stock balances"
              message={stockError}
              onRetry={onRetryStock}
            />
          )}
          {!stockLoading && !stockError && (
            <div className="space-y-4">
              <TableExportActions
                key="inventory-stock-export"
                data={stockItems}
                columns={inventoryStockExportColumns}
                filename="inventory-stock"
                title="Inventory Stock"
              />
              <DataTable
                columns={getStockColumns(onAdjust, canManage)}
                data={stockItems}
                searchKey="name"
                searchPlaceholder="Search stock by product..."
                pageSize={10}
              />
            </div>
          )}
        </>
      )}

      {activeView === 'entries' && (
        <>
          {entriesLoading && (
            <TableLoadingState message="Loading inventory entries..." rowCount={8} />
          )}
          {entriesError && (
            <TableErrorState
              title="Unable to load inventory entries"
              message={entriesError}
              onRetry={onRetryEntries}
            />
          )}
          {!entriesLoading && !entriesError && (
            <div className="space-y-4">
              <TableExportActions
                key="inventory-entries-export"
                data={entries}
                columns={inventoryEntryExportColumns}
                filename="inventory-entries"
                title="Initial Inventory Entries"
              />
              <DataTable
                columns={entryColumns}
                data={entries}
                searchKey="productName"
                searchPlaceholder="Search entries by product..."
                pageSize={10}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function InventoryPage() {
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const canManage = canManageInventory(user?.role);

  const [activeView, setActiveView] = useState<InventoryView>('movements');
  const [stockCategoryId, setStockCategoryId] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
  const [adjustmentModalKey, setAdjustmentModalKey] = useState(0);
  const [entryModalKey, setEntryModalKey] = useState(0);
  const [selectedProduct, setSelectedProduct] = useState<InventoryAdjustmentProduct | null>(null);
  const [entrySelection, setEntrySelection] = useState<ProductSearchSelection | null>(null);

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
  const entriesQuery = trpc.inventory.listEntries.useQuery({
    page: 1,
    perPage: 50,
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
      toast.success({ title: 'Stock adjusted' });
    },
    onError: error => {
      toast.error({
        title: 'Unable to adjust stock',
        description: getErrorMessage(error, 'Unable to adjust stock'),
      });
    },
  });

  const recordEntryMutation = trpc.inventory.recordEntry.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.inventory.listEntries.invalidate(),
        utils.inventory.listMovements.invalidate(),
        utils.inventory.listStock.invalidate(),
        utils.products.list.invalidate(),
      ]);
      setEntrySelection(null);
      setIsSearchOpen(false);
      toast.success({ title: 'Initial inventory recorded' });
    },
    onError: error => {
      toast.error({
        title: 'Unable to record inventory entry',
        description: getErrorMessage(error, 'Unable to record inventory entry'),
      });
    },
  });

  const categories = (categoriesQuery.data?.items ?? []) as Category[];
  const movements = (movementsQuery.data?.items ?? []) as InventoryMovement[];
  const stockItems = (stockQuery.data?.items ?? []) as InventoryStockItem[];
  const entries = (entriesQuery.data?.items ?? []) as InitialInventoryEntry[];
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

  const openSearchDialog = (mode: SearchMode) => {
    setSearchMode(mode);
    setIsSearchOpen(true);
  };

  const openAdjustmentModal = (product: InventoryAdjustmentProduct) => {
    setSelectedProduct(product);
    setAdjustmentModalKey(current => current + 1);
    setIsAdjustmentModalOpen(true);
  };

  const openEntryModal = (selection: ProductSearchSelection) => {
    setEntrySelection(selection);
    setEntryModalKey(current => current + 1);
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

  const handleEntrySubmit = async (values: InventoryEntryFormValues) => {
    if (!entrySelection) {
      return;
    }

    await recordEntryMutation.mutateAsync({
      productId: entrySelection.product.id,
      unitId: entrySelection.unit.unitId,
      mode: values.mode,
      quantity: values.quantity,
      cost: values.cost,
      notes: values.notes || undefined,
    });
    setEntrySelection(null);
  };

  const searchDialogCopy = getSearchDialogCopy(searchMode);

  return (
    <div className="space-y-6">
      <InventoryHeader
        activeView={activeView}
        canManage={canManage}
        onViewChange={setActiveView}
        onNewEntry={() => openSearchDialog('entry')}
        onNewAdjustment={() => openSearchDialog('adjustment')}
      />

      {!canManage && (
        <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          Only administrators and managers can record entries or adjust stock. Inventory views remain available.
        </div>
      )}

      <InventorySummaryCards
        isLoading={stockQuery.isLoading}
        totalUnits={stockSummary?.totalUnits ?? 0}
        totalValue={stockSummary?.totalValue ?? 0}
        lowStockCount={stockSummary?.lowStockCount ?? 0}
        recentInbound={recentInbound}
        recentOutbound={recentOutbound}
        entriesCount={entries.length}
        entriesLoading={entriesQuery.isLoading}
        recentAdjustments={recentAdjustments}
      />

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

      <InventoryDataPanel
        activeView={activeView}
        movementsLoading={movementsQuery.isLoading}
        movementsError={movementsQuery.error?.message ?? null}
        onRetryMovements={() => {
          void movementsQuery.refetch();
        }}
        stockLoading={stockQuery.isLoading}
        stockError={stockQuery.error?.message ?? null}
        onRetryStock={() => {
          void stockQuery.refetch();
        }}
        entriesLoading={entriesQuery.isLoading}
        entriesError={entriesQuery.error?.message ?? null}
        onRetryEntries={() => {
          void entriesQuery.refetch();
        }}
        movements={movements}
        stockItems={stockItems}
        entries={entries}
        canManage={canManage}
        onAdjust={product => openAdjustmentModal(mapStockItemToAdjustmentProduct(product))}
      />

      <ProductSearchDialog
        isOpen={isSearchOpen}
        onClose={() => {
          setIsSearchOpen(false);
          setSearchMode(null);
        }}
        categories={categories}
        title={searchDialogCopy.title}
        confirmLabel={searchDialogCopy.confirmLabel}
        onSelect={selection => {
          setIsSearchOpen(false);

          if (searchMode === 'entry') {
            openEntryModal(selection);
            return;
          }

          openAdjustmentModal(mapSearchSelectionToAdjustmentProduct(selection));
        }}
      />

      <InventoryAdjustmentModal
        key={`${selectedProduct?.id ?? 'inventory-adjustment'}-${adjustmentModalKey}`}
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

      <InventoryEntryModal
        key={`${entrySelection?.product.id ?? 'inventory-entry'}-${entryModalKey}`}
        isOpen={!!entrySelection}
        selection={entrySelection}
        isSaving={recordEntryMutation.isPending}
        error={recordEntryMutation.error?.message ?? null}
        onClose={() => setEntrySelection(null)}
        onSubmit={handleEntrySubmit}
      />

      <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-3 text-sm text-secondary-600">
        Stock remains tenant-wide for now. Initial and physical inventory entries capture the counted unit and normalize it into the shared stock model, which avoids the legacy accumulation bug from the WinForms version.
      </div>
    </div>
  );
}
