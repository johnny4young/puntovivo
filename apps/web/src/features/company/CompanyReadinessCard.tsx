/**
 * ENG-104 — Company readiness card.
 *
 * Renders the aggregate readiness payload from
 * `setupReadiness.get`. Lives as the first tab of `/company` for
 * admin role so a fresh tenant sees blockers before any other
 * configuration card. The render pattern is shared with the other
 * Company* cards: query loading + error + happy state in one
 * component.
 *
 * Score donut color flips:
 *   - `< 50`  → danger
 *   - `50-79` → warning
 *   - `>= 80` → success
 *
 * Section icons:
 *   - `ready` → Check (success)
 *   - `blocker` → AlertCircle (danger)
 *   - `optional-pending` → Clock (warning)
 *   - `not-applicable` → Minus (muted)
 *
 * @module features/company/CompanyReadinessCard
 */

import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertCircle, Check, Clock, Minus, ArrowRight } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { PageLoadingState } from '@/components/feedback/LoadingState';
import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';

type SectionStatus = 'ready' | 'blocker' | 'optional-pending' | 'not-applicable';

function statusIcon(status: SectionStatus, label: string) {
  const className = 'h-4 w-4';
  switch (status) {
    case 'ready':
      return <Check className={`${className} text-success-600`} aria-label={label} />;
    case 'blocker':
      return <AlertCircle className={`${className} text-danger-600`} aria-label={label} />;
    case 'optional-pending':
      return <Clock className={`${className} text-warning-600`} aria-label={label} />;
    case 'not-applicable':
      return <Minus className={`${className} text-secondary-400`} aria-label={label} />;
  }
}

function scoreTone(score: number): 'danger' | 'warning' | 'success' {
  if (score < 50) return 'danger';
  if (score < 80) return 'warning';
  return 'success';
}

/**
 * Public surface that the CompanyPage tab + the ReadinessBanner use
 * to navigate to the right tab when an operator clicks a section CTA.
 * Exposed (not inlined) so other consumers (empty states, banner)
 * can reuse the routing convention.
 */
export function readinessCtaHref(cta: { route: string; tab?: string }): string {
  if (!cta.tab) return cta.route;
  return `${cta.route}?tab=${encodeURIComponent(cta.tab)}`;
}

export interface CompanyReadinessCardProps {
  /**
   * Called when the operator clicks "Llevame al dashboard" / "Take me
   * to the dashboard" so the parent (CompanyPage) can refresh its
   * understanding of `acknowledgedAt`. Defaults to a no-op.
   */
  onAcknowledged?: () => void;
}

export function CompanyReadinessCard({ onAcknowledged }: CompanyReadinessCardProps = {}) {
  const { t } = useTranslation(['setup', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();

  // React Query staleTime keeps the call out of the hot path. The
  // payload is small (10 sections + score) so refetching on focus is
  // cheap when the operator returns to the tab after editing another
  // setting card.
  const readinessQuery = trpc.setupReadiness.get.useQuery(undefined, {
    staleTime: 60_000,
  });
  const [, setSearchParams] = useSearchParams();

  const acknowledgeMutation = trpc.companies.acknowledgeSetup.useMutation({
    onSuccess: async () => {
      await utils.setupReadiness.get.invalidate();
      toast.success({ title: t('readiness.acknowledge.toast') });
      onAcknowledged?.();
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'setup:readiness.acknowledge.error',
    }),
  });

  const handleSectionCta = (cta: { route: string; tab?: string }): void => {
    // Same-page navigation when the CTA points at /company: just
    // flip the tab via setSearchParams so React Query keeps the
    // readiness payload warm.
    if (cta.route === '/company' && cta.tab) {
      setSearchParams(prev => {
        const next = new URLSearchParams(prev);
        next.set('tab', cta.tab!);
        return next;
      }, { replace: true });
      return;
    }
    // Cross-page navigation falls back to a hard anchor — react-router
    // links sit inside the larger CompanyPage shell, but the CTA may
    // legitimately point outside `/company` for future sections.
    // `window.location.assign` over `.href = ...` to satisfy
    // `no-restricted-syntax` linting against external-value writes.
    window.location.assign(readinessCtaHref(cta));
  };

  const summary = useMemo(() => {
    if (!readinessQuery.data) return null;
    const { sections, blockerCount } = readinessQuery.data;
    const applicable = sections.filter(s => s.status !== 'not-applicable');
    const readyCount = applicable.filter(s => s.status === 'ready').length;
    return { applicable: applicable.length, readyCount, blockerCount };
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

  if (!readinessQuery.data || !summary) {
    return null;
  }

  const { score, sections, acknowledgedAt } = readinessQuery.data;
  const tone = scoreTone(score);

  return (
    <div className="card p-6 space-y-6" data-testid="company-readiness-card">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-secondary-900">
            {t('readiness.title')}
          </h2>
          <p className="text-sm text-secondary-600 mt-1">
            {t('readiness.description')}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div
            className="flex h-20 w-20 items-center justify-center rounded-full border-4"
            data-testid="company-readiness-score"
            data-tone={tone}
            aria-label={t('readiness.score.aria', { score })}
            style={{
              borderColor:
                tone === 'danger'
                  ? 'var(--color-danger-500)'
                  : tone === 'warning'
                    ? 'var(--color-warning-500)'
                    : 'var(--color-success-500)',
            }}
          >
            <span className="text-xl font-bold text-secondary-900">{score}</span>
          </div>
          <div className="space-y-1 text-sm">
            <p className="text-secondary-700">
              {t('readiness.score.label', {
                ready: summary.readyCount,
                total: summary.applicable,
              })}
            </p>
            {summary.blockerCount > 0 && (
              <p
                className="text-danger-700 font-medium"
                data-testid="company-readiness-blocker-count"
              >
                {t('readiness.blocker.count', { count: summary.blockerCount })}
              </p>
            )}
          </div>
        </div>
      </div>

      <ul className="divide-y divide-line" data-testid="company-readiness-sections">
        {sections.map(section => {
          const labelKey = `readiness.sections.${section.id}.label`;
          const hintKey = `readiness.sections.${section.id}.hint`;
          const statusLabelKey = `readiness.status.${section.status}`;
          return (
            <li
              key={section.id}
              className="flex items-start justify-between gap-3 py-3"
              data-testid={`company-readiness-section-${section.id}`}
              data-status={section.status}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-6 w-6 items-center justify-center">
                  {statusIcon(section.status, t(statusLabelKey))}
                </div>
                <div>
                  <p className="text-sm font-medium text-secondary-900">
                    {t(labelKey)}
                  </p>
                  <p className="text-xs text-secondary-500 mt-0.5">
                    {t(hintKey)}
                  </p>
                </div>
              </div>
              {section.cta && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm inline-flex items-center gap-1"
                  onClick={() => handleSectionCta(section.cta!)}
                  data-testid={`company-readiness-cta-${section.id}`}
                >
                  <span>{t('readiness.cta.configure')}</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {acknowledgedAt === null && (
        <div className="pt-2">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => acknowledgeMutation.mutate()}
            disabled={acknowledgeMutation.isPending}
            data-testid="company-readiness-acknowledge"
          >
            {acknowledgeMutation.isPending
              ? t('readiness.acknowledge.pending')
              : t('readiness.acknowledge.button')}
          </button>
        </div>
      )}
    </div>
  );
}
