import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Building2,
  Check,
  ChevronRight,
  Landmark,
  MonitorSmartphone,
  PackageCheck,
} from 'lucide-react';

import { PageLoadingState } from '@/components/feedback/LoadingState';
import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import { Button } from '@/components/ui';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import {
  buildCompanyGuidedSteps,
  findNextRequiredSection,
  isCompanyGuidedStepId,
  resolveInitialGuidedStep,
  type CompanyGuidedStep,
  type CompanyGuidedStepId,
} from './companyGuidedSetup';

const STEP_ICONS: Record<CompanyGuidedStepId, LucideIcon> = {
  business: Building2,
  selling: PackageCheck,
  fiscal: Landmark,
  payments: Banknote,
  devices: MonitorSmartphone,
};

const STEP_TONE_CLASSES: Record<CompanyGuidedStep['status'], string> = {
  ready: 'border-success-200 bg-success-50/65 text-success-800',
  blocker: 'border-danger-200 bg-danger-50/70 text-danger-800',
  warning: 'border-warning-200 bg-warning-50/70 text-warning-800',
  optional: 'border-secondary-200 bg-secondary-50/80 text-secondary-700',
  'not-applicable': 'border-secondary-200 bg-white text-secondary-500',
};

function readinessCtaHref(cta: { route: string; tab?: string }): string {
  if (!cta.tab) return cta.route;
  return `${cta.route}?tab=${encodeURIComponent(cta.tab)}`;
}

export interface CompanyReadinessCardProps {
  onAcknowledged?: () => void;
}

/** Five-step, novice-first projection over the canonical readiness payload. */
export function CompanyReadinessCard({
  onAcknowledged,
}: CompanyReadinessCardProps = {}) {
  const { t } = useTranslation(['setup', 'errors']);
  const { t: tGuide } = useTranslation('companySetupGuide');
  const toast = useToast();
  const utils = trpc.useUtils();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const readinessQuery = trpc.setupReadiness.get.useQuery(undefined, {
    staleTime: 60_000,
  });

  const acknowledgeMutation = trpc.companies.acknowledgeSetup.useMutation({
    onSuccess: async () => {
      await utils.setupReadiness.get.invalidate();
      toast.success({ title: t('readiness.acknowledge.toast') });
      onAcknowledged?.();
      navigate('/sales');
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'setup:readiness.acknowledge.error',
    }),
  });

  const guidedState = useMemo(() => {
    if (!readinessQuery.data) return null;
    const steps = buildCompanyGuidedSteps(readinessQuery.data.sections);
    const nextRequired = findNextRequiredSection(readinessQuery.data.sections);
    return {
      steps,
      nextRequired,
      initialStep: resolveInitialGuidedStep(steps, nextRequired),
    };
  }, [readinessQuery.data]);

  if (readinessQuery.isLoading) {
    return (
      <PageLoadingState
        title={t('readiness.title')}
        description={t('readiness.loading')}
      />
    );
  }

  if (readinessQuery.error) {
    return (
      <QueryErrorState
        title={t('readiness.title')}
        message={translateServerError(
          readinessQuery.error,
          t,
          t('errors:server.unknown')
        )}
        onRetry={() => {
          void readinessQuery.refetch();
        }}
      />
    );
  }

  if (!readinessQuery.data || !guidedState) {
    return <></>;
  }

  const requestedStep = searchParams.get('step');
  const activeStepId = isCompanyGuidedStepId(requestedStep)
    ? requestedStep
    : guidedState.initialStep;
  const activeStep =
    guidedState.steps.find(step => step.id === activeStepId) ??
    guidedState.steps[0];

  if (!activeStep) {
    return <></>;
  }

  const resolvedCount = guidedState.steps.filter(
    step => step.status === 'ready' || step.status === 'not-applicable'
  ).length;
  const hasBlockers = guidedState.nextRequired !== null;
  const nextRequired = guidedState.nextRequired;
  const selectedSection = activeStep.nextSection;
  const ActiveIcon = STEP_ICONS[activeStep.id];

  const selectStep = (stepId: CompanyGuidedStepId): void => {
    setSearchParams(
      previous => {
        const next = new URLSearchParams(previous);
        // `?tab=readiness` is a supported legacy deep link. Once the operator
        // interacts with the new guide, normalize it to the guided URL shape
        // instead of mixing mutually exclusive tab and step state.
        next.delete('tab');
        next.set('step', stepId);
        return next;
      },
      { replace: true }
    );
  };

  const goTo = (cta: { route: string; tab?: string }): void => {
    navigate(readinessCtaHref(cta));
  };

  const continueToSales = (): void => {
    if (readinessQuery.data.acknowledgedAt === null) {
      acknowledgeMutation.mutate();
      return;
    }
    navigate('/sales');
  };

  const selectedDescription = selectedSection
    ? t(`readiness.sections.${selectedSection.id}.hint`)
    : activeStep.status === 'optional'
      ? tGuide('selected.optional')
      : activeStep.status === 'not-applicable'
        ? tGuide('selected.notApplicable')
        : activeStep.status === 'warning'
          ? tGuide('selected.warning')
          : tGuide('selected.complete');

  const selectedActionLabel = selectedSection
    ? selectedSection.status === 'blocker'
      ? tGuide('selected.actionBlocker')
      : selectedSection.status === 'warning'
        ? tGuide('selected.actionWarning')
        : tGuide('selected.actionOptional')
    : tGuide(`steps.${activeStep.id}.action`);

  return (
    <div className="space-y-5" data-testid="company-readiness-card">
      <section className="overflow-hidden rounded-[1.75rem] border border-primary-200/70 bg-[linear-gradient(135deg,#08263a_0%,#0d3a54_62%,#12506b_100%)] text-white shadow-[0_28px_70px_-48px_rgba(3,15,25,0.8)]">
        <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)] lg:items-end">
          <div className="max-w-[48rem]">
            <p className="text-[0.68rem] font-bold uppercase tracking-[0.2em] text-primary-200">
              {tGuide('kicker')}
            </p>
            <h2 className="mt-2 max-w-[24ch] font-display text-[1.75rem] leading-[1.02] text-white sm:text-[2.2rem]">
              {tGuide('title')}
            </h2>
            <p className="mt-3 max-w-[62ch] text-sm leading-6 text-primary-50/80">
              {tGuide('description')}
            </p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-semibold text-white">
                {tGuide('progress', { ready: resolvedCount })}
              </span>
              {hasBlockers && (
                <span
                  className="rounded-full bg-danger-500/95 px-2.5 py-1 text-xs font-bold text-white"
                  data-testid="company-readiness-blocker-count"
                >
                  {t('readiness.blocker.count', {
                    count: readinessQuery.data.blockerCount,
                  })}
                </span>
              )}
            </div>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-white/15"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={5}
              aria-valuenow={resolvedCount}
              aria-label={tGuide('progress', { ready: resolvedCount })}
            >
              <div
                className="h-full rounded-full bg-primary-200 transition-[width]"
                style={{ width: `${(resolvedCount / 5) * 100}%` }}
              />
            </div>
          </div>
        </div>

        <div
          className={cn(
            'border-t px-5 py-5 sm:px-6',
            hasBlockers
              ? 'border-danger-300/25 bg-danger-950/20'
              : 'border-success-300/20 bg-success-950/15'
          )}
          data-testid={
            hasBlockers ? 'company-readiness-next' : 'company-readiness-ready'
          }
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span
                className={cn(
                  'grid h-10 w-10 shrink-0 place-items-center rounded-xl',
                  hasBlockers
                    ? 'bg-danger-400/20 text-danger-100'
                    : 'bg-success-400/20 text-success-100'
                )}
              >
                {hasBlockers ? (
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                ) : (
                  <Check className="h-5 w-5" aria-hidden="true" />
                )}
              </span>
              <div>
                <p className="text-[0.66rem] font-bold uppercase tracking-[0.18em] text-primary-100/75">
                  {hasBlockers ? tGuide('next.eyebrow') : tGuide('ready.eyebrow')}
                </p>
                <h3 className="mt-1 text-lg font-semibold text-white">
                  {hasBlockers && nextRequired
                    ? tGuide('next.title', {
                        section: t(`readiness.sections.${nextRequired.id}.label`),
                      })
                    : tGuide('ready.title')}
                </h3>
                <p className="mt-1 text-sm leading-5 text-primary-50/75">
                  {hasBlockers ? tGuide('next.description') : tGuide('ready.description')}
                </p>
              </div>
            </div>
            {hasBlockers && nextRequired?.cta ? (
              <Button
                type="button"
                variant="primary"
                className="shrink-0 bg-white text-primary-950 hover:bg-primary-50"
                onClick={() => goTo(nextRequired.cta!)}
                data-testid={`company-readiness-cta-${nextRequired.id}`}
              >
                {tGuide('next.action')}
                <ArrowRight aria-hidden="true" />
              </Button>
            ) : (
              <Button
                type="button"
                variant="primary"
                className="shrink-0 bg-white text-primary-950 hover:bg-primary-50"
                onClick={continueToSales}
                disabled={acknowledgeMutation.isPending}
                data-testid={
                  readinessQuery.data.acknowledgedAt === null
                    ? 'company-readiness-acknowledge'
                    : 'company-readiness-continue'
                }
              >
                {acknowledgeMutation.isPending
                  ? tGuide('ready.saving')
                  : tGuide('ready.action')}
                <ArrowRight aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </section>

      <section
        className="rounded-[1.5rem] border border-line bg-card p-3 shadow-[0_22px_60px_-50px_rgba(15,23,42,0.7)]"
        aria-label={tGuide('title')}
      >
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {guidedState.steps.map((step, index) => {
            const Icon = STEP_ICONS[step.id];
            const isActive = step.id === activeStep.id;
            return (
              <button
                key={step.id}
                type="button"
                className={cn(
                  'group flex min-h-28 flex-col items-start rounded-2xl border px-3.5 py-3 text-left transition-[border-color,background-color,box-shadow,transform] hover:-translate-y-0.5',
                  isActive
                    ? 'border-primary-300 bg-primary-50/80 shadow-[0_12px_28px_-22px_rgba(2,96,144,0.8)]'
                    : 'border-transparent bg-surface-2/65 hover:border-line hover:bg-white'
                )}
                aria-current={isActive ? 'step' : undefined}
                onClick={() => selectStep(step.id)}
                data-testid={`company-guided-step-${step.id}`}
                data-status={step.status}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span
                    className={cn(
                      'grid h-9 w-9 place-items-center rounded-xl border',
                      STEP_TONE_CLASSES[step.status]
                    )}
                  >
                    <Icon className="h-[1.05rem] w-[1.05rem]" aria-hidden="true" />
                  </span>
                  <span className="text-[0.66rem] font-bold uppercase tracking-[0.14em] text-secondary-700">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </span>
                <span className="mt-3 text-sm font-semibold text-secondary-950">
                  {tGuide(`steps.${step.id}.title`)}
                </span>
                <span className="mt-1 text-xs leading-4 text-secondary-500">
                  {tGuide(`status.${step.status}`)}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section
        className="grid gap-5 rounded-[1.5rem] border border-line bg-surface-2/55 p-5 sm:p-6 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-center"
        data-testid={`company-guided-detail-${activeStep.id}`}
      >
        <span
          className={cn(
            'grid h-12 w-12 place-items-center rounded-2xl border',
            STEP_TONE_CLASSES[activeStep.status]
          )}
        >
          <ActiveIcon className="h-6 w-6" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-[0.66rem] font-bold uppercase tracking-[0.17em] text-secondary-500">
            {tGuide('selected.eyebrow')}
          </p>
          <h3 className="mt-1 font-display text-xl leading-tight text-secondary-950">
            {selectedSection
              ? t(`readiness.sections.${selectedSection.id}.label`)
              : tGuide(`steps.${activeStep.id}.title`)}
          </h3>
          <p className="mt-1.5 max-w-[64ch] text-sm leading-6 text-secondary-600">
            {selectedDescription}
          </p>
        </div>
        <Button
          type="button"
          variant={selectedSection?.status === 'blocker' ? 'primary' : 'outline'}
          className="w-full justify-between lg:w-auto"
          onClick={() => goTo(selectedSection?.cta ?? activeStep.cta)}
          data-testid={`company-guided-action-${activeStep.id}`}
        >
          {selectedActionLabel}
          <ChevronRight aria-hidden="true" />
        </Button>
      </section>
    </div>
  );
}
