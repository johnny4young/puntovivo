import { useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import type { Product } from '@/types';
import { calculatePricing } from './pricing';

type ProductRole = 'create' | 'edit';

export interface LookupOption {
  id: string;
  name: string;
}

export interface VatRateOption extends LookupOption {
  rate: number;
}

export interface ProductFormValues {
  name: string;
  sku: string;
  description: string;
  categoryId: string;
  providerId: string;
  vatRateId: string;
  locationId: string;
  barcode: string;
  imageUrl: string;
  cost: number;
  initialCost: number;
  price: number;
  price2: number;
  price3: number;
  marginPercent1: number;
  marginPercent2: number;
  marginPercent3: number;
  marginAmount1: number;
  marginAmount2: number;
  marginAmount3: number;
  taxRate: number;
  stock: number;
  minStock: number;
  isActive: boolean;
}

const defaultValues: ProductFormValues = {
  name: '',
  sku: '',
  description: '',
  categoryId: '',
  providerId: '',
  vatRateId: '',
  locationId: '',
  barcode: '',
  imageUrl: '',
  cost: 0,
  initialCost: 0,
  price: 0,
  price2: 0,
  price3: 0,
  marginPercent1: 0,
  marginPercent2: 0,
  marginPercent3: 0,
  marginAmount1: 0,
  marginAmount2: 0,
  marginAmount3: 0,
  taxRate: 0,
  stock: 0,
  minStock: 0,
  isActive: true,
};

export function mapProductToForm(product: Product | null): ProductFormValues {
  if (!product) {
    return defaultValues;
  }

  return {
    name: product.name,
    sku: product.sku,
    description: product.description ?? '',
    categoryId: product.categoryId ?? '',
    providerId: product.providerId ?? '',
    vatRateId: product.vatRateId ?? '',
    locationId: product.locationId ?? '',
    barcode: product.barcode ?? '',
    imageUrl: product.imageUrl ?? '',
    cost: product.cost,
    initialCost: product.initialCost,
    price: product.price,
    price2: product.price2,
    price3: product.price3,
    marginPercent1: product.marginPercent1,
    marginPercent2: product.marginPercent2,
    marginPercent3: product.marginPercent3,
    marginAmount1: product.marginAmount1,
    marginAmount2: product.marginAmount2,
    marginAmount3: product.marginAmount3,
    taxRate: product.taxRate,
    stock: product.stock,
    minStock: product.minStock,
    isActive: product.isActive,
  };
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

interface ProductFormModalProps {
  mode: ProductRole;
  isOpen: boolean;
  product: Product | null;
  categories: LookupOption[];
  providers: LookupOption[];
  vatRates: VatRateOption[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: ProductFormValues) => Promise<void>;
}

type PricingField = 'price' | 'price2' | 'price3';
type MarginPercentField = 'marginPercent1' | 'marginPercent2' | 'marginPercent3';
type MarginAmountField = 'marginAmount1' | 'marginAmount2' | 'marginAmount3';

export function ProductFormModal({
  mode,
  isOpen,
  product,
  categories,
  providers,
  vatRates,
  isSaving,
  error,
  onClose,
  onSubmit,
}: ProductFormModalProps) {
  const form = useForm<ProductFormValues>({
    defaultValues: mapProductToForm(product),
  });
  const [activeTab, setActiveTab] = useState<'general' | 'pricing'>('general');
  const handleSubmit = form.handleSubmit(onSubmit);
  const selectedVatRateId = form.watch('vatRateId');

  const syncTierFromPercent = (priceField: PricingField, percentField: MarginPercentField, amountField: MarginAmountField, value: number) => {
    const result = calculatePricing({
      cost: form.getValues('cost'),
      marginPercent: value,
    });

    form.setValue(priceField, result.price, { shouldDirty: true, shouldValidate: true });
    form.setValue(percentField, result.marginPercent, { shouldDirty: true, shouldValidate: true });
    form.setValue(amountField, result.marginAmount, { shouldDirty: true, shouldValidate: true });
  };

  const syncTierFromAmount = (priceField: PricingField, percentField: MarginPercentField, amountField: MarginAmountField, value: number) => {
    const result = calculatePricing({
      cost: form.getValues('cost'),
      marginAmount: value,
    });

    form.setValue(priceField, result.price, { shouldDirty: true, shouldValidate: true });
    form.setValue(percentField, result.marginPercent, { shouldDirty: true, shouldValidate: true });
    form.setValue(amountField, result.marginAmount, { shouldDirty: true, shouldValidate: true });
  };

  const syncTierFromPrice = (priceField: PricingField, percentField: MarginPercentField, amountField: MarginAmountField, value: number) => {
    const result = calculatePricing({
      cost: form.getValues('cost'),
      price: value,
    });

    form.setValue(priceField, result.price, { shouldDirty: true, shouldValidate: true });
    form.setValue(percentField, result.marginPercent, { shouldDirty: true, shouldValidate: true });
    form.setValue(amountField, result.marginAmount, { shouldDirty: true, shouldValidate: true });
  };

  const syncAllTiersFromCost = (cost: number) => {
    form.setValue('cost', cost, { shouldDirty: true, shouldValidate: true });

    const tiers: Array<[PricingField, MarginPercentField, MarginAmountField]> = [
      ['price', 'marginPercent1', 'marginAmount1'],
      ['price2', 'marginPercent2', 'marginAmount2'],
      ['price3', 'marginPercent3', 'marginAmount3'],
    ];

    for (const [priceField, percentField, amountField] of tiers) {
      const result = calculatePricing({
        cost,
        marginPercent: form.getValues(percentField),
      });

      form.setValue(priceField, result.price, { shouldDirty: true, shouldValidate: true });
      form.setValue(percentField, result.marginPercent, { shouldDirty: true, shouldValidate: true });
      form.setValue(amountField, result.marginAmount, { shouldDirty: true, shouldValidate: true });
    }
  };

  const costField = form.register('cost', { min: 0, valueAsNumber: true });
  const initialCostField = form.register('initialCost', { min: 0, valueAsNumber: true });
  const taxRateField = form.register('taxRate', { min: 0, max: 100, valueAsNumber: true });
  const stockField = form.register('stock', { min: 0, valueAsNumber: true });
  const minStockField = form.register('minStock', { min: 0, valueAsNumber: true });
  const vatRateField = form.register('vatRateId');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'create' ? 'Create Product' : 'Edit Product'}
      size="xl"
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            Cancel
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving...' : mode === 'create' ? 'Create Product' : 'Save Changes'}
          </ModalButton>
        </>
      }
    >
      <div className="mb-5 flex gap-2">
        <button
          type="button"
          className={`rounded-lg px-3 py-2 text-sm font-medium ${
            activeTab === 'general'
              ? 'bg-primary-100 text-primary-800'
              : 'bg-secondary-100 text-secondary-600'
          }`}
          onClick={() => setActiveTab('general')}
        >
          General
        </button>
        <button
          type="button"
          className={`rounded-lg px-3 py-2 text-sm font-medium ${
            activeTab === 'pricing'
              ? 'bg-primary-100 text-primary-800'
              : 'bg-secondary-100 text-secondary-600'
          }`}
          onClick={() => setActiveTab('pricing')}
        >
          Pricing
        </button>
      </div>

      <form className="space-y-5" onSubmit={handleSubmit}>
        {activeTab === 'general' && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="product-name" className="label">
                  Name
                </label>
                <input
                  id="product-name"
                  className="input mt-1"
                  {...form.register('name', { required: 'Product name is required' })}
                />
              </div>
              <div>
                <label htmlFor="product-sku" className="label">
                  SKU
                </label>
                <input
                  id="product-sku"
                  className="input mt-1"
                  {...form.register('sku', { required: 'SKU is required' })}
                />
              </div>
            </div>

            <div>
              <label htmlFor="product-description" className="label">
                Description
              </label>
              <textarea
                id="product-description"
                className="input mt-1 min-h-[88px]"
                {...form.register('description')}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="product-category" className="label">
                  Category
                </label>
                <select id="product-category" className="input mt-1" {...form.register('categoryId')}>
                  <option value="">No category</option>
                  {categories.map(category => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="product-provider" className="label">
                  Provider
                </label>
                <select id="product-provider" className="input mt-1" {...form.register('providerId')}>
                  <option value="">No provider</option>
                  {providers.map(provider => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="product-vat-rate" className="label">
                  VAT Rate
                </label>
                <select
                  id="product-vat-rate"
                  className="input mt-1"
                  {...vatRateField}
                  onChange={event => {
                    vatRateField.onChange(event);
                    const selected = vatRates.find(vatRate => vatRate.id === event.target.value);
                    form.setValue('taxRate', selected?.rate ?? 0, {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }}
                >
                  <option value="">Manual tax rate</option>
                  {vatRates.map(vatRate => (
                    <option key={vatRate.id} value={vatRate.id}>
                      {vatRate.name} ({vatRate.rate}%)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="product-tax-rate" className="label">
                  Tax Rate (%)
                </label>
                <input
                  id="product-tax-rate"
                  type="number"
                  step="0.01"
                  min="0"
                  className="input mt-1"
                  disabled={!!selectedVatRateId}
                  {...taxRateField}
                />
              </div>
              <div>
                <label htmlFor="product-location" className="label">
                  Location
                </label>
                <input id="product-location" className="input mt-1" {...form.register('locationId')} />
              </div>
              <div>
                <label htmlFor="product-barcode" className="label">
                  Barcode
                </label>
                <input id="product-barcode" className="input mt-1" {...form.register('barcode')} />
              </div>
              <div>
                <label htmlFor="product-stock" className="label">
                  Stock
                </label>
                <input
                  id="product-stock"
                  type="number"
                  min="0"
                  className="input mt-1"
                  {...stockField}
                />
              </div>
              <div>
                <label htmlFor="product-min-stock" className="label">
                  Min Stock
                </label>
                <input
                  id="product-min-stock"
                  type="number"
                  min="0"
                  className="input mt-1"
                  {...minStockField}
                />
              </div>
            </div>

            <div>
              <label htmlFor="product-image-url" className="label">
                Image URL
              </label>
              <input id="product-image-url" className="input mt-1" {...form.register('imageUrl')} />
            </div>

            <label className="flex items-center gap-3 text-sm text-secondary-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-secondary-300"
                {...form.register('isActive')}
              />
              Product is active
            </label>
          </>
        )}

        {activeTab === 'pricing' && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="product-cost" className="label">
                  Cost
                </label>
                <input
                  id="product-cost"
                  type="number"
                  step="0.01"
                  min="0"
                  className="input mt-1"
                  {...costField}
                  onChange={event => {
                    costField.onChange(event);
                    syncAllTiersFromCost(parseNumber(event.target.value));
                  }}
                />
              </div>
              <div>
                <label htmlFor="product-initial-cost" className="label">
                  Initial Cost
                </label>
                <input
                  id="product-initial-cost"
                  type="number"
                  step="0.01"
                  min="0"
                  className="input mt-1"
                  {...initialCostField}
                />
              </div>
            </div>

            <div className="space-y-4 rounded-xl border border-secondary-200 p-4">
              <PricingTierSection
                title="Price Tier 1"
                priceField={form.register('price', { min: 0, valueAsNumber: true })}
                percentField={form.register('marginPercent1', { min: 0, valueAsNumber: true })}
                amountField={form.register('marginAmount1', { min: 0, valueAsNumber: true })}
                onPriceChange={value => syncTierFromPrice('price', 'marginPercent1', 'marginAmount1', value)}
                onPercentChange={value =>
                  syncTierFromPercent('price', 'marginPercent1', 'marginAmount1', value)
                }
                onAmountChange={value =>
                  syncTierFromAmount('price', 'marginPercent1', 'marginAmount1', value)
                }
              />
              <PricingTierSection
                title="Price Tier 2"
                priceField={form.register('price2', { min: 0, valueAsNumber: true })}
                percentField={form.register('marginPercent2', { min: 0, valueAsNumber: true })}
                amountField={form.register('marginAmount2', { min: 0, valueAsNumber: true })}
                onPriceChange={value => syncTierFromPrice('price2', 'marginPercent2', 'marginAmount2', value)}
                onPercentChange={value =>
                  syncTierFromPercent('price2', 'marginPercent2', 'marginAmount2', value)
                }
                onAmountChange={value =>
                  syncTierFromAmount('price2', 'marginPercent2', 'marginAmount2', value)
                }
              />
              <PricingTierSection
                title="Price Tier 3"
                priceField={form.register('price3', { min: 0, valueAsNumber: true })}
                percentField={form.register('marginPercent3', { min: 0, valueAsNumber: true })}
                amountField={form.register('marginAmount3', { min: 0, valueAsNumber: true })}
                onPriceChange={value => syncTierFromPrice('price3', 'marginPercent3', 'marginAmount3', value)}
                onPercentChange={value =>
                  syncTierFromPercent('price3', 'marginPercent3', 'marginAmount3', value)
                }
                onAmountChange={value =>
                  syncTierFromAmount('price3', 'marginPercent3', 'marginAmount3', value)
                }
              />
            </div>
          </>
        )}

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}

interface PricingTierSectionProps {
  title: string;
  priceField: UseFormRegisterReturn<PricingField>;
  percentField: UseFormRegisterReturn<MarginPercentField>;
  amountField: UseFormRegisterReturn<MarginAmountField>;
  onPriceChange: (value: number) => void;
  onPercentChange: (value: number) => void;
  onAmountChange: (value: number) => void;
}

function PricingTierSection({
  title,
  priceField,
  percentField,
  amountField,
  onPriceChange,
  onPercentChange,
  onAmountChange,
}: PricingTierSectionProps) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="md:col-span-3">
        <p className="text-sm font-medium text-secondary-900">{title}</p>
      </div>
      <div>
        <label className="label">Margin %</label>
        <input
          type="number"
          step="0.01"
          min="0"
          className="input mt-1"
          {...percentField}
          onChange={event => {
            percentField.onChange(event);
            onPercentChange(parseNumber(event.target.value));
          }}
        />
      </div>
      <div>
        <label className="label">Margin Amount</label>
        <input
          type="number"
          step="0.01"
          min="0"
          className="input mt-1"
          {...amountField}
          onChange={event => {
            amountField.onChange(event);
            onAmountChange(parseNumber(event.target.value));
          }}
        />
      </div>
      <div>
        <label className="label">Sale Price</label>
        <input
          type="number"
          step="0.01"
          min="0"
          className="input mt-1"
          {...priceField}
          onChange={event => {
            priceField.onChange(event);
            onPriceChange(parseNumber(event.target.value));
          }}
        />
      </div>
    </div>
  );
}
