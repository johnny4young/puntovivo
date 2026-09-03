/**
 * Restaurant voice-ordering screen.
 *
 * Shared component for both `/touch/voice` (tablet two-column) and `/m`
 * (phone-width stacked) surface variants. Builds on the shared voice
 * infrastructure plus the existing
 * atomic `restaurantServices.openCheck` command.
 *
 * Flow:
 * 1. Waiter enters a table label (e.g. "Mesa 5").
 * 2. Mic CTA opens the lazy-loaded `VoiceCartCommandModal`. Modal
 * reviews the parsed lines + notes; on Aplicar the items hydrate
 * into the local cart.
 * 3. Operator can adjust quantity (-/+), remove a line, or edit the
 * inline note before saving.
 * 4. "Guardar orden" commits the draft sale, service, check, diners,
 * round, courses and modifiers in one SQLite transaction.
 *
 * Per-line notes live in a local `Record<itemKey, string>`; on save
 * each cart line forwards its trimmed note as `sale_items.notes`.
 * The sale-level `notes` field is no longer populated
 * by this surface; `tableId` / `suspendedLabel` already carry the
 * table identifier so no aggregation is needed.
 *
 * @module features/restaurants/VoiceOrderingScreen
 */
import { Suspense, lazy, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useIsModuleActive } from '@/features/modules/ModulesContext';
import { useToast } from '@/components/feedback/ToastProvider';
import { ProductSearchDialog } from '@/components/dialogs/ProductSearchDialog';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import {
  invalidateCommittedGroups,
  INVENTORY_RESERVATION_INVALIDATIONS,
} from '@/lib/invalidateGroups';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency } from '@/lib/utils';
import { roundQuantity } from '@puntovivo/shared/unit-math';
import {
  buildCartItem,
  getSaleMinimumQuantity,
  getSaleQuantityStep,
  type SaleCartItem,
} from '@/features/sales/saleCart';
import type { VoiceCartItem } from '@/features/voice/VoiceCartCommandModal';
import type { ProductSearchSelection } from '@/types';
import { VoiceOrderingCart, type RestaurantLineDraft } from './VoiceOrderingCart';
import { VoiceOrderingControls } from './VoiceOrderingControls';
import { getRestaurantModifierPriceDelta, normalizeRestaurantGuestCount } from './restaurantDraft';

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
  const { t } = useTranslation(['restaurants', 'voice', 'errors', 'common']);
  const toast = useToast();
  const { logout, user } = useAuth();
  const { currentTenant, currentSite } = useTenant();

  const semanticSearchActive = useIsModuleActive('semantic-search');
  const dineInActive = useIsModuleActive('dine-in');
  const aiSettingsQuery = trpc.ai.settings.get.useQuery(undefined, {
    enabled: semanticSearchActive,
  });
  const activeCashSessionQuery = trpc.cashSessions.getActive.useQuery(
    currentSite ? { siteId: currentSite.id } : (undefined as never),
    { enabled: Boolean(currentSite) }
  );

  // Pull the persistent table catalog when the active site resolves. A
  // restaurant check always targets an authoritative table row; an empty or
  // failed catalog therefore exposes setup guidance instead of accepting a
  // free-text label that cannot participate in service lifecycle invariants.
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

  const [tableLabel, setTableLabel] = useState<string>('');
  // Guard against a stale selection after catalog refresh. The operator must
  // explicitly choose a currently active row before opening a check.
  const tableLabelMatchesCatalog =
    !useCatalogDropdown || tableCatalog.some(row => row.name === tableLabel);
  // resolve the picked table's id from the label so we can
  // persist the FK alongside the denormalized display label. The
  // dropdown stores the table name for compatibility with the original
  // controlled input;
  // looking up the id on save keeps a single source of truth without
  // doubling the controlled state.
  const resolvedPickedTableId = useCatalogDropdown
    ? (tableCatalog.find(row => row.name === tableLabel)?.id ?? null)
    : null;
  const tableStateQuery = trpc.restaurantServices.getTableState.useQuery(
    resolvedPickedTableId ? { tableId: resolvedPickedTableId } : (undefined as never),
    { enabled: Boolean(resolvedPickedTableId) && dineInActive }
  );
  const [guestCount, setGuestCount] = useState<number>(1);
  const [checkLabel, setCheckLabel] = useState<string>('');
  const lockedGuestCount = tableStateQuery.data?.service?.guestCount ?? null;
  const pickedTableGuestMaximum =
    tableCatalog.find(row => row.id === resolvedPickedTableId)?.seatCount ?? 200;
  const effectiveGuestCount = normalizeRestaurantGuestCount(
    lockedGuestCount ?? guestCount,
    pickedTableGuestMaximum
  );
  const [cartItems, setCartItems] = useState<SaleCartItem[]>([]);
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [lineDetails, setLineDetails] = useState<Record<string, RestaurantLineDraft>>({});
  const [voiceModalOpen, setVoiceModalOpen] = useState<boolean>(false);
  const [searchDialogOpen, setSearchDialogOpen] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const nextRestaurantLineId = useRef(0);

  const cashSession = activeCashSessionQuery.data ?? null;
  const aiEnabled = aiSettingsQuery.data?.enabled === true;
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
    tableLabel.trim().length === 0 ||
    !tableLabelMatchesCatalog ||
    cartItems.length === 0 ||
    isSaving;

  function applyVoiceItems(items: VoiceCartItem[]): void {
    if (items.length === 0) return;
    const additions = items.map(item => {
      const cartItem = buildRestaurantCartItem(item.selection, item.quantity);
      return { cartItem, note: item.note?.trim() || null };
    });
    const notesUpdate: Record<string, string> = {};
    for (const { cartItem, note } of additions) {
      if (note) {
        notesUpdate[cartItem.key] = note;
      }
    }

    // Restaurant additions intentionally remain distinct even when product
    // and unit match. Two diners may order the same item with different
    // modifiers, notes or courses; the generic POS merge key would silently
    // collapse those operationally different kitchen lines.
    setCartItems(previous => [...previous, ...additions.map(({ cartItem }) => cartItem)]);
    if (Object.keys(notesUpdate).length > 0) {
      setItemNotes(prevNotes => ({ ...prevNotes, ...notesUpdate }));
    }
  }

  function handleProductSearchSelect(selection: ProductSearchSelection): void {
    setCartItems(previous => [...previous, buildRestaurantCartItem(selection)]);
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

  function handleTableLabelChange(value: string): void {
    setTableLabel(value);
    const table = tableCatalog.find(row => row.name === value);
    if (table?.seatCount) {
      const capacity = table.seatCount;
      // A table's capacity is a ceiling, not the default party size. Preserve
      // the operator's current count and clamp only when moving to a smaller
      // table so selecting a 12-seat table never invents 12 diners.
      setGuestCount(current => normalizeRestaurantGuestCount(current, capacity));
    }
    setCheckLabel('');
  }

  function handleQuantityChange(itemKey: string, delta: number): void {
    // The decrement button is `disabled` at `quantity === minQty` so
    // the operator never sees a no-op press; we still clamp here as
    // defense-in-depth against keyboard / programmatic invocations.
    setCartItems(prev =>
      prev.map(item => {
        if (item.key !== itemKey) return item;
        const step = getSaleQuantityStep(item);
        const minQty = getSaleMinimumQuantity(item);
        const nextQty = roundQuantity(Math.max(minQty, item.quantity + delta * step), 12);
        return { ...item, quantity: nextQty };
      })
    );
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

  function handleLineDetailsChange(itemKey: string, value: RestaurantLineDraft): void {
    setLineDetails(previous => ({ ...previous, [itemKey]: value }));
  }

  async function handleSave(): Promise<void> {
    if (saveDisabled) return;
    setIsSaving(true);
    try {
      const trimmedLabel = tableLabel.trim();
      if (!resolvedPickedTableId) return;
      try {
        await openCheckMutation.mutateAsync({
          tableId: resolvedPickedTableId,
          guestCount: effectiveGuestCount,
          checkLabel: checkLabel.trim() || undefined,
          diners: Array.from({ length: effectiveGuestCount }, (_, index) => ({
            clientId: `seat-${index + 1}`,
            seatNumber: index + 1,
          })),
          // Per-item notes persist on `sale_items.notes` directly. The check
          // already owns table/label identity; structured modifiers remain in
          // the restaurant projection and PR11 owns durable KDS routing.
          items: cartItems.map(item => {
            const trimmedNote = itemNotes[item.key]?.trim();
            const detail = lineDetails[item.key] ?? {
              courseKey: 'main' as const,
              seatNumber: 1,
              modifierName: '',
              modifierPriceDelta: 0,
            };
            const modifierName = detail.modifierName.trim();
            return {
              productId: item.productId,
              unitId: item.unitId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              discount: item.discount,
              taxRate: item.taxRate,
              notes: trimmedNote && trimmedNote.length > 0 ? trimmedNote : null,
              dinerClientId: `seat-${Math.min(detail.seatNumber, effectiveGuestCount)}`,
              courseKey: detail.courseKey,
              modifiers:
                modifierName.length > 0
                  ? [
                      {
                        name: modifierName,
                        quantity: 1,
                        unitPriceDelta: getRestaurantModifierPriceDelta(detail),
                      },
                    ]
                  : [],
            };
          }),
        });
      } catch (error) {
        toast.error({
          title: t('restaurants:save.errorTitle'),
          description: translateServerError(error, t, t('errors:server.unknown')),
        });
        return;
      }

      // The order is durable now. Empty the local cart before any read-side
      // refresh so a failed invalidation cannot make a duplicate save likely.
      setCartItems([]);
      setItemNotes({});
      setLineDetails({});
      setTableLabel('');
      setCheckLabel('');
      setGuestCount(1);
      const refreshed = await invalidateCommittedGroups(utils, [
        u => u.sales.list,
        u => u.sales.listDrafts,
        u => u.sales.summary,
        u => u.cashSessions.getActive,
        u => u.restaurantTables.listWithDraftStatus,
        u => u.restaurantServices.getTableState,
        ...INVENTORY_RESERVATION_INVALIDATIONS,
      ]);
      const successTitle = t('restaurants:save.successToast', {
        count: cartItems.length,
        tableLabel: trimmedLabel,
      });
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

  const containerLayout =
    variant === 'mobile'
      ? 'flex flex-col gap-4'
      : 'grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]';

  return (
    <div
      className="flex min-h-full flex-col"
      data-testid="voice-ordering-screen"
      data-variant={variant}
      aria-busy={isSaving}
    >
      {/* Top bar — no sidebar, no Header. Logout is the only escape. */}
      <header
        className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line/60 pb-3"
        data-testid="voice-ordering-topbar"
      >
        <div>
          <p className="text-xs uppercase tracking-wide text-secondary-500">
            {variant === 'mobile'
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

      <div className={containerLayout}>
        <div className="space-y-4">
          <VoiceOrderingControls
            dineInActive={dineInActive}
            tableLabel={tableLabel}
            tableCatalog={tableCatalog}
            useCatalogDropdown={useCatalogDropdown}
            tableCatalogLoading={tableCatalogQuery.isLoading}
            tableCatalogError={Boolean(tableCatalogQuery.error)}
            guestCount={effectiveGuestCount}
            guestCountMaximum={pickedTableGuestMaximum}
            guestCountLocked={lockedGuestCount !== null}
            checkLabel={checkLabel}
            interactionDisabled={isSaving}
            micDisabled={micDisabled}
            micDisabledReason={micDisabledReason}
            onTableLabelChange={handleTableLabelChange}
            onGuestCountChange={value =>
              setGuestCount(normalizeRestaurantGuestCount(value, pickedTableGuestMaximum))
            }
            onCheckLabelChange={setCheckLabel}
            onOpenVoice={() => setVoiceModalOpen(true)}
            onOpenSearch={() => setSearchDialogOpen(true)}
          />
          {resolvedPickedTableId && tableStateQuery.isLoading && (
            <p
              className="text-sm text-secondary-500"
              data-testid="voice-ordering-table-state-loading"
            >
              {t('restaurants:service.tableStateLoading')}
            </p>
          )}
          {resolvedPickedTableId && tableStateQuery.error && (
            <p className="text-sm text-danger-700" data-testid="voice-ordering-table-state-error">
              {t('restaurants:service.tableStateError')}
            </p>
          )}
          {tableStateQuery.data?.checks && tableStateQuery.data.checks.length > 0 && (
            <section className="card p-4" data-testid="voice-ordering-open-checks">
              <h2 className="font-display text-base text-secondary-950">
                {t('restaurants:service.openChecks', {
                  count: tableStateQuery.data.checks.length,
                })}
              </h2>
              <ul className="mt-2 space-y-2">
                {tableStateQuery.data.checks.map(check => (
                  <li
                    key={check.id}
                    className="flex items-center justify-between rounded-md bg-secondary-50 px-3 py-2 text-sm"
                  >
                    <span>{check.label || check.saleNumber}</span>
                    <span className="font-medium">{formatCurrency(check.total)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <VoiceOrderingCart
          cartItems={cartItems}
          itemNotes={itemNotes}
          lineDetails={lineDetails}
          guestCount={effectiveGuestCount}
          tableLabel={tableLabel}
          saveDisabled={saveDisabled}
          interactionDisabled={isSaving}
          onQuantityChange={handleQuantityChange}
          onRemoveLine={handleRemoveLine}
          onNoteChange={handleNoteChange}
          onLineDetailsChange={handleLineDetailsChange}
          onSave={() => void handleSave()}
        />
      </div>

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
        onSelect={handleProductSearchSelect}
      />
    </div>
  );
}
