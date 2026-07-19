/** ENG-178 — Search-result table and keyboard navigation for ProductSearchDialog. */
import { useRef, useState, type KeyboardEvent } from 'react';
import { PlusCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { formatCurrency } from '@/lib/utils';
import type { ProductSearchItem } from '@/types';

import { getDefaultProductUnit } from './productSearchSelection';

interface ProductSearchResultsProps {
  items: readonly ProductSearchItem[];
  isLoading: boolean;
  errorMessage: string | undefined;
  isEmptyState: boolean;
  query: string;
  selectedProductId: string | undefined;
  discountSuggestions: ReadonlyMap<string, number>;
  canCreateProducts: boolean;
  quickCreateAvailable: boolean;
  onQuickCreate: () => void;
  onProductSelect: (product: ProductSearchItem) => void;
}

export function ProductSearchResults({
  items,
  isLoading,
  errorMessage,
  isEmptyState,
  query,
  selectedProductId,
  discountSuggestions,
  canCreateProducts,
  quickCreateAvailable,
  onQuickCreate,
  onProductSelect,
}: ProductSearchResultsProps) {
  const { t } = useTranslation('common');
  // ENG-134e — roving tabindex state for keyboard navigation across
  // product rows. Identity changes reset the active row during render,
  // following the React 19 derived-state pattern used by the original dialog.
  const [activeRowIndex, setActiveRowIndex] = useState(0);
  const [lastItemsKey, setLastItemsKey] = useState('');
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const itemsKey = items.map(product => product.id).join('\u0000');

  if (itemsKey !== lastItemsKey) {
    setLastItemsKey(itemsKey);
    setActiveRowIndex(0);
  }

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLTableRowElement>,
    index: number,
    product: ProductSearchItem
  ) => {
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        const next = Math.min(index + 1, items.length - 1);
        setActiveRowIndex(next);
        rowRefs.current[next]?.focus();
        return;
      }
      case 'ArrowUp': {
        event.preventDefault();
        const previous = Math.max(index - 1, 0);
        setActiveRowIndex(previous);
        rowRefs.current[previous]?.focus();
        return;
      }
      case 'Home':
        event.preventDefault();
        setActiveRowIndex(0);
        rowRefs.current[0]?.focus();
        return;
      case 'End': {
        event.preventDefault();
        const last = Math.max(items.length - 1, 0);
        setActiveRowIndex(last);
        rowRefs.current[last]?.focus();
        return;
      }
      case 'Enter':
      case ' ':
        event.preventDefault();
        onProductSelect(product);
        return;
      // Other keys keep bubbling to document-level sales shortcuts.
    }
  };

  return (
    <div className="card-inset overflow-hidden">
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>{t('productSearch.sku')}</th>
              <th>{t('productSearch.name')}</th>
              <th>{t('productSearch.stock')}</th>
              <th>{t('productSearch.price')}</th>
              <th>{t('productSearch.unit')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td className="px-4 py-6 text-sm text-secondary-500" colSpan={5}>
                  {t('productSearch.searching')}
                </td>
              </tr>
            )}

            {errorMessage && (
              <tr>
                <td className="px-4 py-6 text-sm text-danger-500" colSpan={5}>
                  {errorMessage}
                </td>
              </tr>
            )}

            {isEmptyState && (
              <tr>
                <td colSpan={5} className="px-4 py-6">
                  {/* ENG-105c — preserve the role-gated quick-create state. */}
                  {quickCreateAvailable ? (
                    <div
                      className="flex flex-col items-start gap-3 text-sm"
                      data-testid="product-search-empty-state"
                    >
                      <div>
                        <p className="font-semibold text-secondary-900">
                          {t('productSearch.quickCreate.emptyTitle', { query })}
                        </p>
                        <p className="mt-1 text-secondary-500">
                          {canCreateProducts
                            ? t('productSearch.quickCreate.adminHint')
                            : t('productSearch.quickCreate.cashierHint')}
                        </p>
                      </div>
                      {canCreateProducts && (
                        <button
                          type="button"
                          className="btn-outline inline-flex items-center gap-2"
                          data-testid="product-search-quick-create-cta"
                          onClick={onQuickCreate}
                        >
                          <PlusCircle className="h-4 w-4" aria-hidden="true" />
                          {t('productSearch.quickCreate.createCta')}
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-secondary-500">{t('productSearch.noResults')}</p>
                  )}
                </td>
              </tr>
            )}

            {!isLoading &&
              !errorMessage &&
              items.map((product, index) => {
                const defaultUnit = getDefaultProductUnit(product);
                const isSelected = selectedProductId === product.id;
                const isActiveRow = index === activeRowIndex;

                return (
                  <tr
                    key={product.id}
                    ref={element => {
                      rowRefs.current[index] = element;
                    }}
                    className="cursor-pointer focus:outline-none focus-visible:bg-primary-50/60 focus-visible:ring-2 focus-visible:ring-primary-500/60"
                    data-state={isSelected ? 'selected' : undefined}
                    tabIndex={isActiveRow ? 0 : -1}
                    aria-selected={isSelected}
                    data-testid={`product-search-row-${product.sku}`}
                    onClick={() => onProductSelect(product)}
                    onFocus={() => setActiveRowIndex(index)}
                    onKeyDown={event => handleRowKeyDown(event, index, product)}
                  >
                    <td className="px-4 py-3 text-sm font-medium text-secondary-700">
                      {product.sku}
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="flex items-center gap-2 text-sm font-medium text-secondary-900">
                          {product.name}
                          {(discountSuggestions.get(product.id) ?? 0) > 0 && (
                            <span
                              className="pv-badge warning"
                              data-testid={`product-discount-suggestion-${product.sku}`}
                            >
                              {t('productSearch.discountSuggested', {
                                pct: discountSuggestions.get(product.id),
                              })}
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-secondary-500">
                          {product.categoryName ?? t('productSearch.noCategory')}
                          {' · '}
                          {product.providerName ?? t('productSearch.noProvider')}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-secondary-700">{product.stock}</td>
                    <td className="px-4 py-3 text-sm text-secondary-700">
                      {formatCurrency(defaultUnit?.price ?? product.baseUnitPrice ?? product.price)}
                    </td>
                    <td className="px-4 py-3 text-sm text-secondary-700">
                      {defaultUnit?.unitAbbreviation ?? product.baseUnitAbbreviation ?? 'UND'}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
