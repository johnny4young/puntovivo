import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18next, { type TFunction } from 'i18next';
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
import { useTenant } from '@/features/tenant/TenantProvider';
import {
  InventoryAdjustmentModal,
  type InventoryAdjustmentFormValues,
  type InventoryAdjustmentProduct,
} from '@/features/inventory/InventoryAdjustmentModal';
import {
  InventoryEntryModal,
  type InventoryEntryFormValues,
} from '@/features/inventory/InventoryEntryModal';
import { InventoryBalancesPanel } from '@/features/inventory/InventoryBalancesPanel';
import {
  inventoryEntryExportColumns,
  inventoryMovementExportColumns,
  inventoryStockExportColumns,
} from '@/features/inventory/inventoryExport';
import { trpc } from '@/lib/trpc';
import { onErrorToast } from '@/lib/mutationHelpers';
import { cn, formatCurrency, formatDateTime } from '@/lib/utils';
import type {
  Category,
  InitialInventoryEntry,
  InventoryMovement,
  InventoryStockItem,
  ProductSearchSelection,
  UserRole,
} from '@/types';

type InventoryView = 'movements' | 'stock' | 'entries' | 'balances';
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

const viewKeys: Record<InventoryView, string> = {
  movements: 'page.tabs.movements',
  stock: 'page.tabs.stockQuery',
  entries: 'page.tabs.initialInventory',
  balances: 'page.tabs.balances',
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
    header: () => i18next.t('inventory:table.date'),
    size: 180,
    cell: ({ row }) => formatDateTime(row.original.createdAt),
  },
  {
    accessorKey: 'type',
    header: () => i18next.t('inventory:table.type'),
    size: 140,
    cell: ({ row }) => {
      const type = row.original.type;
      const Icon = movementIcons[type] ?? RefreshCw;
      return (
        <div className={cn('flex items-center gap-2 font-medium capitalize', movementColors[type])}>
          <Icon className="h-4 w-4" />
          <span>{i18next.t(`inventory:movements.types.${type}`)}</span>
        </div>
      );
    },
  },
  {
    accessorKey: 'productName',
    header: () => i18next.t('inventory:table.product'),
    size: 230,
    cell: ({ row }) => (
      <div>
        <p className="font-medium text-secondary-900">{row.original.productName ?? i18next.t('inventory:table.unknownProduct')}</p>
        <p className="text-xs text-secondary-500">
          {row.original.productSku ?? i18next.t('inventory:table.noSku')}
          {row.original.categoryName ? ` · ${row.original.categoryName}` : ''}
        </p>
      </div>
    ),
  },
  {
    id: 'delta',
    header: () => i18next.t('inventory:table.movement'),
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
    header: () => i18next.t('inventory:table.stockAfter'),
    size: 110,
    cell: ({ row }) => <span className="font-medium text-secondary-900">{row.original.newStock}</span>,
  },
  {
    accessorKey: 'reference',
    header: () => i18next.t('inventory:table.reference'),
    size: 150,
    cell: ({ row }) => (
      <span className="font-mono text-sm text-primary-600">{row.original.reference || '—'}</span>
    ),
  },
  {
    accessorKey: 'notes',
    header: () => i18next.t('inventory:table.notes'),
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
      header: () => i18next.t('inventory:table.product'),
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
      header: () => i18next.t('inventory:stock.columns.stock'),
      size: 100,
      cell: ({ row }) => (
        <span className={row.original.isLowStock ? 'font-medium text-danger-500' : 'font-medium text-secondary-900'}>
          {row.original.stock}
        </span>
      ),
    },
    {
      accessorKey: 'minStock',
      header: () => i18next.t('inventory:stock.columns.minStock'),
      size: 110,
    },
    {
      accessorKey: 'price',
      header: () => i18next.t('inventory:stock.columns.sellPrice'),
      size: 120,
      cell: ({ row }) => formatCurrency(row.original.price),
    },
    {
      accessorKey: 'inventoryValue',
      header: () => i18next.t('inventory:stock.columns.valuation'),
      size: 140,
      cell: ({ row }) => formatCurrency(row.original.inventoryValue),
    },
    {
      accessorKey: 'updatedAt',
      header: () => i18next.t('inventory:stock.columns.updated'),
      size: 170,
      cell: ({ row }) => formatDateTime(row.original.updatedAt),
    },
    {
      id: 'status',
      header: () => i18next.t('inventory:stock.columns.status'),
      size: 120,
      cell: ({ row }) => (
        <span className={cn('badge', row.original.isLowStock ? 'badge-danger' : 'badge-success')}>
          {row.original.isLowStock
            ? i18next.t('inventory:stock.status.lowStock')
            : i18next.t('inventory:stock.status.healthy')}
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
          title={i18next.t('inventory:stock.adjustStock')}
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
    header: () => i18next.t('inventory:table.date'),
    size: 180,
    cell: ({ row }) => formatDateTime(row.original.createdAt),
  },
  {
    accessorKey: 'mode',
    header: () => i18next.t('inventory:table.mode'),
    size: 160,
    cell: ({ row }) => (
      <span className={cn('badge', row.original.mode === 'initial' ? 'badge-primary' : 'badge-warning')}>
        {row.original.mode === 'initial'
          ? i18next.t('inventory:table.initialInventory')
          : i18next.t('inventory:table.physicalCount')}
      </span>
    ),
  },
  {
    accessorKey: 'productName',
    header: () => i18next.t('inventory:table.product'),
    size: 240,
    cell: ({ row }) => (
      <div>
        <p className="font-medium text-secondary-900">
          {row.original.productName ?? i18next.t('inventory:table.unknownProduct')}
        </p>
        <p className="text-xs text-secondary-500">
          {row.original.productSku ?? i18next.t('inventory:table.noSku')}
        </p>
      </div>
    ),
  },
  {
    accessorKey: 'unitName',
    header: () => i18next.t('inventory:table.unit'),
    size: 140,
    cell: ({ row }) => row.original.unitAbbreviation ?? row.original.unitName ?? '—',
  },
  {
    accessorKey: 'quantity',
    header: () => i18next.t('inventory:table.countedQty'),
    size: 110,
  },
  {
    accessorKey: 'normalizedQuantity',
    header: () => i18next.t('inventory:table.normalized'),
    size: 120,
  },
  {
    accessorKey: 'cost',
    header: () => i18next.t('inventory:table.cost'),
    size: 120,
    cell: ({ row }) => formatCurrency(row.original.cost),
  },
  {
    accessorKey: 'newStock',
    header: () => i18next.t('inventory:table.stockAfter'),
    size: 120,
  },
  {
    accessorKey: 'notes',
    header: () => i18next.t('inventory:table.notes'),
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

function getSearchDialogCopy(
  mode: SearchMode | null,
  t: TFunction,
  currentSiteName?: string | null
): { title: string; confirmLabel: string } {
  if (mode === 'entry') {
    return {
      title: currentSiteName
        ? t('dialogs.selectProductEntryForSite', { site: currentSiteName })
        : t('dialogs.selectProductEntry'),
      confirmLabel: t('dialogs.recordEntry'),
    };
  }

  return {
    title: currentSiteName
      ? t('dialogs.selectProductAdjustForSite', { site: currentSiteName })
      : t('dialogs.selectProductAdjust'),
    confirmLabel: t('dialogs.adjustProduct'),
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
  const { t } = useTranslation('inventory');
  return (
    <div className="page-header-row">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-secondary-900">{t('page.title')}</h1>
        <p className="mt-1 text-sm text-secondary-500">
          {t('page.description')}
        </p>
      </div>

      <div className="page-header-actions">
        <div className="segmented-control">
          {(Object.keys(viewKeys) as InventoryView[]).map(view => (
            <button
              key={view}
              className={cn(
                'segmented-tab',
                activeView === view ? 'segmented-tab-active' : ''
              )}
              onClick={() => onViewChange(view)}
            >
              {t(viewKeys[view])}
            </button>
          ))}
        </div>

        <button
          className="btn-secondary flex items-center gap-2"
          onClick={onNewEntry}
          disabled={!canManage}
        >
          <ClipboardList className="h-4 w-4" />
          {t('newEntry')}
        </button>
        <button
          className="btn-primary flex items-center gap-2"
          onClick={onNewAdjustment}
          disabled={!canManage}
        >
          <Search className="h-4 w-4" />
          {t('newAdjustment')}
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
}: InventorySummaryProps) {
  const { t } = useTranslation('inventory');
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <div className="card p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary-50 p-2">
            <Boxes className="h-5 w-5 text-primary-600" />
          </div>
          <div>
            <p className="text-sm text-secondary-500">{t('stats.totalUnits')}</p>
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
            <p className="text-sm text-secondary-500">{t('stats.inventoryValue')}</p>
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
            <p className="text-sm text-secondary-500">{t('stats.lowStockItems')}</p>
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
            <p className="text-sm text-secondary-500">{t('stats.recentFlow')}</p>
            <p className="text-lg font-semibold text-secondary-900">
              +{recentInbound} / -{recentOutbound}
            </p>
            <p className="mt-1 text-xs text-secondary-500">
              {entriesLoading
                ? t('entries.loadingShort')
                : t('stats.recentFlowDetail', { count: entriesCount })}
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
  const { t } = useTranslation('inventory');
  return (
    <div className="card p-6">
      {activeView === 'movements' && (
        <>
          {movementsLoading && (
            <TableLoadingState message={t('movements.loading')} rowCount={8} />
          )}
          {movementsError && (
            <TableErrorState
              title={t('movements.error')}
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
                title={t('movements.exportTitle')}
              />
              <DataTable
                columns={movementColumns}
                data={movements}
                searchKey="productName"
                searchPlaceholder={t('movements.search')}
                pageSize={10}
              />
            </div>
          )}
        </>
      )}

      {activeView === 'stock' && (
        <>
          {stockLoading && <TableLoadingState message={t('stock.loading')} rowCount={8} />}
          {stockError && (
            <TableErrorState
              title={t('stock.error')}
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
                title={t('stock.exportTitle')}
              />
              <DataTable
                columns={getStockColumns(onAdjust, canManage)}
                data={stockItems}
                searchKey="name"
                searchPlaceholder={t('stock.search')}
                pageSize={10}
              />
            </div>
          )}
        </>
      )}

      {activeView === 'entries' && (
        <>
          {entriesLoading && (
            <TableLoadingState message={t('entries.loading')} rowCount={8} />
          )}
          {entriesError && (
            <TableErrorState
              title={t('entries.error')}
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
                title={t('entries.exportTitle')}
              />
              <DataTable
                columns={entryColumns}
                data={entries}
                searchKey="productName"
                searchPlaceholder={t('entries.search')}
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
  const { t } = useTranslation('inventory');
  const { user } = useAuth();
  const { currentSite } = useTenant();
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
  const sitesQuery = trpc.sites.list.useQuery(undefined, {
    // Only hit the network when the balances tab is actually opened.
    enabled: activeView === 'balances',
  });
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
        utils.inventory.listBalancesBySite.invalidate(),
        utils.products.list.invalidate(),
      ]);
      setIsAdjustmentModalOpen(false);
      setSelectedProduct(null);
      toast.success({ title: t('toast.adjustSuccess') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'inventory:toast.adjustError' }),
  });

  const recordEntryMutation = trpc.inventory.recordEntry.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.inventory.listEntries.invalidate(),
        utils.inventory.listMovements.invalidate(),
        utils.inventory.listStock.invalidate(),
        utils.inventory.listBalancesBySite.invalidate(),
        utils.products.list.invalidate(),
      ]);
      setEntrySelection(null);
      setIsSearchOpen(false);
      toast.success({ title: t('toast.entrySuccess') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'inventory:toast.entryError' }),
  });

  const categories = (categoriesQuery.data?.items ?? []) as Category[];
  const movements = (movementsQuery.data?.items ?? []) as InventoryMovement[];
  const stockItems = (stockQuery.data?.items ?? []) as InventoryStockItem[];
  const entries = (entriesQuery.data?.items ?? []) as InitialInventoryEntry[];
  const stockSummary = stockQuery.data?.summary;
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

  const searchDialogCopy = getSearchDialogCopy(searchMode, t, currentSite?.name);

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
          {t('page.permissionNote')}
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
      />

      {activeView === 'stock' && (
        <div className="card p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <label className="block md:min-w-64">
              <span className="label">{t('stock.category')}</span>
              <select
                className="input mt-1"
                value={stockCategoryId}
                onChange={event => setStockCategoryId(event.target.value)}
              >
                <option value="">{t('stock.allCategories')}</option>
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
              {t('stock.lowStockOnly')}
            </label>
          </div>
        </div>
      )}

      {activeView === 'balances' && (
        <InventoryBalancesPanel
          sites={sitesQuery.data?.items ?? []}
          sitesLoading={sitesQuery.isLoading}
        />
      )}

      {activeView !== 'balances' && (
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
      )}

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
        siteName={currentSite?.name}
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
        siteName={currentSite?.name}
        isSaving={recordEntryMutation.isPending}
        error={recordEntryMutation.error?.message ?? null}
        onClose={() => setEntrySelection(null)}
        onSubmit={handleEntrySubmit}
      />

      <div className="surface-panel-muted text-sm text-secondary-600">
        {t('page.stockNote')}
      </div>
    </div>
  );
}
