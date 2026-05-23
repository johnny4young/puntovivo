import { useDeferredValue, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { PlusCircle, Search } from 'lucide-react';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { trpc } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';
import type {
  Category,
  ProductSearchItem,
  ProductSearchSelection,
  ProductUnitAssignment,
  Provider,
} from '@/types';

interface ProductSearchDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (selection: ProductSearchSelection) => void;
  categories?: Category[];
  providers?: Provider[];
  initialQuery?: string;
  title?: string;
  confirmLabel?: string;
  /**
   * ENG-105c — when set, the dialog renders a "Crear nuevo producto"
   * CTA inside the empty-state block whenever the typed query returns
   * zero results. The caller owns:
   * - Whether the CTA is offered at all (omit the prop for surfaces
   *   that should not surface quick-create).
   * - The actual modal mounting (the dialog closes itself before
   *   firing the callback so the caller can swap dialogs cleanly).
   * The string handed to the callback is the trimmed search query
   * the cashier typed, used as the default name in the form modal.
   */
  onQuickCreateRequested?: (defaultName: string) => void;
  /**
   * ENG-105c — defense-in-depth role gate. When `false`, the
   * empty-state block renders an explanatory hint ("Pídele a un
   * manager...") instead of the CTA button. Defaults to `true` to
   * preserve backward compatibility — only callers wired to the
   * quick-create flow pass `false` for cashier sessions.
   */
  canCreateProducts?: boolean;
}

interface ProductSelectionState {
  productId: string;
  unitId: string;
}

function getDefaultUnit(product: ProductSearchItem | null): ProductUnitAssignment | null {
  if (!product?.unitAssignments?.length) {
    return null;
  }

  return product.unitAssignments.find(assignment => assignment.isBase) ?? product.unitAssignments[0] ?? null;
}

function getInitialSelection(product: ProductSearchItem): ProductSelectionState | null {
  const defaultUnit = getDefaultUnit(product);
  if (!defaultUnit) {
    return null;
  }

  return {
    productId: product.id,
    unitId: defaultUnit.unitId,
  };
}

export function ProductSearchDialog({
  isOpen,
  onClose,
  onSelect,
  categories = [],
  providers = [],
  initialQuery = '',
  title,
  confirmLabel,
  onQuickCreateRequested,
  canCreateProducts = true,
}: ProductSearchDialogProps) {
  const { t } = useTranslation('common');
  const categoryFilterId = useId();
  const providerFilterId = useId();
  const searchInputId = useId();
  const unitSelectId = 'product-search-unit-select';
  const [query, setQuery] = useState(initialQuery);
  const [categoryId, setCategoryId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [selection, setSelection] = useState<ProductSelectionState | null>(null);
  // ENG-134e — roving tabindex state for keyboard navigation across
  // the product rows. The active row carries tabindex=0; every other
  // row carries tabindex=-1 so Tab from the search input lands on the
  // active row (and Tab from the active row lands on the unit select
  // / Confirm footer). Arrow / Home / End / Enter wire below.
  //
  // `lastItemsKey` is a companion state used to detect "items
  // changed across renders" and reset the roving index back to the
  // first row — derived during render per the React 19 pattern for
  // resetting state on prop / data change, which avoids the lint
  // forbidding setState inside an effect.
  const [activeRowIndex, setActiveRowIndex] = useState(0);
  const [lastItemsKey, setLastItemsKey] = useState('');
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  const deferredQuery = useDeferredValue(query.trim());
  const deferredCategoryId = useDeferredValue(categoryId);
  const deferredProviderId = useDeferredValue(providerId);
  const searchEnabled = isOpen && deferredQuery.length > 0;

  const productsQuery = trpc.products.search.useQuery(
    {
      q: deferredQuery,
      limit: 25,
      categoryId: deferredCategoryId || undefined,
      providerId: deferredProviderId || undefined,
      isActive: true,
    },
    {
      enabled: searchEnabled,
    }
  );

  const items = (productsQuery.data?.items ?? []) as ProductSearchItem[];
  const itemsKey = items.map(product => product.id).join('\u0000');
  // ENG-134e — when a new search returns a different result set, the
  // roving tabindex must restart on the first row so a keyboard user
  // does not jump into a stale position (or worse, an index past
  // items.length-1 that focuses nothing). React 19 pattern: detect
  // the change during render and queue a same-render setState — no
  // useEffect cascade, no lint complaint. Guarded by an identity
  // signature so equal-length result replacements reset too.
  if (itemsKey !== lastItemsKey) {
    setLastItemsKey(itemsKey);
    setActiveRowIndex(0);
  }
  const selectedProduct = selection
    ? items.find(product => product.id === selection.productId) ?? null
    : null;
  const selectedUnit = selectedProduct?.unitAssignments?.find(
    assignment => assignment.unitId === selection?.unitId
  ) ?? getDefaultUnit(selectedProduct ?? null);
  const isSelectionValid = Boolean(selectedProduct && selectedUnit);

  const handleProductSelect = (product: ProductSearchItem) => {
    setSelection(getInitialSelection(product));
  };

  // ENG-134e — keyboard navigation handler for the roving tabindex.
  // Mirrors the CommandPalette contract (no wrap-around — last row
  // ArrowDown is a no-op, first row ArrowUp likewise) so muscle memory
  // is consistent across the renderer. Enter and Space both select
  // the active row, matching the existing mouse onClick semantics.
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
        const prev = Math.max(index - 1, 0);
        setActiveRowIndex(prev);
        rowRefs.current[prev]?.focus();
        return;
      }
      case 'Home': {
        event.preventDefault();
        setActiveRowIndex(0);
        rowRefs.current[0]?.focus();
        return;
      }
      case 'End': {
        event.preventDefault();
        const last = Math.max(items.length - 1, 0);
        setActiveRowIndex(last);
        rowRefs.current[last]?.focus();
        return;
      }
      case 'Enter':
      case ' ': {
        event.preventDefault();
        handleProductSelect(product);
        return;
      }
      // Default: let the event bubble. Alt+U (focus unit select) and
      // any other document-level shortcut from useSalesKeyboardShortcuts
      // continues to work because we only preventDefault for the keys
      // we handle here.
    }
  };

  const handleClose = () => {
    setQuery('');
    setCategoryId('');
    setProviderId('');
    setSelection(null);
    onClose();
  };

  const handleConfirm = () => {
    if (!selectedProduct || !selectedUnit) {
      return;
    }

    onSelect({
      product: selectedProduct,
      unit: selectedUnit,
      price: selectedUnit.price,
    });
    handleClose();
  };

  const isEmptyState = searchEnabled && !productsQuery.isLoading && items.length === 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={title ?? t('productSearch.search')}
      size="full"
      footerClassName="sm:justify-between"
      footer={
        <>
          <ModalButton onClick={handleClose} className="sm:min-w-[8.5rem]">
            {t('productSearch.cancel')}
          </ModalButton>
          <ModalButton
            variant="primary"
            onClick={handleConfirm}
            disabled={!isSelectionValid}
            className="sm:min-w-[11rem]"
          >
            {confirmLabel ?? t('productSearch.search')}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-5">
        <section className="card-inset p-4 sm:p-5">
          <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <label className="block">
              <span className="label" id={searchInputId}>
                {t('productSearch.search')}
              </span>
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-400" />
                <input
                  aria-labelledby={searchInputId}
                  className="input pl-10"
                  placeholder={t('productSearch.searchPlaceholder')}
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                />
              </div>
            </label>

            <label className="block" htmlFor={categoryFilterId}>
              <span className="label">{t('productSearch.category')}</span>
              <select
                id={categoryFilterId}
                className="input mt-1"
                value={categoryId}
                onChange={event => setCategoryId(event.target.value)}
              >
                <option value="">{t('productSearch.allCategories')}</option>
                {categories.map(category => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block" htmlFor={providerFilterId}>
              <span className="label">{t('productSearch.provider')}</span>
              <select
                id={providerFilterId}
                className="input mt-1"
                value={providerId}
                onChange={event => setProviderId(event.target.value)}
              >
                <option value="">{t('productSearch.allProviders')}</option>
                {providers.map(provider => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {!searchEnabled && (
          <div className="card-inset flex min-h-44 items-center justify-center px-6 py-10 text-center text-sm leading-6 text-secondary-500">
            {t('productSearch.enterTerm')}
          </div>
        )}

        {searchEnabled && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(19rem,0.95fr)]">
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
                    {productsQuery.isLoading && (
                      <tr>
                        <td className="px-4 py-6 text-sm text-secondary-500" colSpan={5}>
                          {t('productSearch.searching')}
                        </td>
                      </tr>
                    )}

                    {productsQuery.error && (
                      <tr>
                        <td className="px-4 py-6 text-sm text-danger-500" colSpan={5}>
                          {productsQuery.error.message}
                        </td>
                      </tr>
                    )}

                    {isEmptyState && (
                      <tr>
                        <td colSpan={5} className="px-4 py-6">
                          {/* ENG-105c — empty state block. When the
                            * caller wired `onQuickCreateRequested`,
                            * surfaces a CTA gated by `canCreateProducts`
                            * (typically manager/admin); cashiers see
                            * an explanatory hint instead. Surfaces
                            * without the prop keep the legacy text
                            * exactly. */}
                          {onQuickCreateRequested ? (
                            <div
                              className="flex flex-col items-start gap-3 text-sm"
                              data-testid="product-search-empty-state"
                            >
                              <div>
                                <p className="font-semibold text-secondary-900">
                                  {t('productSearch.quickCreate.emptyTitle', {
                                    query: deferredQuery,
                                  })}
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
                                  onClick={() => {
                                    const requested = deferredQuery;
                                    handleClose();
                                    onQuickCreateRequested(requested);
                                  }}
                                >
                                  <PlusCircle className="h-4 w-4" aria-hidden="true" />
                                  {t('productSearch.quickCreate.createCta')}
                                </button>
                              )}
                            </div>
                          ) : (
                            <p className="text-sm text-secondary-500">
                              {t('productSearch.noResults')}
                            </p>
                          )}
                        </td>
                      </tr>
                    )}

                    {!productsQuery.isLoading &&
                      !productsQuery.error &&
                      items.map((product, index) => {
                        const defaultUnit = getDefaultUnit(product);
                        const isSelected = selection?.productId === product.id;
                        // ENG-134e — roving tabindex: only the active
                        // row enters the Tab order. The Modal focus
                        // trap (which excludes `tabindex="-1"` by its
                        // query) skips inactive rows automatically.
                        const isActiveRow = index === activeRowIndex;

                        return (
                          <tr
                            key={product.id}
                            ref={el => {
                              rowRefs.current[index] = el;
                            }}
                            className="cursor-pointer focus:outline-none focus-visible:bg-primary-50/60 focus-visible:ring-2 focus-visible:ring-primary-500/60"
                            data-state={isSelected ? 'selected' : undefined}
                            tabIndex={isActiveRow ? 0 : -1}
                            aria-selected={isSelected}
                            data-testid={`product-search-row-${product.sku}`}
                            onClick={() => handleProductSelect(product)}
                            onFocus={() => setActiveRowIndex(index)}
                            onKeyDown={event => handleRowKeyDown(event, index, product)}
                          >
                            <td className="px-4 py-3 text-sm font-medium text-secondary-700">
                              {product.sku}
                            </td>
                            <td className="px-4 py-3">
                              <div>
                                <p className="text-sm font-medium text-secondary-900">{product.name}</p>
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

            <aside className="card-inset p-4 sm:p-5 xl:sticky xl:top-0">
              <h3 className="text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-secondary-500">
                {t('productSearch.selection')}
              </h3>

              {!selectedProduct || !selectedUnit ? (
                <p className="mt-5 text-sm leading-6 text-secondary-500">
                  {t('productSearch.chooseProduct')}
                </p>
              ) : (
                <div className="mt-5 space-y-4">
                  <div>
                    <p className="text-xl font-semibold text-secondary-950">{selectedProduct.name}</p>
                    <p className="mt-1 text-sm text-secondary-500">{selectedProduct.sku}</p>
                  </div>

                  <div className="grid gap-3">
                    <div>
                      <label className="label" htmlFor={unitSelectId}>
                        {t('productSearch.unit')}
                      </label>
                      <select
                        id={unitSelectId}
                        className="input mt-1"
                        value={selectedUnit.unitId}
                        onChange={event => {
                          if (!selectedProduct) {
                            return;
                          }

                          setSelection({
                            productId: selectedProduct.id,
                            unitId: event.target.value,
                          });
                        }}
                      >
                        {selectedProduct.unitAssignments?.map(assignment => (
                          <option key={assignment.unitId} value={assignment.unitId}>
                            {assignment.unitName ?? assignment.unitAbbreviation ?? assignment.unitId}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="rounded-[20px] border border-line/70 bg-surface/92 px-4 py-4">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-secondary-500">{t('productSearch.price')}</span>
                        <span className="font-medium text-secondary-900">
                          {formatCurrency(selectedUnit.price)}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span className="text-secondary-500">{t('productSearch.equivalence')}</span>
                        <span className="font-medium text-secondary-900">{selectedUnit.equivalence}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span className="text-secondary-500">{t('productSearch.availableStock')}</span>
                        <span className="font-medium text-secondary-900">{selectedProduct.stock}</span>
                      </div>
                      {selectedProduct.sellByFraction && (
                        <>
                          <div className="mt-2 flex items-center justify-between text-sm">
                            <span className="text-secondary-500">{t('productSearch.fractionStep')}</span>
                            <span className="font-medium text-secondary-900">
                              {selectedProduct.fractionStep ?? '—'}
                            </span>
                          </div>
                          <div className="mt-2 flex items-center justify-between text-sm">
                            <span className="text-secondary-500">{t('productSearch.fractionMinimum')}</span>
                            <span className="font-medium text-secondary-900">
                              {selectedProduct.fractionMinimum ?? '—'}
                            </span>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
    </Modal>
  );
}
