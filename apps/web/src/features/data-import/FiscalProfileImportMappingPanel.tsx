import { useTranslation } from 'react-i18next';

import {
  FISCAL_PROFILE_IMPORT_FIELDS,
  type FiscalProfileImportField,
  type FiscalProfileImportMapping,
} from './fiscalProfileImportMapping';

interface FiscalProfileImportMappingPanelProps {
  disabled: boolean;
  headers: string[];
  mapping: FiscalProfileImportMapping;
  onMappingChange: (field: FiscalProfileImportField, sourceHeader: string) => void;
}

const ALWAYS_REQUIRED = new Set<FiscalProfileImportField>(['countryCode', 'taxIdentifier']);

export function FiscalProfileImportMappingPanel({
  disabled,
  headers,
  mapping,
  onMappingChange,
}: FiscalProfileImportMappingPanelProps) {
  const { t } = useTranslation('dataImport');

  return (
    <section className="card space-y-5 p-6" aria-labelledby="fiscal-profile-mapping-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-700">
          {t('steps.map.kicker')}
        </p>
        <h2
          id="fiscal-profile-mapping-title"
          className="mt-1 text-lg font-semibold text-secondary-900"
        >
          {t('steps.map.title')}
        </h2>
        <p className="mt-1 text-sm text-secondary-600">{t('fiscalProfiles.mapDescription')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {FISCAL_PROFILE_IMPORT_FIELDS.map(field => {
          const id = `data-import-map-${field}`;
          const required = ALWAYS_REQUIRED.has(field);
          return (
            <div key={field}>
              <label htmlFor={id} className="label mb-2 block">
                {t(`fiscalProfiles.fields.${field}`)}
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

      <div className="rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-xs leading-5 text-primary-950">
        {t('fiscalProfiles.countryFieldHelp')}
      </div>
    </section>
  );
}
