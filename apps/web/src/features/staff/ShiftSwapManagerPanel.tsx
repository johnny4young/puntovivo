import { useRef, useState } from 'react';
import { History, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/AuthProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { Button } from '@/components/ui';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { translateServerError } from '@/lib/translateServerError';
import { ShiftSwapDecisionDialog, ShiftSwapHistoryDialog, ShiftSwapPair } from './ShiftSwapShared';
import type { ShiftSwapDecision, ShiftSwapRequest, ShiftSwapRequestCursor } from './shiftSwapTypes';

export function ShiftSwapManagerPanel() {
  const { user } = useAuth();
  const { t } = useTranslation('shiftSwaps');
  if (!user || (user.role !== 'admin' && user.role !== 'manager'))
    return <p role="alert">{t('manager.forbidden')}</p>;
  return <ManagerInbox key={`${user.tenantId}:${user.id}:${user.role}`} />;
}

function ManagerInbox() {
  const { t } = useTranslation(['shiftSwaps', 'errors', 'workforceErrors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<'requested' | 'accepted' | ''>('');
  const [cursors, setCursors] = useState<ShiftSwapRequestCursor[]>([]);
  const [editor, setEditor] = useState<{
    row: ShiftSwapRequest;
    status: 'approved' | 'rejected';
  } | null>(null);
  const [history, setHistory] = useState<ShiftSwapRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const query = trpc.workforce.shiftSwaps.managerInbox.useQuery(
    {
      limit: 20,
      ...(status ? { status } : {}),
      ...(cursors.at(-1) ? { cursor: cursors.at(-1)! } : {}),
    },
    { gcTime: 0, staleTime: 0 }
  );
  const decide = useCriticalMutation('workforce.shiftSwaps.decide', { gcTime: 0 });

  async function submit(decision: ShiftSwapDecision) {
    if (!editor || busy.current) return;
    busy.current = true;
    setError(null);
    try {
      if (decision.status === 'approved') {
        await decide.mutateAsync({
          id: editor.row.id,
          expectedVersion: editor.row.version,
          status: 'approved',
        });
      } else if (decision.status === 'rejected' && decision.reason) {
        await decide.mutateAsync({
          id: editor.row.id,
          expectedVersion: editor.row.version,
          status: 'rejected',
          reason: decision.reason,
        });
      } else {
        return;
      }
      setEditor(null);
      setCursors([]);
      toast.success({ title: t('shiftSwaps:saved') });
      void utils.workforce.shiftSwaps.invalidate();
      void utils.employeeShifts.schedule.invalidate();
      void utils.auditLogs.invalidate();
    } catch (failure) {
      setError(translateServerError(failure, t, t('shiftSwaps:saveError')));
      // Do not replace the reviewed version after a conflict; the operator must reopen it.
      void query.refetch();
    } finally {
      busy.current = false;
    }
  }

  return (
    <section className="space-y-5" data-testid="shift-swap-manager-panel">
      <header>
        <h1 className="pv-title text-2xl">{t('shiftSwaps:manager.title')}</h1>
        <p className="mt-2 max-w-3xl text-sm text-secondary-600">
          {t('shiftSwaps:manager.description')}
        </p>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="label">{t('shiftSwaps:statusFilter')}</span>
          <select
            className="input"
            value={status}
            onChange={event => {
              setStatus(event.target.value as typeof status);
              setCursors([]);
            }}
          >
            <option value="">{t('shiftSwaps:manager.allPending')}</option>
            <option value="requested">{t('shiftSwaps:statuses.requested')}</option>
            <option value="accepted">{t('shiftSwaps:statuses.accepted')}</option>
          </select>
        </label>
        <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
          <RefreshCw aria-hidden="true" />
          {t('shiftSwaps:refresh')}
        </Button>
      </div>
      {query.isFetching && <p role="status">{t('shiftSwaps:loading')}</p>}
      {query.error && (
        <div role="alert">
          <p>{translateServerError(query.error, t, t('shiftSwaps:loadError'))}</p>
          <Button onClick={() => void query.refetch()}>{t('shiftSwaps:retry')}</Button>
        </div>
      )}
      {!query.error && !query.isPending && query.data?.items.length === 0 && (
        <p>{t('shiftSwaps:manager.empty')}</p>
      )}
      {!query.error && (
        <ul className="space-y-4">
          {query.data?.items.map(row => (
            <li
              key={row.id}
              data-testid={`manager-shift-swap-${row.id}`}
              className="space-y-3 rounded-xl border border-line bg-surface p-4"
            >
              <h2 className="font-semibold">
                {t(`shiftSwaps:statuses.${row.status}`)} ·{' '}
                {t('shiftSwaps:version', { version: row.version })}
              </h2>
              <ShiftSwapPair row={row} />
              {row.status === 'requested' && (
                <p className="text-sm text-secondary-600">
                  {t('shiftSwaps:manager.waitingConsent')}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                {row.status === 'accepted' && (
                  <Button onClick={() => setEditor({ row, status: 'approved' })}>
                    {t('shiftSwaps:actions.approve')}
                  </Button>
                )}
                <Button variant="outline" onClick={() => setEditor({ row, status: 'rejected' })}>
                  {t('shiftSwaps:actions.reject')}
                </Button>
                <Button variant="outline" onClick={() => setHistory(row)}>
                  <History aria-hidden="true" />
                  {t('shiftSwaps:actions.history')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <nav className="flex gap-3" aria-label={t('shiftSwaps:manager.pages')}>
        <Button
          variant="outline"
          disabled={!cursors.length || query.isFetching}
          onClick={() => setCursors(previous => previous.slice(0, -1))}
        >
          {t('shiftSwaps:previous')}
        </Button>
        <Button
          variant="outline"
          disabled={!query.data?.nextCursor || query.isFetching || !!query.error}
          onClick={() => {
            if (query.data?.nextCursor)
              setCursors(previous => [...previous, query.data!.nextCursor!]);
          }}
        >
          {t('shiftSwaps:next')}
        </Button>
      </nav>
      {editor && (
        <ShiftSwapDecisionDialog
          key={`${editor.row.id}:${editor.row.version}:${editor.status}`}
          row={editor.row}
          status={editor.status}
          busy={decide.isPending}
          error={error}
          onClose={() => {
            setEditor(null);
            setError(null);
          }}
          onSubmit={decision => void submit(decision)}
        />
      )}
      {history && (
        <ShiftSwapHistoryDialog key={history.id} row={history} onClose={() => setHistory(null)} />
      )}
    </section>
  );
}
