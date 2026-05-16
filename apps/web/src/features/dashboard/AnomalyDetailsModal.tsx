/**
 * ENG-032 — drill-down modal for the anomaly tile.
 *
 * Read-only by design in v1. The "investigate cashier" CTA mentioned
 * in the plan is captured as a BACKLOG follow-up; this modal only
 * surfaces the data + a filter so a manager can scan the list quickly.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, BellOff, ShieldAlert } from 'lucide-react';

import { Overlay } from '@/components/overlay/Overlay';
import { useToast } from '@/components/feedback/ToastProvider';
import { useTenantSettings } from '@/hooks';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

export type AnomalyKind =
  | 'ticketsPerHourSpike'
  | 'voidRate'
  | 'refundAmount'
  | 'noSaleSessions';

export type AnomalySeverity = 'medium' | 'high';

export interface AnomalyAlertView {
  id: string;
  kind: AnomalyKind;
  cashierId: string | null;
  cashierName: string | null;
  severity: AnomalySeverity;
  observed: number;
  baselineMean: number;
  baselineStdDev: number;
  distance: number;
  occurredAt: string;
  evidenceRef: string | null;
}

interface AnomalyDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  alerts: AnomalyAlertView[];
}

const FILTER_OPTIONS: Array<AnomalyKind | 'all'> = [
  'all',
  'ticketsPerHourSpike',
  'voidRate',
  'refundAmount',
  'noSaleSessions',
];

/**
 * Format the `observed` and `baselineMean` columns. For refundAmount
 * the metric is a currency; for voidRate it is a ratio rendered as
 * a percentage; for ticketsPerHourSpike + noSaleSessions it is a
 * raw integer count.
 */
function formatMetric(
  value: number,
  kind: AnomalyKind,
  formatCurrency: (amount: number) => string
): string {
  switch (kind) {
    case 'refundAmount':
      return formatCurrency(value);
    case 'voidRate':
      return `${(value * 100).toFixed(1)}%`;
    case 'ticketsPerHourSpike':
    case 'noSaleSessions':
      return Math.round(value).toLocaleString();
    default:
      return value.toFixed(2);
  }
}

type SortKey = 'severity' | 'occurredAt' | 'observed';
type SortDir = 'asc' | 'desc';
const SEVERITY_ORDER: Record<AnomalySeverity, number> = { high: 1, medium: 0 };

interface SortHeaderProps {
  label: string;
  columnKey: SortKey;
  align?: 'left' | 'right';
  activeKey: SortKey;
  activeDir: SortDir;
  onToggle: (key: SortKey) => void;
}

function SortHeader({ label, columnKey, align = 'left', activeKey, activeDir, onToggle }: SortHeaderProps) {
  const isActive = activeKey === columnKey;
  return (
    <th
      scope="col"
      className={cn(
        'px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-secondary-500',
        align === 'right' ? 'text-right' : 'text-left'
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(columnKey)}
        className={cn(
          'inline-flex items-center gap-1 transition-colors hover:text-primary-700',
          isActive && 'text-primary-700'
        )}
      >
        {label}
        {isActive ? (
          activeDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : null}
      </button>
    </th>
  );
}

export function AnomalyDetailsModal({ isOpen, onClose, alerts }: AnomalyDetailsModalProps) {
  const { t } = useTranslation(['aiAnomalies', 'aiShared']);
  const { formatCurrency, formatDateTime } = useTenantSettings();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [filter, setFilter] = useState<AnomalyKind | 'all'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('severity');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const filteredAlerts = useMemo(() => {
    const filtered = filter === 'all' ? alerts : alerts.filter(a => a.kind === filter);
    const direction = sortDir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let delta: number;
      if (sortKey === 'severity') {
        delta = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
      } else if (sortKey === 'occurredAt') {
        delta = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
      } else {
        delta = a.observed - b.observed;
      }
      return delta * direction;
    });
  }, [alerts, filter, sortKey, sortDir]);

  // ENG-047 — snooze a flagged pattern for 7 days. The mutation key is
  // (kind, cashierId, evidenceRef) so the same dollar value can later
  // surface again from a different sale without re-triggering the
  // silenced row. Optimistically refetches anomalies on success so the
  // row disappears from the modal.
  const snoozeMutation = trpc.ai.anomalies.snooze.useMutation({
    onSuccess: result => {
      toast.success({
        title: t('modal.snoozeSuccessTitle'),
        description: t('modal.snoozeSuccessDescription', {
          until: formatDateTime(result.snoozedUntil),
        }),
      });
      void utils.ai.anomalies.list.invalidate();
    },
    onError: onErrorToast(toast, t, { titleKey: 'aiAnomalies:modal.snoozeErrorTitle' }),
  });

  const handleSnooze = (alert: AnomalyAlertView) => {
    snoozeMutation.mutate({
      kind: alert.kind,
      cashierId: alert.cashierId,
      evidenceRef: alert.evidenceRef,
      durationDays: 7,
    });
  };

  return (
    <Overlay
      isOpen={isOpen}
      onClose={onClose}
      size="full"
      kicker={t('card.kicker', { defaultValue: 'Anomalías' })}
      title={t('modal.title')}
      description={t('modal.description')}
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm">
            <span className="sr-only">{t('modal.filters.all')}</span>
            <select
              className="rounded-full border border-line/70 bg-surface-2/60 px-3 py-1.5 text-[12.5px] text-secondary-800 outline-none focus:border-primary-300"
              value={filter}
              onChange={event => setFilter(event.target.value as AnomalyKind | 'all')}
              data-testid="anomaly-filter"
            >
              {FILTER_OPTIONS.map(option => (
                <option key={option} value={option}>
                  {t(`modal.filters.${option}`)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {filteredAlerts.length === 0 ? (
          <div className="surface-panel-muted text-sm text-secondary-600">
            {t('modal.noResults')}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line/70">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-line/70 text-sm">
                <thead className="bg-secondary-50/80">
                  <tr>
                    <SortHeader
                      label={t('modal.table.severity')}
                      columnKey="severity"
                      activeKey={sortKey}
                      activeDir={sortDir}
                      onToggle={toggleSort}
                    />
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.16em] text-secondary-500">
                      {t('modal.table.kind')}
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.16em] text-secondary-500">
                      {t('modal.table.cashier')}
                    </th>
                    <SortHeader
                      label={t('modal.table.observed')}
                      columnKey="observed"
                      activeKey={sortKey}
                      activeDir={sortDir}
                      onToggle={toggleSort}
                    />
                    <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.16em] text-secondary-500">
                      {t('modal.table.baseline')}
                    </th>
                    <SortHeader
                      label={t('modal.table.occurredAt')}
                      columnKey="occurredAt"
                      activeKey={sortKey}
                      activeDir={sortDir}
                      onToggle={toggleSort}
                    />
                    <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-[0.16em] text-secondary-500">
                      <span className="sr-only">{t('modal.snoozeAction')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/60 bg-surface">
                  {filteredAlerts.map(alert => (
                    <tr
                      key={alert.id}
                      className={cn(
                        alert.severity === 'high' ? 'bg-danger-50/30' : 'bg-warning-50/15'
                      )}
                    >
                      <td className="px-3 py-2.5 align-middle">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]',
                            alert.severity === 'high'
                              ? 'bg-danger-50 text-danger-700'
                              : 'bg-warning-50 text-warning-700'
                          )}
                        >
                          <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                          {t(`card.severity.${alert.severity}`)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-secondary-700">
                        {t(`modal.kindLabels.${alert.kind}`)}
                      </td>
                      <td className="px-3 py-2.5 text-secondary-800">
                        {alert.cashierName ?? alert.cashierId ?? t('modal.cashierUnknown')}
                      </td>
                      <td className="px-3 py-2.5 font-semibold tabular-nums text-secondary-950">
                        {formatMetric(alert.observed, alert.kind, formatCurrency)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums text-secondary-600">
                        {formatMetric(alert.baselineMean, alert.kind, formatCurrency)}
                      </td>
                      <td className="px-3 py-2.5 text-secondary-600">
                        {formatDateTime(alert.occurredAt)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <button
                          type="button"
                          className="btn-outline inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold"
                          onClick={() => handleSnooze(alert)}
                          disabled={snoozeMutation.isPending}
                          data-testid={`anomaly-snooze-${alert.id}`}
                        >
                          <BellOff className="h-3.5 w-3.5" />
                          {snoozeMutation.isPending && snoozeMutation.variables?.kind === alert.kind
                            ? t('modal.snoozing')
                            : t('modal.snoozeAction')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-[11px] leading-5 text-secondary-500">
          {t('aiShared:disclaimer.anomaly')}
        </p>
      </div>
    </Overlay>
  );
}
