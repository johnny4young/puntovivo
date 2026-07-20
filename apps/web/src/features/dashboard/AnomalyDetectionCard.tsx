/**
 * admin/manager dashboard tile for the anomaly detector.
 *
 * Reads `ai.anomalies.list` for the alerts and the master enabled
 * flag. The server short-circuits this query to `enabled=false` +
 * empty counts when ai.enabled is false, so managers can render the
 * disabled state without calling the admin-only settings endpoint.
 *
 * States surfaced:
 * - loading
 * - error
 * - disabled (ai.enabled = false → CTA to /company)
 * - empty (no alerts)
 * - has-alerts (counter + severity pills + open-modal button)
 *
 * Cashier role never reaches this component — `dashboardRoles`
 * already excludes them at the route level. Defense-in-depth at
 * the API: `ai.anomalies.list` is `managerOrAdminProcedure`.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react';

import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

import { AnomalyDetailsModal, type AnomalyAlertView } from './AnomalyDetailsModal';

export function AnomalyDetectionCard() {
  const { t } = useTranslation(['aiAnomalies', 'aiShared']);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const anomaliesQuery = trpc.ai.anomalies.list.useQuery(
    {},
    {
      // The 5-minute staleTime keeps a manager who leaves the dashboard
      // open seeing fresh signal without manual reload. Recompute is
      // server-side and cheap (~30-60ms on 30 days of pilot data).
      staleTime: 5 * 60 * 1000,
      // no window-focus refetch; the staleTime window is the
      // freshness contract, not every tab-back-in.
      refetchOnWindowFocus: false,
    }
  );

  const anomalies = anomaliesQuery.data;

  // ----- Loading -----
  if (anomaliesQuery.isLoading) {
    return (
      <section className="card p-6" data-testid="anomaly-card">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50">
            <Sparkles className="h-5 w-5 text-primary-700" />
          </div>
          <div className="space-y-1">
            <p className="page-kicker text-[0.62rem] tracking-[0.24em]">
              {t('aiAnomalies:card.kicker')}
            </p>
            <h2 className="text-lg font-semibold text-secondary-900">
              {t('aiAnomalies:card.title')}
            </h2>
          </div>
        </div>
        <p className="mt-4 text-sm text-secondary-500">{t('aiAnomalies:card.states.loading')}</p>
      </section>
    );
  }

  // ----- Error -----
  if (anomaliesQuery.error) {
    return (
      <section className="card p-6" data-testid="anomaly-card">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-danger-50">
            <ShieldAlert className="h-5 w-5 text-danger-700" />
          </div>
          <div className="space-y-1">
            <p className="page-kicker text-[0.62rem] tracking-[0.24em]">
              {t('aiAnomalies:card.kicker')}
            </p>
            <h2 className="text-lg font-semibold text-secondary-900">
              {t('aiAnomalies:card.title')}
            </h2>
          </div>
        </div>
        <p className="mt-4 text-sm text-danger-700">{t('aiAnomalies:card.states.error')}</p>
      </section>
    );
  }

  // ----- Disabled (master toggle off) -----
  if (anomalies && !anomalies.enabled) {
    return (
      <section className="card p-6" data-testid="anomaly-card">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary-100">
            <Sparkles className="h-5 w-5 text-secondary-500" />
          </div>
          <div className="space-y-1">
            <p className="page-kicker text-[0.62rem] tracking-[0.24em]">
              {t('aiAnomalies:card.kicker')}
            </p>
            <h2 className="text-lg font-semibold text-secondary-900">
              {t('aiAnomalies:card.title')}
            </h2>
          </div>
        </div>
        <p className="mt-4 text-sm text-secondary-600">{t('aiAnomalies:card.states.disabled')}</p>
        <Link to="/company?tab=ai" className="btn-outline mt-4 inline-flex">
          {t('aiAnomalies:card.settingsLink')}
        </Link>
      </section>
    );
  }

  if (!anomalies) return null;

  // ----- Empty (no alerts) -----
  if (anomalies.totalCount === 0) {
    return (
      <section className="card p-6" data-testid="anomaly-card">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-success-50">
            <ShieldCheck className="h-5 w-5 text-success-700" />
          </div>
          <div className="space-y-1">
            <p className="page-kicker text-[0.62rem] tracking-[0.24em]">
              {t('aiAnomalies:card.kicker')}
            </p>
            <h2 className="text-lg font-semibold text-secondary-900">
              {t('aiAnomalies:card.title')}
            </h2>
          </div>
        </div>
        <p className="mt-4 text-sm text-secondary-600">{t('aiAnomalies:card.states.empty')}</p>
      </section>
    );
  }

  // ----- Has alerts -----
  return (
    <section className="card relative overflow-hidden p-6" data-testid="anomaly-card">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 90% 0%, color-mix(in oklch, var(--warning-500) 14%, transparent), transparent 55%)',
        }}
      />
      <div className="relative">
        <div className="flex items-center gap-3">
          <span className="glyph-tile glyph-tile-warning h-11 w-11">
            <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="space-y-1">
            <p className="page-kicker">{t('aiAnomalies:card.kicker')}</p>
            <h2 className="font-display text-xl tracking-[-0.02em] text-secondary-950">
              {t('aiAnomalies:card.title')}
            </h2>
          </div>
        </div>
        <p className="mt-4 text-sm text-secondary-700" data-testid="anomaly-summary">
          {t('aiAnomalies:card.states.summary', {
            count: anomalies.totalCount,
          })}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {anomalies.severityCounts.high > 0 && (
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]',
                'bg-danger-50 text-danger-700'
              )}
              data-testid="anomaly-pill-high"
            >
              <ShieldAlert className="h-3 w-3" aria-hidden="true" />
              {t('aiAnomalies:card.severity.high')} · {anomalies.severityCounts.high}
            </span>
          )}
          {anomalies.severityCounts.medium > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full bg-warning-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-warning-700"
              data-testid="anomaly-pill-medium"
            >
              <ShieldAlert className="h-3 w-3" aria-hidden="true" />
              {t('aiAnomalies:card.severity.medium')} · {anomalies.severityCounts.medium}
            </span>
          )}
        </div>
        <p className="mt-3 text-[11px] leading-5 text-secondary-500">
          {t('aiShared:disclaimer.anomaly')}
        </p>
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={() => setIsModalOpen(true)}
            data-testid="anomaly-view-details"
          >
            {t('aiAnomalies:card.viewDetails')}
          </button>
        </div>
      </div>

      <AnomalyDetailsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        alerts={anomalies.alerts as AnomalyAlertView[]}
      />
    </section>
  );
}
