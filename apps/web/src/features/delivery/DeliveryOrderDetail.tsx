/**
 * Domicilios touch V5: right-side detail panel.
 *
 * Surfaces the customer header, address block, items snapshot
 * list, 5-step status timeline, courier-assignment input, and the
 * two write actions (Marcar como <next> · Cancelar pedido).
 *
 * Both write actions call `deliveryOrders.advance` (the cancel
 * path uses `toStatus='cancelled'` per the existing router shape;
 * there is no separate `cancel` procedure). Success invalidates
 * every status column query so counts update immediately.
 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Phone, MapPin, FileText, X } from 'lucide-react';
import { useToast } from '@/components/feedback/ToastProvider';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { translateServerError } from '@/lib/translateServerError';
import { formatDeliveryAmount, parseDeliveryItems } from './deliverySnapshot';
import type { DeliveryOrderRow } from './DeliveryOrderCard';
import type { DeliveryStatus } from './DeliveryPage';

const TIMELINE_STEPS: DeliveryStatus[] = ['accepted', 'preparing', 'dispatched', 'delivered'];

interface DeliveryOrderDetailProps {
  order: DeliveryOrderRow & {
    preparingAt?: string | null;
    dispatchedAt?: string | null;
    deliveredAt?: string | null;
    cancelledAt?: string | null;
  };
  onAdvanced: (nextStatus: DeliveryStatus) => void;
  onCancelled: () => void;
}

export function DeliveryOrderDetail({ order, onAdvanced, onCancelled }: DeliveryOrderDetailProps) {
  const { t } = useTranslation(['delivery', 'errors', 'fulfillmentErrors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [courierName, setCourierName] = useState(order.courierName ?? '');
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [reason, setReason] = useState('');
  const inFlight = useRef(false);

  const advanceMutation = useCriticalMutation('deliveryOrders.advance', {
    onSettled: async () => {
      await Promise.all([
        utils.deliveryOrders.list.invalidate(),
        utils.deliveryOrders.counts.invalidate(),
        utils.deliveryOrders.get.invalidate(),
      ]);
    },
  });
  const nextStatus = order.allowedTransitions.find(status => status !== 'cancelled');
  const isTerminal = order.allowedTransitions.length === 0;
  const items = parseDeliveryItems(order.itemsSnapshot);

  async function handleAdvance(): Promise<void> {
    if (!nextStatus || inFlight.current || (nextStatus === 'dispatched' && !courierName.trim()))
      return;
    inFlight.current = true;
    try {
      await advanceMutation.mutateAsync({
        id: order.id,
        siteId: order.siteId,
        expectedVersion: order.version,
        toStatus: nextStatus,
        courierName: courierName.trim() || undefined,
      });
      toast.success({
        title: t('toast.advanceSuccess', { label: t(`status.${nextStatus}.label`) }),
      });
      onAdvanced(nextStatus);
    } catch (err) {
      toast.error({
        title: t('toast.advanceError'),
        description: translateServerError(err, t, t('toast.advanceError')),
      });
    } finally {
      inFlight.current = false;
    }
  }

  async function handleCancel(): Promise<void> {
    if (inFlight.current || !reason.trim() || !order.allowedTransitions.includes('cancelled'))
      return;
    inFlight.current = true;
    try {
      await advanceMutation.mutateAsync({
        id: order.id,
        siteId: order.siteId,
        expectedVersion: order.version,
        toStatus: 'cancelled',
        reason: reason.trim(),
        courierName: courierName.trim() || undefined,
      });
      toast.success({ title: t('toast.cancelSuccess') });
      setConfirmingCancel(false);
      onCancelled();
    } catch (err) {
      toast.error({
        title: t('toast.cancelError'),
        description: translateServerError(err, t, t('toast.advanceError')),
      });
    } finally {
      inFlight.current = false;
    }
  }

  function timestampFor(step: DeliveryStatus): string | null {
    switch (step) {
      case 'accepted':
        return order.acceptedAt;
      case 'preparing':
        return order.preparingAt ?? null;
      case 'dispatched':
        return order.dispatchedAt ?? null;
      case 'delivered':
        return order.deliveredAt ?? null;
      case 'cancelled':
        return order.cancelledAt ?? null;
    }
  }

  return (
    <section
      data-testid="delivery-detail-card"
      className="min-w-0 break-words space-y-4 rounded-xl border border-line/70 bg-surface-1 p-4"
    >
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.18em] text-secondary-500">
          {t('detail.title')}
        </p>
        <p className="font-display text-xl">{order.customerName}</p>
        {order.customerPhone ? (
          <p className="flex items-center gap-1 text-sm text-secondary-600">
            <Phone className="h-3.5 w-3.5" aria-hidden="true" />
            {order.customerPhone}
          </p>
        ) : null}
      </header>

      <p className="text-sm text-secondary-600">{t(`detail.source.${order.source}`)}</p>
      {order.cancellationReason ? (
        <p>
          {t('detail.reasonLabel')}: {order.cancellationReason}
        </p>
      ) : null}
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="flex items-center gap-1 text-xs uppercase tracking-[0.18em] text-secondary-500">
            <MapPin className="h-3 w-3" aria-hidden="true" />
            {t('detail.addressLabel')}
          </dt>
          <dd className="mt-1 text-secondary-900">{order.address}</dd>
          {order.addressNotes ? (
            <dd className="mt-1 text-xs text-secondary-600">
              <span className="font-medium">{t('detail.addressNotesLabel')}: </span>
              {order.addressNotes}
            </dd>
          ) : null}
        </div>
        <div>
          <dt className="text-xs uppercase tracking-[0.18em] text-secondary-500">
            {t('detail.totalLabel')}
          </dt>
          <dd
            className="mt-1 font-display text-lg tabular-nums"
            data-testid="delivery-detail-total"
          >
            {formatDeliveryAmount(
              order.totalAmount,
              order.currencyCode,
              t('detail.currencyUnknown')
            )}
          </dd>
        </div>
      </dl>

      {items.length > 0 ? (
        <div>
          <p className="flex items-center gap-1 text-xs uppercase tracking-[0.18em] text-secondary-500">
            <FileText className="h-3 w-3" aria-hidden="true" />
            {t('detail.itemsLabel')}
          </p>
          <ul className="mt-1 space-y-1 text-xs text-secondary-700">
            {items.map((item, idx) => (
              <li
                key={idx}
                className="flex items-center justify-between gap-2 border-b border-line/40 py-1 last:border-b-0"
              >
                <span>
                  {item.qty ? `${item.qty} × ` : ''}
                  {item.name ?? '—'}
                </span>
                {typeof item.unitPrice === 'number' ? (
                  <span className="tabular-nums">
                    {formatDeliveryAmount(
                      item.unitPrice,
                      order.currencyCode,
                      t('detail.currencyUnknown')
                    )}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-secondary-600">{t('card.itemsFallback')}</p>
      )}

      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-secondary-500">
          {t('detail.timelineTitle')}
        </p>
        <ol className="mt-2 space-y-1 text-xs">
          {TIMELINE_STEPS.map(step => {
            const stamp = timestampFor(step);
            const isReached = Boolean(stamp);
            const isCurrent = step === order.status;
            return (
              <li
                key={step}
                data-testid={`delivery-timeline-${step}`}
                data-reached={isReached ? 'true' : 'false'}
                className={[
                  'flex items-center justify-between gap-2 rounded-md border px-2 py-1',
                  isCurrent
                    ? 'border-primary-300 bg-primary-50 text-primary-900'
                    : isReached
                      ? 'border-success-200 bg-success-50 text-success-700'
                      : 'border-line/50 text-secondary-500',
                ].join(' ')}
              >
                <span>{t(`detail.timeline.${step}`)}</span>
                <span className="tabular-nums">{stamp ?? '—'}</span>
              </li>
            );
          })}
          {order.status === 'cancelled' ? (
            <li
              data-testid="delivery-timeline-cancelled"
              className="flex items-center justify-between gap-2 rounded-md border border-danger-300 bg-danger-50 px-2 py-1 text-danger-700"
            >
              <span>{t('detail.timeline.cancelled')}</span>
              <span className="tabular-nums">{order.cancelledAt ?? '—'}</span>
            </li>
          ) : null}
        </ol>
      </div>

      <div>
        <label
          htmlFor="delivery-detail-courier"
          className="text-xs uppercase tracking-[0.18em] text-secondary-500"
        >
          {t('detail.courierLabel')}
        </label>
        <input
          id="delivery-detail-courier"
          type="text"
          data-testid="delivery-detail-courier"
          value={courierName}
          maxLength={120}
          disabled={isTerminal || advanceMutation.isPending}
          onChange={e => setCourierName(e.target.value)}
          placeholder={t('detail.courierPlaceholder')}
          className="mt-1 w-full rounded-md border border-line/70 px-2 py-1.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
        />
      </div>

      <div className="flex flex-col gap-2">
        <button
          type="button"
          data-testid="delivery-detail-advance"
          onClick={handleAdvance}
          disabled={
            isTerminal ||
            advanceMutation.isPending ||
            (nextStatus === 'dispatched' && !courierName.trim())
          }
          className="inline-flex items-center justify-center gap-2 rounded-md bg-primary-700 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-800 disabled:cursor-not-allowed disabled:bg-secondary-300 disabled:text-secondary-600"
        >
          {t(`detail.advance.${order.status}`)}
        </button>
        {!isTerminal ? (
          confirmingCancel ? (
            <div
              role="dialog"
              aria-label={t('detail.cancelConfirmTitle')}
              data-testid="delivery-detail-cancel-confirm"
              className="space-y-2 rounded-md border border-danger-300 bg-danger-50 p-3 text-xs text-danger-700"
            >
              <p className="font-medium">{t('detail.cancelConfirmTitle')}</p>
              <p>{t('detail.cancelConfirmBody')}</p>
              <label className="block" htmlFor="delivery-cancel-reason">
                {t('detail.reasonLabel')}
              </label>
              <textarea
                id="delivery-cancel-reason"
                required
                maxLength={500}
                value={reason}
                onChange={event => setReason(event.target.value)}
                disabled={advanceMutation.isPending}
                className="w-full rounded-md border border-line bg-surface-1 p-2 text-secondary-900"
              />
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingCancel(false)}
                  className="rounded-md border border-line/70 bg-surface-1 px-2 py-1 text-xs font-medium text-secondary-700 hover:bg-surface-2"
                >
                  {t('detail.cancelConfirmDismiss')}
                </button>
                <button
                  type="button"
                  data-testid="delivery-detail-cancel-confirm-button"
                  onClick={handleCancel}
                  disabled={advanceMutation.isPending || !reason.trim()}
                  className="rounded-md bg-danger-600 px-2 py-1 text-xs font-medium text-white hover:bg-danger-700 disabled:opacity-60"
                >
                  {t('detail.cancelConfirmConfirm')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              data-testid="delivery-detail-cancel"
              onClick={() => setConfirmingCancel(true)}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-danger-300 px-3 py-2 text-sm font-medium text-danger-700 transition-colors hover:bg-danger-50"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              {t('detail.cancel')}
            </button>
          )
        ) : null}
      </div>
    </section>
  );
}
