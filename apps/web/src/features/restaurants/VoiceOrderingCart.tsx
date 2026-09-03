import { Plus, Save, ShoppingBag, Trash2 } from 'lucide-react';
import { usePriceIncludesTax } from '@/features/pricing/PricingContext';
import { useTranslation } from 'react-i18next';

import { roundMoney } from '@/lib/money';
import { formatCurrency } from '@/lib/utils';
import { getSaleMinimumQuantity, type SaleCartItem } from '@/features/sales/saleCart';
import { getCartSummary } from '@/features/sales/saleCartTotals';
import { getRestaurantModifierPriceDelta } from './restaurantDraft';

const RESTAURANT_LINE_NOTE_MAX = 280;
const RESTAURANT_MODIFIER_PRICE_MAX = 1_000_000_000;

/** State and callbacks required to edit one local restaurant order draft. */
interface VoiceOrderingCartProps {
  cartItems: SaleCartItem[];
  itemNotes: Record<string, string>;
  lineDetails: Record<string, RestaurantLineDraft>;
  guestCount: number;
  tableLabel: string;
  saveDisabled: boolean;
  interactionDisabled: boolean;
  onQuantityChange: (itemKey: string, delta: number) => void;
  onRemoveLine: (itemKey: string) => void;
  onNoteChange: (itemKey: string, value: string) => void;
  onLineDetailsChange: (itemKey: string, value: RestaurantLineDraft) => void;
  onSave: () => void;
}

/** Editable restaurant-only metadata kept outside the generic sale cart. */
export interface RestaurantLineDraft {
  courseKey: 'starter' | 'main' | 'dessert' | 'drink' | 'other';
  seatNumber: number;
  modifierName: string;
  modifierPriceDelta: number;
}

const DEFAULT_LINE_DETAILS: RestaurantLineDraft = {
  courseKey: 'main',
  seatNumber: 1,
  modifierName: '',
  modifierPriceDelta: 0,
};

/** Presentational cart preview and save controls for voice ordering. */
export function VoiceOrderingCart({
  cartItems,
  itemNotes,
  lineDetails,
  guestCount,
  tableLabel,
  saveDisabled,
  interactionDisabled,
  onQuantityChange,
  onRemoveLine,
  onNoteChange,
  onLineDetailsChange,
  onSave,
}: VoiceOrderingCartProps): React.ReactElement {
  const priceIncludesTax = usePriceIncludesTax();
  const { t } = useTranslation('restaurants');
  const pricedCartItems = cartItems.map(item => {
    const detail = lineDetails[item.key] ?? DEFAULT_LINE_DETAILS;
    return {
      ...item,
      unitPrice: roundMoney(item.unitPrice + getRestaurantModifierPriceDelta(detail)),
    };
  });
  const cartSummary = getCartSummary(pricedCartItems, priceIncludesTax);

  return (
    <section className="space-y-3">
      <div className="card overflow-hidden">
        <header className="flex items-center justify-between border-b border-line/60 px-4 py-3">
          <h2 className="font-display text-lg text-secondary-950">{t('cart.heading')}</h2>
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
              const detail = lineDetails[item.key] ?? DEFAULT_LINE_DETAILS;
              const effectiveUnitPrice = roundMoney(
                item.unitPrice + getRestaurantModifierPriceDelta(detail)
              );
              return (
                <li
                  key={item.key}
                  className="space-y-2 px-4 py-3"
                  data-testid="voice-ordering-cart-row"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="text-sm font-medium text-secondary-950">{item.productName}</p>
                      <p className="text-xs text-secondary-500">
                        {item.unitName} · {formatCurrency(effectiveUnitPrice)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="text-secondary-500 hover:text-danger-600"
                      onClick={() => onRemoveLine(item.key)}
                      disabled={interactionDisabled}
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
                        disabled={
                          interactionDisabled || item.quantity <= getSaleMinimumQuantity(item)
                        }
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
                        disabled={interactionDisabled}
                        aria-label={t('cart.quantityIncrement')}
                        data-testid="voice-ordering-qty-increment"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                    <span className="text-sm font-medium text-secondary-950">
                      {formatCurrency(item.quantity * effectiveUnitPrice)}
                    </span>
                  </div>
                  <input
                    type="text"
                    className="input text-xs"
                    placeholder={t('cart.notesPlaceholder')}
                    maxLength={RESTAURANT_LINE_NOTE_MAX}
                    value={note}
                    disabled={interactionDisabled}
                    onChange={event => onNoteChange(item.key, event.target.value)}
                    data-testid="voice-ordering-note-input"
                    aria-label={t('cart.notesPlaceholder')}
                  />
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="text-xs font-medium text-secondary-600">
                      {t('cart.courseLabel')}
                      <select
                        className="input mt-1 w-full text-xs"
                        value={detail.courseKey}
                        disabled={interactionDisabled}
                        onChange={event =>
                          onLineDetailsChange(item.key, {
                            ...detail,
                            courseKey: event.target.value as RestaurantLineDraft['courseKey'],
                          })
                        }
                        data-testid="voice-ordering-course-select"
                      >
                        {(['starter', 'main', 'dessert', 'drink', 'other'] as const).map(key => (
                          <option key={key} value={key}>
                            {t(`cart.courses.${key}`)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-medium text-secondary-600">
                      {t('cart.seatLabel')}
                      <select
                        className="input mt-1 w-full text-xs"
                        value={Math.min(detail.seatNumber, guestCount)}
                        disabled={interactionDisabled}
                        onChange={event =>
                          onLineDetailsChange(item.key, {
                            ...detail,
                            seatNumber: Number(event.target.value),
                          })
                        }
                        data-testid="voice-ordering-seat-select"
                      >
                        {Array.from({ length: guestCount }, (_, index) => index + 1).map(seat => (
                          <option key={seat} value={seat}>
                            {t('cart.seatOption', { count: seat })}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
                    <label className="text-xs font-medium text-secondary-600">
                      {t('cart.modifierLabel')}
                      <input
                        className="input mt-1 w-full text-xs"
                        type="text"
                        maxLength={80}
                        placeholder={t('cart.modifierPlaceholder')}
                        value={detail.modifierName}
                        disabled={interactionDisabled}
                        onChange={event =>
                          onLineDetailsChange(item.key, {
                            ...detail,
                            modifierName: event.target.value,
                          })
                        }
                        data-testid="voice-ordering-modifier-name"
                      />
                    </label>
                    <label className="text-xs font-medium text-secondary-600">
                      {t('cart.modifierPrice')}
                      <input
                        className="input mt-1 w-full text-xs"
                        type="number"
                        min={0}
                        max={RESTAURANT_MODIFIER_PRICE_MAX}
                        step="0.01"
                        value={detail.modifierPriceDelta}
                        disabled={interactionDisabled || detail.modifierName.trim().length === 0}
                        onChange={event => {
                          const value = event.currentTarget.valueAsNumber;
                          onLineDetailsChange(item.key, {
                            ...detail,
                            modifierPriceDelta: Number.isFinite(value)
                              ? Math.min(RESTAURANT_MODIFIER_PRICE_MAX, Math.max(0, value))
                              : 0,
                          });
                        }}
                        data-testid="voice-ordering-modifier-price"
                      />
                    </label>
                  </div>
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
        <p className="text-xs text-warning-700" data-testid="voice-ordering-save-table-hint">
          {t('save.tableRequired')}
        </p>
      )}
      {cartItems.length === 0 && tableLabel.trim().length > 0 && (
        <p className="text-xs text-warning-700" data-testid="voice-ordering-save-empty-hint">
          {t('save.emptyCartHint')}
        </p>
      )}
    </section>
  );
}
