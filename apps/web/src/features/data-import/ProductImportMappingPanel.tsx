import { useTranslation } from 'react-i18next';

import {
  PRODUCT_IMPORT_FIELDS,
  type ProductImportField,
  type ProductImportMapping,
} from './productImportMapping';
import type { ImportDecimalFormat } from './types';

interface ProductImportMappingPanelProps {
  headers: string[];
  mapping: ProductImportMapping;
  decimalFormat: ImportDecimalFormat;
  disabled: boolean;
  onMappingChange: (field: ProductImportField, sourceHeader: string) => void;
  onDecimalFormatChange: (format: ImportDecimalFormat) => void;
}

export function ProductImportMappingPanel({
  headers,
  mapping,
  decimalFormat,
  disabled,
  onMappingChange,
  onDecimalFormatChange,
}: ProductImportMappingPanelProps) {
  const { t } = useTranslation('dataImport');

  return (
    <section className="card space-y-5 p-6" aria-labelledby="data-import-mapping-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-700">
          {t('steps.map.kicker')}
        </p>
        <h2
          id="data-import-mapping-title"
          className="mt-1 text-lg font-semibold text-secondary-900"
        >
          {t('steps.map.title')}
        </h2>
        <p className="mt-1 text-sm text-secondary-600">{t('steps.map.description')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {PRODUCT_IMPORT_FIELDS.map(field => {
          const id = `data-import-map-${field}`;
          const required = field === 'name' || field === 'sku';
          return (
            <div key={field}>
              <label htmlFor={id} className="label mb-2 block">
                {t(`fields.${field}`)}
                {required ? <span className="ml-1 text-danger-700">*</span> : null}
              </label>
              <select
                id={id}
                value={mapping[field]}
                disabled={disabled}
                aria-required={required}
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
      </div>

      <div className="max-w-sm">
        <label htmlFor="data-import-decimal-format" className="label mb-2 block">
          {t('steps.map.decimalFormat')}
        </label>
        <select
          id="data-import-decimal-format"
          value={decimalFormat}
          disabled={disabled}
          onChange={event => onDecimalFormatChange(event.target.value as ImportDecimalFormat)}
          className="input w-full"
        >
          <option value="auto">{t('decimalFormats.auto')}</option>
          <option value="comma">{t('decimalFormats.comma')}</option>
          <option value="dot">{t('decimalFormats.dot')}</option>
        </select>
      </div>
    </section>
  );
}
