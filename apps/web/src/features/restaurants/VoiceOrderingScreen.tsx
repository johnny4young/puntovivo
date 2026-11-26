/**
 * Restaurant ordering screen shared by `/touch/voice` (three columns: dishes,
 * plate sheet, order rail) and `/m` (stacked, sheet in a dialog).
 *
 * A tapped dish opens its plate sheet; «Agregar al pedido» puts it in the
 * round being built, and «Enviar ronda N» commits that round through the
 * atomic `restaurantServices.openCheck` command, which also routes it to the
 * kitchen. The table stays selected so the rail shows the round as sent.
 *
 * @module features/restaurants/VoiceOrderingScreen
 */
import { Suspense, lazy, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Receipt, Split } from 'lucide-react';
import { usePriceIncludesTax } from '@/features/pricing/PricingContext';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useIsModuleActive } from '@/features/modules/ModulesContext';
import { useRegisterZone } from '@/features/modules/useRegisterZone';
import { useToast } from '@/components/feedback/ToastProvider';
import { ProductSearchDialog } from '@/components/dialogs/ProductSearchDialog';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import {
  invalidateCommittedGroups,
  INVENTORY_RESERVATION_INVALIDATIONS,
  RESTAURANT_TABLE_INVALIDATIONS,
} from '@/lib/invalidateGroups';
import { translateServerError } from '@/lib/translateServerError';
import { roundMoney } from '@/lib/money';
import {
  buildCartItem,
  getSaleMinimumQuantity,
  getSaleQuantityStep,
  type SaleCartItem,
} from '@/features/sales/saleCart';
import { getCartSummary } from '@/features/sales/saleCartTotals';
import { selectionFromHydratedProduct } from '@/features/sales/productSelection';
import { Modal } from '@/components/form-controls/Modal';
import type { VoiceCartItem } from '@/features/voice/VoiceCartCommandModal';
import type { Product, ProductSearchSelection } from '@/types';
import { ReservationChoice } from '@/features/reservations/ReservationChoice';
import { reservationChoiceKey } from '@/features/reservations/reservationSelection';
import { VoiceOrderingControls } from './VoiceOrderingControls';
import { RestaurantBillRequestToggle } from './RestaurantBillRequestToggle';
import { usePendingRoundReport } from './usePendingRoundReport';
import { RestaurantDishCatalog } from './RestaurantDishCatalog';
import { RestaurantOrderRail } from './RestaurantOrderRail';
import { sentRoundsFromTableState, type RailLine } from './orderRounds';
import {
  DEFAULT_LINE_DETAILS,
  getRestaurantModifierPriceDelta,
  hasDuplicateRestaurantModifiers,
  restaurantModifierSnapshot,
  normalizeRestaurantGuestCount,
  type RestaurantLineDraft,
} from './restaurantDraft';

// The sheet loads on the first tapped dish, not with the empty ordering screen.
const loadPlateSheet = () => import('./RestaurantPlateSheet');
const RestaurantPlateSheet = lazy(() =>
  loadPlateSheet().then(module => ({ default: module.RestaurantPlateSheet }))
);

type SheetState =
  { mode: 'add'; selection: ProductSearchSelection } | { mode: 'edit'; key: string };

const RestaurantSplitSheet = lazy(() =>
  import('./RestaurantSplitSheet').then(module => ({ default: module.RestaurantSplitSheet }))
);

const RestaurantPrecheckModal = lazy(() =>
  import('./RestaurantPrecheckModal').then(module => ({ default: module.RestaurantPrecheckModal }))
);

const VoiceCartCommandModal = lazy(() =>
  import('@/features/voice/VoiceCartCommandModal').then(mod => ({
    default: mod.VoiceCartCommandModal,
  }))
);

/** Layout variant shared by touch and mobile-waiter restaurant shells. */
export interface VoiceOrderingScreenProps {
  variant: 'touch' | 'mobile';
}

export function VoiceOrderingScreen({ variant }: VoiceOrderingScreenProps): React.ReactElement {
  const { t } = useTranslation(['restaurants', 'voice', 'errors', 'common', 'fulfillmentErrors']);
  const toast = useToast();
  const priceIncludesTax = usePriceIncludesTax();
  const { logout, user } = useAuth();
  const { currentTenant, currentSite } = useTenant();

  const semanticSearchActive = useIsModuleActive('semantic-search');
  const dineInActive = useIsModuleActive('dine-in');
  const kdsActive = useIsModuleActive('kds');
  const splitsBills = useRegisterZone('tip-split');
  const navigate = useNavigate();
  const [splitOpen, setSplitOpen] = useState(false);
  const [precheckOpen, setPrecheckOpen] = useState(false);
  const voiceAvailabilityQuery = trpc.ai.settings.voiceAvailability.useQuery(undefined, {
    enabled: semanticSearchActive,
  });
  const activeCashSessionQuery = trpc.cashSessions.getActive.useQuery(
    currentSite ? { siteId: currentSite.id } : (undefined as never),
    { enabled: Boolean(currentSite) }
  );

  // A restaurant check always targets an authoritative table row; an empty or
  // failed catalog exposes setup guidance instead of a free-text label.
  const tableCatalogQuery = trpc.restaurantTables.list.useQuery(
    currentSite ? { siteId: currentSite.id, includeArchived: false } : (undefined as never),
    { enabled: Boolean(currentSite) && dineInActive }
  );
  const tableCatalog = tableCatalogQuery.data?.items ?? [];
  const useCatalogDropdown =
    dineInActive &&
    !tableCatalogQuery.isLoading &&
    !tableCatalogQuery.error &&
    tableCatalog.length > 0;

  const utils = trpc.useUtils();
  const openCheckMutation = useCriticalMutation('restaurantServices.openCheck');
  const addRoundMutation = useCriticalMutation('restaurantServices.addRound');

  const [tableLabel, setTableLabel] = useState<string>('');
  // Guard against a stale selection after catalog refresh.
  const tableLabelMatchesCatalog =
    !useCatalogDropdown || tableCatalog.some(row => row.name === tableLabel);
  const resolvedPickedTableId = useCatalogDropdown
    ? (tableCatalog.find(row => row.name === tableLabel)?.id ?? null)
    : null;
  const tableStateQuery = trpc.restaurantServices.getTableState.useQuery(
    resolvedPickedTableId ? { tableId: resolvedPickedTableId } : (undefined as never),
    { enabled: Boolean(resolvedPickedTableId) && dineInActive }
  );
  const [guestCount, setGuestCount] = useState<number>(1);
  const [reservationSelection, setReservationSelection] = useState('');
  const arrivedReservation = tableStateQuery.data?.reservation;
  const reservationSelected =
    !!arrivedReservation && reservationSelection === reservationChoiceKey(arrivedReservation);
  const [checkLabel, setCheckLabel] = useState<string>('');
  const lockedGuestCount = tableStateQuery.data?.service?.guestCount ?? null;
  const pickedTableGuestMaximum =
    tableCatalog.find(row => row.id === resolvedPickedTableId)?.seatCount ?? 200;
  const effectiveGuestCount = normalizeRestaurantGuestCount(
    lockedGuestCount ?? (reservationSelected ? arrivedReservation.partySize : guestCount),
    pickedTableGuestMaximum
  );
  const [cartItems, setCartItems] = useState<SaleCartItem[]>([]);
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [lineDetails, setLineDetails] = useState<Record<string, RestaurantLineDraft>>({});
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [hydratingDishId, setHydratingDishId] = useState<string | null>(null);
  const [voiceModalOpen, setVoiceModalOpen] = useState<boolean>(false);
  const [searchDialogOpen, setSearchDialogOpen] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const nextRestaurantLineId = useRef(0);

  const cashSession = activeCashSessionQuery.data ?? null;
  const aiEnabled = voiceAvailabilityQuery.data?.enabled === true;
  const micDisabledReason = (() => {
    if (!semanticSearchActive) return t('voice:disabledNoModule');
    if (!aiEnabled) return t('voice:disabledNoAi');
    if (!cashSession) return t('voice:disabledNoSession');
    return null;
  })();
  const micDisabled = micDisabledReason !== null;
  const saveDisabled =
    !cashSession ||
    !useCatalogDropdown ||
    !resolvedPickedTableId ||
    tableStateQuery.isLoading ||
    Boolean(tableStateQuery.error) ||
    (!!arrivedReservation && !reservationSelected) ||
    tableLabel.trim().length === 0 ||
    !tableLabelMatchesCatalog ||
    cartItems.length === 0 ||
    cartItems.some(item =>
      hasDuplicateRestaurantModifiers((lineDetails[item.key] ?? DEFAULT_LINE_DETAILS).modifiers)
    ) ||
    isSaving;

  const detailFor = (key: string) => lineDetails[key] ?? DEFAULT_LINE_DETAILS;
  // A party that shrank after a plate was assigned keeps the plate on the last seat.
  const seatFor = (detail: RestaurantLineDraft) =>
    detail.seatNumber === null ? null : Math.min(detail.seatNumber, effectiveGuestCount);
  const pricedCartItems = cartItems.map(item => ({
    ...item,
    unitPrice: roundMoney(
      item.unitPrice + getRestaurantModifierPriceDelta(detailFor(item.key).modifiers)
    ),
  }));
  const draftTotal = getCartSummary(pricedCartItems, priceIncludesTax).total;
  const sentRounds = sentRoundsFromTableState(tableStateQuery.data);
  const sentTotal = (tableStateQuery.data?.checks ?? []).reduce(
    (sum, check) => roundMoney(sum + check.total),
    0
  );
  const roundNumber = sentRounds.length + 1;
  const openChecks = tableStateQuery.data?.checks ?? [];
  const activeOpenCheck =
    openChecks.find(check => check.suspendedAt !== null) ?? openChecks[0] ?? null;
  // Equal split and shared-dish split are available to waiters/cashiers as well as managers.
  const canSplit =
    splitsBills &&
    openChecks.length > 0 &&
    sentRounds.reduce((count, round) => count + round.lines.length, 0) > 0;
  const openService = tableStateQuery.data?.service ?? null;
  usePendingRoundReport(resolvedPickedTableId, cartItems.length, openService !== null);
  const draftLines: RailLine[] = pricedCartItems.map(item => {
    const detail = detailFor(item.key);
    return {
      key: item.key,
      quantity: item.quantity,
      productName: item.productName,
      total: roundMoney(item.quantity * item.unitPrice),
      seatNumber: seatFor(detail),
      modifiers: detail.modifiers.filter(modifier => modifier.name.trim()),
      note: itemNotes[item.key]?.trim() || null,
    };
  });

  function applyVoiceItems(items: VoiceCartItem[]): void {
    if (items.length === 0) return;
    const additions = items.map(item => {
      const cartItem = buildRestaurantCartItem(item.selection, item.quantity);
      return { cartItem, note: item.note?.trim() || null };
    });
    const notesUpdate: Record<string, string> = {};
    for (const { cartItem, note } of additions) {
      if (note) notesUpdate[cartItem.key] = note;
    }
    // Restaurant additions stay distinct even when product and unit match:
    // two diners may order the same dish with different options or courses.
    setCartItems(previous => [...previous, ...additions.map(({ cartItem }) => cartItem)]);
    if (Object.keys(notesUpdate).length > 0) {
      setItemNotes(prevNotes => ({ ...prevNotes, ...notesUpdate }));
    }
  }

  async function handleDishPick(dishId: string): Promise<void> {
    if (!currentSite || hydratingDishId) return;
    setHydratingDishId(dishId);
    try {
      // The sheet's chunk and the dish's groups load while the dish hydrates.
      void loadPlateSheet();
      void utils.restaurantModifiers.productGroups.prefetch(
        { siteId: currentSite.id, productId: dishId },
        { staleTime: 30_000 }
      );
      // `products.list` skips unit assignments to keep the grid payload small.
      const full = await utils.products.getById.fetch({ id: dishId, siteId: currentSite.id });
      const selection = selectionFromHydratedProduct(full as unknown as Product);
      if (!selection) throw new Error('missing unit');
      setSheet({ mode: 'add', selection });
    } catch (error) {
      toast.error({
        title: t('restaurants:catalogGrid.error'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
    } finally {
      setHydratingDishId(null);
    }
  }

  function buildRestaurantCartItem(
    selection: ProductSearchSelection,
    requestedQuantity?: number
  ): SaleCartItem {
    const item = buildCartItem(selection);
    nextRestaurantLineId.current += 1;
    return {
      ...item,
      key: `${item.key}:restaurant:${nextRestaurantLineId.current}`,
      quantity:
        requestedQuantity === undefined
          ? item.quantity
          : Math.max(requestedQuantity, getSaleMinimumQuantity(item)),
    };
  }

  function handleSheetSubmit(detail: RestaurantLineDraft, note: string, quantity: number): void {
    if (!sheet) return;
    let key: string;
    if (sheet.mode === 'edit') {
      key = sheet.key;
      setCartItems(previous =>
        previous.map(item => (item.key === key ? { ...item, quantity } : item))
      );
    } else {
      const item = { ...buildRestaurantCartItem(sheet.selection), quantity };
      key = item.key;
      setCartItems(previous => [...previous, item]);
    }
    setLineDetails(previous => ({ ...previous, [key]: detail }));
    handleNoteChange(key, note);
    setSheet(null);
  }

  function handleTableLabelChange(value: string): void {
    setTableLabel(value);
    const table = tableCatalog.find(row => row.name === value);
    if (table?.seatCount) {
      const capacity = table.seatCount;
      // Capacity is a ceiling, not the party size: clamp only when moving to a smaller table.
      setGuestCount(current => normalizeRestaurantGuestCount(current, capacity));
    }
    setCheckLabel('');
  }

  function handleRemoveLine(itemKey: string): void {
    setCartItems(prev => prev.filter(item => item.key !== itemKey));
    setItemNotes(prev => {
      const next = { ...prev };
      delete next[itemKey];
      return next;
    });
    setLineDetails(prev => {
      const next = { ...prev };
      delete next[itemKey];
      return next;
    });
    if (sheet?.mode === 'edit' && sheet.key === itemKey) setSheet(null);
  }

  function handleNoteChange(itemKey: string, value: string): void {
    setItemNotes(prev => {
      const next = { ...prev };
      if (value.trim().length === 0) {
        delete next[itemKey];
      } else {
        next[itemKey] = value;
      }
      return next;
    });
  }

  async function handleSave(): Promise<void> {
    if (saveDisabled) return;
    setIsSaving(true);
    try {
      const trimmedLabel = tableLabel.trim();
      if (!resolvedPickedTableId) return;
      try {
        const mappedDiners = Array.from({ length: effectiveGuestCount }, (_, index) => ({
          clientId: `seat-${index + 1}`,
          seatNumber: index + 1,
        }));
        const mappedItems = cartItems.map(item => {
          const trimmedNote = itemNotes[item.key]?.trim();
          const detail = detailFor(item.key);
          return {
            productId: item.productId,
            unitId: item.unitId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount,
            taxRate: item.taxRate,
            notes: trimmedNote && trimmedNote.length > 0 ? trimmedNote : null,
            dinerClientId: seatFor(detail) === null ? null : `seat-${seatFor(detail)}`,
            courseKey: detail.courseKey,
            ...(detail.modifierGroups ? { modifierGroups: detail.modifierGroups } : {}),
            modifiers: restaurantModifierSnapshot(detail.modifiers),
          };
        });
        const trimmedCheckLabel = checkLabel.trim();
        if (activeOpenCheck && !trimmedCheckLabel && !reservationSelected) {
          await addRoundMutation.mutateAsync({
            tableId: resolvedPickedTableId,
            checkId: activeOpenCheck.id,
            expectedCheckVersion: activeOpenCheck.version,
            diners: mappedDiners,
            items: mappedItems,
          });
        } else {
          await openCheckMutation.mutateAsync({
            tableId: resolvedPickedTableId,
            ...(reservationSelected
              ? {
                  reservation: {
                    id: arrivedReservation.id,
                    expectedVersion: arrivedReservation.version,
                  },
                }
              : {}),
            guestCount: effectiveGuestCount,
            checkLabel: trimmedCheckLabel || undefined,
            diners: mappedDiners,
            items: mappedItems,
          });
        }
      } catch (error) {
        toast.error({
          title: t('restaurants:save.errorTitle'),
          description: translateServerError(error, t, t('errors:server.unknown')),
        });
        return;
      }

      // The round is durable now. Empty the local round before any read-side
      // refresh so a failed invalidation cannot make a duplicate send likely.
      // The table stays picked so the rail shows the round as sent.
      setCartItems([]);
      setItemNotes({});
      setLineDetails({});
      setSheet(null);
      setCheckLabel('');
      setReservationSelection('');
      const refreshed = await invalidateCommittedGroups(utils, [
        u => u.sales.list,
        u => u.sales.listDrafts,
        u => u.sales.summary,
        u => u.cashSessions.getActive,
        ...RESTAURANT_TABLE_INVALIDATIONS,
        // The same writer may have seated the arrived reservation.
        u => u.reservations.list,
        ...INVENTORY_RESERVATION_INVALIDATIONS,
      ]);
      const successTitle = t(
        kdsActive ? 'restaurants:rail.sentToast' : 'restaurants:rail.savedToast',
        {
          count: roundNumber,
          tableLabel: trimmedLabel,
        }
      );
      if (refreshed) {
        toast.success({ title: successTitle });
      } else {
        toast.warning({
          title: successTitle,
          description: t('common:toast.committedRefreshWarning'),
        });
      }
    } finally {
      setIsSaving(false);
    }
  }

  async function handleExit(): Promise<void> {
    await logout();
  }

  const editingItem =
    sheet?.mode === 'edit' ? cartItems.find(item => item.key === sheet.key) : null;
  const addItem = useMemo(
    () => (sheet?.mode === 'add' ? buildCartItem(sheet.selection) : null),
    [sheet]
  );
  const sheetItem = addItem ?? editingItem;
  const sheetProduct = sheetItem
    ? {
        productId: sheetItem.productId,
        productName: sheetItem.productName,
        unitPrice: sheetItem.unitPrice,
        quantity: sheetItem.quantity,
        minQuantity: getSaleMinimumQuantity(sheetItem),
        quantityStep: getSaleQuantityStep(sheetItem),
      }
    : null;
  const sheetBody =
    sheet && sheetProduct && currentSite ? (
      <Suspense
        fallback={
          <p role="status" className="p-5 text-sm text-fg3">
            {t('restaurants:sheet.loading')}
          </p>
        }
      >
        <RestaurantPlateSheet
          key={sheet.mode === 'edit' ? sheet.key : `add:${sheetProduct.productId}`}
          siteId={currentSite.id}
          productId={sheetProduct.productId}
          productName={sheetProduct.productName}
          unitPrice={sheetProduct.unitPrice}
          quantity={sheetProduct.quantity}
          minQuantity={sheetProduct.minQuantity}
          quantityStep={sheetProduct.quantityStep}
          guestCount={effectiveGuestCount}
          canManage={user?.role === 'admin' || user?.role === 'manager'}
          initialDetail={sheet.mode === 'edit' ? detailFor(sheet.key) : DEFAULT_LINE_DETAILS}
          initialNote={sheet.mode === 'edit' ? (itemNotes[sheet.key] ?? '') : ''}
          mode={sheet.mode}
          onSubmit={handleSheetSubmit}
          onClose={() => setSheet(null)}
        />
      </Suspense>
    ) : null;

  const isMobile = variant === 'mobile';
  const sendLabel = t(kdsActive ? 'restaurants:rail.send' : 'restaurants:rail.save', {
    count: roundNumber,
  });

  const tableControls = (
    <>
      <VoiceOrderingControls
        tablePicker={isMobile ? 'grid' : 'dropdown'}
        canCreateTables={user?.role === 'admin'}
        dineInActive={dineInActive}
        tableLabel={tableLabel}
        tableCatalog={tableCatalog}
        useCatalogDropdown={useCatalogDropdown}
        tableCatalogLoading={tableCatalogQuery.isLoading}
        tableCatalogError={Boolean(tableCatalogQuery.error)}
        guestCount={effectiveGuestCount}
        guestCountMaximum={pickedTableGuestMaximum}
        guestCountLocked={lockedGuestCount !== null || reservationSelected}
        checkLabel={checkLabel}
        interactionDisabled={isSaving}
        micDisabled={micDisabled}
        micDisabledReason={micDisabledReason}
        onTableLabelChange={value => {
          setReservationSelection('');
          handleTableLabelChange(value);
        }}
        onGuestCountChange={value =>
          setGuestCount(normalizeRestaurantGuestCount(value, pickedTableGuestMaximum))
        }
        onCheckLabelChange={setCheckLabel}
        onOpenVoice={() => setVoiceModalOpen(true)}
        onOpenSearch={() => setSearchDialogOpen(true)}
      />
      {arrivedReservation && (
        <ReservationChoice
          row={arrivedReservation}
          checked={reservationSelected}
          disabled={isSaving}
          onChange={checked =>
            setReservationSelection(checked ? reservationChoiceKey(arrivedReservation) : '')
          }
        />
      )}
      {resolvedPickedTableId && openService && (
        <div className="flex flex-wrap gap-2">
          <RestaurantBillRequestToggle
            tableId={resolvedPickedTableId}
            requested={openService.billRequestedAt !== null}
            disabled={isSaving}
          />
          {openChecks.length > 0 && (
            <button
              type="button"
              className="btn-outline"
              disabled={isSaving}
              onClick={() => setPrecheckOpen(true)}
              data-testid="voice-ordering-precheck"
            >
              <Receipt className="h-4 w-4" aria-hidden="true" />
              {t('restaurants:precheck.ctaLabel')}
            </button>
          )}
          {canSplit && (
            <button
              type="button"
              className="btn-outline"
              disabled={isSaving}
              onClick={() => setSplitOpen(true)}
              data-testid="voice-ordering-split"
            >
              <Split className="h-4 w-4" aria-hidden="true" />
              {t('restaurants:split.ctaLabel')}
            </button>
          )}
        </div>
      )}
      {resolvedPickedTableId && tableStateQuery.isLoading && (
        <p className="text-sm text-secondary-500" data-testid="voice-ordering-table-state-loading">
          {t('restaurants:service.tableStateLoading')}
        </p>
      )}
      {resolvedPickedTableId && tableStateQuery.error && (
        <p className="text-sm text-danger-700" data-testid="voice-ordering-table-state-error">
          {t('restaurants:service.tableStateError')}
        </p>
      )}
    </>
  );

  return (
    <div
      className={`flex min-h-full flex-col ${isMobile ? '' : 'lg:h-[calc(100dvh-4rem)] lg:min-h-0'}`}
      data-testid="voice-ordering-screen"
      data-variant={variant}
      aria-busy={isSaving}
    >
      {/* Top bar — no sidebar, no Header. Logout is the only escape. */}
      <header
        className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line/60 pb-3"
        data-testid="voice-ordering-topbar"
      >
        <div>
          <p className="text-xs uppercase tracking-wide text-secondary-500">
            {isMobile
              ? t('restaurants:surface.mobileHeading')
              : t('restaurants:surface.touchHeading')}
          </p>
          <h1 className="font-display text-xl text-secondary-950">
            {currentTenant?.name ?? '—'}
            {currentSite ? ` · ${currentSite.name}` : ''}
          </h1>
          {user?.name && <p className="text-xs text-secondary-600">{user.name}</p>}
        </div>
        <button
          type="button"
          className="btn-outline"
          onClick={handleExit}
          data-testid="voice-ordering-exit"
        >
          {t('restaurants:actions.exit')}
        </button>
      </header>

      {!isMobile && <div className="mb-4 shrink-0 space-y-3">{tableControls}</div>}

      <div
        className={
          isMobile
            ? 'flex flex-col gap-4'
            : 'grid grid-cols-1 gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.95fr)]'
        }
      >
        <div className="space-y-4 lg:min-h-0 lg:overflow-y-auto">
          {isMobile && tableControls}
          {currentSite && dineInActive && (
            <div className="card p-4">
              <RestaurantDishCatalog
                siteId={currentSite.id}
                activeDishId={sheetProduct?.productId ?? hydratingDishId}
                disabled={isSaving || hydratingDishId !== null}
                onPick={dishId => void handleDishPick(dishId)}
              />
            </div>
          )}
        </div>

        {!isMobile && (
          <div className="card overflow-hidden p-0 lg:min-h-0">
            {sheetBody ?? (
              <p
                className="flex h-full min-h-40 items-center justify-center p-6 text-sm text-fg3"
                data-testid="plate-sheet-empty"
              >
                {t('restaurants:sheet.empty')}
              </p>
            )}
          </div>
        )}

        <div className={`card p-0 ${isMobile ? '' : 'overflow-hidden lg:min-h-0'}`}>
          <RestaurantOrderRail
            sentRounds={sentRounds}
            draftLines={draftLines}
            tableTotal={roundMoney(sentTotal + draftTotal)}
            sendLabel={sendLabel}
            sendDisabled={saveDisabled}
            interactionDisabled={isSaving}
            sticky={isMobile}
            onEdit={key => setSheet({ mode: 'edit', key })}
            onRemove={handleRemoveLine}
            onSend={() => void handleSave()}
            hints={
              <>
                {tableLabel.trim().length === 0 && cartItems.length > 0 && (
                  <p
                    className="text-xs text-warning-700"
                    data-testid="voice-ordering-save-table-hint"
                  >
                    {t('restaurants:save.tableRequired')}
                  </p>
                )}
                {cartItems.length === 0 && tableLabel.trim().length > 0 && (
                  <p
                    className="text-xs text-warning-700"
                    data-testid="voice-ordering-save-empty-hint"
                  >
                    {t('restaurants:save.emptyCartHint')}
                  </p>
                )}
              </>
            }
          />
        </div>
      </div>

      {isMobile && (
        <Modal
          isOpen={sheetBody !== null}
          onClose={() => setSheet(null)}
          ariaLabel={sheetProduct?.productName ?? t('restaurants:sheet.empty')}
          size="full"
          showCloseButton={false}
          contentClassName="p-0"
        >
          {/* A fixed height lets the sheet scroll inside and keep its actions in reach. */}
          <div className="h-[min(82dvh,48rem)]">{sheetBody}</div>
        </Modal>
      )}

      {splitOpen && resolvedPickedTableId && (
        <Suspense fallback={null}>
          <RestaurantSplitSheet
            tableId={resolvedPickedTableId}
            tableName={tableLabel}
            onClose={() => setSplitOpen(false)}
            onCharge={account => navigate('/sales', { state: { restaurantCharge: account } })}
          />
        </Suspense>
      )}

      {precheckOpen && resolvedPickedTableId && (
        <Suspense fallback={null}>
          <RestaurantPrecheckModal
            tableId={resolvedPickedTableId}
            tableName={tableLabel}
            onClose={() => setPrecheckOpen(false)}
          />
        </Suspense>
      )}

      {voiceModalOpen && (
        <Suspense fallback={null}>
          <VoiceCartCommandModal
            isOpen={voiceModalOpen}
            onClose={() => setVoiceModalOpen(false)}
            onApply={applyVoiceItems}
          />
        </Suspense>
      )}

      <ProductSearchDialog
        isOpen={searchDialogOpen}
        onClose={() => setSearchDialogOpen(false)}
        onSelect={selection => setSheet({ mode: 'add', selection })}
        siteId={currentSite?.id ?? null}
      />
    </div>
  );
}
