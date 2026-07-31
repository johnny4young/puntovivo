import { Hash, TriangleAlert } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { QuickFormSection } from '@/components/experience/QuickFormSection';
import type { Sequential, Site } from '@/types';
import type { SequentialFormValues } from './sequentialForm.types';

interface SequentialEssentialSectionProps {
  form: UseFormReturn<SequentialFormValues>;
  sequential: Sequential | null;
  sites: Site[];
  documentTypeLabels: Record<Sequential['documentType'], string>;
}

export function SequentialEssentialSection({
  form,
  sequential,
  sites,
  documentTypeLabels,
}: SequentialEssentialSectionProps): React.ReactElement {
  const { t } = useTranslation('sequentials');
  const siteName =
    sequential?.siteName ?? sites.find(site => site.id === sequential?.siteId)?.name ?? '';

  return (
    <QuickFormSection
      icon={Hash}
      eyebrow={t('form.essential.eyebrow')}
      title={sequential ? t('form.essential.editTitle') : t('form.essential.createTitle')}
      description={
        sequential ? t('form.essential.editDescription') : t('form.essential.createDescription')
      }
      headingLevel={4}
    >
      {sequential ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" {...form.register('siteId')} />
          <input type="hidden" {...form.register('documentType')} />
          <div className="rounded-xl border border-line bg-surface-2/55 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-secondary-500">
              {t('columns.site')}
            </p>
            <p className="mt-1 font-semibold text-secondary-950">{siteName}</p>
          </div>
          <div className="rounded-xl border border-line bg-surface-2/55 px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-secondary-500">
              {t('columns.documentType')}
            </p>
            <p className="mt-1 font-semibold text-secondary-950">
              {documentTypeLabels[sequential.documentType]}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="sequential-site" className="label">
              {t('columns.site')}
            </label>
            <select
              id="sequential-site"
              className="input mt-1"
              {...form.register('siteId', { required: t('form.fields.siteRequired') })}
            >
              <option value="">{t('form.fields.selectSite')}</option>
              {sites.map(site => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
            {form.formState.errors.siteId ? (
              <p className="mt-1 text-sm text-danger-500">{form.formState.errors.siteId.message}</p>
            ) : null}
          </div>

          <div>
            <label htmlFor="sequential-document-type" className="label">
              {t('columns.documentType')}
            </label>
            <select
              id="sequential-document-type"
              className="input mt-1"
              {...form.register('documentType', {
                required: t('form.fields.documentTypeRequired'),
              })}
            >
              {Object.entries(documentTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div>
        <label htmlFor="sequential-prefix" className="label">
          {t('form.fields.prefix')}
        </label>
        <input
          id="sequential-prefix"
          className="input mt-1 font-mono"
          maxLength={20}
          autoComplete="off"
          aria-describedby="sequential-prefix-help"
          {...form.register('prefix', {
            maxLength: { value: 20, message: t('form.fields.prefixMax') },
          })}
        />
        <p id="sequential-prefix-help" className="mt-1 text-xs leading-5 text-secondary-500">
          {t('form.fields.prefixHelp')}
        </p>
        {form.formState.errors.prefix ? (
          <p className="mt-1 text-sm text-danger-500">{form.formState.errors.prefix.message}</p>
        ) : null}
      </div>
    </QuickFormSection>
  );
}

interface SequentialCounterFieldsProps {
  form: UseFormReturn<SequentialFormValues>;
  nextPreview: string;
  isLowering: boolean;
}

export function SequentialCounterFields({
  form,
  nextPreview,
  isLowering,
}: SequentialCounterFieldsProps): React.ReactElement {
  const { t } = useTranslation('sequentials');

  return (
    <fieldset className="rounded-xl border border-warning-200 bg-warning-50/70 p-4">
      <legend className="px-1 text-sm font-semibold text-secondary-950">
        {t('form.advanced.counterTitle')}
      </legend>
      <div className="flex gap-3 text-sm text-warning-900">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="leading-5">{t('form.advanced.counterWarning')}</p>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,12rem)_1fr] sm:items-end">
        <div>
          <label htmlFor="sequential-current-value" className="label">
            {t('form.fields.currentValue')}
          </label>
          <input
            id="sequential-current-value"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            className="input mt-1 font-mono"
            {...form.register('currentValue', {
              valueAsNumber: true,
              required: t('form.fields.currentValueRequired'),
              validate: {
                finite: value => Number.isFinite(value) || t('form.fields.currentValueRequired'),
                integer: value => Number.isInteger(value) || t('form.fields.currentValueInteger'),
              },
              min: { value: 0, message: t('form.fields.currentValueMin') },
            })}
          />
          {form.formState.errors.currentValue ? (
            <p className="mt-1 text-sm text-danger-500">
              {form.formState.errors.currentValue.message}
            </p>
          ) : null}
        </div>

        <div className="rounded-xl border border-warning-200 bg-white/70 px-4 py-3">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-secondary-500">
            {t('form.advanced.nextNumber')}
          </p>
          <output className="mt-1 block font-mono text-lg font-semibold text-secondary-950">
            {nextPreview}
          </output>
        </div>
      </div>

      {isLowering ? (
        <p role="alert" className="mt-3 text-sm font-semibold text-danger-700">
          {t('form.advanced.loweringWarning')}
        </p>
      ) : null}
    </fieldset>
  );
}
