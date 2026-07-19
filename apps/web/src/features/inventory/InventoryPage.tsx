import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type TFunction } from 'i18next';
import { ProductSearchDialog } from '@/components/dialogs/ProductSearchDialog';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import {
  InventoryAdjustmentModal,
  type InventoryAdjustmentFormValues,
  type InventoryAdjustmentProduct,
} from '@/features/inventory/InventoryAdjustmentModal';
import type { InventoryEntryFormValues } from '@/features/inventory/InventoryEntryModal';
import { parseSerialNumbers } from '@/features/inventory/serialNumbers';
import { InventoryBalancesPanel } from '@/features/inventory/InventoryBalancesPanel';
import { InventoryStockDetailsDrawer } from '@/features/inventory/InventoryStockDetailsDrawer';
import { InventoryMovementDetailsDrawer } from '@/features/inventory/InventoryMovementDetailsDrawer';
import { InventoryEntryDetailsDrawer } from '@/features/inventory/InventoryEntryDetailsDrawer';
import { InventoryHeader } from '@/features/inventory/InventoryHeader';
import { InventorySummaryCards } from '@/features/inventory/InventorySummaryCards';
import { InventoryDataPanel } from '@/features/inventory/InventoryDataPanel';
import { type InventoryView } from '@/features/inventory/inventoryViews';
import { getMovementDelta } from '@/features/inventory/inventoryMovementColumns';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { onErrorToast } from '@/lib/mutationHelpers';
import { cn } from '@/lib/utils';
import type {
  Category,
  InitialInventoryEntry,
  InventoryMovement,
  InventoryStockItem,
  ProductSearchSelection,
  UserRole,
} from '@/types';

type SearchMode = 'adjustment' | 'entry';

// ENG-199 — keep the infrequently opened expiry view out of the default
// inventory shell. The tab boundary is a natural, accessible loading point.
const ExpiryRadarPanel = lazy(() =>
  import('@/features/inventory/ExpiryRadarPanel').then(module => ({
    default: module.ExpiryRadarPanel,
  }))
);

// ENG-110a — the entry flow now includes lot and expiry controls. Keep that
// form out of the default inventory shell until an operator selects a product.
const InventoryEntryModal = lazy(() =>
  import('@/features/inventory/InventoryEntryModal').then(module => ({
    default: module.InventoryEntryModal,
  }))
);

// ENG-110c — warranty traceability is a self-contained secondary panel. Keep
// its query + presentation code out of the already budget-sensitive inventory
// route chunk and stream it immediately after the primary inventory shell.
const SerialWarrantyLookup = lazy(() =>
  import('@/features/inventory/SerialWarrantyLookup').then(module => ({
    default: module.SerialWarrantyLookup,
  }))
);

function canManageInventory(role: UserRole | undefined): boolean {
  return role === 'admin' || role === 'manager';
}

function mapStockItemToAdjustmentProduct(product: InventoryStockItem): InventoryAdjustmentProduct {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    stock: product.stock,
    minStock: product.minStock,
    tracksLots: product.tracksLots,
    tracksSerials: product.tracksSerials,
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
    tracksLots: selection.product.tracksLots,
    tracksSerials: selection.product.tracksSerials,
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
  // ENG-132g — row-detail Drawers for the Movements / Entries columns trimmed
  // off their default tables (stock-after, reference, notes / unit, normalized,
  // cost, stock-after, notes).
  const [detailsMovement, setDetailsMovement] = useState<InventoryMovement | null>(null);
  const [detailsEntry, setDetailsEntry] = useState<InitialInventoryEntry | null>(null);
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
        utils.products.search.invalidate(),
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
        utils.products.search.invalidate(),
      ]);
      setEntrySelection(null);
      setIsSearchOpen(false);
      toast.success({ title: t('toast.entrySuccess') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'inventory:toast.entryError' }),
  });

  const receiveLotMutation = trpc.inventoryLots.receive.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.inventoryLots.list.invalidate(),
        utils.inventoryLots.expiring.invalidate(),
        utils.inventory.listMovements.invalidate(),
        utils.inventory.listStock.invalidate(),
        utils.inventory.listBalancesBySite.invalidate(),
        utils.products.list.invalidate(),
        utils.products.search.invalidate(),
      ]);
      setEntrySelection(null);
      setIsSearchOpen(false);
      toast.success({ title: t('toast.lotSuccess') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'inventory:toast.lotError' }),
  });

  const receiveSerialsMutation = trpc.productSerials.receive.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.productSerials.list.invalidate(),
        utils.productSerials.lookup.invalidate(),
        utils.inventoryLots.list.invalidate(),
        utils.inventoryLots.expiring.invalidate(),
        utils.inventory.listMovements.invalidate(),
        utils.inventory.listStock.invalidate(),
        utils.inventory.listBalancesBySite.invalidate(),
        utils.products.list.invalidate(),
        utils.products.search.invalidate(),
      ]);
      setEntrySelection(null);
      setIsSearchOpen(false);
      toast.success({ title: t('toast.serialSuccess') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'inventory:toast.serialError' }),
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
    recordEntryMutation.reset();
    receiveLotMutation.reset();
    receiveSerialsMutation.reset();
    setEntrySelection(selection);
    setEntryModalKey(current => current + 1);
  };

  const closeEntryModal = () => {
    setEntrySelection(null);
    recordEntryMutation.reset();
    receiveLotMutation.reset();
    receiveSerialsMutation.reset();
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

    if (entrySelection.product.tracksSerials) {
      if (!currentSite?.id) return;
      await receiveSerialsMutation.mutateAsync({
        siteId: currentSite.id,
        productId: entrySelection.product.id,
        serialNumbers: parseSerialNumbers(values.serialNumbers),
        unitCost: values.cost,
        warrantyExpiresAt: values.warrantyExpiresAt || null,
        notes: values.notes || undefined,
      });
      return;
    }

    if (entrySelection.product.tracksLots) {
      if (!currentSite?.id) return;
      await receiveLotMutation.mutateAsync({
        siteId: currentSite.id,
        productId: entrySelection.product.id,
        lotNumber: values.lotNumber,
        expiresAt: values.expiresAt || null,
        quantity: values.quantity * entrySelection.unit.equivalence,
        unitCost: values.cost,
        notes: values.notes || undefined,
      });
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

      <Suspense fallback={null}>
        <SerialWarrantyLookup />
      </Suspense>

      {activeView === 'balances' && (
        <InventoryBalancesPanel
          sites={sitesQuery.data?.items ?? []}
          sitesLoading={sitesQuery.isLoading}
        />
      )}

      {/* ENG-199 — expiry radar; self-contained queries fire on mount. */}
      {activeView === 'expiry' && (
        <Suspense
          fallback={
            <div className="card p-6 text-sm text-secondary-600" role="status">
              {t('expiry.loading')}
            </div>
          }
        >
          <ExpiryRadarPanel />
        </Suspense>
      )}

      {activeView !== 'balances' && activeView !== 'expiry' && (
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
          onViewMovementDetails={setDetailsMovement}
          onViewEntryDetails={setDetailsEntry}
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

      <InventoryMovementDetailsDrawer
        item={detailsMovement}
        onClose={() => setDetailsMovement(null)}
      />

      <InventoryEntryDetailsDrawer item={detailsEntry} onClose={() => setDetailsEntry(null)} />

      {entrySelection && (
        <Suspense fallback={null}>
          <InventoryEntryModal
            key={`${entrySelection.product.id}-${entryModalKey}`}
            isOpen
            selection={entrySelection}
            siteId={currentSite?.id}
            siteName={currentSite?.name}
            isSaving={
              recordEntryMutation.isPending ||
              receiveLotMutation.isPending ||
              receiveSerialsMutation.isPending
            }
            error={
              entrySelection.product.tracksSerials
                ? (receiveSerialsMutation.error?.message ?? null)
                : entrySelection.product.tracksLots
                ? (receiveLotMutation.error?.message ?? null)
                : (recordEntryMutation.error?.message ?? null)
            }
            onClose={closeEntryModal}
            onSubmit={handleEntrySubmit}
          />
        </Suspense>
      )}

      {/* Rediseño §10 — un único callout discreto al pie consolida las notas:
          el aviso de permisos (solo cuando el rol no puede gestionar) y la nota
          de sincronización de totales, en vez de dos paneles separados. */}
      <div className="surface-panel-muted space-y-2 text-sm text-secondary-600">
        {!canManage && <p className="font-medium text-warning-700">{t('page.permissionNote')}</p>}
        <p>{t('page.stockNote')}</p>
      </div>
    </div>
  );
}
