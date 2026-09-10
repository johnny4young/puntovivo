import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { Button } from '@/components/ui';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import type {
  ShiftSwapDecision,
  ShiftSwapDecisionStatus,
  ShiftSwapRequest,
} from './shiftSwapTypes';
import { formatSwapShift } from './shiftSwapFormat';

export function ShiftSwapPair({ row }: { row: ShiftSwapRequest }) {
  const { t, i18n } = useTranslation('shiftSwaps');
  const locale = i18n.resolvedLanguage ?? i18n.language;
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg border border-line bg-surface-2 p-3">
        <dt className="text-xs font-semibold uppercase tracking-wide text-secondary-500">
          {t('pair.offeredBy', { name: row.requester.name })}
        </dt>
        <dd className="mt-1 text-sm text-secondary-900">{formatSwapShift(row.offered, locale)}</dd>
      </div>
      <div className="rounded-lg border border-line bg-surface-2 p-3">
        <dt className="text-xs font-semibold uppercase tracking-wide text-secondary-500">
          {t('pair.requestedFrom', { name: row.recipient.name })}
        </dt>
        <dd className="mt-1 text-sm text-secondary-900">
          {formatSwapShift(row.requested, locale)}
        </dd>
      </div>
    </dl>
  );
}

export function ShiftSwapDecisionDialog({
  row,
  status,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  row: ShiftSwapRequest;
  status: ShiftSwapDecisionStatus;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (decision: ShiftSwapDecision) => void;
}) {
  const { t } = useTranslation('shiftSwaps');
  const needsAcknowledgement = status === 'accepted' || status === 'approved';
  const needsReason = status === 'rejected' || status === 'cancelled';
  const [acknowledged, setAcknowledged] = useState(false);
  const [reason, setReason] = useState('');
  const reasonId = useId();
  const valid = needsAcknowledgement ? acknowledged : reason.trim().length >= 10;
  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t(`decision.${status}.title`)}
      closeOnBackdrop={!busy}
      closeOnEsc={!busy}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={busy}>
            {t('actions.keep')}
          </ModalButton>
          <ModalButton
            variant={status === 'rejected' || status === 'cancelled' ? 'danger' : 'primary'}
            disabled={busy || !valid}
            onClick={() =>
              onSubmit({
                status,
                ...(needsReason ? { reason: reason.trim() } : {}),
              })
            }
          >
            {busy ? t('saving') : t(`decision.${status}.confirm`)}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-secondary-600">{t(`decision.${status}.description`)}</p>
        <ShiftSwapPair row={row} />
        {needsAcknowledgement && (
          <label className="flex items-start gap-3 rounded-lg border border-line p-3">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={event => setAcknowledged(event.target.checked)}
            />
            <span className="text-sm">{t('decision.acknowledgeExactPair')}</span>
          </label>
        )}
        {needsReason && (
          <div>
            <label className="block" htmlFor={reasonId}>
              <span className="label">{t('decision.reasonLabel')}</span>
              <textarea
                id={reasonId}
                aria-describedby={`${reasonId}-hint`}
                className="input min-h-28"
                value={reason}
                maxLength={500}
                onChange={event => setReason(event.target.value)}
                placeholder={t('decision.reasonPlaceholder')}
              />
            </label>
            <span id={`${reasonId}-hint`} className="mt-1 block text-xs text-secondary-500">
              {t('decision.reasonHint')}
            </span>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

export function ShiftSwapHistoryDialog({
  row,
  onClose,
}: {
  row: ShiftSwapRequest;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation(['shiftSwaps', 'errors', 'workforceErrors']);
  const [versions, setVersions] = useState<number[]>([]);
  const beforeVersion = versions.at(-1);
  const input = useMemo(
    () => ({ id: row.id, limit: 20, ...(beforeVersion ? { beforeVersion } : {}) }),
    [beforeVersion, row.id]
  );
  const query = trpc.workforce.shiftSwaps.events.useQuery(input, { gcTime: 0, staleTime: 0 });
  const locale = i18n.resolvedLanguage ?? i18n.language;
  return (
    <Modal isOpen onClose={onClose} title={t('shiftSwaps:history.title')} size="lg">
      <div className="space-y-4">
        <ShiftSwapPair row={row} />
        {query.isFetching && <p role="status">{t('shiftSwaps:loading')}</p>}
        {query.error && (
          <div role="alert">
            <p>{translateServerError(query.error, t, t('shiftSwaps:history.loadError'))}</p>
            <Button onClick={() => void query.refetch()}>{t('shiftSwaps:retry')}</Button>
          </div>
        )}
        {!query.error && query.data?.items.length === 0 && <p>{t('shiftSwaps:history.empty')}</p>}
        {!query.error && (
          <ol className="space-y-3">
            {query.data?.items.map(event => (
              <li key={event.id} className="rounded-lg border border-line p-3">
                <p className="font-semibold">
                  {t(`shiftSwaps:statuses.${event.status}`)} ·{' '}
                  {t('shiftSwaps:version', { version: event.version })}
                </p>
                <p className="text-sm text-secondary-600">
                  {event.actorName} ·{' '}
                  {new Intl.DateTimeFormat(locale, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  }).format(Date.parse(event.createdAt))}
                </p>
                {event.reason && <p className="mt-2 whitespace-pre-wrap text-sm">{event.reason}</p>}
              </li>
            ))}
          </ol>
        )}
        <nav className="flex gap-3" aria-label={t('shiftSwaps:history.pages')}>
          <Button
            variant="outline"
            disabled={!versions.length || query.isFetching}
            onClick={() => setVersions(previous => previous.slice(0, -1))}
          >
            {t('shiftSwaps:previous')}
          </Button>
          <Button
            variant="outline"
            disabled={!query.data?.nextBeforeVersion || query.isFetching || !!query.error}
            onClick={() => {
              if (query.data?.nextBeforeVersion)
                setVersions(previous => [...previous, query.data!.nextBeforeVersion!]);
            }}
          >
            {t('shiftSwaps:next')}
          </Button>
        </nav>
      </div>
    </Modal>
  );
}
