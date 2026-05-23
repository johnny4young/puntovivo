import { Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SaleCartTable } from '@/features/sales/SaleCartTable';
import type { SaleCartItem } from '@/features/sales/saleCart';
import {
  ariaKeyshortcutsFor,
  formatKeysForDisplay,
  getShortcutById,
} from '@/lib/shortcuts';

interface SalesCartWorkspaceProps {
  items: SaleCartItem[];
  selectedItemKey: string | null;
  itemCount: number;
  saleError: string | null;
  onQuantityChange: (itemKey: string, quantity: number) => void;
  onDiscountChange: (itemKey: string, discount: number) => void;
  onRemove: (itemKey: string) => void;
  onSelectItem: (itemKey: string | null) => void;
  onClearCart: () => void;
  quantityInputRefFor: (itemKey: string) => (node: HTMLInputElement | null) => void;
  discountInputRefFor: (itemKey: string) => (node: HTMLInputElement | null) => void;
  /**
   * ENG-105d — `true` when the active workspace has at least one
   * undoable mutation in its history stack and the cart is not a
   * locked resumed-draft. The toolbar button only renders when this
   * is true; the canonical shortcut catalogue owns discovery when
   * there is nothing undoable yet.
   */
  canUndo?: boolean;
  /**
   * ENG-105d — invoked from the visible "Deshacer" button. Optional
   * so existing consumers that do not yet wire undo (component
   * tests, future surfaces) keep compiling. When undefined the
   * button is hidden entirely.
   */
  onUndo?: () => void;
}

export function SalesCartWorkspace({
  items,
  selectedItemKey,
  itemCount,
  saleError,
  onQuantityChange,
  onDiscountChange,
  onRemove,
  onSelectItem,
  onClearCart,
  quantityInputRefFor,
  discountInputRefFor,
  canUndo = false,
  onUndo,
}: SalesCartWorkspaceProps) {
  const { t } = useTranslation('sales');
  // ENG-105d — visible shortcut chip pulled from the canonical
  // catalogue so the surface stays in sync with `Mod+Z` (and any
  // future rebind).
  const undoShortcut = onUndo ? getShortcutById('sales.undo') : undefined;
  const undoShortcutHint = undoShortcut
    ? formatKeysForDisplay(undoShortcut.keys)
    : null;
  const undoAriaKeyshortcuts = onUndo
    ? ariaKeyshortcutsFor('sales.undo')
    : undefined;
  return (
    <div className="card p-5 sm:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="page-kicker text-[0.62rem] tracking-[0.24em]">{t('checkout.activeTicket')}</p>
          <h2 className="mt-2 font-display text-3xl text-secondary-950">{t('checkout.currentCart')}</h2>
          <p className="mt-2 max-w-2xl text-sm text-secondary-600">
            {t('checkout.adjustHint')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-secondary">{t('checkout.lineItems', { count: itemCount })}</span>
          {/* ENG-134d — only render Undo + Clear when actually usable.
            * Disabled toolbar buttons tank WCAG AA contrast through the
            * shared `disabled:opacity-45` rule on every btn variant; the
            * cleaner UX is to hide affordances that have nothing to act
            * on. The keyboard shortcut Mod+Z still fires from the
            * document-level handler when there is something to undo,
            * and CommandPalette (Mod+K) is the canonical place to
            * discover keybindings. */}
          {onUndo && canUndo && (
            <button
              className="btn-ghost flex items-center gap-2"
              onClick={onUndo}
              aria-keyshortcuts={undoAriaKeyshortcuts}
              data-testid="sales-cart-undo"
            >
              <Undo2 className="h-4 w-4" aria-hidden="true" />
              <span>{t('undo.button.label')}</span>
              {undoShortcutHint && (
                <span
                  className="rounded-md border border-line/70 bg-surface-2/80 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-secondary-600"
                  aria-hidden="true"
                >
                  {undoShortcutHint}
                </span>
              )}
            </button>
          )}
          {items.length > 0 && (
            <button className="btn-ghost" onClick={onClearCart}>
              {t('checkout.clearCart')}
            </button>
          )}
        </div>
      </div>

      <SaleCartTable
        items={items}
        selectedItemKey={selectedItemKey}
        onQuantityChange={onQuantityChange}
        onDiscountChange={onDiscountChange}
        onRemove={onRemove}
        onSelectItem={itemKey => onSelectItem(itemKey)}
        quantityInputRefFor={quantityInputRefFor}
        discountInputRefFor={discountInputRefFor}
      />

      {saleError && (
        <div className="mt-4 rounded-[20px] border border-danger-200/70 bg-danger-50/90 px-4 py-3 text-sm text-danger-700">
          {saleError}
        </div>
      )}
    </div>
  );
}
