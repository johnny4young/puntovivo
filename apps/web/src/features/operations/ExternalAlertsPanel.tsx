import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BellRing,
  Check,
  Copy,
  Link2,
  RefreshCw,
  Send,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';

import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import { Badge, Button } from '@/components/ui';
import { trpc } from '@/lib/trpc';

const ALERT_EVENT_TYPES = [
  'operational_alert.opened',
  'operational_alert.escalated',
  'operational_alert.acknowledged',
  'operational_alert.resolved',
] as const;

export function ExternalAlertsPanel(): React.ReactElement {
  const { t } = useTranslation('operationalAlerts');
  const toast = useToast();
  const utils = trpc.useUtils();
  const overview = trpc.operations.alertsOverview.useQuery(undefined, {
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
  const [oneTimeSecret, setOneTimeSecret] = useState<string | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);

  const refresh = async (): Promise<void> => {
    await Promise.all([
      utils.operations.alertsOverview.invalidate(),
      utils.operations.needsAttention.invalidate(),
    ]);
  };
  const create = trpc.events.createSubscription.useMutation({
    onSuccess: async result => {
      setOneTimeSecret(result.signingSecret);
      setSecretCopied(false);
      await refresh();
    },
  });
  const acknowledge = trpc.operations.acknowledgeAlert.useMutation({
    onSuccess: async () => {
      toast.success({ title: t('incidents.acknowledged') });
      await refresh();
    },
  });
  const retry = trpc.operations.retryAlertDelivery.useMutation({ onSuccess: refresh });

  if (overview.isError) {
    return (
      <QueryErrorState
        title={t('loadError')}
        message={t('loadError')}
        retryLabel={t('retryLoad')}
        onRetry={() => void overview.refetch()}
      />
    );
  }

  const data = overview.data;
  const activeAlerts = data?.alerts.filter(alert => alert.status !== 'resolved') ?? [];
  const deadLetters = data?.deliveries.filter(delivery => delivery.status === 'dead_letter') ?? [];
  const activeSubscriptions =
    data?.subscriptions.filter(subscription => subscription.enabled && !subscription.revokedAt) ??
    [];

  return (
    <div className="space-y-6" data-testid="external-alerts-panel">
      <section className="card overflow-hidden">
        <div className="border-b border-line p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="pv-gt pv-gt-primary h-11 w-11 rounded-xl">
                <BellRing className="h-5 w-5" aria-hidden="true" />
              </span>
              <div>
                <p className="pv-kicker">{t('kicker')}</p>
                <h2 className="pv-title text-xl">{t('title')}</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-secondary-600">
                  {t('description')}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  deadLetters.length > 0 ? 'danger' : data?.provisioned ? 'success' : 'warning'
                }
                marker="dot"
              >
                {deadLetters.length > 0
                  ? t('status.attention')
                  : data?.provisioned
                    ? t('status.configured')
                    : t('status.unconfigured')}
              </Badge>
              <Button type="button" variant="ghost" onClick={() => void refresh()}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {t('refresh')}
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-px bg-line sm:grid-cols-3">
          <Metric label={t('metrics.active')} value={activeAlerts.length} />
          <Metric
            label={t('metrics.failed')}
            value={deadLetters.length}
            danger={deadLetters.length > 0}
          />
          <Metric label={t('metrics.receivers')} value={activeSubscriptions.length} />
        </div>
        <div className="border-t border-line bg-warning-50/60 px-5 py-4 text-sm leading-6 text-secondary-700 sm:px-6">
          <div className="flex items-start gap-2">
            <TriangleAlert
              className="mt-0.5 h-4 w-4 shrink-0 text-warning-700"
              aria-hidden="true"
            />
            <p>{t('honesty')}</p>
          </div>
        </div>
      </section>

      {oneTimeSecret && (
        <section
          className="rounded-2xl border border-warning-300 bg-warning-50 p-5"
          aria-live="polite"
        >
          <h3 className="font-semibold text-secondary-950">{t('secret.title')}</h3>
          <p className="mt-1 text-sm text-secondary-700">{t('secret.description')}</p>
          <code className="mt-3 block overflow-x-auto rounded-xl bg-secondary-950 p-3 text-sm text-white">
            {oneTimeSecret}
          </code>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (!navigator.clipboard?.writeText) return;
                void navigator.clipboard
                  .writeText(oneTimeSecret)
                  .then(() => setSecretCopied(true))
                  .catch(() => setSecretCopied(false));
              }}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              {secretCopied ? t('secret.copied') : t('secret.copy')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOneTimeSecret(null)}>
              {t('secret.saved')}
            </Button>
          </div>
        </section>
      )}

      <section className="card p-5 sm:p-6">
        <div>
          <h3 className="text-lg font-semibold text-secondary-950">{t('create.title')}</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-secondary-600">
            {t('create.description')}
          </p>
        </div>
        <form
          className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.4fr)_auto] lg:items-end"
          onSubmit={event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            create.mutate({
              name: String(form.get('name') ?? ''),
              destinationUrl: String(form.get('destinationUrl') ?? ''),
              eventTypes: [...ALERT_EVENT_TYPES],
            });
          }}
        >
          <label className="space-y-2 text-sm font-medium text-secondary-800">
            {t('create.name')}
            <input
              className="input"
              name="name"
              required
              maxLength={80}
              placeholder={t('create.namePlaceholder')}
            />
          </label>
          <label className="space-y-2 text-sm font-medium text-secondary-800">
            {t('create.destination')}
            <input
              className="input"
              name="destinationUrl"
              type="url"
              required
              placeholder="https://"
            />
          </label>
          <Button type="submit" disabled={create.isPending}>
            <Link2 className="h-4 w-4" aria-hidden="true" />
            {create.isPending ? t('create.creating') : t('create.action')}
          </Button>
        </form>
        {create.isError && <p className="mt-3 text-sm text-destructive">{t('create.error')}</p>}
      </section>

      <section className="card p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="pv-gt pv-gt-success h-10 w-10 rounded-xl">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-lg font-semibold text-secondary-950">{t('incidents.title')}</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-secondary-600">
              {t('incidents.description')}
            </p>
          </div>
        </div>
        {overview.isLoading && <LoadingRows />}
        {!overview.isLoading && activeAlerts.length === 0 && (
          <p className="mt-5 rounded-xl bg-secondary-50 p-4 text-sm text-secondary-600">
            {t('incidents.empty')}
          </p>
        )}
        <div className="mt-5 space-y-3">
          {activeAlerts.map(alert => (
            <article
              key={alert.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line p-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-semibold text-secondary-950">
                    {t(`incidents.area.${alert.area}`)}
                  </h4>
                  <Badge variant={alert.severity === 'danger' ? 'danger' : 'warning'} marker="dot">
                    {t(`status.${alert.status}`)}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-secondary-600">
                  {t('incidents.count', { count: alert.count })}
                </p>
              </div>
              {alert.status === 'open' && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={acknowledge.isPending}
                  onClick={() => acknowledge.mutate({ alertId: alert.id })}
                >
                  <Check className="h-4 w-4" aria-hidden="true" />
                  {acknowledge.isPending
                    ? t('incidents.acknowledging')
                    : t('incidents.acknowledge')}
                </Button>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="pv-gt pv-gt-primary h-10 w-10 rounded-xl">
            <Send className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-lg font-semibold text-secondary-950">{t('deliveries.title')}</h3>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-secondary-600">
              {t('deliveries.description')}
            </p>
          </div>
        </div>
        {!overview.isLoading && (data?.deliveries.length ?? 0) === 0 && (
          <p className="mt-5 rounded-xl bg-secondary-50 p-4 text-sm text-secondary-600">
            {t('deliveries.empty')}
          </p>
        )}
        <div className="mt-5 space-y-3">
          {data?.deliveries.map(delivery => (
            <article
              key={delivery.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line p-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h4 className="font-semibold text-secondary-950">
                    {t(`status.${delivery.status}`)}
                  </h4>
                  <Badge
                    variant={delivery.status === 'dead_letter' ? 'danger' : 'outline'}
                    marker="dot"
                  >
                    {t(`deliveries.transition.${delivery.transition}`)}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-secondary-600">
                  {t('deliveries.context', {
                    transition: t(`deliveries.transition.${delivery.transition}`),
                    receiver: delivery.subscriptionName,
                  })}
                </p>
                <p className="mt-1 text-xs text-secondary-500">
                  {t('deliveries.attempts', { count: delivery.attempts })}
                  {delivery.responseStatus ? ` · HTTP ${delivery.responseStatus}` : ''}
                  {delivery.lastErrorCode ? ` · ${delivery.lastErrorCode}` : ''}
                </p>
              </div>
              {delivery.status === 'dead_letter' && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={retry.isPending}
                  onClick={() => retry.mutate({ deliveryId: delivery.id })}
                >
                  <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  {retry.isPending ? t('deliveries.retrying') : t('deliveries.retry')}
                </Button>
              )}
            </article>
          ))}
        </div>
        {data && (
          <p className="mt-5 text-xs leading-5 text-secondary-500">
            {t('retention', data.retention)}
          </p>
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number;
  danger?: boolean;
}) {
  return (
    <div className="bg-card p-5 sm:p-6">
      <p className="pv-kicker">{label}</p>
      <p
        className={`mt-2 text-2xl font-semibold ${danger ? 'text-destructive' : 'text-secondary-950'}`}
      >
        {value}
      </p>
    </div>
  );
}

function LoadingRows(): React.ReactElement {
  return (
    <div className="mt-5 space-y-3" data-testid="external-alerts-loading" aria-hidden="true">
      {[0, 1].map(item => (
        <div key={item} className="h-16 animate-pulse rounded-2xl bg-secondary-100/70" />
      ))}
    </div>
  );
}
