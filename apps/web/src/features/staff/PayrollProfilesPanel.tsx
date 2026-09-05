import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { Button } from '@/components/ui';
import { useTenant } from '@/features/tenant/TenantProvider';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { PayrollProfileForm, type PayrollProfileEditor } from './PayrollProfileForm';
import {
  payrollProfileTerms,
  type PayrollProfile,
  type PayrollProfileFormValues,
} from './payrollTypes';

/** Private profile directory and append-only lifecycle controls. */
export function PayrollProfilesPanel() {
  const { t } = useTranslation(['payroll', 'errors', 'workforceErrors']);
  const { currentSite } = useTenant();
  const utils = trpc.useUtils();
  const [siteId, setSiteId] = useState('');
  const [onDate, setOnDate] = useState('');
  const [includeVoided, setIncludeVoided] = useState(false);
  const [cursors, setCursors] = useState<Array<{ effectiveFrom: string; id: string }>>([]);
  const [editor, setEditor] = useState<PayrollProfileEditor | null>(null);
  const [history, setHistory] = useState<PayrollProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const sites = trpc.sites.list.useQuery({ includeInactive: true }, { gcTime: 0, staleTime: 0 });
  const query = trpc.workforce.payroll.profiles.list.useQuery(
    {
      siteId: siteId || undefined,
      onDate: onDate || undefined,
      includeVoided,
      cursor: cursors.at(-1),
      limit: 20,
    },
    { gcTime: 0, staleTime: 0 }
  );
  const create = useCriticalMutation('workforce.payroll.profiles.create', { gcTime: 0 });
  const replace = useCriticalMutation('workforce.payroll.profiles.replace', { gcTime: 0 });
  const end = useCriticalMutation('workforce.payroll.profiles.end', { gcTime: 0 });
  const voidCommand = useCriticalMutation('workforce.payroll.profiles.void', { gcTime: 0 });
  const saving = create.isPending || replace.isPending || end.isPending || voidCommand.isPending;

  async function submit(values: PayrollProfileFormValues) {
    if (!editor || busy.current) return;
    busy.current = true;
    setError(null);
    try {
      if (editor.action === 'create') {
        await create.mutateAsync({
          profile: payrollProfileTerms(values),
          reason: values.reason.trim(),
        });
      } else {
        const row = editor.profile;
        const target = {
          id: row.id,
          siteId: row.siteId,
          expectedVersion: row.version,
          reason: values.reason.trim(),
        };
        if (editor.action === 'replace') {
          await replace.mutateAsync({ ...target, profile: payrollProfileTerms(values) });
        } else if (editor.action === 'end') {
          await end.mutateAsync({ ...target, effectiveUntil: values.effectiveUntil });
        } else {
          await voidCommand.mutateAsync(target);
        }
      }
      setEditor(null);
      setCursors([]);
      await utils.workforce.payroll.profiles.invalidate();
      void utils.auditLogs.invalidate();
    } catch (failure) {
      setError(translateServerError(failure, t, t('profiles.saveError')));
      void query.refetch();
    } finally {
      busy.current = false;
    }
  }

  const failure = query.error ?? sites.error;
  return (
    <section className="space-y-4" aria-labelledby="payroll-profiles-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="payroll-profiles-title" className="text-xl font-semibold">
            {t('profiles.title')}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-secondary-600">{t('profiles.description')}</p>
        </div>
        <Button
          onClick={() => {
            setError(null);
            setEditor({ action: 'create' });
          }}
        >
          {t('profiles.actions.create')}
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-4 rounded-xl border border-line bg-surface-1 p-4">
        <label className="block">
          <span className="label">{t('profiles.fields.site')}</span>
          <select
            className="input mt-1"
            value={siteId}
            onChange={event => {
              setSiteId(event.target.value);
              setCursors([]);
            }}
          >
            <option value="">{t('profiles.filters.allSites')}</option>
            {sites.data?.items.map(site => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="label">{t('profiles.filters.onDate')}</span>
          <input
            className="input mt-1"
            type="date"
            value={onDate}
            onChange={event => {
              setOnDate(event.target.value);
              setCursors([]);
            }}
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={includeVoided}
            onChange={event => {
              setIncludeVoided(event.target.checked);
              setCursors([]);
            }}
          />
          {t('profiles.filters.includeVoided')}
        </label>
        <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
          {t('actions.refresh')}
        </Button>
      </div>
      {failure && (
        <p role="alert" className="text-danger-700">
          {translateServerError(failure, t, t('profiles.loadError'))}
        </p>
      )}
      {query.isPending && <p role="status">{t('actions.loading')}</p>}
      {!query.isPending && !failure && query.data?.items.length === 0 && (
        <p className="rounded-xl border border-dashed border-line p-8 text-secondary-600">
          {t('profiles.empty')}
        </p>
      )}
      {!failure && (
        <ul className="grid gap-4 lg:grid-cols-2">
          {query.data?.items.map(row => (
            <li key={row.id} className="space-y-3 rounded-xl border border-line bg-surface-1 p-4">
              <div>
                <h3 className="break-words text-lg font-semibold">{row.userName}</h3>
                <p className="text-sm">{row.siteName}</p>
              </div>
              <p className="text-sm">
                {t('profiles.period', {
                  from: row.effectiveFrom,
                  until: row.effectiveUntil ?? t('profiles.openEnded'),
                })}
              </p>
              <p className="text-sm">
                {t(`profiles.contractKinds.${row.contractKind}`)} ·{' '}
                {t('profiles.arl', { value: row.arlRiskClass })}
              </p>
              <p className="text-xs text-secondary-500">
                {t('profiles.version', { version: row.version })}
              </p>
              {row.voidedAt && (
                <p className="font-medium text-warning-700">{t('profiles.voided')}</p>
              )}
              <div className="flex flex-wrap gap-2">
                {!row.voidedAt && (
                  <>
                    <Button
                      variant="outline"
                      disabled={saving || !row.userActive || !row.siteActive}
                      onClick={() => {
                        setError(null);
                        setEditor({ action: 'replace', profile: row });
                      }}
                    >
                      {t('profiles.actions.replace')}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={saving}
                      onClick={() => {
                        setError(null);
                        setEditor({ action: 'end', profile: row });
                      }}
                    >
                      {t('profiles.actions.end')}
                    </Button>
                    <Button
                      variant="danger"
                      disabled={saving}
                      onClick={() => {
                        setError(null);
                        setEditor({ action: 'void', profile: row });
                      }}
                    >
                      {t('profiles.actions.void')}
                    </Button>
                  </>
                )}
                <Button variant="outline" onClick={() => setHistory(row)}>
                  {t('profiles.actions.history')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <nav className="flex gap-3" aria-label={t('profiles.pages')}>
        <Button
          variant="outline"
          disabled={cursors.length === 0 || query.isFetching}
          onClick={() => setCursors(previous => previous.slice(0, -1))}
        >
          {t('actions.previous')}
        </Button>
        <Button
          variant="outline"
          disabled={!query.data?.nextCursor || query.isFetching || !!failure}
          onClick={() => {
            if (query.data?.nextCursor)
              setCursors(previous => [...previous, query.data.nextCursor!]);
          }}
        >
          {t('actions.next')}
        </Button>
      </nav>
      {editor && (
        <PayrollProfileForm
          key={
            editor.action === 'create'
              ? 'create'
              : `${editor.action}:${editor.profile.id}:${editor.profile.version}`
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
      {history && <PayrollProfileHistory profile={history} onClose={() => setHistory(null)} />}
    </section>
  );
}

function PayrollProfileHistory({
  profile,
  onClose,
}: {
  profile: PayrollProfile;
  onClose: () => void;
}) {
  const { t } = useTranslation(['payroll', 'errors', 'workforceErrors']);
  const query = trpc.workforce.payroll.profiles.events.useQuery(
    { id: profile.id, siteId: profile.siteId, limit: 100 },
    { gcTime: 0, staleTime: 0 }
  );
  return (
    <Modal
      isOpen
      title={t('profiles.historyTitle', { employee: profile.userName })}
      size="lg"
      onClose={onClose}
      footer={<ModalButton onClick={onClose}>{t('actions.close')}</ModalButton>}
    >
      {query.isPending && <p role="status">{t('actions.loading')}</p>}
      {query.error && (
        <p role="alert">{translateServerError(query.error, t, t('profiles.loadError'))}</p>
      )}
      <ol className="space-y-3">
        {query.data?.items.map(event => (
          <li key={event.id} className="rounded-lg border border-line p-3">
            <p className="font-medium">
              {t(`profiles.events.${event.kind}`)} ·{' '}
              {t('profiles.version', { version: event.version })}
            </p>
            <p className="mt-1 text-sm">{event.reason}</p>
            <p className="mt-1 text-xs text-secondary-500">{event.createdAt}</p>
          </li>
        ))}
      </ol>
      {query.data?.nextCursor && (
        <p className="mt-3 text-sm text-warning-700">{t('profiles.historyTruncated')}</p>
      )}
    </Modal>
  );
}
