import { useDeferredValue, useId, useState } from 'react';
import { Search } from 'lucide-react';
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
  title = 'Search Products',
  confirmLabel = 'Select Product',
}: ProductSearchDialogProps) {
  const categoryFilterId = useId();
  const providerFilterId = useId();
  const searchInputId = useId();
  const unitSelectId = 'product-search-unit-select';
  const [query, setQuery] = useState(initialQuery);
  const [categoryId, setCategoryId] = useState('');
  const [providerId, setProviderId] = useState('');
  const [selection, setSelection] = useState<ProductSelectionState | null>(null);

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
      title={title}
      size="full"
      footer={
        <>
          <ModalButton onClick={handleClose}>Cancel</ModalButton>
          <ModalButton variant="primary" onClick={handleConfirm} disabled={!isSelectionValid}>
            {confirmLabel}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <label className="block">
            <span className="label" id={searchInputId}>
              Search
            </span>
            <div className="relative mt-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-400" />
              <input
                aria-labelledby={searchInputId}
                className="input pl-10"
                placeholder="Search by SKU, name, or barcode"
                value={query}
                onChange={event => setQuery(event.target.value)}
              />
            </div>
          </label>

          <label className="block" htmlFor={categoryFilterId}>
            <span className="label">Category</span>
            <select
              id={categoryFilterId}
              className="input mt-1"
              value={categoryId}
              onChange={event => setCategoryId(event.target.value)}
            >
              <option value="">All categories</option>
              {categories.map(category => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block" htmlFor={providerFilterId}>
            <span className="label">Provider</span>
            <select
              id={providerFilterId}
              className="input mt-1"
              value={providerId}
              onChange={event => setProviderId(event.target.value)}
            >
              <option value="">All providers</option>
              {providers.map(provider => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {!searchEnabled && (
          <div className="rounded-xl border border-dashed border-secondary-300 bg-secondary-50 px-4 py-8 text-center text-sm text-secondary-500">
            Enter a search term to find products.
          </div>
        )}

        {searchEnabled && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_320px]">
            <div className="overflow-hidden rounded-xl border border-secondary-200">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-secondary-200">
                  <thead className="bg-secondary-50">
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-secondary-500">
                      <th className="px-4 py-3">SKU</th>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Stock</th>
                      <th className="px-4 py-3">Price</th>
                      <th className="px-4 py-3">Unit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-secondary-200 bg-white">
                    {productsQuery.isLoading && (
                      <tr>
                        <td className="px-4 py-6 text-sm text-secondary-500" colSpan={5}>
                          Searching products...
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
                        <td className="px-4 py-6 text-sm text-secondary-500" colSpan={5}>
                          No products matched the current filters.
                        </td>
                      </tr>
                    )}

                    {!productsQuery.isLoading &&
                      !productsQuery.error &&
                      items.map(product => {
                        const defaultUnit = getDefaultUnit(product);
                        const isSelected = selection?.productId === product.id;

                        return (
                          <tr
                            key={product.id}
                            className={`cursor-pointer transition-colors ${
                              isSelected ? 'bg-primary-50' : 'hover:bg-secondary-50'
                            }`}
                            onClick={() => handleProductSelect(product)}
                          >
                            <td className="px-4 py-3 text-sm font-medium text-secondary-700">
                              {product.sku}
                            </td>
                            <td className="px-4 py-3">
                              <div>
                                <p className="text-sm font-medium text-secondary-900">{product.name}</p>
                                <p className="text-xs text-secondary-500">
                                  {product.categoryName ?? 'No category'}
                                  {' · '}
                                  {product.providerName ?? 'No provider'}
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

            <div className="rounded-xl border border-secondary-200 bg-secondary-50 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary-500">
                Selection
              </h3>

              {!selectedProduct || !selectedUnit ? (
                <p className="mt-4 text-sm text-secondary-500">
                  Choose a product row to confirm the unit and price.
                </p>
              ) : (
                <div className="mt-4 space-y-4">
                  <div>
                    <p className="text-lg font-semibold text-secondary-900">{selectedProduct.name}</p>
                    <p className="text-sm text-secondary-500">{selectedProduct.sku}</p>
                  </div>

                  <div className="grid gap-3">
                    <div>
                      <label className="label" htmlFor={unitSelectId}>
                        Unit
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

                    <div className="rounded-lg border border-secondary-200 bg-white px-3 py-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-secondary-500">Price</span>
                        <span className="font-medium text-secondary-900">
                          {formatCurrency(selectedUnit.price)}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span className="text-secondary-500">Equivalence</span>
                        <span className="font-medium text-secondary-900">{selectedUnit.equivalence}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-sm">
                        <span className="text-secondary-500">Available stock</span>
                        <span className="font-medium text-secondary-900">{selectedProduct.stock}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
