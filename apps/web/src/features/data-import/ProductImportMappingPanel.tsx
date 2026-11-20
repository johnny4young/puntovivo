import { AlertTriangle, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui';

import {
  PRODUCT_IMPORT_FIELDS,
  type ProductImportField,
  type ProductImportMapping,
} from './productImportMapping';
import type { ImportDecimalFormat } from './types';
import {
  PRODUCT_IMPORT_PROFILE_IDS,
  matchesProductImportProfileSignature,
  type ProductImportProfileId,
} from './productImportProfiles';

interface ProductImportMappingPanelProps {
  headers: string[];
  mapping: ProductImportMapping;
  decimalFormat: ImportDecimalFormat;
  profileId: ProductImportProfileId;
  detectedProfileId: ProductImportProfileId;
  disabled: boolean;
  onMappingChange: (field: ProductImportField, sourceHeader: string) => void;
  onDecimalFormatChange: (format: ImportDecimalFormat) => void;
  onProfileChange: (profileId: ProductImportProfileId) => void;
}

export function ProductImportMappingPanel({
  headers,
  mapping,
  decimalFormat,
  profileId,
  detectedProfileId,
  disabled,
  onMappingChange,
  onDecimalFormatChange,
  onProfileChange,
}: ProductImportMappingPanelProps) {
  const { t } = useTranslation('dataImport');
  const [reviewOpen, setReviewOpen] = useState(false);
  const requiredMissing = !mapping.name || !mapping.sku;
  const showFields = reviewOpen || requiredMissing;
  const recognized = PRODUCT_IMPORT_FIELDS.filter(field => mapping[field]);
  const usedHeaders = new Set<string>(recognized.map(field => mapping[field]));
  const ignoredHeaders = headers.filter(header => !usedHeaders.has(header));
  const knownFormat =
    profileId !== 'generic' &&
    profileId === detectedProfileId &&
    matchesProductImportProfileSignature(headers, profileId);
  const warnings = [
    detectedProfileId === 'generic' ? t('steps.map.unknownFormat') : null,
    requiredMissing ? t('steps.map.requiredMissing') : null,
    ignoredHeaders.length > 0
      ? t('steps.map.ignoredColumns', { columns: ignoredHeaders.join(', ') })
      : null,
  ].filter((warning): warning is string => warning !== null);

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

      <div className="rounded-xl border border-primary-100 bg-primary-50/60 p-4">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div>
            <label htmlFor="data-import-source-profile" className="label mb-2 block">
              {t('profiles.label')}
            </label>
            <select
              id="data-import-source-profile"
              value={profileId}
              disabled={disabled}
              onChange={event => onProfileChange(event.target.value as ProductImportProfileId)}
              className="input w-full"
            >
              {PRODUCT_IMPORT_PROFILE_IDS.map(id => (
                <option key={id} value={id}>
                  {t(`profiles.options.${id}`)}
                </option>
              ))}
            </select>
          </div>
          <span className="inline-flex w-fit rounded-full border border-primary-200 bg-white px-3 py-1.5 text-xs font-semibold text-primary-800">
            {knownFormat ? t('profiles.detected') : t('profiles.reviewRequired')}
          </span>
        </div>
        <p className="mt-3 text-xs font-medium leading-5 text-secondary-800">
          {t(`profiles.details.${profileId}`)}
        </p>
        <p className="mt-3 text-xs leading-5 text-secondary-600">{t('profiles.boundary')}</p>
      </div>

      {warnings.length > 0 ? (
        <ul className="space-y-2" data-testid="data-import-mapping-warnings">
          {warnings.map(warning => (
            <li
              key={warning}
              className="flex items-start gap-2 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-800"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{warning}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="space-y-3" data-testid="data-import-mapping-summary">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-semibold text-secondary-900">
            {t('steps.map.recognized', { count: recognized.length })}
          </p>
          {requiredMissing ? null : (
            <Button
              type="button"
              variant="outline"
              aria-expanded={showFields}
              aria-controls="data-import-mapping-fields"
              disabled={disabled}
              onClick={() => setReviewOpen(open => !open)}
            >
              <ChevronDown
                className={showFields ? 'h-4 w-4 rotate-180' : 'h-4 w-4'}
                aria-hidden="true"
              />
              {t(showFields ? 'steps.map.hideFields' : 'steps.map.reviewFields')}
            </Button>
          )}
        </div>
        {recognized.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {recognized.map(field => (
              <li
                key={field}
                className="rounded-full border border-line bg-white px-3 py-1 text-xs text-secondary-700"
              >
                {t('steps.map.pair', { column: mapping[field], field: t(`fields.${field}`) })}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div
        id="data-import-mapping-fields"
        hidden={!showFields}
        className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3"
      >
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
