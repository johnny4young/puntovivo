/** ENG-202 — living, role-aware checklist for a tenant's first completed sale. */

import { useEffect, useState } from 'react';
import { ArrowRight, Check, Circle, PartyPopper, Rocket, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const CELEBRATION_DURATION_MS = 5_000;

const STEP_TARGETS = {
  product: '/products',
  cashSession: '/sales',
  firstSale: '/sales',
} as const;

type StepId = keyof typeof STEP_TARGETS;

interface FirstSaleGuideProps {
  /** Incremented by the shell help action to reopen the guide on demand. */
  openRequest: number;
}

export function FirstSaleGuide({ openRequest }: FirstSaleGuideProps) {
  const { user } = useAuth();
  const { currentSite } = useTenant();
  const canSell =
    user?.role === 'admin' || user?.role === 'manager' || user?.role === 'cashier';
  const siteId = currentSite?.id ?? '';
  const readinessQuery = trpc.setupReadiness.firstSale.useQuery(
    { siteId },
    {
      enabled: canSell && siteId.length > 0,
      staleTime: 30_000,
    }
  );

  const readiness = readinessQuery.data;
  if (!canSell || !siteId || !readiness || !user) return null;

  return (
    <FirstSaleGuideContent
      key={siteId}
      openRequest={openRequest}
      role={user.role}
      readiness={readiness}
    />
  );
}

interface FirstSaleGuideContentProps {
  openRequest: number;
  role: 'admin' | 'manager' | 'cashier' | 'viewer';
  readiness: {
    completed: boolean;
    steps: Array<{ id: StepId; completed: boolean }>;
  };
}

interface GuideUiState {
  lastCompleted: boolean;
  celebrating: boolean;
  closedRequest: number | null;
}

function FirstSaleGuideContent({
  openRequest,
  role,
  readiness,
}: FirstSaleGuideContentProps) {
  const { t } = useTranslation('setup');
  const [ui, setUi] = useState<GuideUiState>(() => ({
    lastCompleted: readiness.completed,
    celebrating: false,
    closedRequest: null,
  }));

  // React 19 derived-state pattern: adjust before commit when fresh query
  // data crosses the incomplete → complete boundary. This avoids a transient
  // hidden frame and avoids synchronously setting state from an Effect.
  if (ui.lastCompleted !== readiness.completed) {
    const justCompleted = !ui.lastCompleted && readiness.completed;
    setUi({
      lastCompleted: readiness.completed,
      celebrating: justCompleted,
      closedRequest: justCompleted ? openRequest : ui.closedRequest,
    });
  }

  useEffect(() => {
    if (!ui.celebrating) return;
    const timer = window.setTimeout(() => {
      setUi(current => ({ ...current, celebrating: false }));
    }, CELEBRATION_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [ui.celebrating]);

  const canManageCatalog = role === 'admin' || role === 'manager';
  const manualOpen = openRequest > 0 && ui.closedRequest !== openRequest;
  const visible =
    ui.celebrating ||
    manualOpen ||
    (!readiness.completed && ui.closedRequest === null);

  if (!visible) return null;

  const completedCount = readiness.steps.filter(step => step.completed).length;
  const handleDismiss = () => {
    setUi(current => ({
      ...current,
      celebrating: false,
      closedRequest: openRequest,
    }));
  };

  if (ui.celebrating) {
    return (
      <section
        className="mx-4 mt-3 overflow-hidden rounded-[24px] border border-success-200 bg-gradient-to-r from-success-50 via-white to-primary-50 shadow-[var(--shadow-panel)] sm:mx-6 xl:mx-8"
        aria-labelledby="first-sale-celebration-title"
        aria-live="polite"
        aria-atomic="true"
        data-testid="first-sale-celebration"
      >
        <div className="flex items-center gap-4 px-5 py-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-success-100 text-success-700">
            <PartyPopper className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="first-sale-celebration-title"
              className="font-display text-lg font-semibold text-secondary-950"
            >
              {t('firstSale.completedTitle')}
            </h2>
            <p className="mt-0.5 text-sm text-fg2">
              {t('firstSale.completedDescription')}
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost btn-icon shrink-0"
            onClick={handleDismiss}
            aria-label={t('firstSale.dismiss')}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      className="mx-4 mt-3 rounded-[24px] border border-primary-200/80 bg-card p-4 shadow-[var(--shadow-panel)] sm:mx-6 sm:p-5 xl:mx-8"
      aria-labelledby="first-sale-guide-title"
      data-testid="first-sale-guide"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary-100 text-primary-700">
          <Rocket className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary-800">
                {t('firstSale.kicker')}
              </p>
              <h2
                id="first-sale-guide-title"
                className="mt-1 font-display text-lg font-semibold text-secondary-950"
              >
                {t('firstSale.title')}
              </h2>
              <p className="mt-1 text-sm text-fg2">{t('firstSale.description')}</p>
            </div>
            <button
              type="button"
              className="btn-ghost btn-icon shrink-0"
              onClick={handleDismiss}
              aria-label={t('firstSale.dismiss')}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          <p
            className="mt-3 text-xs font-semibold text-secondary-700"
            aria-live="polite"
            aria-atomic="true"
          >
            {t('firstSale.progress', {
              completed: completedCount,
              total: readiness.steps.length,
            })}
          </p>
          <ol className="mt-3 grid gap-2 lg:grid-cols-3">
            {readiness.steps.map((step, index) => {
              const stepId = step.id as StepId;
              const showAction = stepId !== 'product' || canManageCatalog;
              return (
                <li
                  key={stepId}
                  className={cn(
                    'flex min-w-0 items-start gap-3 rounded-2xl border px-3.5 py-3',
                    step.completed
                      ? 'border-success-200 bg-success-50/70'
                      : 'border-line bg-surface-2/55'
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                      step.completed
                        ? 'bg-success-600 text-white'
                        : 'bg-white text-secondary-500 ring-1 ring-line-strong'
                    )}
                  >
                    {step.completed ? (
                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Circle className="h-2.5 w-2.5" aria-hidden="true" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-secondary-950">
                      {index + 1}. {t(`firstSale.steps.${stepId}.label`)}
                    </p>
                    <p className="mt-0.5 text-xs leading-5 text-fg2">
                      {t(`firstSale.steps.${stepId}.hint`)}
                    </p>
                    {!step.completed && showAction && (
                      <Link
                        to={STEP_TARGETS[stepId]}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary-800 hover:text-primary-900"
                      >
                        {t(`firstSale.steps.${stepId}.action`)}
                        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
