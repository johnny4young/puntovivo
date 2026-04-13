import { useState } from 'react';
import {
  useFieldArray,
  useForm,
  type UseFieldArrayReturn,
  type UseFormReturn,
  type UseFormRegisterReturn,
} from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import type { Product } from '@/types';
import { calculatePricing } from './pricing';
import { normalizeProductProviderSelections } from './providerState';

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
  unitAssignments: ProductUnitAssignmentFormValues[];
  providerAssignments: ProductProviderAssignmentFormValues[];
}

export interface ProductUnitAssignmentFormValues {
  unitId: string;
  equivalence: number;
  price: number;
  isBase: boolean;
}

export interface ProductProviderAssignmentFormValues {
  providerId: string;
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
  unitAssignments: [{ unitId: '', equivalence: 1, price: 0, isBase: true }],
  providerAssignments: [],
};

export function mapProductToForm(product: Product | null): ProductFormValues {
  if (!product) {
    return defaultValues;
  }

  const normalizedProviders = normalizeProductProviderSelections(product);

  return {
    name: product.name,
    sku: product.sku,
    description: product.description ?? '',
    categoryId: product.categoryId ?? '',
    providerId: normalizedProviders.primaryProviderId ?? '',
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
    unitAssignments:
      product.unitAssignments?.length
        ? product.unitAssignments.map(assignment => ({
            unitId: assignment.unitId,
            equivalence: assignment.equivalence,
            price: assignment.price,
            isBase: assignment.isBase,
          }))
        : [{ unitId: '', equivalence: 1, price: product.price, isBase: true }],
    providerAssignments: normalizedProviders.providerAssignments,
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
  locations: LookupOption[];
  providers: LookupOption[];
  units: LookupOption[];
  vatRates: VatRateOption[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: ProductFormValues) => Promise<void>;
}

type PricingField = 'price' | 'price2' | 'price3';
type MarginPercentField = 'marginPercent1' | 'marginPercent2' | 'marginPercent3';
type MarginAmountField = 'marginAmount1' | 'marginAmount2' | 'marginAmount3';
type ProductFormTab = 'general' | 'pricing' | 'units' | 'providers';

export function ProductFormModal({
  mode,
  isOpen,
  product,
  categories,
  locations,
  providers,
  units,
  vatRates,
  isSaving,
  error,
  onClose,
  onSubmit,
}: ProductFormModalProps) {
  const { t } = useTranslation('products');
  const form = useForm<ProductFormValues>({
    defaultValues: mapProductToForm(product),
  });
  const [activeTab, setActiveTab] = useState<ProductFormTab>('general');
  const handleSubmit = form.handleSubmit(onSubmit);
  const selectedVatRateId = form.watch('vatRateId');
  const unitAssignmentsFieldArray = useFieldArray({
    control: form.control,
    name: 'unitAssignments',
  });
  const providerAssignmentsFieldArray = useFieldArray({
    control: form.control,
    name: 'providerAssignments',
  });

  const PRODUCT_FORM_TABS: Array<{ id: ProductFormTab; label: string }> = [
    { id: 'general', label: t('form.tabs.general') },
    { id: 'pricing', label: t('form.tabs.pricing') },
    { id: 'units', label: t('form.tabs.units') },
    { id: 'providers', label: t('form.tabs.providers') },
  ];

  const validateProviderAssignment = (providerId: string, index: number) => {
    if (!providerId) {
      return t('form.providerAssignments.providerRequired');
    }

    const duplicateIndex = form
      .getValues('providerAssignments')
      .findIndex(
        (assignment, assignmentIndex) =>
          assignmentIndex !== index && assignment.providerId === providerId
      );

    return duplicateIndex === -1 || t('form.providerAssignments.providerDuplicate');
  };

  type PricingInput = { marginPercent: number } | { marginAmount: number } | { price: number };

  const syncTier = (
    priceField: PricingField,
    percentField: MarginPercentField,
    amountField: MarginAmountField,
    pricingInput: PricingInput
  ) => {
    const result = calculatePricing({ cost: form.getValues('cost'), ...pricingInput });
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

  const handleBaseUnitChange = (index: number) => {
    const assignments = form.getValues('unitAssignments');
    assignments.forEach((_, assignmentIndex) => {
      form.setValue(`unitAssignments.${assignmentIndex}.isBase`, assignmentIndex === index, {
        shouldDirty: true,
        shouldValidate: true,
      });
    });
    form.setValue(`unitAssignments.${index}.equivalence`, 1, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={mode === 'create' ? t('form.createTitle') : t('form.editTitle')}
      size="xl"
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('form.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? t('form.submitting') : mode === 'create' ? t('form.create') : t('form.save')}
          </ModalButton>
        </>
      }
    >
      <div className="mb-5 flex gap-2">
        {PRODUCT_FORM_TABS.map(tab => (
          <button
            key={tab.id}
            type="button"
            className={`rounded-lg px-3 py-2 text-sm font-medium ${
              activeTab === tab.id
                ? 'bg-primary-100 text-primary-800'
                : 'bg-secondary-100 text-secondary-600'
            }`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <form className="space-y-5" onSubmit={handleSubmit}>
        {activeTab === 'general' && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="product-name" className="label">
                  {t('form.fields.name')}
                </label>
                <input
                  id="product-name"
                  className="input mt-1"
                  {...form.register('name', { required: t('form.fields.nameRequired') })}
                />
              </div>
              <div>
                <label htmlFor="product-sku" className="label">
                  {t('form.fields.sku')}
                </label>
                <input
                  id="product-sku"
                  className="input mt-1"
                  {...form.register('sku', { required: t('form.fields.skuRequired') })}
                />
              </div>
            </div>

            <div>
              <label htmlFor="product-description" className="label">
                {t('form.fields.description')}
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
                  {t('form.fields.category')}
                </label>
                <select id="product-category" className="input mt-1" {...form.register('categoryId')}>
                  <option value="">{t('form.fields.noCategory')}</option>
                  {categories.map(category => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="product-provider" className="label">
                  {t('form.fields.provider')}
                </label>
                <select id="product-provider" className="input mt-1" {...form.register('providerId')}>
                  <option value="">{t('form.fields.noProvider')}</option>
                  {providers.map(provider => (
                    <option key={provider.id} value={provider.id}>
                      {provider.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="product-vat-rate" className="label">
                  {t('form.fields.vatRate')}
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
                  <option value="">{t('form.fields.manualTaxRate')}</option>
                  {vatRates.map(vatRate => (
                    <option key={vatRate.id} value={vatRate.id}>
                      {vatRate.name} ({vatRate.rate}%)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="product-tax-rate" className="label">
                  {t('form.fields.taxRate')}
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
                  {t('form.fields.location')}
                </label>
                <select id="product-location" className="input mt-1" {...form.register('locationId')}>
                  <option value="">{t('form.fields.noLocation')}</option>
                  {locations.map(location => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="product-barcode" className="label">
                  {t('form.fields.barcode')}
                </label>
                <input id="product-barcode" className="input mt-1" {...form.register('barcode')} />
              </div>
              <div>
                <label htmlFor="product-stock" className="label">
                  {t('form.fields.stock')}
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
                  {t('form.fields.minStock')}
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
                {t('form.fields.imageUrl')}
              </label>
              <input id="product-image-url" className="input mt-1" {...form.register('imageUrl')} />
            </div>

            <label className="flex items-center gap-3 text-sm text-secondary-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-secondary-300"
                {...form.register('isActive')}
              />
              {t('form.fields.isActive')}
            </label>
          </>
        )}

        {activeTab === 'pricing' && (
          <PricingSection
            form={form}
            costField={costField}
            initialCostField={initialCostField}
            syncAllTiersFromCost={syncAllTiersFromCost}
            syncTier={syncTier}
          />
        )}

        {activeTab === 'units' && (
          <UnitAssignmentsSection
            form={form}
            units={units}
            unitAssignmentsFieldArray={unitAssignmentsFieldArray}
            onBaseUnitChange={handleBaseUnitChange}
          />
        )}

        {activeTab === 'providers' && (
          <ProviderAssignmentsSection
            form={form}
            providers={providers}
            providerAssignmentsFieldArray={providerAssignmentsFieldArray}
            validateProviderAssignment={validateProviderAssignment}
          />
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

interface PricingSectionProps {
  form: UseFormReturn<ProductFormValues>;
  costField: UseFormRegisterReturn<'cost'>;
  initialCostField: UseFormRegisterReturn<'initialCost'>;
  syncAllTiersFromCost: (cost: number) => void;
  syncTier: (
    priceField: PricingField,
    percentField: MarginPercentField,
    amountField: MarginAmountField,
    pricingInput: { marginPercent: number } | { marginAmount: number } | { price: number }
  ) => void;
}

function PricingSection({
  form,
  costField,
  initialCostField,
  syncAllTiersFromCost,
  syncTier,
}: PricingSectionProps) {
  const { t } = useTranslation('products');
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="product-cost" className="label">
            {t('form.fields.cost')}
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
            {t('form.fields.initialCost')}
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
          title={t('form.fields.priceTier1')}
          priceField={form.register('price', { min: 0, valueAsNumber: true })}
          percentField={form.register('marginPercent1', { min: 0, valueAsNumber: true })}
          amountField={form.register('marginAmount1', { min: 0, valueAsNumber: true })}
          onPriceChange={value => syncTier('price', 'marginPercent1', 'marginAmount1', { price: value })}
          onPercentChange={value =>
            syncTier('price', 'marginPercent1', 'marginAmount1', { marginPercent: value })
          }
          onAmountChange={value =>
            syncTier('price', 'marginPercent1', 'marginAmount1', { marginAmount: value })
          }
        />
        <PricingTierSection
          title={t('form.fields.priceTier2')}
          priceField={form.register('price2', { min: 0, valueAsNumber: true })}
          percentField={form.register('marginPercent2', { min: 0, valueAsNumber: true })}
          amountField={form.register('marginAmount2', { min: 0, valueAsNumber: true })}
          onPriceChange={value => syncTier('price2', 'marginPercent2', 'marginAmount2', { price: value })}
          onPercentChange={value =>
            syncTier('price2', 'marginPercent2', 'marginAmount2', { marginPercent: value })
          }
          onAmountChange={value =>
            syncTier('price2', 'marginPercent2', 'marginAmount2', { marginAmount: value })
          }
        />
        <PricingTierSection
          title={t('form.fields.priceTier3')}
          priceField={form.register('price3', { min: 0, valueAsNumber: true })}
          percentField={form.register('marginPercent3', { min: 0, valueAsNumber: true })}
          amountField={form.register('marginAmount3', { min: 0, valueAsNumber: true })}
          onPriceChange={value => syncTier('price3', 'marginPercent3', 'marginAmount3', { price: value })}
          onPercentChange={value =>
            syncTier('price3', 'marginPercent3', 'marginAmount3', { marginPercent: value })
          }
          onAmountChange={value =>
            syncTier('price3', 'marginPercent3', 'marginAmount3', { marginAmount: value })
          }
        />
      </div>
    </>
  );
}

interface UnitAssignmentsSectionProps {
  form: UseFormReturn<ProductFormValues>;
  units: LookupOption[];
  unitAssignmentsFieldArray: UseFieldArrayReturn<ProductFormValues, 'unitAssignments', 'id'>;
  onBaseUnitChange: (index: number) => void;
}

function UnitAssignmentsSection({
  form,
  units,
  unitAssignmentsFieldArray,
  onBaseUnitChange,
}: UnitAssignmentsSectionProps) {
  const { t } = useTranslation('products');
  return (
    <div className="space-y-4 rounded-xl border border-secondary-200 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-secondary-900">{t('form.units.title')}</p>
          <p className="text-sm text-secondary-500">
            {t('form.units.description')}
          </p>
        </div>
        <button
          type="button"
          className="btn-outline"
          onClick={() =>
            unitAssignmentsFieldArray.append({
              unitId: '',
              equivalence: 1,
              price: form.getValues('price'),
              isBase: false,
            })
          }
        >
          {t('form.units.addUnit')}
        </button>
      </div>

      <div className="space-y-4">
        {unitAssignmentsFieldArray.fields.map((field, index) => {
          const isBase = form.watch(`unitAssignments.${index}.isBase`);
          return (
            <div key={field.id} className="grid grid-cols-2 gap-4 rounded-lg border border-secondary-200 p-4">
              <div>
                <label className="label">{t('form.units.unit')}</label>
                <select
                  className="input mt-1"
                  {...form.register(`unitAssignments.${index}.unitId` as const, {
                    required: t('form.units.unitRequired'),
                  })}
                >
                  <option value="">{t('form.units.selectUnit')}</option>
                  {units.map(unit => (
                    <option key={unit.id} value={unit.id}>
                      {unit.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">{t('form.units.equivalence')}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  disabled={isBase}
                  className="input mt-1"
                  {...form.register(`unitAssignments.${index}.equivalence` as const, {
                    min: 0.01,
                    valueAsNumber: true,
                  })}
                />
              </div>
              <div>
                <label className="label">{t('form.units.unitPrice')}</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  className="input mt-1"
                  {...form.register(`unitAssignments.${index}.price` as const, {
                    min: 0,
                    valueAsNumber: true,
                  })}
                />
              </div>
              <div className="flex items-end gap-3">
                <label className="flex items-center gap-2 text-sm text-secondary-700">
                  <input
                    type="checkbox"
                    checked={!!isBase}
                    onChange={() => onBaseUnitChange(index)}
                  />
                  {t('form.units.baseUnit')}
                </label>
                <button
                  type="button"
                  className="btn-ghost text-danger-600"
                  disabled={unitAssignmentsFieldArray.fields.length === 1}
                  onClick={() => {
                    const currentAssignments = form.getValues('unitAssignments');
                    const removingBase = currentAssignments[index]?.isBase;
                    unitAssignmentsFieldArray.remove(index);

                    if (removingBase && currentAssignments.length > 1) {
                      const nextIndex = index === 0 ? 0 : index - 1;
                      onBaseUnitChange(nextIndex);
                    }
                  }}
                >
                  {t('form.units.remove')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface ProviderAssignmentsSectionProps {
  form: UseFormReturn<ProductFormValues>;
  providers: LookupOption[];
  providerAssignmentsFieldArray: UseFieldArrayReturn<ProductFormValues, 'providerAssignments', 'id'>;
  validateProviderAssignment: (providerId: string, index: number) => string | true;
}

function ProviderAssignmentsSection({
  form,
  providers,
  providerAssignmentsFieldArray,
  validateProviderAssignment,
}: ProviderAssignmentsSectionProps) {
  const { t } = useTranslation('products');
  return (
    <div className="space-y-4 rounded-xl border border-secondary-200 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-secondary-900">{t('form.providerAssignments.title')}</p>
          <p className="text-sm text-secondary-500">{t('form.providerAssignments.description')}</p>
        </div>
        <button
          type="button"
          className="btn-outline"
          onClick={() => providerAssignmentsFieldArray.append({ providerId: '' })}
        >
          {t('form.providerAssignments.addProvider')}
        </button>
      </div>

      {providerAssignmentsFieldArray.fields.length === 0 && (
        <p className="py-4 text-center text-sm text-secondary-500">
          {t('form.providerAssignments.empty')}
        </p>
      )}

      <div className="space-y-3">
        {providerAssignmentsFieldArray.fields.map((field, index) => (
          <div key={field.id} className="flex items-end gap-3 rounded-lg border border-secondary-200 p-4">
            <div className="flex-1">
              <label className="label">{t('form.providerAssignments.provider')}</label>
              <select
                className="input mt-1"
                {...form.register(`providerAssignments.${index}.providerId` as const, {
                  validate: value => validateProviderAssignment(value, index),
                })}
              >
                <option value="">{t('form.providerAssignments.selectProvider')}</option>
                {providers.map(provider => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              className="btn-ghost text-danger-600"
              onClick={() => providerAssignmentsFieldArray.remove(index)}
            >
              {t('form.providerAssignments.remove')}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
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
  const { t } = useTranslation('products');
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="md:col-span-3">
        <p className="text-sm font-medium text-secondary-900">{title}</p>
      </div>
      <div>
        <label className="label">{t('form.fields.marginPercent')}</label>
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
        <label className="label">{t('form.fields.marginAmount')}</label>
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
        <label className="label">{t('form.fields.salePrice')}</label>
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
