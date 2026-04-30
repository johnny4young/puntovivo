/**
 * ENG-032 — admin/manager dashboard tile for the anomaly detector.
 *
 * Reads `ai.anomalies.list` for the alerts and the master enabled
 * flag. The server short-circuits this query to `enabled=false` +
 * empty counts when ai.enabled is false, so managers can render the
 * disabled state without calling the admin-only settings endpoint.
 *
 * States surfaced:
 *  - loading
 *  - error
 *  - disabled (ai.enabled = false → CTA to /company)
 *  - empty (no alerts)
 *  - has-alerts (counter + severity pills + open-modal button)
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
  const { t } = useTranslation(['aiAnomalies']);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const anomaliesQuery = trpc.ai.anomalies.list.useQuery(
    {},
    {
      // Refetch every 5 minutes so a manager who keeps the dashboard
      // open sees fresh signal without manually reloading. Recompute
      // is server-side and cheap (~30-60ms on 30 days of pilot data).
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: true,
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
            <p className="page-kicker text-[0.62rem] tracking-[0.24em]">{t('aiAnomalies:card.kicker')}</p>
            <h2 className="text-lg font-semibold text-secondary-900">{t('aiAnomalies:card.title')}</h2>
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
            <p className="page-kicker text-[0.62rem] tracking-[0.24em]">{t('aiAnomalies:card.kicker')}</p>
            <h2 className="text-lg font-semibold text-secondary-900">{t('aiAnomalies:card.title')}</h2>
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
            <p className="page-kicker text-[0.62rem] tracking-[0.24em]">{t('aiAnomalies:card.kicker')}</p>
            <h2 className="text-lg font-semibold text-secondary-900">{t('aiAnomalies:card.title')}</h2>
          </div>
        </div>
        <p className="mt-4 text-sm text-secondary-600">{t('aiAnomalies:card.states.disabled')}</p>
        <Link to="/company" className="btn-outline mt-4 inline-flex">
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
            <p className="page-kicker text-[0.62rem] tracking-[0.24em]">{t('aiAnomalies:card.kicker')}</p>
            <h2 className="text-lg font-semibold text-secondary-900">{t('aiAnomalies:card.title')}</h2>
          </div>
        </div>
        <p className="mt-4 text-sm text-secondary-600">{t('aiAnomalies:card.states.empty')}</p>
      </section>
    );
  }

  // ----- Has alerts -----
  return (
    <section className="card p-6" data-testid="anomaly-card">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50">
          <ShieldAlert className="h-5 w-5 text-amber-700" />
        </div>
        <div className="space-y-1">
          <p className="page-kicker text-[0.62rem] tracking-[0.24em]">{t('aiAnomalies:card.kicker')}</p>
          <h2 className="text-lg font-semibold text-secondary-900">{t('aiAnomalies:card.title')}</h2>
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
              'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold',
              'bg-danger-50 text-danger-700'
            )}
            data-testid="anomaly-pill-high"
          >
            <ShieldAlert className="h-3 w-3" />
            {t('aiAnomalies:card.severity.high')} · {anomalies.severityCounts.high}
          </span>
        )}
        {anomalies.severityCounts.medium > 0 && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700"
            data-testid="anomaly-pill-medium"
          >
            <ShieldAlert className="h-3 w-3" />
            {t('aiAnomalies:card.severity.medium')} · {anomalies.severityCounts.medium}
          </span>
        )}
      </div>
      <div className="mt-5">
        <button
          type="button"
          className="btn-primary"
          onClick={() => setIsModalOpen(true)}
          data-testid="anomaly-view-details"
        >
          {t('aiAnomalies:card.viewDetails')}
        </button>
      </div>

      <AnomalyDetailsModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        alerts={anomalies.alerts as AnomalyAlertView[]}
      />
    </section>
  );
}
