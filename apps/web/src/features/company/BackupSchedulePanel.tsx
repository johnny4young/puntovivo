import { CalendarClock, FolderOpen, HardDrive, Play, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { formatDateTime } from '@/lib/utils';
import type { BackupScheduleFrequency, BackupScheduleStatus } from '@/types/electron';

type ScheduleAction = 'load' | 'save' | 'destination' | 'snapshot' | null;

function formatBytes(value: number | null): string | null {
  if (value === null) return null;
  if (value < 1_024) return `${value} B`;
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / (1_024 * 1_024)).toFixed(1)} MB`;
}

export function BackupSchedulePanel() {
  const { t } = useTranslation('backupProtection');
  const toast = useToast();
  const electron = typeof window !== 'undefined' ? window.electron : undefined;
  const supported = Boolean(
    electron?.getBackupScheduleStatus &&
    electron.updateBackupSchedule &&
    electron.chooseBackupScheduleDestination &&
    electron.runBackupSnapshotNow
  );
  const [status, setStatus] = useState<BackupScheduleStatus | null>(null);
  const [frequency, setFrequency] = useState<BackupScheduleFrequency>('off');
  const [action, setAction] = useState<ScheduleAction>(supported ? 'load' : null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!electron?.getBackupScheduleStatus) return;
    void electron
      .getBackupScheduleStatus()
      .then(result => {
        if (cancelled) return;
        if (!result.success || !result.status) {
          setError(t('schedule.errors.load'));
          return;
        }
        setStatus(result.status);
        setFrequency(result.status.frequency);
      })
      .catch(() => {
        if (!cancelled) setError(t('schedule.errors.load'));
      })
      .finally(() => {
        if (!cancelled) setAction(null);
      });
    return () => {
      cancelled = true;
    };
  }, [electron, t]);

  const handleSave = async (destinationMode?: 'managed') => {
    if (!electron?.updateBackupSchedule) return;
    setAction(destinationMode ? 'destination' : 'save');
    setError(null);
    try {
      const result = await electron.updateBackupSchedule({
        frequency,
        ...(destinationMode ? { destinationMode } : {}),
      });
      if (!result.success || !result.status) throw new Error('schedule_unavailable');
      setStatus(result.status);
      setFrequency(result.status.frequency);
      toast.success({ title: t('schedule.toast.saved') });
    } catch {
      setError(t('schedule.errors.save'));
    } finally {
      setAction(null);
    }
  };

  const handleChooseDestination = async () => {
    if (!electron?.chooseBackupScheduleDestination) return;
    setAction('destination');
    setError(null);
    try {
      const result = await electron.chooseBackupScheduleDestination();
      if (result.cancelled) return;
      if (!result.success || !result.status) throw new Error('schedule_unavailable');
      setStatus(result.status);
      toast.success({ title: t('schedule.toast.destination') });
    } catch {
      setError(t('schedule.errors.destination'));
    } finally {
      setAction(null);
    }
  };

  const handleRunNow = async () => {
    if (!electron?.runBackupSnapshotNow) return;
    setAction('snapshot');
    setError(null);
    try {
      const result = await electron.runBackupSnapshotNow();
      if (!result.success || !result.status) throw new Error('snapshot_failed');
      setStatus(result.status);
      toast.success({ title: t('schedule.toast.created') });
    } catch {
      setError(t('schedule.errors.snapshot'));
    } finally {
      setAction(null);
    }
  };

  const busy = action !== null;
  const size = formatBytes(status?.lastSizeBytes ?? null);

  return (
    <section
      className="rounded-2xl border border-line bg-surface-1 p-4 sm:p-5"
      data-testid="backup-schedule-panel"
    >
      <div className="flex items-start gap-3">
        <span className="pv-gt pv-gt-primary h-9 w-9 shrink-0">
          <CalendarClock className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h3 className="font-semibold text-secondary-950">{t('schedule.title')}</h3>
          <p className="mt-1 text-sm text-secondary-600">{t('schedule.description')}</p>
        </div>
      </div>

      {!supported ? (
        <p className="mt-4 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-secondary-600">
          {t('schedule.unsupported')}
        </p>
      ) : (
        <div className="mt-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="metric-tile p-3">
              <p className="pv-kicker">{t('schedule.lastSuccess')}</p>
              <p
                className="mt-1 text-sm font-semibold text-secondary-950"
                data-testid="backup-last-success"
              >
                {status?.lastSuccessAt ? formatDateTime(status.lastSuccessAt) : t('schedule.never')}
              </p>
              {size && <p className="mt-1 text-xs text-secondary-500">{size}</p>}
            </div>
            <div className="metric-tile p-3">
              <p className="pv-kicker">{t('schedule.nextRun')}</p>
              <p className="mt-1 text-sm font-semibold text-secondary-950">
                {status?.nextRunAt ? formatDateTime(status.nextRunAt) : t('schedule.notScheduled')}
              </p>
            </div>
            <div className="metric-tile p-3">
              <p className="pv-kicker">{t('schedule.destinationLabel')}</p>
              <p className="mt-1 text-sm font-semibold text-secondary-950">
                {status?.destinationMode === 'custom'
                  ? t('schedule.custom')
                  : t('schedule.managed')}
              </p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,12rem)_1fr] md:items-end">
            <label className="space-y-1 text-sm font-medium text-secondary-700">
              <span>{t('schedule.frequencyLabel')}</span>
              <select
                className="pv-input w-full"
                value={frequency}
                onChange={event => setFrequency(event.target.value as BackupScheduleFrequency)}
                disabled={busy}
                aria-label={t('schedule.frequencyLabel')}
              >
                <option value="off">{t('schedule.frequency.off')}</option>
                <option value="daily">{t('schedule.frequency.daily')}</option>
                <option value="weekly">{t('schedule.frequency.weekly')}</option>
              </select>
            </label>

            <div className="min-w-0 rounded-xl border border-line bg-surface-2 px-3 py-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-secondary-500">
                <HardDrive className="h-3.5 w-3.5" aria-hidden="true" />
                {t('schedule.folder')}
              </div>
              <p
                className="mt-1 break-all font-mono text-xs text-secondary-700"
                data-testid="backup-destination"
              >
                {status?.destinationDirectory ?? t('schedule.loading')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="pv-btn primary"
              onClick={() => void handleSave()}
              disabled={busy || !status}
            >
              <Save aria-hidden="true" />
              {action === 'save' ? t('schedule.saving') : t('schedule.save')}
            </button>
            <button
              type="button"
              className="pv-btn outline"
              onClick={() => void handleRunNow()}
              disabled={busy || !status}
            >
              <Play aria-hidden="true" />
              {action === 'snapshot' ? t('schedule.running') : t('schedule.runNow')}
            </button>
            <button
              type="button"
              className="pv-btn outline"
              onClick={() => void handleChooseDestination()}
              disabled={busy || !status}
            >
              <FolderOpen aria-hidden="true" />
              {t('schedule.chooseFolder')}
            </button>
            {status?.destinationMode === 'custom' && (
              <button
                type="button"
                className="pv-btn ghost"
                onClick={() => void handleSave('managed')}
                disabled={busy}
              >
                {t('schedule.useManaged')}
              </button>
            )}
          </div>

          {error && (
            <p
              className="rounded-xl border border-danger-300 bg-danger-50 px-3 py-2 text-sm text-danger-700"
              role="alert"
            >
              {error}
            </p>
          )}
          {status?.lastError && !error && (
            <p
              className="rounded-xl border border-warning-300 bg-warning-50 px-3 py-2 text-sm text-warning-900"
              role="status"
            >
              {t('schedule.lastRunFailed')}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
