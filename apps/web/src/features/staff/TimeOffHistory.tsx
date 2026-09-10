import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { Button } from '@/components/ui';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import type { TimeOffRecord } from './timeOffTypes';

/** Explanations are fetched only inside this authorized modal, one bounded history page at a time. */
export function TimeOffHistory({ row, onClose }: { row: TimeOffRecord; onClose: () => void }) {
  const { t } = useTranslation(['timeOff', 'errors', 'workforceErrors']);
  const [pages, setPages] = useState<number[]>([]);
  const boundary = pages.at(-1);
  const query = trpc.workforce.timeOff.events.useQuery(
    { id: row.id, siteId: row.siteId, limit: 20, ...(boundary ? { beforeVersion: boundary } : {}) },
    { gcTime: 0, staleTime: 0 }
  );
  return (
    <Modal
      isOpen
      title={t('historyTitle', { employee: row.userName })}
      onClose={onClose}
      size="lg"
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
            <li key={event.id} className="rounded-xl border border-line p-4">
              <h3 className="font-semibold">
                {t(`events.${event.kind}`)} · {t('version', { version: event.version })}
              </h3>
              <p className="my-2 text-xs text-secondary-500">
                {event.createdAt} · {t('actor', { actor: event.actorId })}
              </p>
              <p className="whitespace-pre-wrap break-words">{event.reason}</p>
              <p className="mt-2 text-sm">
                {t(`kinds.${event.after.kind}`)} · {event.after.fromDate} → {event.after.untilDate}{' '}
                · {event.after.timeZone}
              </p>
              <p className="text-sm">
                {event.before ? `${t(`statuses.${event.before.status}`)} → ` : ''}
                {t(`statuses.${event.after.status}`)}
              </p>
              {event.after.approvedAt && (
                <p className="mt-2 text-sm">
                  {t('approvalEvidence', {
                    actor: event.after.approvedByUserId,
                    time: event.after.approvedAt,
                  })}
                </p>
              )}
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
