import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import type { PayrollPeriod } from './payrollTypes';

const PayrollPeriodsPanel = lazy(() =>
  import('./PayrollPeriodsPanel').then(module => ({ default: module.PayrollPeriodsPanel }))
);
const PayrollProfilesPanel = lazy(() =>
  import('./PayrollProfilesPanel').then(module => ({ default: module.PayrollProfilesPanel }))
);
const PayrollRunsPanel = lazy(() =>
  import('./PayrollRunsPanel').then(module => ({ default: module.PayrollRunsPanel }))
);

/** Administrator-only pre-payroll workspace; a staff handoff remounts all private local state. */
export function PayrollPanel() {
  const { user } = useAuth();
  const key = `${user?.tenantId}:${user?.id}:${user?.role}`;
  if (user?.role !== 'admin') return <PayrollForbidden />;
  return <AdminPayrollPanel key={key} />;
}

function PayrollForbidden() {
  const { t } = useTranslation('payroll');
  return <p role="alert">{t('forbidden')}</p>;
}

function AdminPayrollPanel() {
  const { t } = useTranslation('payroll');
  const [view, setView] = useState<'profiles' | 'periods'>('periods');
  const [period, setPeriod] = useState<PayrollPeriod | null>(null);
  return (
    <section className="space-y-5" data-testid="payroll-panel">
      <header>
        <p className="pv-kicker">{t('kicker')}</p>
        <h1 className="pv-title text-2xl">{t('title')}</h1>
        <p className="mt-2 max-w-3xl text-sm text-secondary-600">{t('description')}</p>
      </header>
      {!period && (
        <nav className="flex flex-wrap gap-2" aria-label={t('views.label')}>
          <Button
            variant={view === 'periods' ? 'primary' : 'outline'}
            aria-pressed={view === 'periods'}
            onClick={() => setView('periods')}
          >
            {t('views.periods')}
          </Button>
          <Button
            variant={view === 'profiles' ? 'primary' : 'outline'}
            aria-pressed={view === 'profiles'}
            onClick={() => setView('profiles')}
          >
            {t('views.profiles')}
          </Button>
        </nav>
      )}
      <Suspense fallback={<p role="status">{t('actions.loading')}</p>}>
        {period ? (
          <PayrollRunsPanel period={period} onBack={() => setPeriod(null)} />
        ) : view === 'profiles' ? (
          <PayrollProfilesPanel />
        ) : (
          <PayrollPeriodsPanel onOpenRuns={setPeriod} />
        )}
      </Suspense>
    </section>
  );
}
