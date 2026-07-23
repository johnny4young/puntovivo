/**
 * Company readiness card.
 *
 * Renders the aggregate readiness payload from
 * `setupReadiness.get`. Lives as the first tab of `/company` for
 * admin role so a fresh tenant sees blockers before any other
 * configuration card. The render pattern is shared with the other
 * Company* cards: query loading + error + happy state in one
 * component.
 *
 * Visual model (rediseño §08 — readiness reconstruida como onboarding):
 * - Blockers are hoisted to the top as typed `StatusStrip` danger rows with a
 * direct primary CTA ("Resolver <paso>"), instead of being buried in
 * a flat list of equal steps.
 * - A `.pv-ring` progress ring + "{ready} de {total} listos · {n}
 * bloqueador(es)" tells the readiness story at a glance.
 * - The remaining steps group by state into `.pv-check` lists:
 * attention (`warning` → ic.opt + alert glyph), completed
 * (`ready` → ic.done), and optional (`optional-pending` and
 * `not-applicable` → ic.opt). The closing CTA is contextual:
 * "Resolver bloqueador" while one remains, "Abrir tienda" once
 * none do.
 *
 * Ring fill (`--p`) and tone flip both follow the score:
 * - `< 50`  → danger
 * - `50-79` → warning
 * - `>= 80` → success
 *
 * Section icons (mapped onto the `.pv-check .ic` chip):
 * - `ready` → Check (ic.done)
 * - `blocker` → AlertTriangle (ic.block)
 * - `optional-pending` → Clock (ic.opt)
 * - `warning` → AlertTriangle (ic.opt)
 * - `not-applicable` → Minus (ic.opt, muted)
 *
 * @module features/company/CompanyReadinessCard
 */

import { useMemo, type CSSProperties } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Clock, Minus, ArrowRight } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { PageLoadingState } from '@/components/feedback/LoadingState';
import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import { StatusStrip, Button } from '@/components/ui';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
type SectionStatus = 'ready' | 'blocker' | 'optional-pending' | 'warning' | 'not-applicable';

/**
 * Renders the round status chip used inside every `.pv-check` row. The
 * chip background/foreground come from the `ic.done` / `ic.block` /
 * `ic.opt` recipe variants; the glyph carries an accessible label so the
 * status is conveyed to assistive tech, not by color alone.
 */
function StatusChip({ status, label }: { status: SectionStatus; label: string }) {
  switch (status) {
    case 'ready':
      return (
        <span className="ic done">
          <Check className="h-3.5 w-3.5" aria-label={label} />
        </span>
      );
    case 'blocker':
      return (
        <span className="ic block">
          <AlertTriangle className="h-3.5 w-3.5" aria-label={label} />
        </span>
      );
    case 'optional-pending':
      return (
        <span className="ic opt">
          <Clock className="h-3.5 w-3.5" aria-label={label} />
        </span>
      );
    case 'warning':
      // configured-but-degraded / opt-in reminder. Amber
      // attention glyph, distinct from the red blocker chip.
      return (
        <span className="ic opt">
          <AlertTriangle className="h-3.5 w-3.5" aria-label={label} />
        </span>
      );
    case 'not-applicable':
      return (
        <span className="ic opt">
          <Minus className="h-3.5 w-3.5" aria-label={label} />
        </span>
      );
  }
}
function scoreTone(score: number): 'danger' | 'warning' | 'success' {
  if (score < 50) return 'danger';
  if (score < 80) return 'warning';
  return 'success';
}

/**
 * Public surface that the CompanyPage tab + the GlobalStatusStrip use
 * to navigate to the right tab when an operator clicks a section CTA.
 * Exposed (not inlined) so other consumers (empty states, banner)
 * can reuse the routing convention.
 */
function readinessCtaHref(cta: { route: string; tab?: string }): string {
  if (!cta.tab) return cta.route;
  return `${cta.route}?tab=${encodeURIComponent(cta.tab)}`;
}
export interface CompanyReadinessCardProps {
  /**
   * Called when the operator clicks the closing CTA ("Resolver
   * bloqueador" / "Abrir tienda") so the parent (CompanyPage) can
   * refresh its understanding of `acknowledgedAt`. Defaults to a no-op.
   */
  onAcknowledged?: () => void;
}
export function CompanyReadinessCard({ onAcknowledged }: CompanyReadinessCardProps = {}) {
  const { t } = useTranslation(['setup', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();

  // React Query staleTime keeps the call out of the hot path. The
  // payload is small (11 sections + score) so refetching on focus is
  // cheap when the operator returns to the tab after editing another
  // setting card.
  const readinessQuery = trpc.setupReadiness.get.useQuery(undefined, {
    staleTime: 60_000,
  });
  const [, setSearchParams] = useSearchParams();
  const acknowledgeMutation = trpc.companies.acknowledgeSetup.useMutation({
    onSuccess: async () => {
      await utils.setupReadiness.get.invalidate();
      toast.success({
        title: t('readiness.acknowledge.toast'),
      });
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
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          next.set('tab', cta.tab!);
          return next;
        },
        {
          replace: true,
        }
      );
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
    return {
      applicable: applicable.length,
      readyCount,
      blockerCount,
    };
  }, [readinessQuery.data]);

  // Group sections by state so the render can hoist blockers to the top
  // strip and lay the rest out under attention / completed / optional.
  // Not-applicable rows fold into the optional group (non-blocking,
  // informational) so all 11 sections still render with their testids.
  const grouped = useMemo(() => {
    const sections = readinessQuery.data?.sections ?? [];
    return {
      blockers: sections.filter(s => s.status === 'blocker'),
      // warnings are a soft "needs attention" group between the
      // danger blockers and the completed steps. Never block opening.
      attention: sections.filter(s => s.status === 'warning'),
      completed: sections.filter(s => s.status === 'ready'),
      optional: sections.filter(
        s => s.status === 'optional-pending' || s.status === 'not-applicable'
      ),
    };
  }, [readinessQuery.data]);
  if (readinessQuery.isLoading) {
    return <PageLoadingState title={t('readiness.title')} description={t('readiness.loading')} />;
  }
  if (readinessQuery.error) {
    return (
      <QueryErrorState
        title={t('readiness.title')}
        message={translateServerError(readinessQuery.error, t, t('errors:server.unknown'))}
        onRetry={() => {
          void readinessQuery.refetch();
        }}
      />
    );
  }
  if (!readinessQuery.data || !summary) {
    return null;
  }
  const { score, acknowledgedAt } = readinessQuery.data;
  const tone = scoreTone(score);
  const hasBlockers = summary.blockerCount > 0;
  const renderSectionRow = (section: {
    id: string;
    status: SectionStatus;
    cta: {
      route: string;
      tab?: string;
    } | null;
  }) => {
    const labelKey = `readiness.sections.${section.id}.label`;
    const hintKey = `readiness.sections.${section.id}.hint`;
    const statusLabelKey = `readiness.status.${section.status}`;
    const isOptionalPending = section.status === 'optional-pending';
    // optional-pending + warning render as soft (outline) CTAs.
    const isSoft = isOptionalPending || section.status === 'warning';
    return (
      <div
        key={section.id}
        className="pv-check"
        data-testid={`company-readiness-section-${section.id}`}
        data-status={section.status}
      >
        <StatusChip status={section.status} label={t(statusLabelKey)} />
        <div className="min-w-0 flex-1">
          <div className="t">{t(labelKey)}</div>
          <div className="d">{t(hintKey)}</div>
        </div>
        {section.cta && (
          <Button
            type="button"
            variant={isSoft ? 'outline' : 'ghost'}
            size="compact"
            onClick={() => handleSectionCta(section.cta!)}
            data-testid={`company-readiness-cta-${section.id}`}
          >
            {isOptionalPending ? t('readiness.cta.configure') : t('readiness.cta.review')}
          </Button>
        )}
      </div>
    );
  };
  return (
    <div className="card p-6 space-y-6" data-testid="company-readiness-card">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="max-w-[46ch]">
          <p className="pv-kicker">{t('readiness.kicker')}</p>
          <h2 className="pv-title text-xl">{t('readiness.heading')}</h2>
          <p className="text-sm text-secondary-600 mt-2">{t('readiness.description')}</p>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <div className="flex flex-col items-end gap-1 text-right">
            <span className="text-sm font-semibold text-secondary-900">
              {t('readiness.score.label', {
                ready: summary.readyCount,
                total: summary.applicable,
              })}
            </span>
            {hasBlockers && (
              <span
                className="text-[12.5px] font-semibold text-danger-700"
                data-testid="company-readiness-blocker-count"
              >
                {t('readiness.blocker.count', {
                  count: summary.blockerCount,
                })}
              </span>
            )}
          </div>
          <div
            className="pv-ring"
            data-testid="company-readiness-score"
            data-tone={tone}
            role="img"
            aria-label={t('readiness.score.aria', {
              score,
            })}
            style={
              {
                '--p': score,
              } as CSSProperties
            }
          >
            <div className="in">{score}</div>
          </div>
        </div>
      </div>

      {grouped.blockers.length > 0 && (
        <div className="space-y-3" data-testid="company-readiness-blockers">
          {grouped.blockers.map(section => {
            const labelKey = `readiness.sections.${section.id}.label`;
            const hintKey = `readiness.sections.${section.id}.hint`;
            const statusLabelKey = `readiness.status.${section.status}`;
            return (
              <StatusStrip
                key={section.id}
                tone="danger"
                icon={AlertTriangle}
                title={t(labelKey)}
                data-testid={`company-readiness-section-${section.id}`}
                data-status={section.status}
                meta={<span className="sr-only">{t(statusLabelKey)}</span>}
                action={
                  section.cta ? (
                    <Button
                      type="button"
                      onClick={() => handleSectionCta(section.cta!)}
                      data-testid={`company-readiness-cta-${section.id}`}
                      variant="primary"
                    >
                      <ArrowRight className="h-4 w-4" aria-hidden />
                      {t('readiness.cta.resolveSection', {
                        section: t(labelKey),
                      })}
                    </Button>
                  ) : undefined
                }
              >
                <span className="block text-secondary-600">{t(hintKey)}</span>
              </StatusStrip>
            );
          })}
        </div>
      )}

      {grouped.attention.length > 0 && (
        <div data-testid="company-readiness-attention">
          <p className="text-xs font-semibold uppercase tracking-wide text-warning-700">
            {t('readiness.group.attention')}
          </p>
          <div className="mt-2">{grouped.attention.map(renderSectionRow)}</div>
        </div>
      )}

      {grouped.completed.length > 0 && (
        <div data-testid="company-readiness-completed">
          <p className="text-xs font-semibold uppercase tracking-wide text-secondary-600">
            {t('readiness.group.completed')}
          </p>
          <div className="mt-2">{grouped.completed.map(renderSectionRow)}</div>
        </div>
      )}

      {grouped.optional.length > 0 && (
        <div data-testid="company-readiness-optional">
          <p className="text-xs font-semibold uppercase tracking-wide text-secondary-600">
            {t('readiness.group.optional')}
          </p>
          <div className="mt-2">{grouped.optional.map(renderSectionRow)}</div>
        </div>
      )}

      {acknowledgedAt === null && (
        <div className="pt-2">
          <Button
            type="button"
            onClick={() => acknowledgeMutation.mutate()}
            disabled={acknowledgeMutation.isPending}
            data-testid="company-readiness-acknowledge"
            variant="primary"
          >
            {acknowledgeMutation.isPending
              ? t('readiness.acknowledge.pending')
              : hasBlockers
                ? t('readiness.acknowledge.resolveBlocker')
                : t('readiness.acknowledge.openStore')}
          </Button>
        </div>
      )}
    </div>
  );
}
