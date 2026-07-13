/**
 * ENG-039a — Restaurant voice-ordering screen.
 *
 * Shared component for both `/touch` (tablet two-column) and `/m`
 * (phone-width stacked) surface variants. Builds on the shared voice
 * infrastructure shipped in ENG-040c slice 3 plus the existing
 * `sales.create` + `sales.suspend` orchestration that
 * `SalesPage.handleSuspendConfirm` already uses for retail.
 *
 * Flow:
 *   1. Waiter enters a table label (e.g. "Mesa 5").
 *   2. Mic CTA opens the lazy-loaded `VoiceCartCommandModal`. Modal
 *      reviews the parsed lines + notes; on Aplicar the items hydrate
 *      into the local cart.
 *   3. Operator can adjust quantity (-/+), remove a line, or edit the
 *      inline note before saving.
 *   4. "Guardar orden" runs `sales.create({status:'draft'})` then
 *      `sales.suspend({label})` and clears local state on success.
 *
 * Per-line notes live in a local `Record<itemKey, string>`; on save
 * each cart line forwards its trimmed note as `sale_items.notes`
 * (ENG-039d2). The sale-level `notes` field is no longer populated
 * by this surface; `tableId` / `suspendedLabel` already carry the
 * table identifier so no aggregation is needed.
 *
 * @module features/restaurants/VoiceOrderingScreen
 */
import { Suspense, lazy, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useIsModuleActive } from '@/features/modules/ModulesContext';
import { useToast } from '@/components/feedback/ToastProvider';
import { ProductSearchDialog } from '@/components/dialogs/ProductSearchDialog';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { translateServerError } from '@/lib/translateServerError';
import {
  getCartItemKey,
  getSaleMinimumQuantity,
  getSaleQuantityStep,
  mergeCartItem,
  type SaleCartItem,
} from '@/features/sales/saleCart';
import type { VoiceCartItem } from '@/features/voice/VoiceCartCommandModal';
import type { ProductSearchSelection } from '@/types';
import { VoiceOrderingCart } from './VoiceOrderingCart';
import { VoiceOrderingControls } from './VoiceOrderingControls';

const VoiceCartCommandModal = lazy(() =>
  import('@/features/voice/VoiceCartCommandModal').then(mod => ({
    default: mod.VoiceCartCommandModal,
  }))
);

export interface VoiceOrderingScreenProps {
  variant: 'touch' | 'mobile';
}

export function VoiceOrderingScreen({
  variant,
}: VoiceOrderingScreenProps): React.ReactElement {
  const { t } = useTranslation(['restaurants', 'voice', 'errors', 'common']);
  const toast = useToast();
  const { logout, user } = useAuth();
  const { currentTenant, currentSite } = useTenant();

  const semanticSearchActive = useIsModuleActive('semantic-search');
  const aiSettingsQuery = trpc.ai.settings.get.useQuery(undefined, {
    enabled: semanticSearchActive,
  });
  const activeCashSessionQuery = trpc.cashSessions.getActive.useQuery(
    currentSite ? { siteId: currentSite.id } : (undefined as never),
    { enabled: Boolean(currentSite) }
  );

  // ENG-039b — pull the persistent table catalog when the active site
  // resolves. When the catalog has entries the input becomes a
  // <select>; otherwise the existing free-text input renders so
  // tenants without tables do not regress. Errors fall back the same
  // way — defensive against transient DB hiccups.
  const tableCatalogQuery = trpc.restaurantTables.list.useQuery(
    currentSite
      ? { siteId: currentSite.id, includeArchived: false }
      : (undefined as never),
    { enabled: Boolean(currentSite) }
  );
  const tableCatalog = tableCatalogQuery.data?.items ?? [];
  const useCatalogDropdown =
    !tableCatalogQuery.isLoading &&
    !tableCatalogQuery.error &&
    tableCatalog.length > 0;

  const utils = trpc.useUtils();
  const createMutation = useCriticalMutation('sales.create');
  const suspendMutation = useCriticalMutation('sales.suspend');
  const discardDraftMutation = useCriticalMutation('sales.discardDraft');

  const [tableLabel, setTableLabel] = useState<string>('');
  // ENG-039b — when the catalog resolves AFTER the operator typed into
  // the free-text input (slow LTE / restaurant Wi-Fi), the visible
  // <select> shows the empty placeholder while `tableLabel` still
  // holds the stale typed value. Guard `saveDisabled` so the button
  // never fires with a phantom label that doesn't match any option;
  // the operator has to explicitly pick a row from the dropdown.
  const tableLabelMatchesCatalog =
    !useCatalogDropdown ||
    tableCatalog.some(row => row.name === tableLabel);
  // ENG-039c — resolve the picked table's id from the label so we can
  // persist the FK alongside the denormalized free-text label. The
  // dropdown stores the table NAME (back-compat with ENG-039b);
  // looking up the id on save keeps a single source of truth without
  // doubling the controlled state.
  const resolvedPickedTableId = useCatalogDropdown
    ? tableCatalog.find(row => row.name === tableLabel)?.id ?? null
    : null;
  const [cartItems, setCartItems] = useState<SaleCartItem[]>([]);
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [voiceModalOpen, setVoiceModalOpen] = useState<boolean>(false);
  const [searchDialogOpen, setSearchDialogOpen] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

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
    tableLabel.trim().length === 0 ||
    !tableLabelMatchesCatalog ||
    cartItems.length === 0 ||
    isSaving;

  function applyVoiceItems(items: VoiceCartItem[]): void {
    if (items.length === 0) return;
    const notesUpdate: Record<string, string> = {};
    for (const item of items) {
      const key = getCartItemKey(item.selection.product.id, item.selection.unit.unitId);
      if (item.note !== null && item.note.trim().length > 0) {
        notesUpdate[key] = item.note.trim();
      }
    }

    setCartItems(prev => {
      let next = prev;
      for (const item of items) {
        next = mergeCartItem(next, item.selection);
        const key = getCartItemKey(item.selection.product.id, item.selection.unit.unitId);
        // Override the post-merge quantity with the parser's value
        // (clamped to the unit's minimum). For new items this replaces
        // `getSaleMinimumQuantity` with `parser.quantity`; for existing
        // items it replaces the `mergeCartItem` bump with the parser's
        // quantity so "agrega tres cocas" lands qty=3 unconditionally.
        const idx = next.findIndex(row => row.key === key);
        const row = idx >= 0 ? next[idx] : undefined;
        if (idx >= 0 && row) {
          const minQty = getSaleMinimumQuantity(row);
          const desiredQty = Math.max(item.quantity, minQty);
          next = next.map((r, i) =>
            i === idx ? { ...r, quantity: desiredQty } : r
          );
        }
      }
      return next;
    });
    if (Object.keys(notesUpdate).length > 0) {
      setItemNotes(prevNotes => ({ ...prevNotes, ...notesUpdate }));
    }
  }

  function handleProductSearchSelect(selection: ProductSearchSelection): void {
    setCartItems(prev => mergeCartItem(prev, selection));
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
        const nextQty = Math.max(minQty, item.quantity + delta * step);
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
    let pendingDraftId: string | null = null;
    try {
      const trimmedLabel = tableLabel.trim();
      const draft = await createMutation.mutateAsync({
        // ENG-039d2 — per-item notes now persist on `sale_items.notes`
        // directly (one row per cart line carries its own modifier).
        // Pre-ENG-039d2 the surface aggregated every note into the
        // sale-level `sales.notes` field with a table-label prefix;
        // both were redundant because ENG-039c already persists
        // tableId + suspendedLabel separately and the KDS render now
        // shows the modifier inline with each product.
        items: cartItems.map(item => {
          const trimmedNote = itemNotes[item.key]?.trim();
          return {
            productId: item.productId,
            unitId: item.unitId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discount: item.discount,
            taxRate: item.taxRate,
            notes: trimmedNote && trimmedNote.length > 0 ? trimmedNote : null,
          };
        }),
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'draft',
        discountAmount: 0,
        // ENG-039c — pass the FK when the operator picked a row from
        // the catalog dropdown. Free-text fallback keeps `tableId`
        // undefined and the server falls back to the label-only
        // legacy contract.
        ...(resolvedPickedTableId ? { tableId: resolvedPickedTableId } : {}),
      });
      pendingDraftId = draft.id;
      await suspendMutation.mutateAsync({
        saleId: draft.id,
        label: trimmedLabel,
        ...(resolvedPickedTableId ? { tableId: resolvedPickedTableId } : {}),
      });
      pendingDraftId = null;
      await utils.sales.listDrafts.invalidate();
      await utils.cashSessions.getActive.invalidate();
      toast.success({
        title: t('restaurants:save.successToast', {
          count: cartItems.length,
          tableLabel: trimmedLabel,
        }),
      });
      setCartItems([]);
      setItemNotes({});
      setTableLabel('');
    } catch (error) {
      toast.error({
        title: t('restaurants:save.errorTitle'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
      if (pendingDraftId) {
        try {
          await discardDraftMutation.mutateAsync({ saleId: pendingDraftId });
        } catch {
          // Best-effort cleanup; original error stays surfaced.
        }
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
          {user?.name && (
            <p className="text-xs text-secondary-600">{user.name}</p>
          )}
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
        <VoiceOrderingControls
          tableLabel={tableLabel}
          tableCatalog={tableCatalog}
          useCatalogDropdown={useCatalogDropdown}
          micDisabled={micDisabled}
          micDisabledReason={micDisabledReason}
          onTableLabelChange={setTableLabel}
          onOpenVoice={() => setVoiceModalOpen(true)}
          onOpenSearch={() => setSearchDialogOpen(true)}
        />

        <VoiceOrderingCart
          cartItems={cartItems}
          itemNotes={itemNotes}
          tableLabel={tableLabel}
          saveDisabled={saveDisabled}
          onQuantityChange={handleQuantityChange}
          onRemoveLine={handleRemoveLine}
          onNoteChange={handleNoteChange}
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
