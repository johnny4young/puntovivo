import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { Button } from '@/components/ui';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { translateServerError } from '@/lib/translateServerError';
import { TimeOffForm } from './TimeOffForm';
import { TimeOffHistory } from './TimeOffHistory';
import type {
  TimeOffCursor,
  TimeOffEditor,
  TimeOffFormValues,
  TimeOffRecord,
} from './timeOffTypes';

/** Role-specific mounts prevent private reads and discard open evidence after a staff handoff. */
export function TimeOffPanel() {
  const { user } = useAuth();
  const { t } = useTranslation('timeOff');
  return (
    <section className="space-y-5" data-testid="time-off-panel">
      <header>
        <h1 className="pv-title text-2xl">{t('title')}</h1>
        <p className="mt-2 max-w-3xl text-sm text-secondary-600">{t('description')}</p>
      </header>
      {user?.role === 'admin' || user?.role === 'manager' ? (
        <ManagedTimeOff key={`${user.tenantId}:${user.id}:${user.role}`} actorId={user.id} />
      ) : (
        <p role="alert">{t('forbidden')}</p>
      )}
    </section>
  );
}
function ManagedTimeOff({ actorId }: { actorId: string }) {
  const { t } = useTranslation(['timeOff', 'errors', 'workforceErrors']);
  const { currentSite } = useTenant();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [siteId, setSiteId] = useState('');
  const [status, setStatus] = useState<TimeOffRecord['status'] | ''>('');
  const [cursors, setCursors] = useState<TimeOffCursor[]>([]);
  const [editor, setEditor] = useState<TimeOffEditor | null>(null);
  const [history, setHistory] = useState<TimeOffRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const sites = trpc.sites.list.useQuery({ includeInactive: true });
  const query = trpc.workforce.timeOff.list.useQuery(
    {
      limit: 20,
      ...(siteId ? { siteId } : {}),
      ...(status ? { status } : {}),
      ...(cursors.at(-1) ? { cursor: cursors.at(-1)! } : {}),
    },
    { gcTime: 0, staleTime: 0 }
  );
  const create = useCriticalMutation('workforce.timeOff.create', { gcTime: 0 });
  const advance = useCriticalMutation('workforce.timeOff.advance', { gcTime: 0 });
  const saving = create.isPending || advance.isPending;
  function edit(next: TimeOffEditor) {
    setError(null);
    setEditor(next);
  }
  async function submit(values: TimeOffFormValues) {
    if (!editor || busy.current) return;
    busy.current = true;
    setError(null);
    try {
      if (editor.action === 'create')
        await create.mutateAsync({ ...values, reason: values.reason.trim() });
      else
        await advance.mutateAsync({
          id: editor.row.id,
          siteId: editor.row.siteId,
          expectedVersion: editor.row.version,
          status: editor.action,
          reason: values.reason.trim(),
        });
      // A refetch error after commit must never invite an accidental second decision.
      setEditor(null);
      setCursors([]);
      toast.success({ title: t('saved') });
      void utils.workforce.timeOff.invalidate();
      void utils.employeeShifts.schedule.invalidate();
      void utils.auditLogs.invalidate();
    } catch (failure) {
      setError(translateServerError(failure, t, t('saveError')));
      // Keep the original version and explanation. Never silently retry over another approval.
      void query.refetch();
    } finally {
      busy.current = false;
    }
  }
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="label">{t('siteFilter')}</span>
          <select
            className="input"
            value={siteId}
            disabled={!!sites.error}
            onChange={event => {
              setSiteId(event.target.value);
              setCursors([]);
            }}
          >
            <option value="">{t('allSites')}</option>
            {sites.data?.items.map(site => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">{t('statusFilter')}</span>
          <select
            className="input"
            value={status}
            onChange={event => {
              setStatus(event.target.value as typeof status);
              setCursors([]);
            }}
          >
            <option value="">{t('allStatuses')}</option>
            {(['pending', 'approved', 'rejected', 'cancelled'] as const).map(value => (
              <option key={value} value={value}>
                {t(`statuses.${value}`)}
              </option>
            ))}
          </select>
        </label>
        <Button
          disabled={sites.isPending || !!sites.error}
          onClick={() => edit({ action: 'create' })}
        >
          {t('actions.create')}
        </Button>
        <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
          {t('refresh')}
        </Button>
      </div>
      {sites.error && (
        <div role="alert">
          <p>{translateServerError(sites.error, t, t('loadError'))}</p>
          <Button onClick={() => void sites.refetch()}>{t('retry')}</Button>
        </div>
      )}
      {query.isFetching && <p role="status">{t('loading')}</p>}
      {query.error && (
        <div role="alert">
          <p>{translateServerError(query.error, t, t('loadError'))}</p>
          <Button onClick={() => void query.refetch()}>{t('retry')}</Button>
        </div>
      )}
      {!query.error && !query.isPending && query.data?.items.length === 0 && <p>{t('empty')}</p>}
      {!query.error && (
        <ul className="space-y-3">
          {query.data?.items.map(row => (
            <li
              key={row.id}
              data-testid={`time-off-${row.id}`}
              className="space-y-2 rounded-xl border border-line bg-surface p-4"
            >
              <h2 className="font-semibold">
                {row.userName} · {t(`kinds.${row.kind}`)}
              </h2>
              <p>
                {row.siteName} · {t(`statuses.${row.status}`)}
              </p>
              <p className="text-sm">
                {row.fromDate} → {row.untilDate} · {row.timeZone} ·{' '}
                {t('version', { version: row.version })}
              </p>
              <div className="flex flex-wrap gap-2">
                {row.status === 'pending' && (
                  <>
                    <Button
                      disabled={
                        saving ||
                        query.isFetching ||
                        row.userId === actorId ||
                        !row.userActive ||
                        !row.siteActive
                      }
                      onClick={() => edit({ action: 'approved', row })}
                    >
                      {t('actions.approved')}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={saving || query.isFetching}
                      onClick={() => edit({ action: 'rejected', row })}
                    >
                      {t('actions.rejected')}
                    </Button>
                  </>
                )}
                {(row.status === 'pending' || row.status === 'approved') && (
                  <Button
                    variant="outline"
                    disabled={saving || query.isFetching}
                    onClick={() => edit({ action: 'cancelled', row })}
                  >
                    {t('actions.cancelled')}
                  </Button>
                )}
                <Button variant="outline" onClick={() => setHistory(row)}>
                  {t('history')}
                </Button>
              </div>
              {row.status === 'pending' && row.userId === actorId && (
                <p className="text-sm text-secondary-600">{t('selfApprovalNotice')}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <nav className="flex gap-3" aria-label={t('pages')}>
        <Button
          variant="outline"
          disabled={!cursors.length || query.isFetching}
          onClick={() => setCursors(previous => previous.slice(0, -1))}
        >
          {t('previous')}
        </Button>
        <Button
          variant="outline"
          disabled={!query.data?.nextCursor || !!query.error || query.isFetching}
          onClick={() => {
            if (query.data?.nextCursor)
              setCursors(previous => [...previous, query.data!.nextCursor!]);
          }}
        >
          {t('next')}
        </Button>
      </nav>
      {editor && (
        <TimeOffForm
          key={
            editor.action === 'create'
              ? 'create'
              : `${editor.action}:${editor.row.id}:${editor.row.version}`
          }
          editor={editor}
          sites={sites.data?.items ?? []}
          defaultSiteId={currentSite?.id ?? ''}
          saving={saving}
          error={error}
          onClose={() => setEditor(null)}
          onSubmit={submit}
        />
      )}
      {history && (
        <TimeOffHistory key={history.id} row={history} onClose={() => setHistory(null)} />
      )}
    </>
  );
}
