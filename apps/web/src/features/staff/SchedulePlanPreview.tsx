import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { Button } from '@/components/ui';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import type { SchedulePlanView } from './schedulePlanTypes';

/** Paginate the bounded frozen set instead of mounting up to 1,000 shift cards at once. */
export function SchedulePlanOccurrences({ view }: { view: SchedulePlanView }) {
  const { t } = useTranslation('schedulePlans');
  const [page, setPage] = useState(0),
    size = 20;
  const rows = [...view.occurrences].sort(
    (a, b) =>
      a.startsAt.localeCompare(b.startsAt) ||
      a.userId.localeCompare(b.userId) ||
      a.id.localeCompare(b.id)
  );
  return (
    <section className="space-y-3">
      <p>
        {t('shiftCount', { count: rows.length })} · {t('zone', { zone: view.plan.timeZone })}
      </p>
      <ol className="space-y-2">
        {rows.slice(page * size, (page + 1) * size).map(row => (
          <li
            key={row.id}
            className="rounded-lg border border-line p-3"
            data-testid="plan-occurrence"
          >
            <p className="font-semibold">
              {view.display.employees.find(employee => employee.id === row.userId)?.name ??
                row.userId}
            </p>
            <p>
              {row.startDate} · {row.startTime} → {row.endDate} · {row.endTime}
            </p>
            {row.notes && <p className="break-words text-sm">{row.notes}</p>}
            <p className="text-xs text-secondary-500">
              {row.publishedShiftId ? t('linkedShift') : t('notScheduled')}
            </p>
          </li>
        ))}
      </ol>
      <nav className="flex items-center gap-3" aria-label={t('occurrencePages')}>
        <Button variant="outline" disabled={page === 0} onClick={() => setPage(value => value - 1)}>
          {t('previous')}
        </Button>
        <span>{t('page', { page: page + 1 })}</span>
        <Button
          variant="outline"
          disabled={(page + 1) * size >= rows.length}
          onClick={() => setPage(value => value + 1)}
        >
          {t('next')}
        </Button>
      </nav>
    </section>
  );
}

/** Read failure hides cached private details; decisions capture the version actually shown. */
export function SchedulePlanPreview({
  id,
  onClose,
  onAction,
}: {
  id: string;
  onClose: () => void;
  onAction: (action: 'regenerate' | 'publish' | 'discard', view: SchedulePlanView) => void;
}) {
  const { t } = useTranslation(['schedulePlans', 'errors', 'workforceErrors']);
  const query = trpc.workforce.schedulePlans.get.useQuery({ id }, { gcTime: 0, staleTime: 0 });
  const view = !query.error ? query.data : undefined;
  return (
    <Modal
      isOpen
      size="xl"
      title={t('preview')}
      onClose={onClose}
      footer={
        <ModalButton variant="secondary" onClick={onClose}>
          {t('close')}
        </ModalButton>
      }
    >
      {query.isFetching && <p role="status">{t('loading')}</p>}
      {query.error && <p role="alert">{translateServerError(query.error, t, t('loadError'))}</p>}
      <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
        {t('refresh')}
      </Button>
      {view && (
        <div className="mt-4 space-y-4">
          <h2 className="break-words text-xl font-semibold">{view.plan.title}</h2>
          <p>
            {view.display.site.name} · {t(`statuses.${view.plan.status}`)} ·{' '}
            {t('version', { version: view.plan.version })}
          </p>
          <p className="text-sm text-secondary-600">
            {view.plan.status === 'published' ? t('publishedNotice') : t('draftNotice')}
          </p>
          <SchedulePlanOccurrences key={`${view.plan.id}:${view.plan.version}`} view={view} />
          {view.plan.status === 'draft' && (
            <div className="flex flex-wrap gap-3">
              {(['publish', 'regenerate', 'discard'] as const).map(action => (
                <Button
                  key={action}
                  variant={action === 'publish' ? 'primary' : 'outline'}
                  disabled={query.isFetching}
                  onClick={() => onAction(action, view)}
                >
                  {t(`actions.${action}`)}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/** Explicit final confirmation never reads a newer version behind the operator's back. */
export function SchedulePlanDecision({
  action,
  view,
  saving,
  error,
  onClose,
  onSubmit,
}: {
  action: 'publish' | 'discard';
  view: SchedulePlanView;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const { t } = useTranslation('schedulePlans');
  const [reason, setReason] = useState(''),
    [acknowledged, setAcknowledged] = useState(false);
  const valid =
    action === 'publish' ? acknowledged : reason.trim().length >= 10 && reason.trim().length <= 500;
  return (
    <Modal
      isOpen
      size="lg"
      title={t(`actions.${action}`)}
      onClose={() => {
        if (!saving) onClose();
      }}
      closeOnEsc={!saving}
      closeOnBackdrop={!saving}
      showCloseButton={!saving}
      footer={
        <>
          <ModalButton variant="secondary" disabled={saving} onClick={onClose}>
            {t('close')}
          </ModalButton>
          <ModalButton
            disabled={saving || !valid}
            onClick={() => {
              if (!saving && valid) void onSubmit(reason.trim());
            }}
          >
            {saving ? t('saving') : t(`confirm.${action}`)}
          </ModalButton>
        </>
      }
    >
      <div className="space-y-4">
        <p className="break-words font-semibold">
          {view.plan.title} · {t('version', { version: view.plan.version })}
        </p>
        <p>{t(`${action}Notice`, { count: view.plan.occurrenceCount })}</p>
        <p>
          {view.display.site.name} · {view.plan.fromDate} → {view.plan.untilDate} ·{' '}
          {view.plan.timeZone}
        </p>
        {action === 'publish' ? (
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              disabled={saving}
              checked={acknowledged}
              onChange={event => setAcknowledged(event.target.checked)}
            />
            <span>{t('acknowledge')}</span>
          </label>
        ) : (
          <label className="block">
            <span className="label">{t('reason')}</span>
            <textarea
              className="input"
              rows={3}
              value={reason}
              maxLength={500}
              disabled={saving}
              onChange={event => setReason(event.target.value)}
            />
          </label>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
