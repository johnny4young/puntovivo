import { useState } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/utils';
import {
  getLineTotals,
  getSaleMinimumQuantity,
  getSaleQuantityStep,
  type SaleCartItem,
} from '@/features/sales/saleCart';
import { useDiscountSuggestions } from '@/features/sales/useDiscountSuggestions';

interface SaleCartTableProps {
  items: SaleCartItem[];
  /** ENG-199 — active site scopes the expiry-suggestion badge to this POS. */
  discountSuggestionSiteId?: string | null;
  selectedItemKey: string | null;
  onQuantityChange: (itemKey: string, quantity: number) => void;
  onDiscountChange: (itemKey: string, discount: number) => void;
  onRemove: (itemKey: string) => void;
  onSelectItem: (itemKey: string) => void;
  quantityInputRefFor: (itemKey: string) => (node: HTMLInputElement | null) => void;
  discountInputRefFor: (itemKey: string) => (node: HTMLInputElement | null) => void;
}

export function SaleCartTable({
  items,
  discountSuggestionSiteId = null,
  selectedItemKey,
  onQuantityChange,
  onDiscountChange,
  onRemove,
  onSelectItem,
  quantityInputRefFor,
  discountInputRefFor,
}: SaleCartTableProps) {
  const { t } = useTranslation('sales');

  // ENG-199 — expiry-radar badge on cart lines; the table only renders in
  // the POS, so the query is gated on having lines at all.
  const discountSuggestions = useDiscountSuggestions(items.length > 0, discountSuggestionSiteId);

  // Borradores de edición por celda (`q:<key>` / `d:<key>`). Un input
  // controlado directo pisa la edición en curso: al vaciar el campo para
  // teclear "12", `Number('') || mínimo` lo devolvía a 1 antes de que el
  // cajero terminara. El borrador conserva el texto tal cual; los valores
  // válidos se comprometen en vivo y el blur/Enter resuelve el resto
  // (revertir si quedó vacío o no parsea).
  const [inputDrafts, setInputDrafts] = useState<Record<string, string>>({});
  const draftValueFor = (draftId: string, committed: number): string =>
    inputDrafts[draftId] ?? String(committed);
  const setDraft = (draftId: string, value: string): void => {
    setInputDrafts(previous => ({ ...previous, [draftId]: value }));
  };
  const clearDraft = (draftId: string): void => {
    setInputDrafts(previous => {
      if (!(draftId in previous)) return previous;
      const next = { ...previous };
      delete next[draftId];
      return next;
    });
  };

  // §06 — el carrito vacío guía con copy + pista de atajos, no con un cuadro
  // en blanco. La misma pista se repite al pie de la lista cuando hay ítems.
  const shortcutsHint = (
    <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg3">
      <span>{t('cart.shortcuts.label')}</span>
      <span className="inline-flex items-center gap-1">
        <kbd className="pv-kbd">Alt+P</kbd>
        <span>{t('cart.shortcuts.search')}</span>
      </span>
      <span aria-hidden="true">·</span>
      <span className="inline-flex items-center gap-1">
        <kbd className="pv-kbd">Alt+C</kbd>
        <span>{t('cart.shortcuts.quantity')}</span>
      </span>
      <span aria-hidden="true">·</span>
      <span className="inline-flex items-center gap-1">
        <kbd className="pv-kbd">Alt+D</kbd>
        <span>{t('cart.shortcuts.discount')}</span>
      </span>
    </p>
  );

  if (items.length === 0) {
    return (
      <div className="rounded-[18px] border border-dashed border-line-strong bg-surface-2/55 px-5 py-10 text-center">
        <p className="text-sm text-secondary-600">{t('cart.empty')}</p>
        <div className="text-left">{shortcutsHint}</div>
      </div>
    );
  }

  return (
    <div>
      <ul className="flex flex-col gap-[10px]" aria-label={t('cart.items')}>
        {items.map(item => {
          const lineTotals = getLineTotals(item);
          const isSelected = selectedItemKey === item.key;
          const minimumQuantity = getSaleMinimumQuantity(item);
          const quantityStep = getSaleQuantityStep(item);
          const decrementDisabled = item.quantity - quantityStep < minimumQuantity;

          return (
            <li
              key={item.key}
              data-testid={`sale-cart-item-${item.productSku}`}
              className={[
                'rounded-[14px] border bg-card p-3 transition-colors',
                isSelected ? 'border-primary-300 ring-1 ring-primary-200/70' : 'border-line/70',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left"
                  aria-label={t('cart.selectItem', { name: item.productName })}
                  onClick={() => onSelectItem(item.key)}
                >
                  <span className="flex items-center gap-2 text-[13.5px] font-semibold text-fg1">
                    <span className="truncate">{item.productName}</span>
                    {(discountSuggestions.get(item.productId) ?? 0) > 0 && (
                      <span
                        className="pv-badge warning shrink-0"
                        data-testid={`cart-discount-suggestion-${item.productSku}`}
                      >
                        {t('cart.discountSuggested', {
                          pct: discountSuggestions.get(item.productId),
                        })}
                      </span>
                    )}
                  </span>
                  <span className="mono mt-0.5 block text-[11px] text-secondary-500">
                    {item.productSku}
                    {' · '}
                    {t('cart.tax')} {item.taxRate}%
                  </span>
                  <span className="mono mt-0.5 block text-[11px] text-secondary-500">
                    {t('cart.stock')} {item.availableStock}
                  </span>
                </button>

                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    className="pv-btn outline min-h-11 h-11 w-11 p-0 disabled:cursor-not-allowed disabled:opacity-45"
                    aria-label={t('cart.decrement', { name: item.productName })}
                    disabled={decrementDisabled}
                    onClick={() => {
                      onSelectItem(item.key);
                      onQuantityChange(
                        item.key,
                        Math.max(minimumQuantity, item.quantity - quantityStep)
                      );
                    }}
                  >
                    <Minus className="h-4 w-4" aria-hidden="true" />
                  </button>

                  {/* La cifra de cantidad es la lectura táctil; el input
                   * mantiene el ref para el atajo Alt+C y la edición directa
                   * sin romper el contrato con useSalesInputFocus. */}
                  <span className="relative inline-flex w-6 items-center justify-center">
                    <span className="mono text-[15px] font-semibold text-fg1" aria-hidden="true">
                      {item.quantity}
                    </span>
                    <input
                      ref={quantityInputRefFor(item.key)}
                      type="number"
                      min={minimumQuantity}
                      step={String(quantityStep)}
                      className="absolute inset-0 h-full w-full cursor-default border-0 bg-transparent text-center text-[15px] font-semibold text-fg1 opacity-0 focus:opacity-100 focus:[appearance:textfield] focus-visible:opacity-100 focus-visible:rounded-md focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                      aria-label={t('cart.qtyFor', { name: item.productName })}
                      value={draftValueFor(`q:${item.key}`, item.quantity)}
                      onFocus={() => onSelectItem(item.key)}
                      onChange={event => {
                        const raw = event.target.value;
                        setDraft(`q:${item.key}`, raw);
                        const parsed = Number(raw);
                        if (raw !== '' && Number.isFinite(parsed) && parsed >= minimumQuantity) {
                          onQuantityChange(item.key, parsed);
                        }
                      }}
                      onBlur={() => {
                        const raw = inputDrafts[`q:${item.key}`];
                        clearDraft(`q:${item.key}`);
                        if (raw === undefined || raw === '') return;
                        const parsed = Number(raw);
                        if (!Number.isFinite(parsed)) return;
                        onQuantityChange(item.key, Math.max(minimumQuantity, parsed));
                      }}
                      onKeyDown={event => {
                        if (event.key === 'Enter') event.currentTarget.blur();
                      }}
                    />
                  </span>

                  <button
                    type="button"
                    className="pv-btn outline min-h-11 h-11 w-11 p-0"
                    aria-label={t('cart.increment', { name: item.productName })}
                    onClick={() => {
                      onSelectItem(item.key);
                      onQuantityChange(item.key, item.quantity + quantityStep);
                    }}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </button>

                  <span className="mono w-[78px] text-right text-[14px] font-semibold text-fg1">
                    {formatCurrency(lineTotals.total)}
                  </span>
                </div>
              </div>

              {/* Descuento + base + eliminar: controles secundarios, fuera de
               * la fila táctil principal. El input conserva el ref para Alt+D
               * y el handler onDiscountChange intactos. */}
              <div className="mt-2 flex items-center justify-between gap-3 border-t border-line/55 pt-2 text-[11px] text-secondary-500">
                <label className="flex items-center gap-2">
                  <span>{t('cart.discount')}</span>
                  <input
                    ref={discountInputRefFor(item.key)}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="input mt-0 h-9 w-16 px-2 py-1 text-center text-[13px]"
                    aria-label={t('cart.discountFor', { name: item.productName })}
                    value={draftValueFor(`d:${item.key}`, item.discount)}
                    onFocus={() => onSelectItem(item.key)}
                    onChange={event => {
                      const raw = event.target.value;
                      setDraft(`d:${item.key}`, raw);
                      const parsed = Number(raw);
                      if (raw !== '' && Number.isFinite(parsed)) {
                        onDiscountChange(item.key, Math.min(100, Math.max(0, parsed)));
                      }
                    }}
                    onBlur={() => {
                      const raw = inputDrafts[`d:${item.key}`];
                      clearDraft(`d:${item.key}`);
                      if (raw === undefined || raw === '') return;
                      const parsed = Number(raw);
                      if (!Number.isFinite(parsed)) return;
                      onDiscountChange(item.key, Math.min(100, Math.max(0, parsed)));
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Enter') event.currentTarget.blur();
                    }}
                  />
                  <span className="mono text-fg2">
                    {t('cart.baseQty')} {lineTotals.normalizedQuantity}
                  </span>
                </label>

                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1">
                    <span>{t('cart.lineTotal')}</span>
                    <span className="mono">{formatCurrency(lineTotals.total)}</span>
                  </span>
                  <button
                    type="button"
                    className="btn-ghost btn-icon h-9 w-9 text-danger-500 hover:text-danger-700"
                    aria-label={t('cart.removeItem', { name: item.productName })}
                    onClick={() => onRemove(item.key)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {shortcutsHint}
    </div>
  );
}
