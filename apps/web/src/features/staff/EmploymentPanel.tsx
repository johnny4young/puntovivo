import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { Button } from '@/components/ui';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { translateServerError } from '@/lib/translateServerError';
import { EmploymentDirectory } from './EmploymentDirectory';
import { useEmploymentFilters } from './useEmploymentFilters';
import { EmploymentForm } from './EmploymentForm';
import { EmploymentHistory } from './EmploymentHistory';
import {
  employmentTermsFromForm,
  type EmploymentContract,
  type EmploymentEditor,
  type EmploymentFormValues,
} from './employmentTypes';

/** Role-specific mounts prevent private requests for managers and reset local state on staff handoff. */
export function EmploymentPanel() {
  const { user } = useAuth();
  const { t } = useTranslation('workforce');
  const key = `${user?.tenantId}:${user?.id}:${user?.role}`;
  return (
    <section className="space-y-5" data-testid="employment-panel">
      <header>
        <p className="pv-kicker">{t('kicker')}</p>
        <h1 className="pv-title text-2xl">{t('title')}</h1>
        <p className="mt-2 max-w-3xl text-sm text-secondary-600">{t('description')}</p>
      </header>
      {user?.role === 'admin' ? (
        <AdminEmploymentPanel key={key} />
      ) : user?.role === 'manager' ? (
        <ManagerEmploymentPanel key={key} />
      ) : (
        <p role="alert">{t('forbidden')}</p>
      )}
    </section>
  );
}

function ManagerEmploymentPanel() {
  const { t } = useTranslation('workforce');
  const filters = useEmploymentFilters();
  const query = trpc.workforce.assignments.useQuery(filters.input, { staleTime: 0, gcTime: 0 });
  return (
    <>
      <p className="text-sm text-secondary-600">{t('managerNotice')}</p>
      <EmploymentDirectory
        filters={filters}
        items={query.data?.items ?? []}
        nextCursor={query.data?.nextCursor ?? null}
        isPending={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        refetch={query.refetch}
      />
    </>
  );
}

function AdminEmploymentPanel() {
  const { t, i18n } = useTranslation(['workforce', 'errors', 'workforceErrors']);
  const { currentSite } = useTenant();
  const toast = useToast();
  const filters = useEmploymentFilters();
  const [includeVoided, setIncludeVoided] = useState(false);
  const [editor, setEditor] = useState<EmploymentEditor | null>(null);
  const [history, setHistory] = useState<EmploymentContract | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const utils = trpc.useUtils();
  const query = trpc.workforce.contracts.list.useQuery(
    { ...filters.input, includeVoided },
    { gcTime: 0, staleTime: 0 }
  );
  const context = trpc.workforce.contracts.context.useQuery(undefined, {
    enabled: !!editor,
    gcTime: 0,
    staleTime: 0,
  });
  const create = useCriticalMutation('workforce.contracts.create', { gcTime: 0 });
  const replace = useCriticalMutation('workforce.contracts.replace', { gcTime: 0 });
  const end = useCriticalMutation('workforce.contracts.end', { gcTime: 0 });
  const voidCommand = useCriticalMutation('workforce.contracts.void', { gcTime: 0 });
  const saving = create.isPending || replace.isPending || end.isPending || voidCommand.isPending;
  function edit(next: EmploymentEditor) {
    setError(null);
    setEditor(next);
  }
  async function submit(values: EmploymentFormValues, currencyCode: string) {
    if (!editor || busy.current || !context.data) return;
    busy.current = true;
    setError(null);
    try {
      if (editor.action === 'create') {
        await create.mutateAsync({
          terms: employmentTermsFromForm(values, currencyCode),
          reason: values.reason.trim(),
        });
      } else {
        const row = editor.contract;
        const target = {
          id: row.id,
          siteId: row.siteId,
          expectedVersion: row.version,
          reason: values.reason.trim(),
        };
        if (editor.action === 'end')
          await end.mutateAsync({ ...target, effectiveUntil: values.effectiveUntil });
        else if (editor.action === 'void') await voidCommand.mutateAsync(target);
        else
          await replace.mutateAsync({
            ...target,
            terms: employmentTermsFromForm(
              { ...values, userId: row.userId, effectiveUntil: row.effectiveUntil ?? '' },
              currencyCode
            ),
          });
      }
      // Commit succeeded even if a subsequent read fails; never invite a second write for a refetch failure.
      setEditor(null);
      toast.success({ title: t('saved') });
      filters.setCursors([]);
      void utils.workforce.invalidate();
      void utils.auditLogs.invalidate();
    } catch (failure) {
      setError(translateServerError(failure, t, t('saveError')));
      // Refresh the directory but preserve the submitted version/form. The operator
      // must close and reopen after a stale-version response, never silently overwrite.
      void query.refetch();
    } finally {
      busy.current = false;
    }
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-3xl text-sm text-secondary-600">{t('adminNotice')}</p>
        <Button onClick={() => edit({ action: 'create' })}>{t('actions.create')}</Button>
      </div>
      <EmploymentDirectory
        filters={filters}
        items={query.data?.items ?? []}
        nextCursor={query.data?.nextCursor ?? null}
        isPending={query.isPending}
        isFetching={query.isFetching}
        error={query.error}
        refetch={query.refetch}
        renderExtra={row => (
          <>
            <p className="font-medium">
              {new Intl.NumberFormat(i18n.resolvedLanguage, {
                style: 'currency',
                currency: row.currencyCode,
                // Preserve stored cents even when the runtime currency catalog defaults to zero.
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              }).format(row.payAmount)}{' '}
              · {t(`basis.${row.payBasis}`)}
            </p>
            {row.payBasis === 'monthly' && (
              <p className="text-xs text-secondary-500">
                {row.costingHourlyRate === null
                  ? t('unknownCost')
                  : t('costingValue', {
                      amount: new Intl.NumberFormat(i18n.resolvedLanguage, {
                        style: 'currency',
                        currency: row.currencyCode,
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      }).format(row.costingHourlyRate),
                    })}
              </p>
            )}
            {row.voidedAt && <p className="font-medium text-warning-700">{t('voided')}</p>}
            <div className="flex flex-wrap gap-2">
              {!row.voidedAt && (
                <>
                  <Button
                    variant="outline"
                    disabled={!row.userActive || saving || query.isFetching}
                    onClick={() => edit({ action: 'replace', contract: row })}
                  >
                    {t('actions.replace')}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={saving || query.isFetching}
                    onClick={() => edit({ action: 'end', contract: row })}
                  >
                    {t('actions.end')}
                  </Button>
                  <Button
                    variant="danger"
                    disabled={saving || query.isFetching}
                    onClick={() => edit({ action: 'void', contract: row })}
                  >
                    {t('actions.void')}
                  </Button>
                </>
              )}
              <Button variant="outline" onClick={() => setHistory(row)}>
                {t('history')}
              </Button>
            </div>
          </>
        )}
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeVoided}
            onChange={event => {
              setIncludeVoided(event.target.checked);
              filters.setCursors([]);
            }}
          />
          {t('includeVoided')}
        </label>
      </EmploymentDirectory>
      {editor && context.isPending && <p role="status">{t('loading')}</p>}
      {editor && context.error && !context.data && (
        <div role="alert">
          <p>{translateServerError(context.error, t, t('loadError'))}</p>
          <Button onClick={() => void context.refetch()}>{t('retry')}</Button>
          <Button variant="outline" onClick={() => setEditor(null)}>
            {t('close')}
          </Button>
        </div>
      )}
      {editor && context.data && (
        <EmploymentForm
          key={
            editor.action === 'create'
              ? 'create'
              : `${editor.action}:${editor.contract.id}:${editor.contract.version}`
          }
          editor={editor}
          currencyCode={context.data.currencyCode}
          timeZone={editor.action === 'create' ? context.data.timeZone : editor.contract.timeZone}
          sites={filters.sites.data?.items ?? []}
          defaultSiteId={currentSite?.id ?? ''}
          saving={saving}
          error={
            error ?? (context.error ? translateServerError(context.error, t, t('loadError')) : null)
          }
          onClose={() => setEditor(null)}
          onSubmit={submit}
        />
      )}
      {history && (
        <EmploymentHistory key={history.id} contract={history} onClose={() => setHistory(null)} />
      )}
    </>
  );
}
