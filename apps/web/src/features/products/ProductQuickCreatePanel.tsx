import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Barcode,
  Boxes,
  Check,
  ChevronDown,
  CircleDollarSign,
  ScanLine,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { ExpertDetailPanel } from '@/components/experience';
import { Button } from '@/components/ui';
import { SimpleFormField } from '@/components/form-controls/FormField';
import { cn } from '@/lib/utils';
import { createInternalProductCode } from './productCode';
import { errorProp, parseNumber, REQUIRED_LABEL } from './productForm.helpers';
import type { ProductFormOrigin, VatRateOption } from './productForm.types';
import type { UseProductFormReturn } from './useProductForm';

interface ProductQuickCreatePanelProps {
  formBundle: UseProductFormReturn;
  vatRates: VatRateOption[];
  origin: ProductFormOrigin;
  onOpenAdvanced: () => void;
}

export function ProductQuickCreatePanel({
  formBundle,
  vatRates,
  origin,
  onOpenAdvanced,
}: ProductQuickCreatePanelProps) {
  const { t } = useTranslation('productQuickCreate');
  const [showOpeningStock, setShowOpeningStock] = useState(false);
  const {
    form,
    errors,
    stockField,
    vatRateField,
    syncTier,
  } = formBundle;
  const skuField = form.register('sku', {
    required: t('fields.codeRequired'),
  });
  const priceField = form.register('price', {
    min: { value: 0, message: t('fields.priceInvalid') },
    valueAsNumber: true,
  });

  const updateSharedCode = (nextCode: string) => {
    form.setValue('sku', nextCode, {
      shouldDirty: true,
      shouldValidate: true,
    });
    form.setValue('barcode', nextCode, {
      shouldDirty: true,
      shouldValidate: true,
    });
  };

  return (
    <div className="space-y-4" data-testid="product-quick-create">
      <div className="overflow-hidden rounded-[1.5rem] border border-primary-100 bg-[linear-gradient(135deg,rgba(240,249,255,0.96),rgba(255,255,255,0.98)_58%,rgba(255,247,237,0.86))]">
        <div className="grid gap-4 p-4 sm:grid-cols-[1fr_auto] sm:items-start">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary-100 bg-white/80 px-3 py-1 text-[0.66rem] font-bold uppercase tracking-[0.18em] text-primary-800 shadow-sm">
              <Sparkles className="h-3.5 w-3.5 text-accent-500" aria-hidden="true" />
              {t('eyebrow')}
            </div>
            <h3 className="font-display text-[1.5rem] leading-[1.05] text-secondary-950 sm:text-[1.7rem]">
              {t('title')}
            </h3>
            <p className="mt-1.5 max-w-[42rem] text-sm leading-5 text-secondary-600">
              {origin === 'sale' ? t('descriptionSale') : t('descriptionCatalog')}
            </p>
          </div>
          <div className="hidden grid-cols-3 gap-1 rounded-2xl border border-white/90 bg-white/75 p-1.5 shadow-sm lg:grid">
            {[Barcode, CircleDollarSign, Check].map((Icon, index) => (
              <span
                key={index}
                className={cn(
                  'grid h-11 w-11 place-items-center rounded-xl',
                  index === 2
                    ? 'bg-success-50 text-success-700'
                    : 'bg-secondary-50 text-secondary-600'
                )}
              >
                <Icon className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
              </span>
            ))}
          </div>
        </div>
        <div className="grid border-t border-primary-100/80 bg-white/60 sm:grid-cols-3">
          {[t('steps.identity'), t('steps.price'), t('steps.ready')].map((step, index) => (
            <div
              key={step}
              className="flex items-center gap-2 border-primary-100/80 px-3 py-2 text-xs font-semibold text-secondary-700 sm:border-r sm:last:border-r-0"
            >
              <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary-950 text-[0.65rem] font-bold text-white">
                {index + 1}
              </span>
              {step}
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 rounded-[1.35rem] border border-line bg-card p-4 shadow-[0_18px_50px_-42px_rgba(15,23,42,0.55)]">
        <SimpleFormField
          label={t('fields.name')}
          htmlFor="product-name"
          className={REQUIRED_LABEL}
          helperText={t('fields.nameHelp')}
          {...errorProp(errors.name?.message)}
        >
          <input
            id="product-name"
            autoFocus
            autoComplete="off"
            aria-required="true"
            className={cn('pv-input text-base', errors.name && 'error')}
            placeholder={t('fields.namePlaceholder')}
            {...form.register('name', { required: t('fields.nameRequired') })}
          />
        </SimpleFormField>

        <SimpleFormField
          label={t('fields.code')}
          htmlFor="product-sku"
          className={REQUIRED_LABEL}
          helperText={t('fields.codeHelp')}
          {...errorProp(errors.sku?.message)}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <span
              className={cn(
                'pv-input min-w-0 flex-1',
                errors.sku && 'error'
              )}
            >
              <ScanLine className="h-5 w-5 shrink-0 text-primary-700" aria-hidden="true" />
              <input
                id="product-sku"
                autoComplete="off"
                aria-required="true"
                className="w-full min-w-0 border-0 bg-transparent p-0 font-mono text-sm uppercase tracking-[0.06em] text-inherit outline-none placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-fg4"
                placeholder={t('fields.codePlaceholder')}
                {...skuField}
                onChange={event => {
                  const previousSku = form.getValues('sku');
                  const previousBarcode = form.getValues('barcode');
                  skuField.onChange(event);
                  if (!previousBarcode || previousBarcode === previousSku) {
                    form.setValue('barcode', event.target.value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    });
                  }
                }}
              />
            </span>
            <Button
              type="button"
              variant="outline"
              className="shrink-0 sm:min-w-[10rem]"
              onClick={() =>
                updateSharedCode(createInternalProductCode(form.getValues('name')))
              }
            >
              <Sparkles aria-hidden="true" />
              {t('actions.generateCode')}
            </Button>
          </div>
        </SimpleFormField>

        <div className="grid gap-4 sm:grid-cols-2">
          <SimpleFormField
            label={t('fields.price')}
            htmlFor="product-price"
            className={REQUIRED_LABEL}
            helperText={t('fields.priceHelp')}
            {...errorProp(errors.price?.message)}
          >
            <span className={cn('pv-input', errors.price && 'error')}>
              <CircleDollarSign className="h-5 w-5 shrink-0 text-primary-700" aria-hidden="true" />
              <input
                id="product-price"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                aria-required="true"
                className="w-full border-0 bg-transparent p-0 text-base font-semibold tabular-nums text-inherit outline-none"
                {...priceField}
                onChange={event => {
                  priceField.onChange(event);
                  syncTier('price', 'marginPercent1', 'marginAmount1', {
                    price: parseNumber(event.target.value),
                  });
                }}
              />
            </span>
          </SimpleFormField>

          <SimpleFormField
            label={t('fields.tax')}
            htmlFor="product-vat-rate"
            helperText={t('fields.taxHelp')}
          >
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
              <option value="">{t('fields.noTax')}</option>
              {vatRates.map(vatRate => (
                <option key={vatRate.id} value={vatRate.id}>
                  {vatRate.name} · {vatRate.rate}%
                </option>
              ))}
            </select>
          </SimpleFormField>
        </div>
      </div>

      <div className="overflow-hidden rounded-[1.25rem] border border-line bg-surface-2/55">
        <button
          type="button"
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-surface-2"
          aria-expanded={showOpeningStock}
          aria-controls="product-quick-opening-stock"
          aria-label={t('openingStock.title')}
          onClick={() => setShowOpeningStock(current => !current)}
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-primary-800 shadow-sm">
            <Boxes className="h-[1.1rem] w-[1.1rem]" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-secondary-950">
              {t('openingStock.title')}
            </span>
            <span className="mt-0.5 block text-xs leading-5 text-secondary-600">
              {t('openingStock.description')}
            </span>
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-secondary-500 transition-transform',
              showOpeningStock && 'rotate-180'
            )}
            aria-hidden="true"
          />
        </button>
        {showOpeningStock && (
          <div
            id="product-quick-opening-stock"
            className="border-t border-line bg-white px-4 py-4"
          >
            <SimpleFormField
              label={t('openingStock.field')}
              htmlFor="product-stock"
              helperText={t('openingStock.help')}
              {...errorProp(errors.stock?.message)}
            >
              <input
                id="product-stock"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                className={cn('pv-input max-w-[18rem]', errors.stock && 'error')}
                {...stockField}
              />
            </SimpleFormField>
          </div>
        )}
      </div>

      <ExpertDetailPanel
        icon={Settings2}
        title={t('advanced.title')}
        description={t('advanced.description')}
        tone="muted"
        variant="outline"
        className="rounded-[1.25rem] p-4"
        action={
          <Button
            variant="ghost"
            className="w-full justify-between xl:w-auto"
            onClick={onOpenAdvanced}
          >
            {t('actions.openAdvanced')}
            <Settings2 aria-hidden="true" />
          </Button>
        }
      />
    </div>
  );
}
