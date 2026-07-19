import { ClipboardCheck, Play, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { formatDateTime } from '@/lib/utils';
import type { BackupRestoreDrillReport, BackupRestoreDrillTable } from '@/types/electron';

type DrillError = 'snapshot_unavailable' | 'drill_failed' | null;

function formatDelta(value: number, locale: string): string {
  const formatted = new Intl.NumberFormat(locale).format(Math.abs(value));
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted}`;
  return '0';
}

export function BackupRestoreDrillPanel() {
  const { t, i18n } = useTranslation('backupProtection');
  const toast = useToast();
  const electron = typeof window !== 'undefined' ? window.electron : undefined;
  const supported = Boolean(electron?.runBackupRestoreDrill);
  const [report, setReport] = useState<BackupRestoreDrillReport | null>(null);
  const [error, setError] = useState<DrillError>(null);
  const [running, setRunning] = useState(false);
  const numberFormat = new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language);

  const runDrill = async () => {
    if (!electron?.runBackupRestoreDrill) return;
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      const result = await electron.runBackupRestoreDrill();
      if (!result.success) {
        setReport(null);
        setError(result.error);
        return;
      }
      setReport(result.report);
      toast.success({ title: t('drill.toast.passed') });
    } catch {
      setReport(null);
      setError('drill_failed');
    } finally {
      setRunning(false);
    }
  };

  const tableLabel = (table: BackupRestoreDrillTable) => t(`drill.tables.${table}`);

  return (
    <section
      className="rounded-2xl border border-line bg-surface-1 p-4 sm:p-5"
      data-testid="backup-restore-drill-panel"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="pv-gt pv-gt-success h-9 w-9 shrink-0">
            <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 className="font-semibold text-secondary-950">{t('drill.title')}</h3>
            <p className="mt-1 text-sm text-secondary-600">{t('drill.description')}</p>
          </div>
        </div>
        {supported && (
          <button
            type="button"
            className="pv-btn outline"
            onClick={() => void runDrill()}
            disabled={running}
            data-testid="run-backup-restore-drill"
          >
            <Play aria-hidden="true" />
            {running ? t('drill.running') : t('drill.run')}
          </button>
        )}
      </div>

      {!supported && (
        <p className="mt-4 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-secondary-600">
          {t('drill.unsupported')}
        </p>
      )}

      {error && (
        <p
          className="mt-4 rounded-xl border border-danger-300 bg-danger-50 px-3 py-2 text-sm text-danger-700"
          role="alert"
        >
          {error === 'snapshot_unavailable'
            ? t('drill.errors.snapshotUnavailable')
            : t('drill.errors.failed')}
        </p>
      )}

      {report && (
        <div className="mt-5 space-y-4" data-testid="backup-restore-drill-report" role="status">
          <div className="flex items-start gap-3 rounded-xl border border-success-300/70 bg-success-50 px-4 py-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success-700" aria-hidden="true" />
            <div>
              <p className="font-semibold text-success-900">{t('drill.result.title')}</p>
              <p className="mt-1 text-sm text-success-800">{t('drill.result.description')}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="metric-tile p-3">
              <p className="pv-kicker">{t('drill.result.checkedAt')}</p>
              <p className="mt-1 text-sm font-semibold text-secondary-950">
                {formatDateTime(report.checkedAt)}
              </p>
            </div>
            <div className="metric-tile p-3">
              <p className="pv-kicker">{t('drill.result.snapshotAt')}</p>
              <p className="mt-1 text-sm font-semibold text-secondary-950">
                {formatDateTime(report.snapshotGeneratedAt)}
              </p>
            </div>
            <div className="metric-tile p-3">
              <p className="pv-kicker">{t('drill.result.currentTotal')}</p>
              <p className="mt-1 text-lg font-bold text-secondary-950">
                {numberFormat.format(report.currentTotal)}
              </p>
            </div>
            <div className="metric-tile p-3">
              <p className="pv-kicker">{t('drill.result.snapshotTotal')}</p>
              <p className="mt-1 text-lg font-bold text-secondary-950">
                {numberFormat.format(report.snapshotTotal)}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="min-w-full text-left text-sm">
              <caption className="sr-only">{t('drill.result.tableCaption')}</caption>
              <thead className="bg-surface-2 text-xs uppercase tracking-wide text-secondary-500">
                <tr>
                  <th className="px-3 py-2 font-semibold" scope="col">
                    {t('drill.result.area')}
                  </th>
                  <th className="px-3 py-2 text-right font-semibold" scope="col">
                    {t('drill.result.current')}
                  </th>
                  <th className="px-3 py-2 text-right font-semibold" scope="col">
                    {t('drill.result.snapshot')}
                  </th>
                  <th className="px-3 py-2 text-right font-semibold" scope="col">
                    {t('drill.result.delta')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {report.tables.map(row => (
                  <tr key={row.table}>
                    <th className="px-3 py-2 font-medium text-secondary-800" scope="row">
                      {tableLabel(row.table)}
                    </th>
                    <td className="px-3 py-2 text-right text-secondary-700">
                      {numberFormat.format(row.currentCount)}
                    </td>
                    <td className="px-3 py-2 text-right text-secondary-700">
                      {numberFormat.format(row.snapshotCount)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-secondary-800">
                      {formatDelta(row.delta, i18n.resolvedLanguage ?? i18n.language)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-secondary-500">{t('drill.result.deltaNote')}</p>
        </div>
      )}
    </section>
  );
}
