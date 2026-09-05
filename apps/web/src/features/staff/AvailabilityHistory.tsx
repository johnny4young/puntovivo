import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { Button } from '@/components/ui';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { AvailabilitySlots } from './AvailabilitySlots';
import type { AvailabilityRecord } from './availabilityTypes';
/** Private snapshots are queried only while authorized history is visible, one bounded page at a time. */
export function AvailabilityHistory({
  row,
  onClose,
}: {
  row: AvailabilityRecord;
  onClose: () => void;
}) {
  const { t } = useTranslation(['availability', 'errors', 'workforceErrors']);
  const [pages, setPages] = useState<number[]>([]),
    boundary = pages.at(-1);
  const query = trpc.workforce.availability.events.useQuery(
    { id: row.id, limit: 20, ...(boundary ? { beforeVersion: boundary } : {}) },
    { gcTime: 0, staleTime: 0 }
  );
  return (
    <Modal
      isOpen
      size="lg"
      title={t('historyTitle', { employee: row.userName })}
      onClose={onClose}
      footer={<ModalButton onClick={onClose}>{t('close')}</ModalButton>}
    >
      <p className="mb-4 text-sm text-secondary-600">{t('historyNotice')}</p>
      {query.isPending && <p role="status">{t('loading')}</p>}
      {query.error && (
        <div role="alert">
          <p>{translateServerError(query.error, t, t('loadError'))}</p>
          <Button onClick={() => void query.refetch()}>{t('retry')}</Button>
        </div>
      )}
      {!query.error && (
        <ol className="space-y-4">
          {query.data?.items.map(event => (
            <li key={event.id} className="space-y-2 rounded-xl border border-line p-4">
              <h3 className="font-semibold">
                {t(`events.${event.kind}`)} · {t('version', { version: event.version })}
              </h3>
              <p className="break-words text-xs text-secondary-500">
                {event.createdAt} · {t('actor', { actor: event.actorId })}
              </p>
              <p className="whitespace-pre-wrap break-words">{event.reason}</p>
              {event.before && (
                <section className="space-y-1">
                  <h4 className="text-sm font-semibold">{t('before')}</h4>
                  <p className="text-sm">
                    {event.before.fromDate} → {event.before.untilDate ?? t('openEnd')} ·{' '}
                    {event.before.timeZone} · {t(`statuses.${event.before.status}`)}
                  </p>
                  <AvailabilitySlots slots={event.before.slots} />
                </section>
              )}
              <section className="space-y-1">
                <h4 className="text-sm font-semibold">{t('after')}</h4>
                <p className="text-sm">
                  {event.after.fromDate} → {event.after.untilDate ?? t('openEnd')} ·{' '}
                  {event.after.timeZone} · {t(`statuses.${event.after.status}`)}
                </p>
                <AvailabilitySlots slots={event.after.slots} />
              </section>
            </li>
          ))}
        </ol>
      )}
      <nav className="mt-4 flex gap-3" aria-label={t('historyPages')}>
        <Button
          variant="outline"
          disabled={!pages.length || query.isFetching}
          onClick={() => setPages(previous => previous.slice(0, -1))}
        >
          {t('newer')}
        </Button>
        <Button
          variant="outline"
          disabled={!query.data?.nextBeforeVersion || !!query.error || query.isFetching}
          onClick={() => {
            if (query.data?.nextBeforeVersion)
              setPages(previous => [...previous, query.data!.nextBeforeVersion!]);
          }}
        >
          {t('older')}
        </Button>
      </nav>
    </Modal>
  );
}
