import { useTranslation } from 'react-i18next';

import {
  CUSTOMER_BALANCE_IMPORT_FIELDS,
  type CustomerBalanceImportField,
  type CustomerBalanceImportMapping,
} from './customerBalanceImportMapping';
import type { ImportDecimalFormat } from './types';

interface CustomerBalanceImportMappingPanelProps {
  decimalFormat: ImportDecimalFormat;
  disabled: boolean;
  headers: string[];
  mapping: CustomerBalanceImportMapping;
  onDecimalFormatChange: (value: ImportDecimalFormat) => void;
  onMappingChange: (field: CustomerBalanceImportField, sourceHeader: string) => void;
}

export function CustomerBalanceImportMappingPanel({
  decimalFormat,
  disabled,
  headers,
  mapping,
  onDecimalFormatChange,
  onMappingChange,
}: CustomerBalanceImportMappingPanelProps) {
  const { t } = useTranslation('dataImport');

  return (
    <section className="card space-y-5 p-6" aria-labelledby="customer-balance-mapping-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-700">
          {t('steps.map.kicker')}
        </p>
        <h2
          id="customer-balance-mapping-title"
          className="mt-1 text-lg font-semibold text-secondary-900"
        >
          {t('steps.map.title')}
        </h2>
        <p className="mt-1 text-sm text-secondary-600">{t('customerBalances.mapDescription')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CUSTOMER_BALANCE_IMPORT_FIELDS.map(field => {
          const id = `data-import-map-${field}`;
          const required = field === 'openingBalance';
          return (
            <div key={field}>
              <label htmlFor={id} className="label mb-2 block">
                {t(`customerBalances.fields.${field}`)}
                {required ? <span className="ml-1 text-danger-700">*</span> : null}
              </label>
              <select
                id={id}
                value={mapping[field]}
                disabled={disabled}
                aria-required={required}
                aria-describedby={
                  field === 'taxId' || field === 'email'
                    ? 'customer-balance-identity-requirement'
                    : undefined
                }
                onChange={event => onMappingChange(field, event.target.value)}
                className="input w-full"
              >
                <option value="">{t('steps.map.notMapped')}</option>
                {headers.map(header => (
                  <option key={header} value={header}>
                    {header}
                  </option>
                ))}
              </select>
            </div>
          );
        })}

        <div>
          <label htmlFor="customer-balance-decimal-format" className="label mb-2 block">
            {t('steps.map.decimalFormat')}
          </label>
          <select
            id="customer-balance-decimal-format"
            value={decimalFormat}
            disabled={disabled}
            onChange={event => onDecimalFormatChange(event.target.value as ImportDecimalFormat)}
            className="input w-full"
          >
            {(['auto', 'dot', 'comma'] as const).map(value => (
              <option key={value} value={value}>
                {t(`decimalFormats.${value}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <p id="customer-balance-identity-requirement" className="text-xs text-secondary-500">
        {t('customerBalances.identityRequirement')}
      </p>
    </section>
  );
}
