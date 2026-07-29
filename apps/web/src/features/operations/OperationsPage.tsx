import { lazy, Suspense } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { NeedsAttentionPanel } from './NeedsAttentionPanel';
import { OperationsNavigation } from './OperationsNavigation';
import {
  isOperationsTabKey,
  type OperationsTabKey,
} from './operationsNavigationModel';

const SupportHealthPanel = lazy(async () => {
  const module = await import('./SupportHealthPanel');
  return { default: module.SupportHealthPanel };
});

const OperationalReadinessBoard = lazy(async () => {
  const module = await import('./OperationalReadinessBoard');
  return { default: module.OperationalReadinessBoard };
});

const SyncHealthPanel = lazy(async () => {
  const module = await import('./SyncHealthPanel');
  return { default: module.SyncHealthPanel };
});

const FiscalHealthPanel = lazy(async () => {
  const module = await import('./FiscalHealthPanel');
  return { default: module.FiscalHealthPanel };
});

const DeviceHealthPanel = lazy(async () => {
  const module = await import('./DeviceHealthPanel');
  return { default: module.DeviceHealthPanel };
});

const CashHealthPanel = lazy(async () => {
  const module = await import('./CashHealthPanel');
  return { default: module.CashHealthPanel };
});

const PaymentHealthPanel = lazy(async () => {
  const module = await import('./PaymentHealthPanel');
  return { default: module.PaymentHealthPanel };
});

const DiagnosticExportPanel = lazy(async () => {
  const module = await import('./DiagnosticExportPanel');
  return { default: module.DiagnosticExportPanel };
});

const AuthorityHealthPanel = lazy(async () => {
  const module = await import('./AuthorityHealthPanel');
  return { default: module.AuthorityHealthPanel };
});

/**
 * Operator-first store status with administrator-only recovery tooling.
 *
 * The default landing is the aggregated attention queue. Technical health,
 * recovery controls, service contracts, and diagnostics are progressively
 * disclosed only to administrators. Tab state remains URL-driven
 * (`?tab=attention|support|sync|fiscal|device|cash|payments|diagnostics|authority`)
 * so existing administrator deep links continue to land on the right panel.
 */
export function OperationsPage() {
  const { t } = useTranslation('operations');
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const isAdmin = user?.role === 'admin';
  const requestedTab: OperationsTabKey = isOperationsTabKey(tabParam) ? tabParam : 'attention';
  const activeTab: OperationsTabKey = isAdmin ? requestedTab : 'attention';

  function handleTabChange(next: OperationsTabKey): void {
    const nextParams = new URLSearchParams(searchParams);
    if (next === 'attention') {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', next);
    }
    setSearchParams(nextParams, { replace: true });
  }

  if (!isAdmin && tabParam !== null) {
    return <Navigate to="/operations" replace />;
  }

  const advancedPanelFallback = (
    <div
      className="card grid gap-3 p-5 sm:grid-cols-3 sm:p-6"
      aria-label={t('common.loading')}
      aria-busy="true"
    >
      {[0, 1, 2].map(item => (
        <div
          key={item}
          className="h-28 animate-pulse rounded-2xl bg-secondary-100/70 motion-reduce:animate-none"
        />
      ))}
    </div>
  );

  return (
    <div className="space-y-6">
      <header className="flex items-start gap-3">
        <span className="pv-gt pv-gt-primary h-11 w-11 rounded-xl">
          <Activity className="h-5 w-5" />
        </span>
        <div>
          <p className="pv-kicker">{t('header.kicker')}</p>
          <h1 className="pv-title text-2xl">{t('header.title')}</h1>
          <p className="mt-1 text-sm text-secondary-500">{t('header.subtitle')}</p>
        </div>
      </header>

      {isAdmin && (
        <OperationsNavigation activeTab={activeTab} onTabChange={handleTabChange} />
      )}

      <div
        id={`operations-tabpanel-${activeTab}`}
        data-testid={`operations-tabpanel-${activeTab}`}
      >
        {activeTab === 'attention' && (
          <NeedsAttentionPanel
            onReviewArea={handleTabChange}
            onNavigate={target => navigate(target)}
          />
        )}
        {activeTab !== 'attention' && (
          <Suspense fallback={advancedPanelFallback}>
            {activeTab === 'support' && (
              <div className="space-y-6">
                <OperationalReadinessBoard
                  onReviewArea={handleTabChange}
                  onNavigate={target => navigate(target)}
                />
                <SupportHealthPanel />
              </div>
            )}
            {activeTab === 'sync' && <SyncHealthPanel />}
            {activeTab === 'fiscal' && <FiscalHealthPanel />}
            {activeTab === 'device' && <DeviceHealthPanel />}
            {activeTab === 'cash' && <CashHealthPanel />}
            {activeTab === 'payments' && <PaymentHealthPanel />}
            {activeTab === 'diagnostics' && <DiagnosticExportPanel />}
            {activeTab === 'authority' && <AuthorityHealthPanel />}
          </Suspense>
        )}
      </div>
    </div>
  );
}
