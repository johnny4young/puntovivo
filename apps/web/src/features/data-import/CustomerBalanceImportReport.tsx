import { CheckCircle2, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CustomerBalanceImportReport } from './types';
import { Button } from '@/components/ui';
interface CustomerBalanceImportReportProps {
  onDownloadReport: () => void;
  report: CustomerBalanceImportReport;
}
export function CustomerBalanceImportReportPanel({
  onDownloadReport,
  report,
}: CustomerBalanceImportReportProps) {
  const { t } = useTranslation('dataImport');
  return (
    <section
      className="card border-success-200 bg-success-50/40 p-6"
      aria-labelledby="customer-balance-report-title"
      data-testid="data-import-report"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <span className="mt-0.5 rounded-full bg-success-100 p-2 text-success-700">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-success-800">
              {t('report.kicker')}
            </p>
            <h2
              id="customer-balance-report-title"
              className="mt-1 text-lg font-semibold text-secondary-900"
            >
              {t('report.title')}
            </h2>
            <p className="mt-1 text-sm text-secondary-600">
              {t('customerBalances.reportDescription', {
                count: report.summary.imported,
              })}
            </p>
            <p className="mt-2 text-xs text-secondary-500">
              {t('report.importId')}{' '}
              <span className="font-mono text-secondary-700">{report.importId}</span>
            </p>
          </div>
        </div>
        <Button type="button" onClick={onDownloadReport} variant="outline">
          <Download className="h-4 w-4" aria-hidden="true" />
          {t('actions.downloadReport')}
        </Button>
      </div>
      <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {(['imported', 'skipped', 'invalid', 'failed', 'warnings'] as const).map(key => (
          <div
            key={key}
            className="rounded-lg border border-success-200/70 bg-white p-3"
            data-testid={`data-import-report-${key}`}
          >
            <dt className="text-xs text-secondary-500">{t(`report.metrics.${key}`)}</dt>
            <dd className="mt-1 text-xl font-semibold tabular-nums text-secondary-900">
              {report.summary[key]}
            </dd>
          </div>
        ))}
      </dl>
      <p
        className="mt-4 rounded-lg border border-warning-200 bg-warning-50 px-3 py-2 text-xs leading-5 text-warning-900"
        data-testid="data-import-report-rollback"
      >
        {t('report.rollbackReminder')}
      </p>
    </section>
  );
}
