import { lazy, Suspense, useState } from 'react';
import { AlertOctagon, ClipboardCheck, KeyRound, Pill, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { useAuth } from '@/features/auth/AuthProvider';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const PharmacyAuthorizationPanel = lazy(() =>
  import('./PharmacyAuthorizationPanel').then(module => ({
    default: module.PharmacyAuthorizationPanel,
  }))
);
const PharmacyEvidencePanel = lazy(() =>
  import('./PharmacyEvidencePanel').then(module => ({ default: module.PharmacyEvidencePanel }))
);
const PharmacyLotSafetyPanel = lazy(() =>
  import('./PharmacyLotSafetyPanel').then(module => ({
    default: module.PharmacyLotSafetyPanel,
  }))
);
const PharmacyRecallPanel = lazy(() =>
  import('./PharmacyRecallPanel').then(module => ({ default: module.PharmacyRecallPanel }))
);

type PharmacyOperationsView = 'lots' | 'recalls' | 'evidence' | 'authorizations';

const views = [
  { id: 'lots', icon: ShieldAlert },
  { id: 'recalls', icon: AlertOctagon },
  { id: 'evidence', icon: ClipboardCheck },
  { id: 'authorizations', icon: KeyRound },
] as const satisfies ReadonlyArray<{ id: PharmacyOperationsView; icon: typeof Pill }>;

export function PharmacyOperationsPanel() {
  const { t } = useTranslation(['pharmacy', 'pharmacyErrors', 'errors']);
  const { user } = useAuth();
  const [activeView, setActiveView] = useState<PharmacyOperationsView>('lots');
  const contextQuery = trpc.pharmacy.context.useQuery(undefined, {
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  if (contextQuery.error) {
    return (
      <QueryErrorState
        title={t('pharmacy:context.errorTitle')}
        message={translateServerError(contextQuery.error, t, t('errors:server.unknown'))}
        onRetry={() => void contextQuery.refetch()}
      />
    );
  }

  if (!contextQuery.data) {
    return (
      <div className="card p-6 text-sm text-secondary-600" role="status">
        {t('pharmacy:common.loading')}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl border border-primary-200 bg-gradient-to-br from-primary-950 via-primary-900 to-primary-800 text-white shadow-soft">
        <div className="flex flex-col gap-5 p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/10">
              <Pill className="h-6 w-6" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-xl font-semibold">{t('pharmacy:title')}</h2>
              <p className="mt-1 max-w-3xl text-sm text-primary-100">{t('pharmacy:description')}</p>
            </div>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm">
            <p className="font-medium">
              {t('pharmacy:context.country', { country: contextQuery.data.countryCode })}
            </p>
            <p className="mt-0.5 text-primary-100">
              {t('pharmacy:context.businessDate', { date: contextQuery.data.businessDate })}
            </p>
          </div>
        </div>
      </section>

      {contextQuery.data.approvalCapabilityErrorCode ? (
        <div
          className="rounded-2xl border border-danger-200 bg-danger-50 p-4 text-sm text-danger-950"
          role="alert"
          data-testid="pharmacy-approval-integrity-warning"
        >
          <p className="font-medium">{t('pharmacy:context.approvalIntegrityTitle')}</p>
          <p className="mt-1">
            {t(`pharmacyErrors:server.${contextQuery.data.approvalCapabilityErrorCode}`)}
          </p>
          <p className="mt-1">
            {t(
              contextQuery.data.approvalCapabilityErrorCode ===
                'PHARMACY_EVIDENCE_KEY_UNAVAILABLE'
                ? 'pharmacy:context.approvalKeyRecoveryDescription'
                : 'pharmacy:context.approvalAuthorizationRecoveryDescription'
            )}
          </p>
        </div>
      ) : null}

      <div
        className="flex gap-2 overflow-x-auto rounded-2xl border border-secondary-200 bg-white p-2 shadow-sm"
        role="tablist"
        aria-label={t('pharmacy:tabs.label')}
      >
        {views.map(view => {
          const Icon = view.icon;
          const selected = activeView === view.id;
          return (
            <button
              key={view.id}
              id={`pharmacy-tab-${view.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`pharmacy-panel-${view.id}`}
              className={cn(
                'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-sm font-medium transition',
                selected
                  ? 'bg-primary-700 text-white shadow-sm'
                  : 'text-secondary-600 hover:bg-secondary-50 hover:text-secondary-900'
              )}
              onClick={() => setActiveView(view.id)}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {t(`pharmacy:tabs.${view.id}`)}
            </button>
          );
        })}
      </div>

      <div
        id={`pharmacy-panel-${activeView}`}
        role="tabpanel"
        aria-labelledby={`pharmacy-tab-${activeView}`}
      >
        <Suspense
          fallback={
            <div className="card p-6 text-sm text-secondary-600" role="status">
              {t('pharmacy:common.loading')}
            </div>
          }
        >
          {activeView === 'lots' && <PharmacyLotSafetyPanel />}
          {activeView === 'recalls' && <PharmacyRecallPanel />}
          {activeView === 'evidence' && (
            <PharmacyEvidencePanel
              businessDate={contextQuery.data.businessDate}
              countryCode={contextQuery.data.countryCode}
              canApproveEvidence={contextQuery.data.canApproveEvidence}
            />
          )}
          {activeView === 'authorizations' && (
            <PharmacyAuthorizationPanel
              isAdmin={user?.role === 'admin'}
              countryCode={contextQuery.data.countryCode}
              businessDate={contextQuery.data.businessDate}
            />
          )}
        </Suspense>
      </div>

      <div className="rounded-2xl border border-warning-200 bg-warning-50 p-4 text-sm text-warning-950">
        <p className="font-medium">{t('pharmacy:limits.title')}</p>
        <p className="mt-1">{t('pharmacy:limits.description')}</p>
      </div>
    </div>
  );
}
