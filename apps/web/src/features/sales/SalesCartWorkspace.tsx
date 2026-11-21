import { type ComponentProps, type ReactNode } from 'react';
import { ListX, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SaleCartTable } from '@/features/sales/SaleCartTable';
import type { SaleCartItem } from '@/features/sales/saleCart';
import type { PharmacyLineHint } from '@/features/sales/pharmacyRegister';
import { ariaKeyshortcutsFor, shortcutDisplayFor } from '@/lib/shortcuts';

interface SalesCartWorkspaceProps {
  items: SaleCartItem[];
  /** active POS site for the cart's suggestion badges. */
  discountSuggestionSiteId?: string | null;
  pharmacyLines?: ReadonlyMap<string, PharmacyLineHint> | undefined;
  onUnitChange?: ComponentProps<typeof SaleCartTable>['onUnitChange'];
  priceTier?: ComponentProps<typeof SaleCartTable>['priceTier'];
  selectedItemKey: string | null;
  saleError: string | null;
  onQuantityChange: (itemKey: string, quantity: number) => void;
  onDiscountChange: (itemKey: string, discount: number) => void;
  onRemove: (itemKey: string) => void;
  onSelectItem: (itemKey: string | null) => void;
  onSerialSelectionChange?:
    ((itemKey: string, serialIds: string[], siteId: string) => void) | undefined;
  onClearCart: () => void;
  quantityInputRefFor: (itemKey: string) => (node: HTMLInputElement | null) => void;
  discountInputRefFor: (itemKey: string) => (node: HTMLInputElement | null) => void;
  /** True when the ticket has an undoable edit and is not locked. */
  canUndo?: boolean;
  /** Hidden when omitted; the last-read banner owns undo while it shows a read. */
  onUndo?: (() => void) | undefined;
  /** Disable commercial line edits while preserving serial fulfilment. */
  itemsLocked?: boolean;
  /** The scan / search command input, above the ticket. */
  searchBar?: ReactNode;
  /** The last-read slot between the command input and the ticket. */
  banner?: ReactNode;
  /** One-touch products, pinned under the ticket. */
  quickAccess?: ReactNode;
  /** Phones put the keys between the search and the ticket. */
  quickAccessFirst?: boolean;
  /** The customer's account, right under the lines it would add to. */
  account?: ReactNode;
}

export function SalesCartWorkspace({
  items,
  discountSuggestionSiteId = null,
  pharmacyLines,
  onUnitChange,
  priceTier,
  selectedItemKey,
  saleError,
  onQuantityChange,
  onDiscountChange,
  onRemove,
  onSelectItem,
  onSerialSelectionChange = () => {},
  onClearCart,
  quantityInputRefFor,
  discountInputRefFor,
  canUndo = false,
  onUndo,
  itemsLocked = false,
  searchBar,
  banner,
  quickAccess,
  quickAccessFirst = false,
  account,
}: SalesCartWorkspaceProps) {
  const { t } = useTranslation('sales');
  // Unusable actions stay out of the row: a disabled key fails contrast and
  // the shortcut still works from the document handler.
  const showUndo = !!onUndo && canUndo;
  const showClear = items.length > 0 && !itemsLocked;
  const headerActions =
    showUndo || showClear ? (
      <>
        {showUndo && (
          <button
            type="button"
            className="btn-ghost min-h-9 gap-1.5 px-2 py-1 text-xs"
            onClick={onUndo}
            aria-label={t('undo.button.label')}
            aria-keyshortcuts={ariaKeyshortcutsFor('sales.undo')}
            data-testid="sales-cart-undo"
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sales-head-action-label">{t('undo.button.label')}</span>
            <kbd className="pv-kbd sales-head-action-label" aria-hidden="true">
              {shortcutDisplayFor('sales.undo')}
            </kbd>
          </button>
        )}
        {showClear && (
          <button
            type="button"
            className="btn-ghost min-h-9 gap-1.5 px-2 py-1 text-xs"
            onClick={onClearCart}
            aria-label={t('checkout.clearCart')}
            data-testid="sales-cart-clear"
          >
            <ListX className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sales-head-action-label">{t('checkout.clearCart')}</span>
          </button>
        )}
      </>
    ) : undefined;

  return (
    // At `pos:` the column is bounded: the ticket scrolls inside it while the
    // command input, the last read and the one-touch keys stay put.
    <div className="sales-ticket-column flex flex-col gap-3 lg:min-w-0 pos:h-full pos:min-h-0">
      {searchBar}
      {banner && <div className="sales-banner-slot">{banner}</div>}
      {quickAccessFirst && quickAccess}

      <section
        className="pos:min-h-0 pos:flex-1 pos:overflow-y-auto"
        aria-labelledby="sales-ticket-title"
      >
        <h2 id="sales-ticket-title" className="sr-only">
          {t('checkout.activeTicket')}
        </h2>
        <SaleCartTable
          items={items}
          discountSuggestionSiteId={discountSuggestionSiteId}
          pharmacyLines={pharmacyLines}
          selectedItemKey={selectedItemKey}
          onQuantityChange={onQuantityChange}
          onDiscountChange={onDiscountChange}
          onRemove={onRemove}
          onSelectItem={itemKey => onSelectItem(itemKey)}
          onSerialSelectionChange={onSerialSelectionChange}
          onUnitChange={onUnitChange}
          priceTier={priceTier}
          quantityInputRefFor={quantityInputRefFor}
          discountInputRefFor={discountInputRefFor}
          itemsLocked={itemsLocked}
          headerActions={headerActions}
        />
      </section>

      {account && <div className="lg:shrink-0">{account}</div>}

      {saleError && (
        <div
          className="rounded-xl border border-danger-500/40 bg-danger-50 px-4 py-3 text-sm text-danger-700 lg:shrink-0"
          role="alert"
        >
          {saleError}
        </div>
      )}

      {!quickAccessFirst && quickAccess}
    </div>
  );
}
