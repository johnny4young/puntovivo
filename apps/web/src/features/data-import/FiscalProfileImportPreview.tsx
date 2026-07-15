import { AlertTriangle, CheckCircle2, Copy, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { ImportCommitGuard } from './ImportCommitGuard';
import type {
  FiscalProfileImportIssue,
  FiscalProfileImportPreview,
  LaunchImportDataMode,
} from './types';

interface FiscalProfileImportPreviewProps {
  completed: boolean;
  confirmedRealData: boolean;
  dataMode: LaunchImportDataMode;
  importing: boolean;
  onConfirmRealData: (confirmed: boolean) => void;
  onDownloadIssues: () => void;
  onImport: () => void;
  preview: FiscalProfileImportPreview;
}

const STATUS_STYLE = {
  ready: 'bg-success-50 text-success-800 border-success-200',
  duplicate: 'bg-warning-50 text-warning-800 border-warning-200',
  invalid: 'bg-danger-50 text-danger-800 border-danger-200',
} as const;

function issueKey(issue: FiscalProfileImportIssue) {
  return `fiscalProfiles.issues.${issue.code}`;
}

function profileDetails(row: FiscalProfileImportPreview['rows'][number], empty: string): string {
  const profile = row.normalized;
  const values =
    profile.countryCode === 'CO'
      ? [profile.resolutionNumber, profile.numberingPrefix, profile.rangeFrom, profile.rangeTo]
      : profile.countryCode === 'CL'
        ? [profile.economicActivityCode, profile.administrativeAreaCode, profile.issueLocation]
        : [profile.economicActivityCode, profile.issueLocation];
  return values.filter(value => value !== null && value !== '').join(' · ') || empty;
}

export function FiscalProfileImportPreviewPanel({
  completed,
  confirmedRealData,
  dataMode,
  importing,
  onConfirmRealData,
  onDownloadIssues,
  onImport,
  preview,
}: FiscalProfileImportPreviewProps) {
  const { t } = useTranslation('dataImport');
  const hasIssues = preview.summary.duplicates + preview.summary.invalid > 0;

  return (
    <section className="card space-y-5 p-6" aria-labelledby="fiscal-profile-preview-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-700">
            {t('steps.preview.kicker')}
          </p>
          <h2
            id="fiscal-profile-preview-title"
            className="mt-1 text-lg font-semibold text-secondary-900"
          >
            {t('steps.preview.title')}
          </h2>
          <p className="mt-1 text-sm text-secondary-600">
            {t('fiscalProfiles.previewDescription', {
              country: preview.tenantCountryCode ?? t('table.emptyValue'),
            })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {hasIssues ? (
            <button type="button" className="pv-btn outline" onClick={onDownloadIssues}>
              {t('actions.downloadIssues')}
            </button>
          ) : null}
          <ImportCommitGuard
            completed={completed}
            confirmed={confirmedRealData}
            dataMode={dataMode}
            importing={importing}
            onConfirm={onConfirmRealData}
            onImport={onImport}
            ready={preview.summary.ready}
          />
        </div>
      </div>

      <div
        className="flex gap-3 rounded-lg border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-950"
        data-testid="data-import-fiscal-activation-boundary"
      >
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <span>{t('fiscalProfiles.activationBoundary')}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-4" aria-label={t('summary.ariaLabel')}>
        {(
          [
            ['total', preview.summary.total, Copy],
            ['ready', preview.summary.ready, CheckCircle2],
            ['duplicates', preview.summary.duplicates, Copy],
            ['invalid', preview.summary.invalid, AlertTriangle],
          ] as const
        ).map(([key, value, Icon]) => (
          <div key={key} className="metric-tile p-4" data-testid={`data-import-summary-${key}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-secondary-500">
                {t(`summary.${key}`)}
              </span>
              <Icon className="h-4 w-4 text-secondary-400" aria-hidden="true" />
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-secondary-900">{value}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-secondary-50 text-xs uppercase tracking-wide text-secondary-600">
            <tr>
              <th className="px-4 py-3">{t('table.row')}</th>
              <th className="px-4 py-3">{t('fiscalProfiles.fields.countryCode')}</th>
              <th className="px-4 py-3">{t('fiscalProfiles.fields.taxIdentifier')}</th>
              <th className="px-4 py-3">{t('fiscalProfiles.profileDetails')}</th>
              <th className="px-4 py-3">{t('fiscalProfiles.fields.environment')}</th>
              <th className="px-4 py-3">{t('table.status')}</th>
              <th className="px-4 py-3">{t('table.details')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-white">
            {preview.rows.slice(0, 100).map(row => (
              <tr key={row.rowNumber} data-testid={`data-import-preview-row-${row.rowNumber}`}>
                <td className="px-4 py-3 tabular-nums text-secondary-600">{row.rowNumber}</td>
                <td className="px-4 py-3 font-medium text-secondary-900">
                  {row.normalized.countryCode ?? t('table.emptyValue')}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-secondary-900">
                  {row.normalized.taxIdentifier || t('table.emptyValue')}
                </td>
                <td className="max-w-sm px-4 py-3 text-xs text-secondary-700">
                  {profileDetails(row, t('table.emptyValue'))}
                </td>
                <td className="px-4 py-3 text-secondary-700">
                  {row.normalized.environment || t('table.emptyValue')}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={cn(
                      'inline-flex rounded-full border px-2 py-1 text-xs font-semibold',
                      STATUS_STYLE[row.status]
                    )}
                  >
                    {t(`statuses.${row.status}`)}
                  </span>
                </td>
                <td className="max-w-xs px-4 py-3 text-xs text-secondary-600">
                  {row.issues.length === 0
                    ? t('table.noIssues')
                    : row.issues
                        .map(issue =>
                          t('table.issueFormat', {
                            field: t(`fiscalProfiles.fields.${issue.field}`),
                            issue: t(issueKey(issue)),
                          })
                        )
                        .join(' · ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
