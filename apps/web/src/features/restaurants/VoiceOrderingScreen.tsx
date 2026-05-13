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
 * Per-line notes are kept in a local `Map<itemKey, string>`; on save
 * they are aggregated into the sale-level `notes` field (no schema
 * migration needed for the MVP). Per-item notes will move to
 * `sale_items.notes` once structured modifiers ship in a later
 * `ENG-039` child.
 *
 * @module features/restaurants/VoiceOrderingScreen
 */
import { Suspense, lazy, useState } from 'react';
import { Mic, Plus, Save, Search, ShoppingBag, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useIsModuleActive } from '@/features/modules/ModulesContext';
import { useToast } from '@/components/feedback/ToastProvider';
import { ProductSearchDialog } from '@/components/dialogs/ProductSearchDialog';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency } from '@/lib/utils';
import {
  getCartItemKey,
  getCartSummary,
  getSaleMinimumQuantity,
  getSaleQuantityStep,
  mergeCartItem,
  type SaleCartItem,
} from '@/features/sales/saleCart';
import type { VoiceCartItem } from '@/features/voice/VoiceCartCommandModal';
import type { ProductSearchSelection } from '@/types';

const VoiceCartCommandModal = lazy(() =>
  import('@/features/voice/VoiceCartCommandModal').then(mod => ({
    default: mod.VoiceCartCommandModal,
  }))
);

const TABLE_LABEL_MAX = 80;

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

  const utils = trpc.useUtils();
  const createMutation = useCriticalMutation('sales.create');
  const suspendMutation = useCriticalMutation('sales.suspend');
  const discardDraftMutation = useCriticalMutation('sales.discardDraft');

  const [tableLabel, setTableLabel] = useState<string>('');
  const [cartItems, setCartItems] = useState<SaleCartItem[]>([]);
  const [itemNotes, setItemNotes] = useState<Record<string, string>>({});
  const [voiceModalOpen, setVoiceModalOpen] = useState<boolean>(false);
  const [searchDialogOpen, setSearchDialogOpen] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const cashSession = activeCashSessionQuery.data ?? null;
  const aiEnabled = aiSettingsQuery.data?.enabled === true;
  const cartSummary = getCartSummary(cartItems);

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

  function buildAggregatedNotes(): string | undefined {
    // The desktop SuspendedSalesPanel renders `suspendedLabel`
    // alongside the row, so duplicating the table name inside `notes`
    // would echo "Mesa 5" twice on resume. Only emit per-line notes
    // here; the table prefix lands only when there is at least one
    // per-line note to anchor it to, so a kitchen ticket downstream
    // can read "Mesa 5 — pan: sin sal" without the cashier hunting
    // for which table the line belongs to.
    const noteLines: string[] = [];
    for (const item of cartItems) {
      const note = itemNotes[item.key];
      if (note && note.trim().length > 0) {
        noteLines.push(`${item.productName}: ${note.trim()}`);
      }
    }
    if (noteLines.length === 0) return undefined;
    return [`${t('restaurants:tableLabel.label')}: ${tableLabel.trim()}`, ...noteLines].join(
      '\n'
    );
  }

  async function handleSave(): Promise<void> {
    if (saveDisabled) return;
    setIsSaving(true);
    let pendingDraftId: string | null = null;
    try {
      const trimmedLabel = tableLabel.trim();
      const draft = await createMutation.mutateAsync({
        items: cartItems.map(item => ({
          productId: item.productId,
          unitId: item.unitId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          taxRate: item.taxRate,
        })),
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'draft',
        discountAmount: 0,
        notes: buildAggregatedNotes(),
      });
      pendingDraftId = draft.id;
      await suspendMutation.mutateAsync({ saleId: draft.id, label: trimmedLabel });
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
        {/* Controls column */}
        <section className="space-y-4">
          <div className="card p-4">
            <label
              htmlFor="voice-ordering-table-label"
              className="text-xs font-medium uppercase tracking-wide text-secondary-500"
            >
              {t('restaurants:tableLabel.label')}
            </label>
            <input
              id="voice-ordering-table-label"
              data-testid="voice-ordering-table-input"
              className="input mt-1 w-full text-lg"
              type="text"
              maxLength={TABLE_LABEL_MAX}
              placeholder={t('restaurants:tableLabel.placeholder')}
              aria-required="true"
              value={tableLabel}
              onChange={event => setTableLabel(event.target.value)}
            />
            {tableLabel.trim().length === 0 && (
              <p className="mt-1 text-xs text-warning-700">
                {t('restaurants:tableLabel.required')}
              </p>
            )}
          </div>

          <div className="card p-4 space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-secondary-500">
              {t('restaurants:surface.subheading')}
            </p>
            <button
              type="button"
              className="btn-primary w-full text-base"
              onClick={() => setVoiceModalOpen(true)}
              disabled={micDisabled}
              data-testid="voice-ordering-mic-cta"
              aria-label={t('restaurants:actions.voiceCTA')}
            >
              <Mic className="h-5 w-5" />
              {t('restaurants:actions.voiceCTA')}
            </button>
            {micDisabled && (
              <p
                className="text-xs text-warning-700"
                data-testid="voice-ordering-mic-disabled-hint"
              >
                {micDisabledReason}
              </p>
            )}
            <button
              type="button"
              className="btn-outline w-full"
              onClick={() => setSearchDialogOpen(true)}
              data-testid="voice-ordering-manual-add"
            >
              <Search className="h-4 w-4" />
              {t('restaurants:actions.manualAdd')}
            </button>
          </div>
        </section>

        {/* Cart preview column */}
        <section className="space-y-3">
          <div className="card overflow-hidden">
            <header className="flex items-center justify-between border-b border-line/60 px-4 py-3">
              <h2 className="font-display text-lg text-secondary-950">
                {t('restaurants:cart.heading')}
              </h2>
              <span className="text-xs text-secondary-500">
                {cartItems.length}
              </span>
            </header>

            {cartItems.length === 0 ? (
              <div
                className="px-4 py-10 text-center text-sm text-secondary-500"
                data-testid="voice-ordering-cart-empty"
              >
                <ShoppingBag className="mx-auto mb-2 h-8 w-8 text-secondary-300" />
                {t('restaurants:cart.empty')}
              </div>
            ) : (
              <ul className="divide-y divide-line/40">
                {cartItems.map(item => {
                  const note = itemNotes[item.key] ?? '';
                  return (
                    <li
                      key={item.key}
                      className="space-y-2 px-4 py-3"
                      data-testid="voice-ordering-cart-row"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="text-sm font-medium text-secondary-950">
                            {item.productName}
                          </p>
                          <p className="text-xs text-secondary-500">
                            {item.unitName} · {formatCurrency(item.unitPrice)}
                          </p>
                        </div>
                        <button
                          type="button"
                          className="text-secondary-500 hover:text-danger-600"
                          onClick={() => handleRemoveLine(item.key)}
                          data-testid="voice-ordering-remove-row"
                          aria-label={t('restaurants:cart.removeRow')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="btn-outline btn-icon h-8 w-8"
                            onClick={() => handleQuantityChange(item.key, -1)}
                            aria-label={t('restaurants:cart.quantityDecrement')}
                            data-testid="voice-ordering-qty-decrement"
                            disabled={item.quantity <= getSaleMinimumQuantity(item)}
                          >
                            −
                          </button>
                          <span
                            className="min-w-[2ch] text-center text-sm font-medium"
                            data-testid="voice-ordering-qty"
                          >
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            className="btn-outline btn-icon h-8 w-8"
                            onClick={() => handleQuantityChange(item.key, +1)}
                            aria-label={t('restaurants:cart.quantityIncrement')}
                            data-testid="voice-ordering-qty-increment"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                        <span className="text-sm font-medium text-secondary-950">
                          {formatCurrency(item.quantity * item.unitPrice)}
                        </span>
                      </div>
                      <input
                        type="text"
                        className="input text-xs"
                        placeholder={t('restaurants:cart.notesPlaceholder')}
                        value={note}
                        onChange={event =>
                          handleNoteChange(item.key, event.target.value)
                        }
                        data-testid="voice-ordering-note-input"
                        aria-label={t('restaurants:cart.notesPlaceholder')}
                      />
                    </li>
                  );
                })}
              </ul>
            )}

            {cartItems.length > 0 && (
              <footer className="space-y-1 border-t border-line/60 px-4 py-3 text-sm">
                <div className="flex items-center justify-between text-secondary-500">
                  <span>{t('restaurants:cart.subtotal')}</span>
                  <span>{formatCurrency(cartSummary.subtotal)}</span>
                </div>
                <div className="flex items-center justify-between text-secondary-500">
                  <span>{t('restaurants:cart.tax')}</span>
                  <span>{formatCurrency(cartSummary.taxAmount)}</span>
                </div>
                <div className="flex items-center justify-between font-semibold text-secondary-950">
                  <span>{t('restaurants:cart.total')}</span>
                  <span>{formatCurrency(cartSummary.total)}</span>
                </div>
              </footer>
            )}
          </div>

          <button
            type="button"
            className="btn-primary w-full text-base"
            onClick={() => void handleSave()}
            disabled={saveDisabled}
            data-testid="voice-ordering-save"
          >
            <Save className="h-5 w-5" />
            {t('restaurants:actions.saveOrder')}
          </button>
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
        </section>
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
