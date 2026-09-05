import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { Button } from '@/components/ui';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { translateServerError } from '@/lib/translateServerError';
import { SchedulePlanForm } from './SchedulePlanForm';
import { SchedulePlanPreview, SchedulePlanDecision } from './SchedulePlanPreview';
import type {
  SchedulePlanCursor,
  SchedulePlanEditor,
  SchedulePlanInput,
  SchedulePlanView,
} from './schedulePlanTypes';

/** One modal at a time; every mutation target holds its originally displayed version. */
type PlanDialog =
  | { kind: 'preview'; id: string }
  | { kind: 'editor'; editor: SchedulePlanEditor }
  | { kind: 'decision'; action: 'publish' | 'discard'; view: SchedulePlanView };

/** A staff/tenant handoff unmounts the entire private management surface and its local state. */
export function SchedulePlansPanel() {
  const { user } = useAuth(),
    { t } = useTranslation('schedulePlans');
  return (
    <section className="space-y-5" data-testid="schedule-plans-panel">
      <header>
        <h1 className="pv-title text-2xl">{t('title')}</h1>
        <p className="mt-2 max-w-3xl text-sm text-secondary-600">{t('description')}</p>
      </header>
      {user?.role === 'admin' || user?.role === 'manager' ? (
        <ManagedPlans key={`${user.tenantId}:${user.id}:${user.role}`} />
      ) : (
        <p role="alert">{t('forbidden')}</p>
      )}
    </section>
  );
}
function ManagedPlans() {
  const { t } = useTranslation(['schedulePlans', 'errors', 'workforceErrors']),
    { currentSite } = useTenant(),
    locale = useResolvedLocale(),
    toast = useToast(),
    utils = trpc.useUtils();
  const [siteChoice, setSiteChoice] = useState(''),
    [pagination, setPagination] = useState<{ siteId: string; cursors: SchedulePlanCursor[] }>({
      siteId: '',
      cursors: [],
    }),
    [dialog, setDialog] = useState<PlanDialog | null>(null),
    [error, setError] = useState<string | null>(null),
    [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const sites = trpc.sites.list.useQuery({ includeInactive: true }),
    siteId = siteChoice || currentSite?.id || sites.data?.items[0]?.id || '';
  // The global site selector changes independently of this panel's local selector.
  // Never issue even one request carrying a cursor from a different site's history.
  const cursors = pagination.siteId === siteId ? pagination.cursors : [];
  const query = trpc.workforce.schedulePlans.list.useQuery(
    { siteId, limit: 20, ...(cursors.at(-1) ? { cursor: cursors.at(-1)! } : {}) },
    { enabled: !!siteId, gcTime: 0, staleTime: 0 }
  );
  const create = useCriticalMutation('workforce.schedulePlans.create', { gcTime: 0 }),
    regenerate = useCriticalMutation('workforce.schedulePlans.regenerate', { gcTime: 0 }),
    publish = useCriticalMutation('workforce.schedulePlans.publish', { gcTime: 0 }),
    discard = useCriticalMutation('workforce.schedulePlans.discard', { gcTime: 0 });
  const open = (next: PlanDialog) => {
    if (!busy.current) {
      setError(null);
      setDialog(next);
    }
  };
  const close = () => {
    if (!busy.current) {
      setError(null);
      setDialog(null);
    }
  };
  async function execute(action: () => Promise<{ id: string }>, showPreview: boolean) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await action();
      setDialog(showPreview ? { kind: 'preview', id: result.id } : null);
      setPagination({ siteId, cursors: [] });
      toast.success({ title: t('saved') });
      void utils.workforce.schedulePlans.invalidate();
      void utils.employeeShifts.schedule.invalidate();
      void utils.auditLogs.invalidate();
    } catch (failure) {
      setError(translateServerError(failure, t, t('saveError')));
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  async function saveDraft(input: SchedulePlanInput, reason: string) {
    if (dialog?.kind !== 'editor') return;
    const editor = dialog.editor;
    await execute(
      () =>
        editor.action === 'create'
          ? create.mutateAsync(input)
          : regenerate.mutateAsync({
              ...input,
              id: editor.view.plan.id,
              expectedVersion: editor.view.plan.version,
              reason,
            }),
      true
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-end gap-3">
        <label>
          <span className="label">{t('site')}</span>
          <select
            className="input"
            value={siteId}
            disabled={saving || sites.isFetching}
            onChange={event => {
              setSiteChoice(event.target.value);
              setPagination({ siteId: event.target.value, cursors: [] });
              close();
            }}
          >
            <option value="">{t('chooseSite')}</option>
            {sites.data?.items.map(site => (
              <option key={site.id} value={site.id}>
                {site.name}
                {!site.isActive ? ` (${t('inactive')})` : ''}
              </option>
            ))}
          </select>
        </label>
        <Button
          disabled={saving || !sites.data?.items.some(site => site.id === siteId && site.isActive)}
          onClick={() => open({ kind: 'editor', editor: { action: 'create' } })}
        >
          {t('actions.create')}
        </Button>
        <Button
          variant="outline"
          disabled={saving || query.isFetching || sites.isFetching}
          onClick={() => {
            void sites.refetch();
            if (siteId) void query.refetch();
          }}
        >
          {t('refresh')}
        </Button>
      </div>
      {(query.isFetching || sites.isFetching) && <p role="status">{t('loading')}</p>}
      {(sites.error || query.error) && (
        <p role="alert">{translateServerError(sites.error ?? query.error, t, t('loadError'))}</p>
      )}
      {!query.error &&
        !sites.error &&
        siteId &&
        !query.isPending &&
        query.data?.items.length === 0 && <p>{t('empty')}</p>}
      {!query.error && !sites.error && (
        <ul className="space-y-3">
          {query.data?.items.map(row => (
            <li
              key={row.id}
              className="rounded-xl border border-line bg-surface p-4"
              data-testid={`schedule-plan-${row.id}`}
            >
              <h2 className="break-words font-semibold">{row.title}</h2>
              <p>
                {t(`statuses.${row.status}`)} · {row.fromDate} → {row.untilDate} ·{' '}
                {t('version', { version: row.version })}
              </p>
              <p className="my-2 text-sm">
                {t('shiftCount', { count: row.occurrenceCount })} · {row.timeZone}
              </p>
              <Button
                variant="outline"
                disabled={saving || query.isFetching}
                onClick={() => open({ kind: 'preview', id: row.id })}
              >
                {t('preview')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <nav className="flex gap-3" aria-label={t('planPages')}>
        <Button
          variant="outline"
          disabled={saving || query.isFetching || !cursors.length}
          onClick={() => setPagination({ siteId, cursors: cursors.slice(0, -1) })}
        >
          {t('previous')}
        </Button>
        <Button
          variant="outline"
          disabled={saving || query.isFetching || !!query.error || !query.data?.nextCursor}
          onClick={() => {
            if (query.data?.nextCursor)
              setPagination({ siteId, cursors: [...cursors, query.data.nextCursor] });
          }}
        >
          {t('next')}
        </Button>
      </nav>
      {dialog?.kind === 'editor' && (
        <SchedulePlanForm
          key={
            dialog.editor.action === 'create'
              ? 'create'
              : `${dialog.editor.view.plan.id}:${dialog.editor.view.plan.version}`
          }
          editor={dialog.editor}
          defaultSiteId={siteId}
          sites={sites.data?.items ?? []}
          timeZone={locale.timezone}
          saving={saving}
          error={error}
          onClose={close}
          onSubmit={saveDraft}
        />
      )}
      {dialog?.kind === 'preview' && (
        <SchedulePlanPreview
          key={dialog.id}
          id={dialog.id}
          onClose={close}
          onAction={(action, view) =>
            open(
              action === 'regenerate'
                ? { kind: 'editor', editor: { action, view } }
                : { kind: 'decision', action, view }
            )
          }
        />
      )}
      {dialog?.kind === 'decision' && (
        <SchedulePlanDecision
          key={`${dialog.action}:${dialog.view.plan.id}:${dialog.view.plan.version}`}
          action={dialog.action}
          view={dialog.view}
          saving={saving}
          error={error}
          onClose={close}
          onSubmit={async reason => {
            const input = { id: dialog.view.plan.id, expectedVersion: dialog.view.plan.version };
            await execute(
              () =>
                dialog.action === 'publish'
                  ? publish.mutateAsync(input)
                  : discard.mutateAsync({ ...input, reason }),
              true
            );
          }}
        />
      )}
    </>
  );
}
