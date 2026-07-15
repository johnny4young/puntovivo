import { useTranslation } from 'react-i18next';

import {
  PARTY_IMPORT_FIELDS,
  type PartyImportEntity,
  type PartyImportField,
  type PartyImportMapping,
} from './partyImportMapping';

interface PartyImportMappingPanelProps {
  disabled: boolean;
  entity: PartyImportEntity;
  headers: string[];
  mapping: PartyImportMapping;
  onMappingChange: (field: PartyImportField, sourceHeader: string) => void;
}

export function PartyImportMappingPanel({
  disabled,
  entity,
  headers,
  mapping,
  onMappingChange,
}: PartyImportMappingPanelProps) {
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
        <p className="mt-1 text-sm text-secondary-600">{t(`party.${entity}.mapDescription`)}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {PARTY_IMPORT_FIELDS[entity].map(field => {
          const id = `data-import-map-${field}`;
          const required = field === 'name';
          return (
            <div key={field}>
              <label htmlFor={id} className="label mb-2 block">
                {t(`party.fields.${field}`)}
                {required ? <span className="ml-1 text-danger-700">*</span> : null}
              </label>
              <select
                id={id}
                value={mapping[field] ?? ''}
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
    </section>
  );
}
