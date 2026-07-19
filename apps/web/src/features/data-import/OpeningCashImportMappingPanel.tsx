import { useTranslation } from 'react-i18next';

import {
  OPENING_CASH_IMPORT_FIELDS,
  type OpeningCashImportField,
  type OpeningCashImportMapping,
} from './openingCashImportMapping';
import type { ImportDecimalFormat } from './types';

interface OpeningCashImportMappingPanelProps {
  decimalFormat: ImportDecimalFormat;
  disabled: boolean;
  headers: string[];
  mapping: OpeningCashImportMapping;
  onDecimalFormatChange: (value: ImportDecimalFormat) => void;
  onMappingChange: (field: OpeningCashImportField, sourceHeader: string) => void;
}

export function OpeningCashImportMappingPanel({
  decimalFormat,
  disabled,
  headers,
  mapping,
  onDecimalFormatChange,
  onMappingChange,
}: OpeningCashImportMappingPanelProps) {
  const { t } = useTranslation('dataImport');

  return (
    <section className="card space-y-5 p-6" aria-labelledby="opening-cash-mapping-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-700">
          {t('steps.map.kicker')}
        </p>
        <h2
          id="opening-cash-mapping-title"
          className="mt-1 text-lg font-semibold text-secondary-900"
        >
          {t('steps.map.title')}
        </h2>
        <p className="mt-1 text-sm text-secondary-600">{t('openingCash.mapDescription')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {OPENING_CASH_IMPORT_FIELDS.map(field => {
          const id = `data-import-map-${field}`;
          return (
            <div key={field}>
              <label htmlFor={id} className="label mb-2 block">
                {t(`openingCash.fields.${field}`)}
                <span className="ml-1 text-danger-700">*</span>
              </label>
              <select
                id={id}
                value={mapping[field]}
                disabled={disabled}
                aria-required="true"
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
          <label htmlFor="opening-cash-decimal-format" className="label mb-2 block">
            {t('steps.map.decimalFormat')}
          </label>
          <select
            id="opening-cash-decimal-format"
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

      <p className="text-xs leading-5 text-secondary-500">
        {t('openingCash.denominationFormatHelp')}
      </p>
    </section>
  );
}
