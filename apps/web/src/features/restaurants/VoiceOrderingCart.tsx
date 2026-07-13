import { Plus, Save, ShoppingBag, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { formatCurrency } from '@/lib/utils';
import {
  getCartSummary,
  getSaleMinimumQuantity,
  type SaleCartItem,
} from '@/features/sales/saleCart';

interface VoiceOrderingCartProps {
  cartItems: SaleCartItem[];
  itemNotes: Record<string, string>;
  tableLabel: string;
  saveDisabled: boolean;
  onQuantityChange: (itemKey: string, delta: number) => void;
  onRemoveLine: (itemKey: string) => void;
  onNoteChange: (itemKey: string, value: string) => void;
  onSave: () => void;
}

/** ENG-178 — Presentational cart preview and save controls for voice ordering. */
export function VoiceOrderingCart({
  cartItems,
  itemNotes,
  tableLabel,
  saveDisabled,
  onQuantityChange,
  onRemoveLine,
  onNoteChange,
  onSave,
}: VoiceOrderingCartProps): React.ReactElement {
  const { t } = useTranslation('restaurants');
  const cartSummary = getCartSummary(cartItems);

  return (
    <section className="space-y-3">
      <div className="card overflow-hidden">
        <header className="flex items-center justify-between border-b border-line/60 px-4 py-3">
          <h2 className="font-display text-lg text-secondary-950">
            {t('cart.heading')}
          </h2>
          <span className="text-xs text-secondary-500">{cartItems.length}</span>
        </header>

        {cartItems.length === 0 ? (
          <div
            className="px-4 py-10 text-center text-sm text-secondary-500"
            data-testid="voice-ordering-cart-empty"
          >
            <ShoppingBag className="mx-auto mb-2 h-8 w-8 text-secondary-300" />
            {t('cart.empty')}
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
                      onClick={() => onRemoveLine(item.key)}
                      data-testid="voice-ordering-remove-row"
                      aria-label={t('cart.removeRow')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className="btn-outline btn-icon h-8 w-8"
                        onClick={() => onQuantityChange(item.key, -1)}
                        aria-label={t('cart.quantityDecrement')}
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
                        onClick={() => onQuantityChange(item.key, +1)}
                        aria-label={t('cart.quantityIncrement')}
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
                    placeholder={t('cart.notesPlaceholder')}
                    value={note}
                    onChange={event => onNoteChange(item.key, event.target.value)}
                    data-testid="voice-ordering-note-input"
                    aria-label={t('cart.notesPlaceholder')}
                  />
                </li>
              );
            })}
          </ul>
        )}

        {cartItems.length > 0 && (
          <footer className="space-y-1 border-t border-line/60 px-4 py-3 text-sm">
            <div className="flex items-center justify-between text-secondary-500">
              <span>{t('cart.subtotal')}</span>
              <span>{formatCurrency(cartSummary.subtotal)}</span>
            </div>
            <div className="flex items-center justify-between text-secondary-500">
              <span>{t('cart.tax')}</span>
              <span>{formatCurrency(cartSummary.taxAmount)}</span>
            </div>
            <div className="flex items-center justify-between font-semibold text-secondary-950">
              <span>{t('cart.total')}</span>
              <span>{formatCurrency(cartSummary.total)}</span>
            </div>
          </footer>
        )}
      </div>

      <button
        type="button"
        className="btn-primary w-full text-base"
        onClick={onSave}
        disabled={saveDisabled}
        data-testid="voice-ordering-save"
      >
        <Save className="h-5 w-5" />
        {t('actions.saveOrder')}
      </button>
      {tableLabel.trim().length === 0 && cartItems.length > 0 && (
        <p
          className="text-xs text-warning-700"
          data-testid="voice-ordering-save-table-hint"
        >
          {t('save.tableRequired')}
        </p>
      )}
      {cartItems.length === 0 && tableLabel.trim().length > 0 && (
        <p
          className="text-xs text-warning-700"
          data-testid="voice-ordering-save-empty-hint"
        >
          {t('save.emptyCartHint')}
        </p>
      )}
    </section>
  );
}
