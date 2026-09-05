import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/AuthProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { Button } from '@/components/ui';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { translateServerError } from '@/lib/translateServerError';
import { AvailabilityForm } from './AvailabilityForm';
import { AvailabilityHistory } from './AvailabilityHistory';
import { AvailabilitySlots } from './AvailabilitySlots';
import {
  normalizeAvailabilityWindows,
  type AvailabilityCursor,
  type AvailabilityEditor,
  type AvailabilityFormValues,
  type AvailabilityRecord,
} from './availabilityTypes';
/** Staff handoff unmounts private data/forms; restricted roles never issue management queries. */
export function AvailabilityPanel() {
  const { user } = useAuth(),
    { t } = useTranslation('availability');
  return (
    <section className="space-y-5" data-testid="availability-panel">
      <header>
        <h1 className="pv-title text-2xl">{t('title')}</h1>
        <p className="mt-2 max-w-3xl text-sm text-secondary-600">{t('description')}</p>
      </header>
      {user?.role === 'admin' || user?.role === 'manager' ? (
        <ManagedAvailability key={`${user.tenantId}:${user.id}:${user.role}`} />
      ) : (
        <p role="alert">{t('forbidden')}</p>
      )}
    </section>
  );
}
function ManagedAvailability() {
  const { t } = useTranslation(['availability', 'errors', 'workforceErrors']),
    toast = useToast(),
    utils = trpc.useUtils();
  const [includeVoided, setIncludeVoided] = useState(false),
    [cursors, setCursors] = useState<AvailabilityCursor[]>([]),
    [editor, setEditor] = useState<AvailabilityEditor | null>(null),
    [history, setHistory] = useState<AvailabilityRecord | null>(null),
    [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const query = trpc.workforce.availability.list.useQuery(
    { includeVoided, limit: 20, ...(cursors.at(-1) ? { cursor: cursors.at(-1)! } : {}) },
    { gcTime: 0, staleTime: 0 }
  );
  const create = useCriticalMutation('workforce.availability.create', { gcTime: 0 }),
    replace = useCriticalMutation('workforce.availability.replace', { gcTime: 0 }),
    voidPolicy = useCriticalMutation('workforce.availability.void', { gcTime: 0 });
  const saving = create.isPending || replace.isPending || voidPolicy.isPending;
  function edit(next: AvailabilityEditor) {
    setError(null);
    setEditor(next);
  }
  async function submit(values: AvailabilityFormValues) {
    if (!editor || busy.current) return;
    const slots = normalizeAvailabilityWindows(values.windows);
    if (editor.action !== 'void' && slots === null) {
      setError(t('invalidWindows'));
      return;
    }
    busy.current = true;
    setError(null);
    try {
      const reason = values.reason.trim();
      if (editor.action === 'create')
        await create.mutateAsync({
          userId: values.userId,
          fromDate: values.fromDate,
          untilDate: values.untilDate || null,
          slots: slots!,
          reason,
        });
      else if (editor.action === 'replace')
        await replace.mutateAsync({
          id: editor.row.id,
          expectedVersion: editor.row.version,
          fromDate: values.fromDate,
          slots: slots!,
          reason,
        });
      else
        await voidPolicy.mutateAsync({
          id: editor.row.id,
          expectedVersion: editor.row.version,
          reason,
        });
      setEditor(null);
      setCursors([]);
      toast.success({ title: t('saved') });
      void utils.workforce.availability.invalidate();
      void utils.employeeShifts.schedule.invalidate();
      void utils.auditLogs.invalidate();
    } catch (failure) {
      setError(translateServerError(failure, t, t('saveError')));
      void query.refetch();
    } finally {
      busy.current = false;
    }
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={saving} onClick={() => edit({ action: 'create' })}>
          {t('actions.create')}
        </Button>
        <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
          {t('refresh')}
        </Button>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeVoided}
            onChange={event => {
              setIncludeVoided(event.target.checked);
              setCursors([]);
            }}
          />
          <span>{t('includeVoided')}</span>
        </label>
      </div>
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
              data-testid={`availability-${row.id}`}
              className="space-y-2 rounded-xl border border-line bg-surface p-4"
            >
              <h2 className="break-words font-semibold">
                {row.userName} · {t(`statuses.${row.status}`)}
              </h2>
              <p className="text-sm">
                {row.fromDate} → {row.untilDate ?? t('openEnd')} · {row.timeZone} ·{' '}
                {t('version', { version: row.version })}
              </p>
              <AvailabilitySlots slots={row.slots} />
              {row.replacesId && <p className="text-xs text-secondary-500">{t('successor')}</p>}
              <div className="flex flex-wrap gap-2">
                {row.status === 'active' && (
                  <>
                    <Button
                      disabled={saving || query.isFetching || !row.userActive}
                      onClick={() => edit({ action: 'replace', row })}
                    >
                      {t('actions.replace')}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={saving || query.isFetching}
                      onClick={() => edit({ action: 'void', row })}
                    >
                      {t('actions.void')}
                    </Button>
                  </>
                )}
                <Button variant="outline" onClick={() => setHistory(row)}>
                  {t('history')}
                </Button>
              </div>
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
        <AvailabilityForm
          key={
            editor.action === 'create'
              ? 'create'
              : `${editor.action}:${editor.row.id}:${editor.row.version}`
          }
          editor={editor}
          saving={saving}
          error={error}
          onClose={() => setEditor(null)}
          onSubmit={submit}
        />
      )}
      {history && (
        <AvailabilityHistory key={history.id} row={history} onClose={() => setHistory(null)} />
      )}
    </>
  );
}
