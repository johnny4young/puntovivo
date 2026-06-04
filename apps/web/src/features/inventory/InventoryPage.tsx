import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import i18next, { type TFunction } from 'i18next';
import { type ColumnDef } from '@tanstack/react-table';
import {
  ArrowDownCircle,
  Boxes,
  ClipboardList,
  Package,
  RefreshCw,
  Search,
} from 'lucide-react';
import { ProductSearchDialog } from '@/components/dialogs/ProductSearchDialog';
import { KpiTile } from '@/components/ui';
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
import { InventoryStockDetailsDrawer } from '@/features/inventory/InventoryStockDetailsDrawer';
import { getStockColumns } from '@/features/inventory/inventoryStockColumns';
import {
  inventoryEntryExportColumns,
  inventoryMovementExportColumns,
  inventoryStockExportColumns,
} from '@/features/inventory/inventoryExport';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
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

// Rediseño §10 — el tipo de movimiento se lee como badge tonal (.pv-badge),
// no como ícono: el dato dominante de la fila es el signo coloreado del delta.
const movementBadgeTones = {
  purchase: 'success',
  sale: 'danger',
  adjustment: 'warning',
  transfer: 'primary',
  return: 'success',
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
    accessorKey: 'productName',
    header: () => i18next.t('inventory:table.product'),
    size: 230,
    // Rediseño FASE 3 — nombre fuerte + SKU mono (.pname/.sku de pv-table).
    cell: ({ row }) => (
      <div>
        <p className="pname">{row.original.productName ?? i18next.t('inventory:table.unknownProduct')}</p>
        <p className="sku">
          {row.original.productSku ?? i18next.t('inventory:table.noSku')}
          {row.original.categoryName ? ` · ${row.original.categoryName}` : ''}
        </p>
      </div>
    ),
  },
  {
    id: 'delta',
    header: () => i18next.t('inventory:table.movement'),
    size: 120,
    // Rediseño §10 — el signo coloreado del movimiento (.pv-mv.up/.down) es el
    // dato dominante de la fila: cifra mono más grande, alineada a la derecha,
    // delante del tipo (que ahora es solo un badge de apoyo).
    meta: { cellClassName: 'num', headerClassName: 'num' },
    cell: ({ row }) => {
      const delta = getMovementDelta(row.original);
      return (
        <span className={cn('pv-mv text-base', delta > 0 && 'up', delta < 0 && 'down')}>
          {delta > 0 ? '+' : ''}
          {delta.toLocaleString()}
        </span>
      );
    },
  },
  {
    accessorKey: 'type',
    header: () => i18next.t('inventory:table.type'),
    size: 140,
    // Rediseño §10 — tipo como badge tonal (.pv-badge) en vez de un ícono;
    // el tono semántico (entrada=success, salida=danger, ajuste=warning,
    // traslado=primary) refuerza el signo sin competir con él.
    cell: ({ row }) => {
      const type = row.original.type;
      return (
        <span className={cn('pv-badge', movementBadgeTones[type] ?? 'neutral')}>
          {i18next.t(`inventory:movements.types.${type}`)}
        </span>
      );
    },
  },
  {
    accessorKey: 'newStock',
    header: () => i18next.t('inventory:table.stockAfter'),
    size: 110,
    meta: { cellClassName: 'num', headerClassName: 'num' },
    cell: ({ row }) => row.original.newStock.toLocaleString(),
  },
  {
    accessorKey: 'reference',
    header: () => i18next.t('inventory:table.reference'),
    size: 150,
    // Rediseño FASE 3 — referencia legible en chip mono (.pv-ref-chip).
    cell: ({ row }) =>
      row.original.reference ? (
        <span className="pv-ref-chip">{row.original.reference}</span>
      ) : (
        <span className="muted">—</span>
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

const entryColumns: ColumnDef<InitialInventoryEntry>[] = [
  {
    accessorKey: 'createdAt',
    header: () => i18next.t('inventory:table.date'),
    size: 180,
    cell: ({ row }) => <span className="muted">{formatDateTime(row.original.createdAt)}</span>,
  },
  {
    accessorKey: 'mode',
    header: () => i18next.t('inventory:table.mode'),
    size: 160,
    // Rediseño FASE 6 — modo como badge tonal (.pv-badge): inventario
    // inicial en primary, conteo físico en warning.
    cell: ({ row }) => (
      <span className={cn('pv-badge', row.original.mode === 'initial' ? 'primary' : 'warning')}>
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
    // Rediseño FASE 6 — celda ancla (.pv-table .prod/.pic/.pname/.sku).
    cell: ({ row }) => (
      <div className="prod">
        <span className="pic">
          <Package className="h-4 w-4" />
        </span>
        <div>
          <p className="pname">
            {row.original.productName ?? i18next.t('inventory:table.unknownProduct')}
          </p>
          <p className="sku">{row.original.productSku ?? i18next.t('inventory:table.noSku')}</p>
        </div>
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
    meta: { cellClassName: 'num', headerClassName: 'num' },
    cell: ({ row }) => row.original.quantity.toLocaleString(),
  },
  {
    accessorKey: 'normalizedQuantity',
    header: () => i18next.t('inventory:table.normalized'),
    size: 120,
    meta: { cellClassName: 'num', headerClassName: 'num' },
    cell: ({ row }) => row.original.normalizedQuantity.toLocaleString(),
  },
  {
    accessorKey: 'cost',
    header: () => i18next.t('inventory:table.cost'),
    size: 120,
    meta: { cellClassName: 'num', headerClassName: 'num' },
    cell: ({ row }) => formatCurrency(row.original.cost),
  },
  {
    accessorKey: 'newStock',
    header: () => i18next.t('inventory:table.stockAfter'),
    size: 120,
    meta: { cellClassName: 'num', headerClassName: 'num' },
    cell: ({ row }) => row.original.newStock.toLocaleString(),
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
      <h1 className="text-2xl font-bold text-secondary-900">{t('page.title')}</h1>

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
  // Rediseño FASE 2 — receta KpiTile compartida (igual que Dashboard / POS):
  // glifo tonal, microetiqueta, cifra alineada. `danger` para stock bajo,
  // `mono` para el valor de inventario (dinero). La rejilla replica la del
  // Dashboard para que los cuatro grupos de KPIs se lean idénticos.
  return (
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
      <KpiTile
        icon={Boxes}
        tone="primary"
        label={t('stats.totalUnits')}
        value={isLoading ? '—' : totalUnits.toLocaleString()}
      />
      <KpiTile
        icon={ArrowDownCircle}
        tone="success"
        mono
        label={t('stats.inventoryValue')}
        value={isLoading ? '—' : formatCurrency(totalValue)}
      />
      <KpiTile
        icon={RefreshCw}
        tone="danger"
        label={t('stats.lowStockItems')}
        value={isLoading ? '—' : lowStockCount.toLocaleString()}
      />
      <KpiTile
        icon={ClipboardList}
        tone="ink"
        label={t('stats.recentFlow')}
        value={`+${recentInbound} / -${recentOutbound}`}
        context={
          entriesLoading
            ? t('entries.loadingShort')
            : t('stats.recentFlowDetail', { count: entriesCount })
        }
      />
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
  onViewStockDetails: (product: InventoryStockItem) => void;
  stockFilters: ReactNode;
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
  onViewStockDetails,
  stockFilters,
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
                variant="dense"
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
        <div className="space-y-4">
          {/* Rediseño §10 — los filtros propios de esta vista (categoría +
              "solo stock bajo") viven dentro del card de stock, separados por
              una línea, en vez de flotar como un card suelto encima. */}
          <div className="border-b border-line/60 pb-4">{stockFilters}</div>
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
                variant="dense"
                columns={getStockColumns(onViewStockDetails, onAdjust, canManage)}
                data={stockItems}
                searchKey="name"
                searchPlaceholder={t('stock.search')}
                pageSize={10}
              />
            </div>
          )}
        </div>
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
                variant="dense"
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
  // ENG-132c — row-detail Drawer for the Stock columns trimmed off the
  // default table (min stock, sell price, valuation, updated date).
  const [detailsStockItem, setDetailsStockItem] = useState<InventoryStockItem | null>(null);
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

  const adjustStockMutation = useCriticalMutation('inventory.adjustStock', {
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

  // Rediseño §10 — los filtros de la vista de stock se renderizan dentro de su
  // propio card (vía InventoryDataPanel) en lugar de flotar como un card aparte.
  const stockFilters = (
    <div className="flex flex-col gap-4 md:flex-row md:items-end">
      <div className="pv-field md:min-w-64">
        <label htmlFor="inventory-stock-category" className="label">
          {t('stock.category')}
        </label>
        <select
          id="inventory-stock-category"
          className="pv-input"
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
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={lowStockOnly}
        onClick={() => setLowStockOnly(current => !current)}
        className="inline-flex min-h-[44px] items-center gap-3 rounded-xl px-1 text-sm text-secondary-700 md:pb-2.5"
      >
        <span className={cn('pv-switch', lowStockOnly && 'on')} aria-hidden="true" />
        {t('stock.lowStockOnly')}
      </button>
    </div>
  );

  return (
    <div className="space-y-6">
      <InventoryHeader
        activeView={activeView}
        canManage={canManage}
        onViewChange={setActiveView}
        onNewEntry={() => openSearchDialog('entry')}
        onNewAdjustment={() => openSearchDialog('adjustment')}
      />

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
        onViewStockDetails={setDetailsStockItem}
        stockFilters={stockFilters}
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

      <InventoryStockDetailsDrawer
        item={detailsStockItem}
        onClose={() => setDetailsStockItem(null)}
        onAdjust={
          canManage
            ? item => {
                setDetailsStockItem(null);
                openAdjustmentModal(mapStockItemToAdjustmentProduct(item));
              }
            : undefined
        }
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

      {/* Rediseño §10 — un único callout discreto al pie consolida las notas:
          el aviso de permisos (solo cuando el rol no puede gestionar) y la nota
          de sincronización de totales, en vez de dos paneles separados. */}
      <div className="surface-panel-muted space-y-2 text-sm text-secondary-600">
        {!canManage && (
          <p className="font-medium text-warning-700">{t('page.permissionNote')}</p>
        )}
        <p>{t('page.stockNote')}</p>
      </div>
    </div>
  );
}
