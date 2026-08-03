import { useState } from 'react';
import { CheckCircle2, Copy, Link2, RefreshCw, ShieldAlert, Webhook } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui';
import { trpc } from '@/lib/trpc';

const EVENT_TYPES = [
  'sale.completed',
  'sale.refunded',
  'inventory.adjusted',
  'cash_session.closed',
  'fiscal_document.accepted',
] as const;

export function WebhookHealthPanel(): React.ReactElement {
  const { t } = useTranslation(['webhookOperations', 'operations']);
  const utils = trpc.useUtils();
  const subscriptions = trpc.events.listSubscriptions.useQuery();
  const deliveries = trpc.events.listDeliveries.useQuery({ limit: 50, offset: 0 });
  const [oneTimeSecret, setOneTimeSecret] = useState<string | null>(null);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const copySecret = async (): Promise<void> => {
    if (!oneTimeSecret || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(oneTimeSecret);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const refresh = async (): Promise<void> => {
    await Promise.all([
      utils.events.listSubscriptions.invalidate(),
      utils.events.listDeliveries.invalidate(),
      utils.events.peekOutbox.invalidate(),
    ]);
  };
  const create = trpc.events.createSubscription.useMutation({
    onSuccess: async result => {
      setOneTimeSecret(result.signingSecret);
      await refresh();
    },
  });
  const disable = trpc.events.disableSubscription.useMutation({ onSuccess: refresh });
  const revoke = trpc.events.revokeSubscription.useMutation({
    onSuccess: async () => {
      setConfirmRevokeId(null);
      await refresh();
    },
  });
  const retry = trpc.events.retryDelivery.useMutation({ onSuccess: refresh });

  const rows = subscriptions.data ?? [];
  const deliveryRows = deliveries.data ?? [];
  const deadLetters = deliveryRows.filter(row => row.status === 'dead_letter');
  const delivered = deliveryRows.filter(row => row.status === 'delivered').length;
  const pending = deliveryRows.length - delivered - deadLetters.length;

  return (
    <div className="space-y-6" data-testid="webhook-health-panel">
      <section className="card overflow-hidden">
        <div className="border-b border-secondary-200 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="pv-gt pv-gt-primary h-11 w-11 rounded-xl">
                <Webhook className="h-5 w-5" />
              </span>
              <div>
                <p className="pv-kicker">{t('kicker')}</p>
                <h2 className="text-xl font-semibold text-secondary-950">{t('title')}</h2>
                <p className="mt-1 max-w-2xl text-sm text-secondary-600">
                  {t('description')}
                </p>
              </div>
            </div>
            <button className="btn-secondary" type="button" onClick={() => void refresh()}>
              <RefreshCw className="h-4 w-4" />
              {t('actions.refresh')}
            </button>
          </div>
        </div>

        <div className="grid gap-3 p-5 sm:grid-cols-3 sm:p-6">
          <Metric label={t('metrics.subscriptions')} value={rows.filter(row => row.enabled).length} />
          <Metric label={t('metrics.delivered')} value={delivered} tone="positive" />
          <Metric label={t('metrics.attention')} value={deadLetters.length + pending} tone={deadLetters.length ? 'danger' : 'neutral'} />
        </div>
      </section>

      {oneTimeSecret && (
        <section className="rounded-2xl border border-warning-300 bg-warning-50 p-5" aria-live="polite">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-warning-700" />
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-secondary-950">{t('secret.title')}</h3>
              <p className="mt-1 text-sm text-secondary-700">{t('secret.description')}</p>
              <code className="mt-3 block overflow-x-auto rounded-xl bg-secondary-950 p-3 text-sm text-white">
                {oneTimeSecret}
              </code>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="btn-secondary"
                  type="button"
                  onClick={() => void copySecret()}
                >
                  <Copy className="h-4 w-4" />
                  {copied ? t('secret.copied') : t('secret.copy')}
                </button>
                <button className="btn-ghost" type="button" onClick={() => setOneTimeSecret(null)}>
                  {t('secret.saved')}
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      <section className="card p-5 sm:p-6">
        <div className="mb-5">
          <h3 className="text-lg font-semibold text-secondary-950">{t('create.title')}</h3>
          <p className="mt-1 text-sm text-secondary-600">{t('create.description')}</p>
        </div>
        <form
          className="grid gap-4 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.4fr)_auto] lg:items-end"
          onSubmit={event => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            create.mutate({
              name: String(data.get('name') ?? ''),
              destinationUrl: String(data.get('destinationUrl') ?? ''),
              eventTypes: [...EVENT_TYPES],
            });
          }}
        >
          <label className="space-y-2 text-sm font-medium text-secondary-800">
            {t('create.name')}
            <input className="input" name="name" required maxLength={80} />
          </label>
          <label className="space-y-2 text-sm font-medium text-secondary-800">
            {t('create.destination')}
            <input className="input" name="destinationUrl" type="url" required placeholder="https://" />
          </label>
          <button className="btn-primary" type="submit" disabled={create.isPending}>
            <Link2 className="h-4 w-4" />
            {create.isPending ? t('create.creating') : t('create.action')}
          </button>
        </form>
        {create.error && <p className="mt-3 text-sm text-destructive">{t('create.error')}</p>}
      </section>

      <section className="card p-5 sm:p-6">
        <h3 className="text-lg font-semibold text-secondary-950">{t('subscriptions.title')}</h3>
        {subscriptions.isLoading && <p className="mt-4 text-sm text-secondary-600">{t('operations:common.loading')}</p>}
        {!subscriptions.isLoading && rows.length === 0 && (
          <p className="mt-4 rounded-xl bg-secondary-50 p-4 text-sm text-secondary-600">
            {t('subscriptions.empty')}
          </p>
        )}
        <div className="mt-4 space-y-3">
          {rows.map(row => (
            <article key={row.id} className="rounded-2xl border border-secondary-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold text-secondary-950">{row.name}</h4>
                    <Badge variant={row.enabled ? 'success' : 'neutral'} marker="dot">
                      {row.revokedAt
                        ? t('status.revoked')
                        : row.enabled
                          ? t('status.active')
                          : t('status.disabled')}
                    </Badge>
                  </div>
                  <p className="mt-1 break-all text-sm text-secondary-600">{row.destinationUrl}</p>
                  <p className="mt-2 text-xs text-secondary-500">
                    {t('subscriptions.events', { count: row.eventTypes.length })}
                  </p>
                </div>
                {!row.revokedAt && (
                  <div className="flex flex-wrap gap-2">
                    {row.enabled && (
                      <button className="btn-secondary" type="button" onClick={() => disable.mutate({ id: row.id })}>
                        {t('actions.disable')}
                      </button>
                    )}
                    <button
                      className={confirmRevokeId === row.id ? 'btn-danger' : 'btn-ghost'}
                      type="button"
                      onClick={() => {
                        if (confirmRevokeId === row.id) revoke.mutate({ id: row.id });
                        else setConfirmRevokeId(row.id);
                      }}
                    >
                      {confirmRevokeId === row.id ? t('actions.confirmRevoke') : t('actions.revoke')}
                    </button>
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="card p-5 sm:p-6">
        <h3 className="text-lg font-semibold text-secondary-950">{t('deliveries.title')}</h3>
        <div className="mt-4 space-y-3">
          {deliveryRows.length === 0 && <p className="text-sm text-secondary-600">{t('deliveries.empty')}</p>}
          {deliveryRows.map(row => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-secondary-200 p-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className={row.status === 'delivered' ? 'h-5 w-5 text-success-700' : 'h-5 w-5 text-warning-700'} />
                <div>
                  <p className="font-medium text-secondary-950">{t(`status.${row.status}`)}</p>
                  <p className="text-xs text-secondary-600">
                    {t('deliveries.context', {
                      destination: row.subscriptionName,
                      event: row.eventType,
                    })}
                  </p>
                  <p className="text-xs text-secondary-500">
                    {t('deliveries.attempts', { count: row.attempts })}
                    {row.responseStatus ? ` · HTTP ${row.responseStatus}` : ''}
                    {row.lastErrorCode ? ` · ${row.lastErrorCode}` : ''}
                  </p>
                </div>
              </div>
              {row.status === 'dead_letter' && (
                <button className="btn-secondary" type="button" onClick={() => retry.mutate({ outboxId: row.outboxId })}>
                  <RefreshCw className="h-4 w-4" />
                  {t('actions.retry')}
                </button>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, tone = 'neutral' }: { label: string; value: number; tone?: 'neutral' | 'positive' | 'danger' }) {
  const toneClass = tone === 'positive' ? 'text-success-700' : tone === 'danger' ? 'text-destructive' : 'text-secondary-950';
  return (
    <div className="rounded-2xl bg-secondary-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-secondary-500">{label}</p>
      <p className={`mt-2 text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}
