import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { translateServerError } from '@/lib/translateServerError';
import type { ReservationView } from './ReservationForm';
/** Each transition carries the displayed version. Cancellation and no-show never mutate a service. */
export function ReservationCard({
  row,
  tableName,
  onEdit,
  onChanged,
}: {
  row: ReservationView;
  tableName: string;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const { t, i18n } = useTranslation(['restaurants', 'common', 'errors', 'fulfillmentErrors']);
  const advance = useCriticalMutation('reservations.advance');
  const busy = useRef(false);
  const [reason, setReason] = useState('');
  const [pendingAction, setPendingAction] = useState<'cancelled' | 'no_show' | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function transition(toStatus: 'arrived' | 'cancelled' | 'no_show') {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    try {
      await advance.mutateAsync({
        siteId: row.siteId,
        id: row.id,
        expectedVersion: row.version,
        toStatus,
        ...(toStatus === 'arrived' ? {} : { reason: reason.trim() }),
      });
      setPendingAction(null);
      onChanged();
    } catch (failure) {
      setError(translateServerError(failure, t, t('errors:server.unknown')));
      onChanged();
    } finally {
      busy.current = false;
    }
  }
  const buttonClass = 'rounded border border-line px-3 py-2 text-sm disabled:opacity-50';
  return (
    <article
      className="min-w-0 space-y-3 rounded-xl border border-line bg-surface-1 p-4"
      data-testid={`reservation-${row.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="break-words font-semibold">{row.guestName}</h3>
        <span className="rounded bg-surface-2 px-2 py-1 text-sm">
          {t(`reservations.status.${row.status}`)}
        </span>
      </div>
      <p className="text-sm">
        {new Date(row.startsAt).toLocaleString(i18n.language)} —{' '}
        {new Date(row.endsAt).toLocaleString(i18n.language)}
      </p>
      <p className="text-sm">
        {tableName} · {t('reservations.party', { count: row.partySize })}
      </p>
      {row.phone && <p className="break-words text-sm">{row.phone}</p>}
      {row.notes && <p className="break-words text-sm text-secondary-700">{row.notes}</p>}
      {row.reason && (
        <p className="break-words text-sm">
          {t('reservations.reason')}: {row.reason}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {row.status === 'booked' && (
          <>
            <button
              type="button"
              className={buttonClass}
              disabled={advance.isPending}
              onClick={onEdit}
            >
              {t('common:actions.edit')}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={advance.isPending || !row.tableId}
              onClick={() => void transition('arrived')}
            >
              {t('reservations.arrive')}
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={advance.isPending}
              onClick={() => setPendingAction('no_show')}
            >
              {t('reservations.noShow')}
            </button>
          </>
        )}
        {(row.status === 'booked' || row.status === 'arrived') && (
          <button
            type="button"
            className={buttonClass}
            disabled={advance.isPending}
            onClick={() => setPendingAction('cancelled')}
          >
            {t('reservations.cancel')}
          </button>
        )}
        {row.status === 'arrived' && (
          <Link className={`${buttonClass} text-primary-700 underline`} to="/sales">
            {t('reservations.openCheck')}
          </Link>
        )}
      </div>
      {row.status === 'arrived' && (
        <p className="text-sm text-secondary-700">{t('reservations.seatingHint')}</p>
      )}
      {pendingAction && (
        <div className="space-y-2 rounded border border-line p-3">
          <p className="font-medium">{t(`reservations.status.${pendingAction}`)}</p>
          <label className="block text-sm">
            {t('reservations.reason')}
            <textarea
              className="mt-1 w-full rounded border border-line bg-surface-1 p-2"
              value={reason}
              maxLength={500}
              onChange={event => setReason(event.target.value)}
              disabled={advance.isPending}
            />
          </label>
          <button
            type="button"
            className={buttonClass}
            disabled={advance.isPending}
            onClick={() => setPendingAction(null)}
          >
            {t('common:actions.cancel')}
          </button>{' '}
          <button
            type="button"
            className="rounded bg-primary-700 px-3 py-2 text-white disabled:opacity-50"
            disabled={advance.isPending || !reason.trim()}
            onClick={() => void transition(pendingAction)}
          >
            {t('common:actions.confirm')}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-danger-700">
          {error}
        </p>
      )}
    </article>
  );
}
