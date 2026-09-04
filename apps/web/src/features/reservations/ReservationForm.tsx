import { useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { translateServerError } from '@/lib/translateServerError';
import { fromLocalReservationTime, toLocalReservationTime } from './reservationTime';

/** API-owned reservation model; no duplicate frontend state machine. */
export type ReservationView = inferRouterOutputs<AppRouter>['reservations']['list']['rows'][number];
const inputClass =
  'mt-1 block w-full rounded border border-line bg-surface-1 p-2 text-secondary-900';
/** Full versioned booking editor, remounted after selecting another row/version/site. */
export function ReservationForm({
  siteId,
  row,
  onSaved,
  onCancel,
}: {
  siteId: string;
  row?: ReservationView | undefined;
  /** The successfully submitted UTC start selects the day containing the saved booking. */
  onSaved: (startsAt: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation(['restaurants', 'errors', 'common', 'fulfillmentErrors']);
  const create = useCriticalMutation('reservations.create'),
    update = useCriticalMutation('reservations.update');
  const pending = create.isPending || update.isPending;
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const tables = trpc.restaurantTables.list.useQuery({ siteId, includeArchived: false });
  const [defaults] = useState(() => {
    const now = Date.now();
    return {
      start: new Date(now + 3_600_000).toISOString(),
      end: new Date(now + 7_200_000).toISOString(),
    };
  });
  const start = row?.startsAt ?? defaults.start;
  const end = row?.endsAt ?? defaults.end;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current) return;
    const fields = new FormData(event.currentTarget);
    const startsAt = fromLocalReservationTime(String(fields.get('startsAt'))),
      endsAt = fromLocalReservationTime(String(fields.get('endsAt')));
    if (
      !startsAt ||
      !endsAt ||
      endsAt <= startsAt ||
      Date.parse(endsAt) - Date.parse(startsAt) > 86_400_000
    ) {
      setError(t('reservations.invalidWindow'));
      return;
    }
    busy.current = true;
    setError(null);
    const input = {
      siteId,
      tableId: String(fields.get('tableId') || '') || null,
      guestName: String(fields.get('guestName') || '').trim(),
      phone: String(fields.get('phone') || '').trim(),
      partySize: Number(fields.get('partySize')),
      notes: String(fields.get('notes') || '').trim(),
      startsAt,
      endsAt,
    };
    try {
      if (row) await update.mutateAsync({ ...input, id: row.id, expectedVersion: row.version });
      else await create.mutateAsync(input);
      onSaved(startsAt);
    } catch (failure) {
      setError(translateServerError(failure, t, t('errors:server.unknown')));
    } finally {
      busy.current = false;
    }
  }
  return (
    <form onSubmit={event => void submit(event)} className="space-y-4">
      <p className="text-sm text-secondary-700">
        {t('reservations.timeZone', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
      </p>
      <fieldset disabled={pending} className="space-y-3">
        <label className="block text-sm">
          {t('reservations.guest')}
          <input
            className={inputClass}
            name="guestName"
            required
            maxLength={160}
            defaultValue={row?.guestName ?? ''}
            autoFocus
          />
        </label>
        <label className="block text-sm">
          {t('reservations.phone')}
          <input
            className={inputClass}
            name="phone"
            type="tel"
            maxLength={40}
            defaultValue={row?.phone ?? ''}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            {t('reservations.startsAt')}
            <input
              className={inputClass}
              name="startsAt"
              type="datetime-local"
              required
              defaultValue={toLocalReservationTime(start)}
            />
          </label>
          <label className="block text-sm">
            {t('reservations.endsAt')}
            <input
              className={inputClass}
              name="endsAt"
              type="datetime-local"
              required
              defaultValue={toLocalReservationTime(end)}
            />
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            {t('service.guestCount')}
            <input
              className={inputClass}
              name="partySize"
              type="number"
              min={1}
              max={200}
              step={1}
              required
              defaultValue={row?.partySize ?? 2}
            />
          </label>
          <label className="block text-sm">
            {t('tableLabel.label')}
            <select
              className={inputClass}
              name="tableId"
              defaultValue={row?.tableId ?? ''}
              disabled={tables.isLoading || !!tables.error}
            >
              <option value="">{t('reservations.unassigned')}</option>
              {row?.tableId && !tables.data?.items.some(table => table.id === row.tableId) && (
                <option value={row.tableId}>{t('reservations.unavailableTable')}</option>
              )}
              {tables.data?.items.map(table => (
                <option key={table.id} value={table.id}>
                  {table.name}
                  {table.seatCount !== null ? ` · ${table.seatCount}` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm">
          {t('reservations.notes')}
          <textarea
            className={inputClass}
            name="notes"
            maxLength={500}
            defaultValue={row?.notes ?? ''}
          />
        </label>
      </fieldset>
      {tables.error && (
        <p role="alert" className="text-danger-700">
          {t('tables.error')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger-700">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          className="rounded border border-line px-3 py-2"
          disabled={pending}
          onClick={onCancel}
        >
          {t('common:actions.cancel')}
        </button>
        <button
          type="submit"
          className="rounded bg-primary-700 px-3 py-2 text-white disabled:opacity-50"
          disabled={pending || tables.isLoading || !!tables.error}
        >
          {t('common:actions.save')}
        </button>
      </div>
    </form>
  );
}
