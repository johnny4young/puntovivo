import { AlertTriangle, Check, Minus, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { PageLoadingState } from '@/components/feedback/LoadingState';
import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { Badge, Button } from '@/components/ui';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';

function ctaHref(cta: { route: string; tab?: string }): string {
  if (!cta.tab) return cta.route;
  const separator = cta.route.includes('?') ? '&' : '?';
  return `${cta.route}${separator}tab=${encodeURIComponent(cta.tab)}`;
}

/** Advisory, evidence-backed setup checklist for the tenant's selected vertical. */
export function VerticalReadinessCard() {
  const { t } = useTranslation(['verticalReadiness', 'errors']);
  const navigate = useNavigate();
  // Configuration lives across several independent pages. Keep this query
  // immediately stale so returning to Company never presents an old checklist.
  const query = trpc.setupReadiness.vertical.useQuery(undefined, {
    staleTime: 0,
    refetchOnMount: 'always',
  });

  if (query.isLoading) {
    return (
      <PageLoadingState
        title={t('verticalReadiness:title')}
        description={t('verticalReadiness:loading')}
      />
    );
  }
  if (query.error) {
    return (
      <QueryErrorState
        title={t('verticalReadiness:title')}
        message={translateServerError(query.error, t, t('errors:server.unknown'))}
        onRetry={() => void query.refetch()}
      />
    );
  }
  const readiness = query.data;
  if (!readiness) return null;

  return (
    <section
      className="rounded-[1.5rem] border border-line bg-card p-5 shadow-soft sm:p-6"
      aria-labelledby="vertical-readiness-title"
      data-testid="vertical-readiness-card"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary-700">
            {t('verticalReadiness:eyebrow')}
          </p>
          <h2
            id="vertical-readiness-title"
            className="mt-1 font-display text-2xl font-semibold text-secondary-950"
          >
            {readiness.profile
              ? t('verticalReadiness:profileTitle', {
                  profile: t(`verticalReadiness:profiles.${readiness.profile}`),
                })
              : t('verticalReadiness:title')}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-secondary-600">
            {readiness.profile
              ? t('verticalReadiness:description')
              : t('verticalReadiness:noProfile')}
          </p>
        </div>
        {readiness.profile ? (
          <div
            className="flex shrink-0 gap-2"
            aria-label={t('verticalReadiness:summary.ariaLabel')}
          >
            <Badge variant="success">
              {t('verticalReadiness:summary.ready', { count: readiness.readyCount })}
            </Badge>
            {readiness.attentionCount > 0 ? (
              <Badge variant="warning">
                {t('verticalReadiness:summary.attention', {
                  count: readiness.attentionCount,
                })}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </div>

      {readiness.profile ? (
        <ul className="mt-5 grid gap-3 md:grid-cols-2">
          {readiness.checks.map(item => {
            const itemCta = item.cta;
            const Icon =
              item.status === 'ready' ? Check : item.status === 'attention' ? AlertTriangle : Minus;
            return (
              <li
                key={item.id}
                className="flex min-h-36 flex-col rounded-2xl border border-line bg-surface p-4"
                data-testid={`vertical-readiness-${item.id}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                      item.status === 'ready'
                        ? 'bg-success-50 text-success-700'
                        : item.status === 'attention'
                          ? 'bg-warning-50 text-warning-800'
                          : 'bg-secondary-100 text-secondary-500'
                    }`}
                    aria-hidden="true"
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold text-secondary-950">
                        {t(`verticalReadiness:checks.${item.id}.label`)}
                      </h3>
                      <Badge
                        variant={
                          item.status === 'ready'
                            ? 'success'
                            : item.status === 'attention'
                              ? 'warning'
                              : 'neutral'
                        }
                      >
                        {t(`verticalReadiness:status.${item.status}`)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm leading-5 text-secondary-600">
                      {t(`verticalReadiness:checks.${item.id}.hint`, {
                        count: item.configuredCount,
                      })}
                    </p>
                  </div>
                </div>
                {itemCta ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-4 min-h-11 self-end"
                    onClick={() => navigate(ctaHref(itemCta))}
                    data-testid={`vertical-readiness-action-${item.id}`}
                  >
                    {item.status === 'attention' ? (
                      <RefreshCw className="h-4 w-4" aria-hidden="true" />
                    ) : null}
                    {t('verticalReadiness:action')}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <p className="mt-5 border-t border-line pt-4 text-xs leading-5 text-secondary-500">
        {t('verticalReadiness:disclaimer')}
      </p>
    </section>
  );
}
