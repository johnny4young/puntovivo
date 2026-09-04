import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/features/tenant/TenantProvider';
import { Overlay } from '@/components/overlay/Overlay';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { ReservationForm, type ReservationView } from './ReservationForm';
import { ReservationCard } from './ReservationCard';
import { toLocalReservationTime } from './reservationTime';

/** Site change destroys recipient/filter/edit state rather than leaking a previous site's view. */
export function ReservationsPage() {
  const { currentSite } = useTenant();
  return <ReservationsSite key={currentSite?.id ?? ''} siteId={currentSite?.id ?? ''} />;
}
function ReservationsSite({ siteId }: { siteId: string }) {
  const { t } = useTranslation(['restaurants', 'common', 'errors', 'fulfillmentErrors']);
  const [day, setDay] = useState(() =>
    toLocalReservationTime(new Date().toISOString()).slice(0, 10)
  );
  const [status, setStatus] = useState<ReservationView['status'] | ''>('');
  const [cursors, setCursors] = useState<Array<{ startsAt: string; id: string }>>([]);
  const [editor, setEditor] = useState<ReservationView | 'new' | null>(null);
  const start = new Date(`${day}T00:00`),
    end = new Date(start);
  end.setDate(end.getDate() + 1);
  const valid = Number.isFinite(start.getTime());
  const utils = trpc.useUtils();
  const list = trpc.reservations.list.useQuery(
    {
      siteId,
      from: valid ? start.toISOString() : new Date(0).toISOString(),
      to: valid ? end.toISOString() : new Date(86_400_000).toISOString(),
      ...(status ? { status } : {}),
      ...(cursors.at(-1) ? { cursor: cursors.at(-1)! } : {}),
    },
    { enabled: !!siteId && valid, staleTime: 3_000, refetchInterval: 15_000 }
  );
  const tables = trpc.restaurantTables.list.useQuery(
    { siteId, includeArchived: true },
    { enabled: !!siteId }
  );
  function refresh() {
    void utils.reservations.invalidate();
    void utils.restaurantServices.invalidate();
    void utils.restaurantTables.invalidate();
  }
  if (!siteId) return <p>{t('reservations.noSite')}</p>;
  return (
    <section className="space-y-4" data-testid="reservations-page">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl">{t('reservations.title')}</h2>
          <p className="mt-1 max-w-3xl text-sm text-secondary-700">{t('reservations.subtitle')}</p>
        </div>
        <button
          type="button"
          className="rounded bg-primary-700 px-4 py-2 text-white"
          onClick={() => setEditor('new')}
        >
          {t('reservations.create')}
        </button>
      </header>
      <p className="text-sm text-secondary-700">
        {t('reservations.timeZone', { zone: Intl.DateTimeFormat().resolvedOptions().timeZone })}
      </p>
      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          {t('reservations.day')}
          <input
            className="ml-2 rounded border border-line bg-surface-1 p-2"
            type="date"
            value={day}
            onChange={event => {
              setDay(event.target.value);
              setCursors([]);
            }}
          />
        </label>
        <label className="text-sm">
          {t('reservations.state')}
          <select
            className="ml-2 rounded border border-line bg-surface-1 p-2"
            value={status}
            onChange={event => {
              setStatus(event.target.value as ReservationView['status'] | '');
              setCursors([]);
            }}
          >
            <option value="">{t('reservations.all')}</option>
            {(['booked', 'arrived', 'seated', 'cancelled', 'no_show'] as const).map(value => (
              <option key={value} value={value}>
                {t(`reservations.status.${value}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!valid && <p role="alert">{t('reservations.invalidWindow')}</p>}
      {list.isLoading && <p role="status">{t('common:status.loading')}</p>}
      {(list.error || tables.error) && (
        <div role="alert">
          <p>{translateServerError(list.error || tables.error, t, t('errors:server.unknown'))}</p>
          <button
            type="button"
            className="underline"
            onClick={() => {
              void list.refetch();
              void tables.refetch();
            }}
          >
            {t('common:actions.retry')}
          </button>
        </div>
      )}
      {valid && !list.error && list.data?.rows.length === 0 && (
        <p className="rounded border border-line p-6 text-secondary-700">
          {t('reservations.empty')}
        </p>
      )}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {valid &&
          list.data?.rows.map(row => (
            <ReservationCard
              key={`${row.id}:${row.version}`}
              row={row}
              tableName={
                tables.data?.items.find(table => table.id === row.tableId)?.name ??
                t(row.tableId ? 'reservations.unavailableTable' : 'reservations.unassigned')
              }
              onEdit={() => setEditor(row)}
              onChanged={refresh}
            />
          ))}
      </div>
      <nav className="flex gap-3" aria-label={t('reservations.pagination')}>
        <button
          type="button"
          className="rounded border border-line px-3 py-2 disabled:opacity-50"
          disabled={!cursors.length || list.isFetching}
          onClick={() => setCursors(previous => previous.slice(0, -1))}
        >
          {t('reservations.previous')}
        </button>
        <button
          type="button"
          className="rounded border border-line px-3 py-2 disabled:opacity-50"
          disabled={!list.data?.hasMore || list.isFetching}
          onClick={() => {
            const last = list.data?.rows.at(-1);
            if (last)
              setCursors(previous => [...previous, { id: last.id, startsAt: last.startsAt }]);
          }}
        >
          {t('reservations.next')}
        </button>
      </nav>
      {editor && (
        <Overlay
          isOpen={true}
          onClose={() => {}}
          closeOnEsc={false}
          closeOnBackdrop={false}
          showCloseButton={false}
          title={t(editor === 'new' ? 'reservations.create' : 'reservations.edit')}
          size="md"
        >
          <ReservationForm
            siteId={siteId}
            row={editor === 'new' ? undefined : editor}
            onCancel={() => setEditor(null)}
            onSaved={startsAt => {
              setEditor(null);
              // A late-night default or an edited date may belong to another day.
              // Keep the successful booking visible instead of leaving a misleading empty list.
              setDay(toLocalReservationTime(startsAt).slice(0, 10));
              setStatus('');
              setCursors([]);
              refresh();
            }}
          />
        </Overlay>
      )}
    </section>
  );
}
