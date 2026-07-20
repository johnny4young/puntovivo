import { Bell, Check, MessageCircle, RefreshCw, ShieldAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { formatDateTime } from '@/lib/utils';
import { buildLossPreventionWhatsAppUrl } from './lossPreventionWhatsApp';

type AlertItem = inferRouterOutputs<AppRouter>['lossPrevention']['listAlerts']['items'][number];

interface LossPreventionAlertCenterProps {
  siteId: string;
  variant?: 'popover' | 'inline';
}

function AlertList(props: {
  items: AlertItem[];
  whatsappHandoff: { enabled: boolean; recipientPhone: string };
  isAcknowledging: boolean;
  onAcknowledge: (alertId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation('common');

  if (props.items.length === 0) {
    return <p className="mt-3 text-xs text-fg2">{t('common:lossPreventionAlerts.empty')}</p>;
  }

  return (
    <div className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto pr-0.5">
      {props.items.map(alert => {
        const occurredAt = formatDateTime(alert.occurredAt);
        const actorName = alert.actorName ?? t('common:lossPreventionAlerts.unknownOperator');
        const siteName = alert.siteName ?? t('common:lossPreventionAlerts.unknownSite');
        const whatsappMessage = t('common:lossPreventionAlerts.whatsapp.message', {
          rule: t(`common:lossPreventionAlerts.kinds.${alert.kind}`),
          operator: actorName,
          site: siteName,
          time: occurredAt,
        });
        const showWhatsApp =
          props.whatsappHandoff.enabled &&
          alert.channels.includes('whatsapp_handoff') &&
          props.whatsappHandoff.recipientPhone.length > 0;

        return (
          <article
            key={alert.id}
            data-testid={`loss-prevention-alert-${alert.id}`}
            className={
              alert.acknowledgedAt
                ? 'rounded-xl border border-line bg-card p-3'
                : 'rounded-xl border border-warning-200 bg-warning-50/70 p-3'
            }
          >
            <div className="flex items-start gap-2">
              <ShieldAlert
                className={
                  alert.acknowledgedAt
                    ? 'mt-0.5 h-4 w-4 shrink-0 text-secondary-500'
                    : 'mt-0.5 h-4 w-4 shrink-0 text-warning-700'
                }
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-secondary-950">
                  {t(`common:lossPreventionAlerts.kinds.${alert.kind}`)}
                </p>
                <p className="mt-1 text-[11px] text-secondary-700">
                  {t('common:lossPreventionAlerts.triggeredBy', {
                    name: actorName,
                    site: siteName,
                  })}
                </p>
                <p className="mt-0.5 text-[10px] text-fg2">{occurredAt}</p>
                <p className="mt-1 text-[10px] font-medium text-secondary-700">
                  {alert.approvalProvided
                    ? t('common:lossPreventionAlerts.approvalProvided')
                    : t('common:lossPreventionAlerts.approvalPending')}
                </p>
                {alert.acknowledgedAt && (
                  <p className="mt-1 text-[10px] text-success-700">
                    {t('common:lossPreventionAlerts.reviewedBy', {
                      name:
                        alert.acknowledgedByName ?? t('common:lossPreventionAlerts.unknownManager'),
                      time: formatDateTime(alert.acknowledgedAt),
                    })}
                  </p>
                )}
              </div>
            </div>

            {!alert.acknowledgedAt && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary flex-1 justify-center px-2 text-xs"
                  disabled={props.isAcknowledging}
                  onClick={() => props.onAcknowledge(alert.id)}
                >
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('common:lossPreventionAlerts.markReviewed')}
                </button>
                {showWhatsApp && (
                  <a
                    className="btn-outline flex-1 justify-center px-2 text-xs"
                    href={buildLossPreventionWhatsAppUrl({
                      recipientPhone: props.whatsappHandoff.recipientPhone,
                      message: whatsappMessage,
                    })}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t('common:lossPreventionAlerts.whatsapp.aria', {
                      rule: t(`common:lossPreventionAlerts.kinds.${alert.kind}`),
                    })}
                    data-testid={`loss-prevention-whatsapp-${alert.id}`}
                  >
                    <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('common:lossPreventionAlerts.whatsapp.action')}
                  </a>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}

/** tenant/site-scoped in-app alert center for manager and admin roles. */
export function LossPreventionAlertCenter({
  siteId,
  variant = 'popover',
}: LossPreventionAlertCenterProps): React.ReactElement {
  const { t } = useTranslation(['common', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const alertsQuery = trpc.lossPrevention.listAlerts.useQuery(
    { siteId, limit: 20 },
    variant === 'popover'
      ? { refetchInterval: 5_000 }
      : { refetchInterval: false, refetchOnMount: false }
  );
  const acknowledgeMutation = useCriticalMutation('lossPrevention.acknowledgeAlert', {
    onSuccess: async () => {
      await utils.lossPrevention.listAlerts.invalidate({ siteId, limit: 20 });
      toast.success({ title: t('common:lossPreventionAlerts.reviewedSuccess') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'common:lossPreventionAlerts.errorTitle',
    }),
  });

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [open]);

  const content = alertsQuery.isLoading ? (
    <p className="mt-3 text-xs text-fg2">{t('common:lossPreventionAlerts.loading')}</p>
  ) : alertsQuery.error ? (
    <div className="mt-3">
      <p role="alert" className="text-xs text-danger-700">
        {t('common:lossPreventionAlerts.errorTitle')}
      </p>
      <button
        type="button"
        className="btn-ghost mt-2 w-full justify-center px-3 text-xs"
        onClick={() => void alertsQuery.refetch()}
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        {t('common:actions.retry')}
      </button>
    </div>
  ) : (
    <AlertList
      items={alertsQuery.data?.items ?? []}
      whatsappHandoff={alertsQuery.data?.whatsappHandoff ?? { enabled: false, recipientPhone: '' }}
      isAcknowledging={acknowledgeMutation.isPending}
      onAcknowledge={alertId => acknowledgeMutation.mutate({ siteId, alertId })}
    />
  );
  const unreadCount = alertsQuery.data?.unacknowledgedCount ?? 0;

  if (variant === 'inline') {
    return (
      <section
        aria-labelledby="loss-prevention-alerts-inline-title"
        className="mt-3 rounded-2xl border border-line bg-surface-2/70 p-3 sm:hidden"
      >
        <div className="flex items-center justify-between gap-2">
          <h3
            id="loss-prevention-alerts-inline-title"
            className="text-xs font-semibold uppercase tracking-[0.12em] text-secondary-950"
          >
            {t('common:lossPreventionAlerts.title')}
          </h3>
          <span className="rounded-full bg-warning-100 px-2 py-0.5 text-[10px] font-semibold text-warning-800">
            {unreadCount}
          </span>
        </div>
        {content}
      </section>
    );
  }

  return (
    <div className="relative hidden sm:block">
      <button
        type="button"
        className="relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line/70 bg-surface-2/70 text-secondary-700 transition hover:border-primary-200 hover:bg-primary-50/80 hover:text-primary-700"
        aria-label={t('common:lossPreventionAlerts.openAria', { count: unreadCount })}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-danger-600 px-1 text-center text-[10px] font-bold leading-5 text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <section
          role="dialog"
          aria-modal="false"
          aria-labelledby="loss-prevention-alerts-popover-title"
          className="absolute right-0 z-40 mt-3 w-[min(26rem,calc(100vw-2rem))] rounded-[24px] border border-line bg-card p-4 shadow-[var(--shadow-panel)]"
        >
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3
                id="loss-prevention-alerts-popover-title"
                className="text-sm font-semibold text-secondary-950"
              >
                {t('common:lossPreventionAlerts.title')}
              </h3>
              <p className="mt-0.5 text-[11px] text-fg2">
                {t('common:lossPreventionAlerts.siteScope')}
              </p>
            </div>
            <button
              type="button"
              className="btn-ghost btn-icon rounded-full"
              aria-label={t('common:lossPreventionAlerts.closeAria')}
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {content}
        </section>
      )}
    </div>
  );
}
