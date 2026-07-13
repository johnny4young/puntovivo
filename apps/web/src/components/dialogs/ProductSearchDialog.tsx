import { useDeferredValue, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { useDiscountSuggestions } from '@/features/sales/useDiscountSuggestions';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { trpc } from '@/lib/trpc';
import type { Category, ProductSearchItem, ProductSearchSelection, Provider } from '@/types';

import { ProductSearchFilters } from './ProductSearchFilters';
import { ProductSearchResults } from './ProductSearchResults';
import { ProductSearchSelectionPanel } from './ProductSearchSelectionPanel';
import {
  getDefaultProductUnit,
  getInitialProductSelection,
  type ProductSelectionState,
} from './productSearchSelection';

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
   * ENG-105c — opt-in quick-create CTA for empty results. The caller owns
   * whether it is offered and mounts the follow-up form after this dialog closes.
   */
  onQuickCreateRequested?: (defaultName: string) => void;
  /** ENG-199 — opt-in expiry-discount badges for the POS consumer only. */
  showDiscountSuggestions?: boolean;
  /** Active site for POS-only expiry suggestions. Other consumers omit it. */
  discountSuggestionSiteId?: string | null;
  /** ENG-105c — defense-in-depth role gate for the quick-create CTA. */
  canCreateProducts?: boolean;
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
  showDiscountSuggestions = false,
  discountSuggestionSiteId = null,
}: ProductSearchDialogProps) {
  const { t } = useTranslation('common');
  const categoryFilterId = useId();
  const providerFilterId = useId();
  const searchInputId = useId();
  const [query, setQuery] = useState(initialQuery);
  const [categoryId, setCategoryId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [selection, setSelection] = useState<ProductSelectionState | null>(null);

  // A real trailing debounce coalesces a burst into one products.search request;
  // useDeferredValue alone would still issue a request for each settled keystroke.
  const deferredQuery = useDebouncedValue(query.trim(), 200);
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
    { enabled: searchEnabled }
  );

  const items = (productsQuery.data?.items ?? []) as ProductSearchItem[];
  // ENG-199 — empty Map and no query unless the caller explicitly opts in.
  const discountSuggestions = useDiscountSuggestions(
    showDiscountSuggestions && isOpen,
    discountSuggestionSiteId
  );
  const selectedProduct = selection
    ? (items.find(product => product.id === selection.productId) ?? null)
    : null;
  const selectedUnit =
    selectedProduct?.unitAssignments?.find(assignment => assignment.unitId === selection?.unitId) ??
    getDefaultProductUnit(selectedProduct);
  const isSelectionValid = Boolean(selectedProduct && selectedUnit);
  const isEmptyState = searchEnabled && !productsQuery.isLoading && items.length === 0;

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

  const handleQuickCreate = () => {
    const requested = deferredQuery;
    handleClose();
    onQuickCreateRequested?.(requested);
  };

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
        <ProductSearchFilters
          query={query}
          categoryId={categoryId}
          providerId={providerId}
          categories={categories}
          providers={providers}
          searchInputId={searchInputId}
          categoryFilterId={categoryFilterId}
          providerFilterId={providerFilterId}
          onQueryChange={setQuery}
          onCategoryChange={setCategoryId}
          onProviderChange={setProviderId}
        />

        {!searchEnabled && (
          <div className="card-inset flex min-h-44 items-center justify-center px-6 py-10 text-center text-sm leading-6 text-secondary-500">
            {t('productSearch.enterTerm')}
          </div>
        )}

        {searchEnabled && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(19rem,0.95fr)]">
            <ProductSearchResults
              items={items}
              isLoading={productsQuery.isLoading}
              errorMessage={productsQuery.error?.message}
              isEmptyState={isEmptyState}
              query={deferredQuery}
              selectedProductId={selection?.productId}
              discountSuggestions={discountSuggestions}
              canCreateProducts={canCreateProducts}
              quickCreateAvailable={Boolean(onQuickCreateRequested)}
              onQuickCreate={handleQuickCreate}
              onProductSelect={product => setSelection(getInitialProductSelection(product))}
            />
            <ProductSearchSelectionPanel
              product={selectedProduct}
              unit={selectedUnit}
              onUnitChange={unitId => {
                if (selectedProduct) {
                  setSelection({ productId: selectedProduct.id, unitId });
                }
              }}
            />
          </div>
        )}
      </div>
    </Modal>
  );
}
