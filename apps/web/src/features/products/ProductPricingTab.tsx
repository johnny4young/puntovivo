import { useTranslation } from 'react-i18next';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { parseNumber } from './productForm.helpers';
import type {
  MarginAmountField,
  MarginPercentField,
  PricingField,
} from './productForm.types';
import type { UseProductFormReturn } from './useProductForm';

interface PricingTierSectionProps {
  title: string;
  priceField: UseFormRegisterReturn<PricingField>;
  percentField: UseFormRegisterReturn<MarginPercentField>;
  amountField: UseFormRegisterReturn<MarginAmountField>;
  onPriceChange: (value: number) => void;
  onPercentChange: (value: number) => void;
  onAmountChange: (value: number) => void;
}

interface ProductPricingTabProps {
  formBundle: UseProductFormReturn;
}

export function ProductPricingTab({ formBundle }: ProductPricingTabProps) {
  const { t } = useTranslation('products');
  const { form, costField, initialCostField, syncAllTiersFromCost, syncTier } = formBundle;
  return (
    <div id="product-tabpanel-pricing" role="tabpanel" aria-labelledby="product-tab-pricing">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="pv-field">
          <label htmlFor="product-cost" className="label">
            {t('form.fields.cost')}
          </label>
          <input
            id="product-cost"
            type="number"
            step="0.01"
            min="0"
            className="pv-input"
            {...costField}
            onChange={event => {
              costField.onChange(event);
              syncAllTiersFromCost(parseNumber(event.target.value));
            }}
          />
        </div>
        <div className="pv-field">
          <label htmlFor="product-initial-cost" className="label">
            {t('form.fields.initialCost')}
          </label>
          <input
            id="product-initial-cost"
            type="number"
            step="0.01"
            min="0"
            className="pv-input"
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
      <div className="pv-field">
        <label className="label">{t('form.fields.marginPercent')}</label>
        <input
          type="number"
          step="0.01"
          min="0"
          className="pv-input"
          {...percentField}
          onChange={event => {
            percentField.onChange(event);
            onPercentChange(parseNumber(event.target.value));
          }}
        />
      </div>
      <div className="pv-field">
        <label className="label">{t('form.fields.marginAmount')}</label>
        <input
          type="number"
          step="0.01"
          min="0"
          className="pv-input"
          {...amountField}
          onChange={event => {
            amountField.onChange(event);
            onAmountChange(parseNumber(event.target.value));
          }}
        />
      </div>
      <div className="pv-field">
        <label className="label">{t('form.fields.salePrice')}</label>
        <input
          type="number"
          step="0.01"
          min="0"
          className="pv-input"
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
