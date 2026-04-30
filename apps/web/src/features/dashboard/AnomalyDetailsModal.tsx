/**
 * ENG-032 — drill-down modal for the anomaly tile.
 *
 * Read-only by design in v1. The "investigate cashier" CTA mentioned
 * in the plan is captured as a BACKLOG follow-up; this modal only
 * surfaces the data + a filter so a manager can scan the list quickly.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldAlert } from 'lucide-react';

import { Modal } from '@/components/form-controls/Modal';
import { useTenantSettings } from '@/hooks';
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

export function AnomalyDetailsModal({ isOpen, onClose, alerts }: AnomalyDetailsModalProps) {
  const { t } = useTranslation('aiAnomalies');
  const { formatCurrency, formatDateTime } = useTenantSettings();
  const [filter, setFilter] = useState<AnomalyKind | 'all'>('all');

  const filteredAlerts = useMemo(
    () => (filter === 'all' ? alerts : alerts.filter(a => a.kind === filter)),
    [alerts, filter]
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t('modal.title')} size="full">
      <div className="space-y-5">
        <p className="text-sm text-secondary-600">{t('modal.description')}</p>

        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm">
            <span className="sr-only">{t('modal.filters.all')}</span>
            <select
              className="rounded-md border border-secondary-300 bg-white px-2 py-2 text-sm"
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
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-line/70 text-sm">
              <thead className="bg-secondary-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.16em] text-secondary-500">
                    {t('modal.table.severity')}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.16em] text-secondary-500">
                    {t('modal.table.kind')}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.16em] text-secondary-500">
                    {t('modal.table.cashier')}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.16em] text-secondary-500">
                    {t('modal.table.observed')}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.16em] text-secondary-500">
                    {t('modal.table.baseline')}
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.16em] text-secondary-500">
                    {t('modal.table.occurredAt')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line/60 bg-surface">
                {filteredAlerts.map(alert => (
                  <tr key={alert.id}>
                    <td className="px-3 py-2.5 align-middle">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold',
                          alert.severity === 'high'
                            ? 'bg-danger-50 text-danger-700'
                            : 'bg-amber-50 text-amber-700'
                        )}
                      >
                        <ShieldAlert className="h-3 w-3" />
                        {t(`card.severity.${alert.severity}`)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-secondary-700">
                      {t(`modal.kindLabels.${alert.kind}`)}
                    </td>
                    <td className="px-3 py-2.5 text-secondary-800">
                      {alert.cashierName ?? alert.cashierId ?? t('modal.cashierUnknown')}
                    </td>
                    <td className="px-3 py-2.5 font-semibold text-secondary-950">
                      {formatMetric(alert.observed, alert.kind, formatCurrency)}
                    </td>
                    <td className="px-3 py-2.5 text-secondary-600">
                      {formatMetric(alert.baselineMean, alert.kind, formatCurrency)}
                    </td>
                    <td className="px-3 py-2.5 text-secondary-600">
                      {formatDateTime(alert.occurredAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
