import { useRef, useState } from 'react';
import { History, RefreshCw, Repeat2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/AuthProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { Button } from '@/components/ui';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { translateServerError } from '@/lib/translateServerError';
import { ShiftSwapDecisionDialog, ShiftSwapHistoryDialog, ShiftSwapPair } from './ShiftSwapShared';
import { formatSwapShift } from './shiftSwapFormat';
import type {
  ShiftSwapCandidate,
  ShiftSwapDecision,
  ShiftSwapDecisionStatus,
  ShiftSwapRequest,
  ShiftSwapRequestCursor,
  ShiftSwapShift,
  ShiftSwapShiftCursor,
  ShiftSwapStatus,
} from './shiftSwapTypes';

/** Personal workforce state is remounted at the authenticated owner boundary. */
export function MySchedulePage() {
  const { user } = useAuth();
  const { t } = useTranslation('shiftSwaps');
  if (!user) return <p role="alert">{t('loadError')}</p>;
  return <OwnedSchedule key={`${user.tenantId}:${user.id}:${user.role}`} userId={user.id} />;
}

function OwnedSchedule({ userId }: { userId: string }) {
  const { t, i18n } = useTranslation(['shiftSwaps', 'errors', 'workforceErrors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<ShiftSwapStatus | ''>('');
  const [requestCursors, setRequestCursors] = useState<ShiftSwapRequestCursor[]>([]);
  const [shiftCursors, setShiftCursors] = useState<ShiftSwapShiftCursor[]>([]);
  const [candidateCursors, setCandidateCursors] = useState<ShiftSwapShiftCursor[]>([]);
  const [creating, setCreating] = useState(false);
  const [offered, setOffered] = useState<ShiftSwapShift | null>(null);
  const [requested, setRequested] = useState<ShiftSwapCandidate | null>(null);
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [editor, setEditor] = useState<{
    row: ShiftSwapRequest;
    status: ShiftSwapDecisionStatus;
  } | null>(null);
  const [history, setHistory] = useState<ShiftSwapRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const locale = i18n.resolvedLanguage ?? i18n.language;

  const requests = trpc.workforce.shiftSwaps.mine.useQuery(
    {
      limit: 20,
      ...(status ? { status } : {}),
      ...(requestCursors.at(-1) ? { cursor: requestCursors.at(-1)! } : {}),
    },
    { gcTime: 0, staleTime: 0 }
  );
  const shifts = trpc.workforce.shiftSwaps.myShifts.useQuery(
    {
      limit: 20,
      ...(shiftCursors.at(-1) ? { cursor: shiftCursors.at(-1)! } : {}),
    },
    { enabled: creating, gcTime: 0, staleTime: 0 }
  );
  const candidates = trpc.workforce.shiftSwaps.candidates.useQuery(
    {
      offeredShiftId: offered?.id ?? '',
      offeredVersion: offered?.version ?? 1,
      limit: 20,
      ...(candidateCursors.at(-1) ? { cursor: candidateCursors.at(-1)! } : {}),
    },
    { enabled: creating && !!offered, gcTime: 0, staleTime: 0 }
  );
  const create = useCriticalMutation('workforce.shiftSwaps.create', { gcTime: 0 });
  const respond = useCriticalMutation('workforce.shiftSwaps.respond', { gcTime: 0 });
  const saving = create.isPending || respond.isPending;

  function resetCreate() {
    setCreating(false);
    setOffered(null);
    setRequested(null);
    setReason('');
    setAcknowledged(false);
    setShiftCursors([]);
    setCandidateCursors([]);
    setError(null);
  }

  function invalidateAfterCommit() {
    void utils.workforce.shiftSwaps.invalidate();
    void utils.employeeShifts.schedule.invalidate();
    void utils.auditLogs.invalidate();
  }

  async function submitCreate() {
    if (busy.current || !offered || !requested || !acknowledged || reason.trim().length < 10)
      return;
    busy.current = true;
    setError(null);
    try {
      await create.mutateAsync({
        offeredShiftId: offered.id,
        offeredVersion: offered.version,
        requestedShiftId: requested.id,
        requestedVersion: requested.version,
        reason: reason.trim(),
      });
      resetCreate();
      setRequestCursors([]);
      toast.success({ title: t('shiftSwaps:saved') });
      invalidateAfterCommit();
    } catch (failure) {
      setError(translateServerError(failure, t, t('shiftSwaps:saveError')));
      // Preserve the captured pair and versions; a safe refetch must not silently change consent.
      void requests.refetch();
    } finally {
      busy.current = false;
    }
  }

  async function submitDecision(decision: ShiftSwapDecision) {
    if (!editor || busy.current) return;
    busy.current = true;
    setError(null);
    try {
      if (decision.status === 'accepted') {
        await respond.mutateAsync({
          id: editor.row.id,
          expectedVersion: editor.row.version,
          status: 'accepted',
        });
      } else if (
        (decision.status === 'rejected' || decision.status === 'cancelled') &&
        decision.reason
      ) {
        await respond.mutateAsync({
          id: editor.row.id,
          expectedVersion: editor.row.version,
          status: decision.status,
          reason: decision.reason,
        });
      } else {
        return;
      }
      setEditor(null);
      setRequestCursors([]);
      toast.success({ title: t('shiftSwaps:saved') });
      invalidateAfterCommit();
    } catch (failure) {
      setError(translateServerError(failure, t, t('shiftSwaps:saveError')));
      void requests.refetch();
    } finally {
      busy.current = false;
    }
  }

  return (
    <main className="space-y-6" data-testid="my-schedule-page">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="pv-kicker">{t('shiftSwaps:kicker')}</p>
          <h1 className="pv-title text-2xl">{t('shiftSwaps:title')}</h1>
          <p className="mt-2 max-w-3xl text-sm text-secondary-600">{t('shiftSwaps:description')}</p>
        </div>
        <Button onClick={() => setCreating(true)} disabled={saving}>
          <Repeat2 aria-hidden="true" />
          {t('shiftSwaps:actions.request')}
        </Button>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="label">{t('shiftSwaps:statusFilter')}</span>
          <select
            className="input"
            value={status}
            onChange={event => {
              setStatus(event.target.value as ShiftSwapStatus | '');
              setRequestCursors([]);
            }}
          >
            <option value="">{t('shiftSwaps:allStatuses')}</option>
            {(['requested', 'accepted', 'approved', 'rejected', 'cancelled'] as const).map(
              value => (
                <option key={value} value={value}>
                  {t(`shiftSwaps:statuses.${value}`)}
                </option>
              )
            )}
          </select>
        </label>
        <Button
          variant="outline"
          disabled={requests.isFetching}
          onClick={() => void requests.refetch()}
        >
          <RefreshCw aria-hidden="true" />
          {t('shiftSwaps:refresh')}
        </Button>
      </div>

      {requests.isFetching && <p role="status">{t('shiftSwaps:loading')}</p>}
      {requests.error && (
        <div role="alert">
          <p>{translateServerError(requests.error, t, t('shiftSwaps:loadError'))}</p>
          <Button onClick={() => void requests.refetch()}>{t('shiftSwaps:retry')}</Button>
        </div>
      )}
      {!requests.error && !requests.isPending && requests.data?.items.length === 0 && (
        <p>{t('shiftSwaps:empty')}</p>
      )}
      {!requests.error && (
        <ul className="space-y-4">
          {requests.data?.items.map(row => {
            const requester = row.requester.id === userId;
            const recipient = row.recipient.id === userId;
            return (
              <li
                key={row.id}
                data-testid={`shift-swap-${row.id}`}
                className="space-y-3 rounded-xl border border-line bg-surface p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold">
                    {t(`shiftSwaps:statuses.${row.status}`)} ·{' '}
                    {t('shiftSwaps:version', { version: row.version })}
                  </h2>
                  <span className="text-xs text-secondary-500">
                    {requester ? t('shiftSwaps:roles.requester') : t('shiftSwaps:roles.recipient')}
                  </span>
                </div>
                <ShiftSwapPair row={row} />
                <div className="flex flex-wrap gap-2">
                  {recipient && row.status === 'requested' && (
                    <>
                      <Button onClick={() => setEditor({ row, status: 'accepted' })}>
                        {t('shiftSwaps:actions.accept')}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setEditor({ row, status: 'rejected' })}
                      >
                        {t('shiftSwaps:actions.reject')}
                      </Button>
                    </>
                  )}
                  {((requester && (row.status === 'requested' || row.status === 'accepted')) ||
                    (recipient && row.status === 'accepted')) && (
                    <Button
                      variant="outline"
                      onClick={() => setEditor({ row, status: 'cancelled' })}
                    >
                      {recipient
                        ? t('shiftSwaps:actions.withdraw')
                        : t('shiftSwaps:actions.cancel')}
                    </Button>
                  )}
                  <Button variant="outline" onClick={() => setHistory(row)}>
                    <History aria-hidden="true" />
                    {t('shiftSwaps:actions.history')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <nav className="flex gap-3" aria-label={t('shiftSwaps:requestPages')}>
        <Button
          variant="outline"
          disabled={!requestCursors.length || requests.isFetching}
          onClick={() => setRequestCursors(previous => previous.slice(0, -1))}
        >
          {t('shiftSwaps:previous')}
        </Button>
        <Button
          variant="outline"
          disabled={!requests.data?.nextCursor || requests.isFetching || !!requests.error}
          onClick={() => {
            if (requests.data?.nextCursor)
              setRequestCursors(previous => [...previous, requests.data!.nextCursor!]);
          }}
        >
          {t('shiftSwaps:next')}
        </Button>
      </nav>

      {creating && (
        <Modal
          isOpen
          onClose={resetCreate}
          title={t('shiftSwaps:create.title')}
          size="lg"
          closeOnBackdrop={!saving}
          closeOnEsc={!saving}
          footer={
            <>
              <ModalButton onClick={resetCreate} disabled={saving}>
                {t('shiftSwaps:actions.keep')}
              </ModalButton>
              <ModalButton
                variant="primary"
                disabled={
                  saving || !offered || !requested || !acknowledged || reason.trim().length < 10
                }
                onClick={() => void submitCreate()}
              >
                {saving ? t('shiftSwaps:saving') : t('shiftSwaps:create.confirm')}
              </ModalButton>
            </>
          }
        >
          <div className="space-y-5">
            <p className="text-sm text-secondary-600">{t('shiftSwaps:create.description')}</p>
            <fieldset className="space-y-3">
              <legend className="font-semibold">{t('shiftSwaps:create.offered')}</legend>
              {shifts.isFetching && <p role="status">{t('shiftSwaps:loading')}</p>}
              {shifts.error && (
                <div role="alert">
                  <p>{translateServerError(shifts.error, t, t('shiftSwaps:loadError'))}</p>
                  <Button onClick={() => void shifts.refetch()}>{t('shiftSwaps:retry')}</Button>
                </div>
              )}
              {!shifts.error && shifts.data?.items.length === 0 && (
                <p>{t('shiftSwaps:create.noOwnShifts')}</p>
              )}
              {shifts.data?.items.map(shift => (
                <label key={shift.id} className="flex items-start gap-3 rounded-lg border p-3">
                  <input
                    type="radio"
                    name="offered-shift"
                    checked={offered?.id === shift.id}
                    onChange={() => {
                      setOffered(shift);
                      setRequested(null);
                      setCandidateCursors([]);
                      setAcknowledged(false);
                    }}
                  />
                  <span className="text-sm">{formatSwapShift(shift, locale)}</span>
                </label>
              ))}
              <PageButtons
                label={t('shiftSwaps:ownShiftPages')}
                cursors={shiftCursors}
                next={shifts.data?.nextCursor ?? null}
                fetching={shifts.isFetching}
                onChange={setShiftCursors}
                previous={t('shiftSwaps:previous')}
                following={t('shiftSwaps:next')}
              />
            </fieldset>
            {offered && (
              <fieldset className="space-y-3">
                <legend className="font-semibold">{t('shiftSwaps:create.requested')}</legend>
                {candidates.isFetching && <p role="status">{t('shiftSwaps:loading')}</p>}
                {candidates.error && (
                  <div role="alert">
                    <p>{translateServerError(candidates.error, t, t('shiftSwaps:loadError'))}</p>
                    <Button onClick={() => void candidates.refetch()}>
                      {t('shiftSwaps:retry')}
                    </Button>
                  </div>
                )}
                {!candidates.error && candidates.data?.items.length === 0 && (
                  <p>{t('shiftSwaps:create.noCandidates')}</p>
                )}
                {candidates.data?.items.map(candidate => (
                  <label
                    key={candidate.id}
                    className="flex items-start gap-3 rounded-lg border p-3"
                  >
                    <input
                      type="radio"
                      name="requested-shift"
                      checked={requested?.id === candidate.id}
                      onChange={() => {
                        setRequested(candidate);
                        setAcknowledged(false);
                      }}
                    />
                    <span className="text-sm">
                      <strong>{candidate.userName}</strong> · {formatSwapShift(candidate, locale)}
                    </span>
                  </label>
                ))}
                <PageButtons
                  label={t('shiftSwaps:candidatePages')}
                  cursors={candidateCursors}
                  next={candidates.data?.nextCursor ?? null}
                  fetching={candidates.isFetching}
                  onChange={setCandidateCursors}
                  previous={t('shiftSwaps:previous')}
                  following={t('shiftSwaps:next')}
                />
              </fieldset>
            )}
            {offered && requested && (
              <section className="space-y-2 rounded-lg border border-primary-200 bg-primary-50 p-3">
                <h3 className="font-semibold">{t('shiftSwaps:create.selectedTitle')}</h3>
                <p className="text-sm">
                  {t('shiftSwaps:create.selectedOffered', {
                    shift: formatSwapShift(offered, locale),
                    version: offered.version,
                  })}
                </p>
                <p className="text-sm">
                  {t('shiftSwaps:create.selectedRequested', {
                    name: requested.userName,
                    shift: formatSwapShift(requested, locale),
                    version: requested.version,
                  })}
                </p>
              </section>
            )}
            <label className="block" htmlFor="shift-swap-create-reason">
              <span className="label">{t('shiftSwaps:create.reasonLabel')}</span>
              <textarea
                id="shift-swap-create-reason"
                aria-describedby="shift-swap-create-reason-hint"
                className="input min-h-28"
                value={reason}
                maxLength={500}
                onChange={event => setReason(event.target.value)}
                placeholder={t('shiftSwaps:create.reasonPlaceholder')}
              />
            </label>
            <span
              id="shift-swap-create-reason-hint"
              className="mt-1 block text-xs text-secondary-500"
            >
              {t('shiftSwaps:decision.reasonHint')}
            </span>
            <label className="flex items-start gap-3 rounded-lg border border-line p-3">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={event => setAcknowledged(event.target.checked)}
              />
              <span className="text-sm">{t('shiftSwaps:create.acknowledge')}</span>
            </label>
            {error && <p role="alert">{error}</p>}
          </div>
        </Modal>
      )}
      {editor && (
        <ShiftSwapDecisionDialog
          key={`${editor.row.id}:${editor.row.version}:${editor.status}`}
          row={editor.row}
          status={editor.status}
          busy={saving}
          error={error}
          onClose={() => {
            setEditor(null);
            setError(null);
          }}
          onSubmit={decision => void submitDecision(decision)}
        />
      )}
      {history && (
        <ShiftSwapHistoryDialog key={history.id} row={history} onClose={() => setHistory(null)} />
      )}
    </main>
  );
}

function PageButtons({
  label,
  cursors,
  next,
  fetching,
  onChange,
  previous,
  following,
}: {
  label: string;
  cursors: ShiftSwapShiftCursor[];
  next: ShiftSwapShiftCursor | null;
  fetching: boolean;
  onChange: (update: (current: ShiftSwapShiftCursor[]) => ShiftSwapShiftCursor[]) => void;
  previous: string;
  following: string;
}) {
  return (
    <nav className="flex gap-3" aria-label={label}>
      <Button
        variant="outline"
        disabled={!cursors.length || fetching}
        onClick={() => onChange(current => current.slice(0, -1))}
      >
        {previous}
      </Button>
      <Button
        variant="outline"
        disabled={!next || fetching}
        onClick={() => {
          if (next) onChange(current => [...current, next]);
        }}
      >
        {following}
      </Button>
    </nav>
  );
}
