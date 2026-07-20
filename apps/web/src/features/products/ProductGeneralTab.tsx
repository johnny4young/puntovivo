import { useTranslation } from 'react-i18next';
import { ScanLine } from 'lucide-react';
import { SimpleFormField } from '@/components/form-controls/FormField';
import { cn } from '@/lib/utils';
import { AISuggestionsPanel } from './AISuggestionsPanel';
import { ProductFormFieldGroup } from './ProductFormFieldGroup';
import { errorProp, REQUIRED_LABEL } from './productForm.helpers';
import type { LookupOption, ProductRole, VatRateOption } from './productForm.types';
import type { UseProductFormReturn } from './useProductForm';

interface ProductGeneralTabProps {
  formBundle: UseProductFormReturn;
  mode: ProductRole;
  isOpen: boolean;
  categories: LookupOption[];
  providers: LookupOption[];
  locations: LookupOption[];
  vatRates: VatRateOption[];
  suggestionsEnabled: boolean;
  // explicit `| undefined` on optional fields.
  productId?: string | undefined;
}

export function ProductGeneralTab({
  formBundle,
  mode,
  isOpen,
  categories,
  providers,
  locations,
  vatRates,
  suggestionsEnabled,
  productId,
}: ProductGeneralTabProps) {
  const { t } = useTranslation('products');
  const {
    form,
    errors,
    selectedVatRateId,
    sellByFraction,
    tracksLots,
    tracksSerials,
    taxRateField,
    stockField,
    minStockField,
    sellByFractionField,
    tracksLotsField,
    tracksSerialsField,
    fractionStepField,
    fractionMinimumField,
    vatRateField,
  } = formBundle;

  return (
    <div
      id="product-tabpanel-general"
      role="tabpanel"
      aria-labelledby="product-tab-general"
      className="space-y-8"
    >
      {/* --- Identity --------------------------------------------------- */}
      <ProductFormFieldGroup
        title={t('form.sections.identity.title')}
        description={t('form.sections.identity.description')}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <SimpleFormField
            label={t('form.fields.name')}
            htmlFor="product-name"
            className={REQUIRED_LABEL}
            {...errorProp(errors.name?.message)}
          >
            <input
              id="product-name"
              aria-required="true"
              className={cn('pv-input', errors.name && 'error')}
              {...form.register('name', { required: t('form.fields.nameRequired') })}
            />
          </SimpleFormField>
          <SimpleFormField
            label={t('form.fields.sku')}
            htmlFor="product-sku"
            className={REQUIRED_LABEL}
            helperText={t('form.fields.skuHelp')}
            {...errorProp(errors.sku?.message)}
          >
            <input
              id="product-sku"
              aria-required="true"
              className={cn('pv-input', errors.sku && 'error')}
              {...form.register('sku', { required: t('form.fields.skuRequired') })}
            />
          </SimpleFormField>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <SimpleFormField
            label={t('form.fields.barcode')}
            htmlFor="product-barcode"
            className="self-start"
          >
            <span className="pv-input">
              <ScanLine aria-hidden="true" />
              <input
                id="product-barcode"
                className="w-full border-0 bg-transparent p-0 text-inherit outline-none placeholder:text-fg4"
                placeholder={t('form.fields.barcodePlaceholder')}
                {...form.register('barcode')}
              />
            </span>
          </SimpleFormField>
          <SimpleFormField label={t('form.fields.imageUrl')} htmlFor="product-image-url">
            <input id="product-image-url" className="pv-input" {...form.register('imageUrl')} />
          </SimpleFormField>
        </div>

        <SimpleFormField label={t('form.fields.description')} htmlFor="product-description">
          <textarea
            id="product-description"
            className="pv-input area"
            placeholder={t('form.fields.descriptionPlaceholder')}
            {...form.register('description')}
          />
        </SimpleFormField>
      </ProductFormFieldGroup>

      {/* --- Classification --------------------------------------------- */}
      <ProductFormFieldGroup
        title={t('form.sections.classification.title')}
        description={t('form.sections.classification.description')}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <AISuggestionsPanel
            form={form}
            mode={mode}
            isOpen={isOpen}
            categories={categories}
            suggestionsEnabled={suggestionsEnabled}
            productId={productId}
          />
          <SimpleFormField label={t('form.fields.provider')} htmlFor="product-provider">
            <select id="product-provider" className="pv-input" {...form.register('providerId')}>
              <option value="">{t('form.fields.noProvider')}</option>
              {providers.map(provider => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
          </SimpleFormField>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <SimpleFormField label={t('form.fields.vatRate')} htmlFor="product-vat-rate">
            <select
              id="product-vat-rate"
              className="pv-input"
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
          </SimpleFormField>
          <SimpleFormField
            label={t('form.fields.taxRate')}
            htmlFor="product-tax-rate"
            {...errorProp(errors.taxRate?.message)}
          >
            <input
              id="product-tax-rate"
              type="number"
              step="0.01"
              min="0"
              className={cn('pv-input', errors.taxRate && 'error')}
              disabled={!!selectedVatRateId}
              {...taxRateField}
            />
          </SimpleFormField>
          <SimpleFormField label={t('form.fields.location')} htmlFor="product-location">
            <select id="product-location" className="pv-input" {...form.register('locationId')}>
              <option value="">{t('form.fields.noLocation')}</option>
              {locations.map(location => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </SimpleFormField>
        </div>
      </ProductFormFieldGroup>

      {/* --- Inventory -------------------------------------------------- */}
      <ProductFormFieldGroup
        title={t('form.sections.inventory.title')}
        description={t('form.sections.inventory.description')}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <SimpleFormField
            label={t('form.fields.stock')}
            htmlFor="product-stock"
            helperText={
              tracksLots
                ? t('form.fields.tracksLotsStockHelp')
                : tracksSerials
                  ? t('form.fields.tracksSerialsStockHelp')
                  : t('form.fields.stockHelp')
            }
            {...errorProp(errors.stock?.message)}
          >
            <input
              id="product-stock"
              type="number"
              min="0"
              step="any"
              className={cn('pv-input', errors.stock && 'error')}
              readOnly={tracksLots || tracksSerials}
              aria-readonly={tracksLots || tracksSerials}
              {...stockField}
            />
          </SimpleFormField>
          <SimpleFormField
            label={t('form.fields.minStock')}
            htmlFor="product-min-stock"
            helperText={t('form.fields.minStockHelp')}
            {...errorProp(errors.minStock?.message)}
          >
            <input
              id="product-min-stock"
              type="number"
              min="0"
              step="any"
              className={cn('pv-input', errors.minStock && 'error')}
              {...minStockField}
            />
          </SimpleFormField>
        </div>

        <div className="rounded-2xl border border-line/80 bg-surface-2/50 p-4">
          <label className="flex items-start gap-3 text-sm font-medium text-secondary-900">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-secondary-300"
              aria-label={t('form.fields.tracksSerials')}
              {...tracksSerialsField}
              onChange={event => {
                tracksSerialsField.onChange(event);
                if (event.target.checked) {
                  form.setValue('tracksLots', false, { shouldDirty: true, shouldValidate: true });
                  form.setValue('sellByFraction', false, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                }
              }}
            />
            <span>
              <span className="block">{t('form.fields.tracksSerials')}</span>
              <span className="mt-1 block text-xs font-normal text-secondary-600">
                {t('form.fields.tracksSerialsHelp')}
              </span>
            </span>
          </label>
          {tracksSerials && (
            <p className="mt-3 rounded-xl border border-primary-100 bg-primary-50 px-3 py-2 text-xs text-primary-800">
              {t('form.fields.tracksSerialsEnabledHelp')}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-line/80 bg-surface-2/50 p-4">
          <label className="flex items-start gap-3 text-sm font-medium text-secondary-900">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-secondary-300"
              aria-label={t('form.fields.tracksLots')}
              {...tracksLotsField}
              onChange={event => {
                tracksLotsField.onChange(event);
                if (event.target.checked) {
                  form.setValue('tracksSerials', false, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                }
              }}
            />
            <span>
              <span className="block">{t('form.fields.tracksLots')}</span>
              <span className="mt-1 block text-xs font-normal text-secondary-600">
                {t('form.fields.tracksLotsHelp')}
              </span>
            </span>
          </label>
          {tracksLots && (
            <p className="mt-3 rounded-xl border border-primary-100 bg-primary-50 px-3 py-2 text-xs text-primary-800">
              {t('form.fields.tracksLotsEnabledHelp')}
            </p>
          )}
        </div>

        <div className="rounded-2xl border border-line/80 bg-surface-2/50 p-4">
          <label className="flex items-center gap-3 text-sm font-medium text-secondary-900">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-secondary-300"
              {...sellByFractionField}
              onChange={event => {
                sellByFractionField.onChange(event);

                if (event.target.checked) {
                  form.setValue('tracksSerials', false, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                  const nextFractionStep = Math.max(0.01, form.getValues('fractionStep') || 0.01);
                  const nextFractionMinimum = Math.max(
                    form.getValues('fractionMinimum') || 0.01,
                    nextFractionStep
                  );

                  form.setValue('fractionStep', nextFractionStep, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                  form.setValue('fractionMinimum', nextFractionMinimum, {
                    shouldDirty: true,
                    shouldValidate: true,
                  });
                }
              }}
            />
            {t('form.fields.sellByFraction')}
          </label>
          <p className="mt-2 text-sm text-secondary-500">{t('form.fields.sellByFractionHelp')}</p>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <SimpleFormField label={t('form.fields.fractionStep')} htmlFor="product-fraction-step">
              <input
                id="product-fraction-step"
                type="number"
                min="0.01"
                step="any"
                disabled={!sellByFraction}
                className="pv-input"
                {...fractionStepField}
              />
            </SimpleFormField>
            <SimpleFormField
              label={t('form.fields.fractionMinimum')}
              htmlFor="product-fraction-minimum"
            >
              <input
                id="product-fraction-minimum"
                type="number"
                min="0.01"
                step="any"
                disabled={!sellByFraction}
                className="pv-input"
                {...fractionMinimumField}
              />
            </SimpleFormField>
          </div>
        </div>
      </ProductFormFieldGroup>
    </div>
  );
}
