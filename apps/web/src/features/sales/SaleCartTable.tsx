import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePriceIncludesTax } from '@/features/pricing/PricingContext';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ariaKeyshortcutsFor, shortcutDisplayFor } from '@/lib/shortcuts';
import { formatCurrency } from '@/lib/utils';
import {
  getSaleMinimumQuantity,
  getSaleQuantityStep,
  type SaleCartItem,
} from '@/features/sales/saleCart';
import { getLineTotals } from '@/features/sales/saleCartTotals';
import { useDiscountSuggestions } from '@/features/sales/useDiscountSuggestions';
import { SaleSerialSelector } from '@/features/sales/SaleSerialSelector';
import { Button } from '@/components/ui';
interface SaleCartTableProps {
  items: SaleCartItem[];
  /** active site scopes the expiry-suggestion badge to this POS. */
  discountSuggestionSiteId?: string | null;
  selectedItemKey: string | null;
  onQuantityChange: (itemKey: string, quantity: number) => void;
  onDiscountChange: (itemKey: string, discount: number) => void;
  onRemove: (itemKey: string) => void;
  onSelectItem: (itemKey: string) => void;
  onSerialSelectionChange?:
    ((itemKey: string, serialIds: string[], siteId: string) => void) | undefined;
  quantityInputRefFor: (itemKey: string) => (node: HTMLInputElement | null) => void;
  discountInputRefFor: (itemKey: string) => (node: HTMLInputElement | null) => void;
  /** Freeze quantity, discount, add/remove terms while allowing serial selection. */
  itemsLocked?: boolean;
  /** Ticket-level actions (undo, clear) shown in the header row. */
  headerActions?: ReactNode;
}
export function SaleCartTable({
  items,
  discountSuggestionSiteId = null,
  selectedItemKey,
  onQuantityChange,
  onDiscountChange,
  onRemove,
  onSelectItem,
  onSerialSelectionChange = () => {},
  quantityInputRefFor,
  discountInputRefFor,
  itemsLocked = false,
  headerActions,
}: SaleCartTableProps) {
  const priceIncludesTax = usePriceIncludesTax();
  const { t } = useTranslation('sales');

  // expiry-radar badge on cart lines; the table only renders in
  // the POS, so the query is gated on having lines at all.
  const discountSuggestions = useDiscountSuggestions(
    items.length > 0 && !itemsLocked,
    discountSuggestionSiteId
  );

  // A scan selects its line; keep it in sight when the ticket is longer than its
  // column. Not on mount: a restored ticket must not move the page.
  const selectedLineRef = useRef<HTMLLIElement | null>(null);
  const shownSelectionRef = useRef(selectedItemKey);
  useEffect(() => {
    if (shownSelectionRef.current === selectedItemKey) return;
    shownSelectionRef.current = selectedItemKey;
    selectedLineRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedItemKey]);

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
    setInputDrafts(previous => ({
      ...previous,
      [draftId]: value,
    }));
  };
  const clearDraft = (draftId: string): void => {
    setInputDrafts(previous => {
      if (!(draftId in previous)) return previous;
      const next = {
        ...previous,
      };
      delete next[draftId];
      return next;
    });
  };

  if (items.length === 0) {
    return (
      <div>
        {headerActions && <div className="mb-2 flex justify-end gap-1">{headerActions}</div>}
        <div className="sales-empty-ticket" data-testid="sales-cart-empty">
          <p className="text-sm text-fg2">{t('cart.empty')}</p>
        </div>
      </div>
    );
  }
  return (
    <div>
      <div className="sales-ticket-head" data-testid="sales-ticket-head">
        <span aria-hidden="true">#</span>
        <span className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true">{t('cart.product')}</span>
          <span className="ml-auto flex items-center gap-1 whitespace-nowrap normal-case tracking-normal">
            {headerActions}
          </span>
        </span>
        <span className="text-center" aria-hidden="true">
          {t('sell.table.quantity')}
        </span>
        <span aria-hidden="true">{t('sell.table.unit')}</span>
        <span className="text-right" aria-hidden="true">
          {t('cart.price')}
        </span>
        <span className="text-right" aria-hidden="true">
          {t('cart.total')}
        </span>
        <span />
      </div>
      <ul aria-label={t('cart.items')}>
        {items.map((item, index) => {
          const lineTotals = getLineTotals(item, priceIncludesTax);
          const isSelected = selectedItemKey === item.key;
          const minimumQuantity = getSaleMinimumQuantity(item);
          const quantityStep = getSaleQuantityStep(item);
          const decrementDisabled = item.quantity - quantityStep < minimumQuantity;
          const serialSiteId = discountSuggestionSiteId ?? null;
          const selectedSerialIds =
            serialSiteId && item.serialSiteId === serialSiteId ? (item.serialIds ?? []) : [];
          const unavailableSerialIds = items
            .filter(
              otherItem => otherItem.key !== item.key && otherItem.serialSiteId === serialSiteId
            )
            .flatMap(otherItem => otherItem.serialIds ?? []);
          const suggestedDiscount = discountSuggestions.get(item.productId) ?? 0;
          return (
            <li
              key={item.key}
              data-testid={`sale-cart-item-${item.productSku}`}
              data-selected={isSelected}
              ref={isSelected ? selectedLineRef : undefined}
              className="sales-ticket-line"
            >
              <div className="sales-ticket-row">
                <span className="sales-ticket-index" aria-hidden="true">
                  {index + 1}
                </span>
                <button
                  type="button"
                  className="sales-ticket-name min-w-0 text-left"
                  aria-label={t('cart.selectItem', {
                    name: item.productName,
                  })}
                  onClick={() => onSelectItem(item.key)}
                >
                  <span className="line-clamp-2 text-base font-semibold leading-tight text-fg1">
                    {item.productName}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-fg3">
                    <span className="font-mono">{item.productSku}</span>
                    {item.tracksStock !== false && Number.isFinite(item.availableStock) && (
                      <span>
                        · {t('cart.stock')} {item.availableStock}
                      </span>
                    )}
                    {!isSelected && item.discount > 0 && (
                      <span
                        className="sales-tag bg-success-50 text-success-700"
                        data-testid={`cart-line-discount-${item.productSku}`}
                      >
                        {t('sell.table.lineDiscount', { pct: item.discount })}
                      </span>
                    )}
                    {suggestedDiscount > 0 && (
                      <span
                        className="sales-tag bg-warning-50 text-warning-700"
                        data-testid={`cart-discount-suggestion-${item.productSku}`}
                      >
                        {t('cart.discountSuggested', { pct: suggestedDiscount })}
                      </span>
                    )}
                  </span>
                </button>

                <div className="sales-ticket-qty">
                  <Button
                    type="button"
                    className="sales-stepper"
                    aria-label={t('cart.decrement', {
                      name: item.productName,
                    })}
                    disabled={itemsLocked || decrementDisabled}
                    onClick={() => {
                      onSelectItem(item.key);
                      onQuantityChange(
                        item.key,
                        Math.max(minimumQuantity, item.quantity - quantityStep)
                      );
                    }}
                    variant="ghost"
                    size="icon"
                  >
                    <Minus className="h-4 w-4" aria-hidden="true" />
                  </Button>

                  {/* The figure is the reading; the input keeps the ref for the
                   * quantity shortcut and direct edits. */}
                  <span className="relative inline-flex min-w-12 items-center justify-center">
                    <span className="font-numeric text-xl font-bold text-fg1" aria-hidden="true">
                      {item.quantity}
                    </span>
                    <input
                      ref={quantityInputRefFor(item.key)}
                      type="number"
                      min={minimumQuantity}
                      step={String(quantityStep)}
                      className="absolute inset-0 h-full w-full cursor-default border-0 bg-transparent text-center text-base font-semibold text-fg1 opacity-0 focus:opacity-100 focus:[appearance:textfield] focus-visible:opacity-100 focus-visible:rounded-md focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
                      aria-label={t('cart.qtyFor', {
                        name: item.productName,
                      })}
                      aria-keyshortcuts={
                        isSelected ? ariaKeyshortcutsFor('sales.focusQuantity') : undefined
                      }
                      value={draftValueFor(`q:${item.key}`, item.quantity)}
                      disabled={itemsLocked}
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

                  <Button
                    type="button"
                    aria-label={t('cart.increment', {
                      name: item.productName,
                    })}
                    className="sales-stepper"
                    onClick={() => {
                      onSelectItem(item.key);
                      onQuantityChange(item.key, item.quantity + quantityStep);
                    }}
                    variant="ghost"
                    size="icon"
                    disabled={itemsLocked}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>

                <span className="sales-ticket-unit">
                  <span className="sr-only">{t('sell.table.unit')} </span>
                  {item.unitName}
                </span>
                <span className="sales-ticket-price">
                  <span className="sr-only">{t('cart.price')} </span>
                  {formatCurrency(item.unitPrice)}
                </span>
                <span className="sales-ticket-total">
                  <span className="sr-only">{t('cart.lineTotal')} </span>
                  {formatCurrency(lineTotals.total)}
                </span>
                <span className="sales-ticket-remove">
                  {!itemsLocked && (
                    <button
                      type="button"
                      className="btn-ghost btn-icon h-11 w-11 text-danger-700"
                      aria-label={t('cart.removeItem', {
                        name: item.productName,
                      })}
                      aria-keyshortcuts={
                        isSelected ? ariaKeyshortcutsFor('sales.removeItem') : undefined
                      }
                      onClick={() => onRemove(item.key)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </span>
              </div>

              {item.tracksSerials && (
                <SaleSerialSelector
                  siteId={discountSuggestionSiteId ?? null}
                  productId={item.productId}
                  productName={item.productName}
                  requiredCount={lineTotals.normalizedQuantity}
                  selectedIds={selectedSerialIds}
                  unavailableIds={unavailableSerialIds}
                  onChange={serialIds => {
                    if (serialSiteId) {
                      onSerialSelectionChange(item.key, serialIds, serialSiteId);
                    }
                  }}
                />
              )}

              {/* Discount and base quantity open with the selected line. The input stays
               * mounted because the Alt+D shortcut focuses it through its ref. */}
              <div
                data-testid={`sale-cart-line-details-${item.productSku}`}
                hidden={!isSelected}
                className="sales-ticket-details"
              >
                <label className="flex flex-wrap items-center gap-2">
                  <span>{t('cart.discount')}</span>
                  {!itemsLocked && (
                    <kbd className="pv-kbd" aria-hidden="true">
                      {shortcutDisplayFor('sales.focusDiscount')}
                    </kbd>
                  )}
                  <input
                    ref={discountInputRefFor(item.key)}
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    className="input mt-0 h-9 w-16 px-2 py-1 text-center text-[13px]"
                    aria-label={t('cart.discountFor', {
                      name: item.productName,
                    })}
                    aria-keyshortcuts={
                      isSelected ? ariaKeyshortcutsFor('sales.focusDiscount') : undefined
                    }
                    value={draftValueFor(`d:${item.key}`, item.discount)}
                    disabled={itemsLocked}
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
                    {' · '}
                    {t('cart.tax')} {item.taxRate}%
                  </span>
                  {!itemsLocked && (
                    <span className="inline-flex items-center gap-1">
                      <kbd className="pv-kbd" aria-hidden="true">
                        {shortcutDisplayFor('sales.focusQuantity')}
                      </kbd>
                      {t('cart.shortcuts.quantity')}
                    </span>
                  )}
                </label>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
