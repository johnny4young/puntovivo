import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Plus, Power, Trash2 } from 'lucide-react';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { TablePagination } from '@/components/tables/TablePagination';
import { usePaginatedRows } from '@/components/tables/usePaginatedRows';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import type { Site } from '@/types';
import { PeripheralForm, type PeripheralFormInitial, type PeripheralFormValues } from './PeripheralForm';
import { PeripheralStatusBadge } from './PeripheralStatusBadge';

/**
 * ENG-060 — Per-site peripherals admin page.
 *
 * Admin-only. Lists every registered peripheral for the active site
 * grouped by kind (printer, cash drawer, scanner, payment terminal,
 * customer display) with row actions Test / Edit / Toggle active /
 * Remove. The "Add peripheral" CTA opens a modal that drives
 * `peripherals.register`; Edit reuses the same modal pre-filled with
 * the row's persisted shape.
 *
 * The legacy system-print path under
 * `apps/desktop/src/main/index.ts:print-receipt` keeps working
 * untouched; the registry adapter is a typed identifier rather than
 * a code-path swap (ENG-062 introduces ESC/POS as a sibling driver).
 */

type PeripheralKind =
  | 'printer'
  | 'cash_drawer'
  | 'scanner'
  | 'payment_terminal'
  | 'customer_display';

type PeripheralRow = {
  id: string;
  tenantId: string;
  siteId: string;
  kind: PeripheralKind;
  driver: string;
  config: Record<string, unknown>;
  displayName: string | null;
  isActive: boolean;
  lastTestedAt: string | null;
  lastTestResult: 'ok' | 'failed' | null;
  lastTestDetails: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

const KIND_ORDER: PeripheralKind[] = [
  'printer',
  'cash_drawer',
  'scanner',
  'payment_terminal',
  'customer_display',
];

type DialogState =
  | { mode: 'closed' }
  | { mode: 'create' }
  | { mode: 'edit'; row: PeripheralRow };

export function PeripheralsPage() {
  const { t } = useTranslation(['peripherals', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const [siteId, setSiteId] = useState<string>('');
  const [dialog, setDialog] = useState<DialogState>({ mode: 'closed' });
  const [pendingDelete, setPendingDelete] = useState<PeripheralRow | null>(null);

  const sitesQuery = trpc.sites.list.useQuery();
  const sites: Site[] = useMemo(
    () => ((sitesQuery.data?.items ?? []) as Site[]).filter(site => !!site.isActive),
    [sitesQuery.data?.items]
  );

  // Derive the effective site id without a setState-in-effect: the
  // operator's explicit choice (`siteId`) wins; otherwise we fall
  // back to the first active site once the list loads. The select
  // below is controlled on `effectiveSiteId` so the user sees the
  // resolved value immediately.
  const effectiveSiteId = siteId !== '' ? siteId : (sites[0]?.id ?? '');

  const peripheralsQuery = trpc.peripherals.list.useQuery(
    { siteId: effectiveSiteId },
    { enabled: effectiveSiteId !== '' }
  );

  const rows = useMemo(
    () => (peripheralsQuery.data ?? []) as unknown as PeripheralRow[],
    [peripheralsQuery.data]
  );

  const registerMutation = trpc.peripherals.register.useMutation({
    onSuccess: async () => {
      await utils.peripherals.list.invalidate();
      toast.success({ title: t('toast.registered') });
      setDialog({ mode: 'closed' });
    },
    onError: onErrorToast(toast, t, { titleKey: 'peripherals:toast.errorTitle' }),
  });

  const updateMutation = trpc.peripherals.update.useMutation({
    onSuccess: async () => {
      await utils.peripherals.list.invalidate();
      toast.success({ title: t('toast.updated') });
      setDialog({ mode: 'closed' });
    },
    onError: onErrorToast(toast, t, { titleKey: 'peripherals:toast.errorTitle' }),
  });

  const setActiveMutation = trpc.peripherals.setActive.useMutation({
    onSuccess: async (_data, variables) => {
      await utils.peripherals.list.invalidate();
      toast.success({
        title: variables.isActive
          ? t('toast.activated')
          : t('toast.deactivated'),
      });
    },
    onError: onErrorToast(toast, t, { titleKey: 'peripherals:toast.errorTitle' }),
  });

  const testMutation = trpc.peripherals.test.useMutation({
    onSuccess: async () => {
      await utils.peripherals.list.invalidate();
      toast.success({ title: t('toast.tested') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'peripherals:toast.errorTitle' }),
  });

  const removeMutation = trpc.peripherals.remove.useMutation({
    onSuccess: async () => {
      await utils.peripherals.list.invalidate();
      toast.success({ title: t('toast.removed') });
      setPendingDelete(null);
    },
    onError: onErrorToast(toast, t, { titleKey: 'peripherals:toast.errorTitle' }),
  });

  const grouped = useMemo(() => {
    const buckets = new Map<PeripheralKind, PeripheralRow[]>();
    for (const row of rows) {
      const list = buckets.get(row.kind) ?? [];
      list.push(row);
      buckets.set(row.kind, list);
    }
    return buckets;
  }, [rows]);

  async function handleSubmit(values: PeripheralFormValues) {
    if (dialog.mode === 'create') {
      await registerMutation.mutateAsync({
        siteId: effectiveSiteId,
        kind: values.kind,
        driver: values.driver,
        config: values.config,
        displayName: values.displayName ?? undefined,
      });
    } else if (dialog.mode === 'edit') {
      await updateMutation.mutateAsync({
        id: dialog.row.id,
        driver: values.driver,
        config: values.config,
        displayName: values.displayName,
      });
    }
  }

  const dialogInitial: PeripheralFormInitial | null =
    dialog.mode === 'edit'
      ? {
          id: dialog.row.id,
          kind: dialog.row.kind,
          driver: dialog.row.driver,
          displayName: dialog.row.displayName,
          config: dialog.row.config ?? {},
        }
      : null;

  const isFormSaving = registerMutation.isPending || updateMutation.isPending;

  return (
    <div className="space-y-6" data-testid="peripherals-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">
            {t('peripherals:title')}
          </h1>
          <p className="mt-1 text-sm text-secondary-500">
            {t('peripherals:description')}
          </p>
        </div>
        <button
          type="button"
          className="btn-primary flex items-center gap-2"
          onClick={() => setDialog({ mode: 'create' })}
          disabled={effectiveSiteId === ''}
          data-testid="peripherals-add-button"
        >
          <Plus className="h-5 w-5" />
          {t('peripherals:addButton')}
        </button>
      </div>

      <div className="card p-6">
        <label htmlFor="peripherals-site" className="label">
          {t('peripherals:siteSelector')}
        </label>
        <select
          id="peripherals-site"
          className="input mt-1 max-w-md"
          value={effectiveSiteId}
          onChange={event => setSiteId(event.target.value)}
          disabled={sitesQuery.isLoading || sites.length === 0}
        >
          {sites.map(site => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
      </div>

      <div className="card p-6">
        {peripheralsQuery.isLoading ? (
          <p className="text-sm text-secondary-500">…</p>
        ) : rows.length === 0 ? (
          <div
            className="space-y-3 py-8 text-center"
            data-testid="peripherals-empty-state"
          >
            <p className="text-base font-semibold text-secondary-900">
              {t('peripherals:emptyState.title')}
            </p>
            <p className="text-sm text-secondary-500">
              {t('peripherals:emptyState.body')}
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => setDialog({ mode: 'create' })}
              disabled={effectiveSiteId === ''}
            >
              {t('peripherals:emptyState.cta')}
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {KIND_ORDER.map(kind => {
              const items = grouped.get(kind);
              if (!items || items.length === 0) return null;
              return (
                <PeripheralKindSection
                  key={kind}
                  kind={kind}
                  items={items}
                  onTest={id => testMutation.mutate({ id })}
                  isTestPending={testMutation.isPending}
                  onEdit={row => setDialog({ mode: 'edit', row })}
                  onToggleActive={row =>
                    setActiveMutation.mutate({
                      id: row.id,
                      isActive: !row.isActive,
                    })
                  }
                  isSetActivePending={setActiveMutation.isPending}
                  onRemove={row => setPendingDelete(row)}
                />
              );
            })}
          </div>
        )}
      </div>

      <PeripheralForm
        key={dialog.mode === 'edit' ? `edit-${dialog.row.id}` : dialog.mode}
        isOpen={dialog.mode !== 'closed'}
        initial={dialogInitial}
        isSaving={isFormSaving}
        onClose={() => setDialog({ mode: 'closed' })}
        onSubmit={handleSubmit}
      />

      <ConfirmModal
        isOpen={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            removeMutation.mutate({ id: pendingDelete.id });
          }
        }}
        title={t('peripherals:confirmRemove.title')}
        message={t('peripherals:confirmRemove.body')}
        confirmText={t('peripherals:confirmRemove.confirm')}
        cancelText={t('peripherals:confirmRemove.cancel')}
        variant="danger"
        loading={removeMutation.isPending}
      />
    </div>
  );
}

type PeripheralKindSectionProps = {
  kind: PeripheralKind;
  items: PeripheralRow[];
  onTest: (id: string) => void;
  isTestPending: boolean;
  onEdit: (row: PeripheralRow) => void;
  onToggleActive: (row: PeripheralRow) => void;
  isSetActivePending: boolean;
  onRemove: (row: PeripheralRow) => void;
};

/**
 * One per-kind peripheral table plus its client-side pagination footer.
 *
 * Extracted from the page body so each kind owns an independent
 * `usePaginatedRows` instance — a hook cannot be called inside the
 * `KIND_ORDER.map(...)` loop. Pagination is purely presentational over the
 * already-loaded `items` array (8 rows per page); the query, grouping, and
 * every per-row affordance (status badge, Test / Edit / Toggle / Remove,
 * inactive-row dimming) are preserved verbatim from the previous inline
 * rendering.
 */
function PeripheralKindSection({
  kind,
  items,
  onTest,
  isTestPending,
  onEdit,
  onToggleActive,
  isSetActivePending,
  onRemove,
}: PeripheralKindSectionProps) {
  const { t } = useTranslation(['peripherals']);
  const { pageRows, hasPagination, ...pagination } = usePaginatedRows(items, 8);

  return (
    <section
      className="space-y-3"
      data-testid={`peripherals-section-${kind}`}
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-secondary-500">
        {t(`peripherals:kind.${kind}`)}
      </h2>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-secondary-500">
            <th className="py-2">{t('peripherals:fields.driverLabel')}</th>
            <th>{t('peripherals:fields.displayNameLabel')}</th>
            <th>{t('peripherals:status.untested')}</th>
            <th className="text-right">&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map(row => (
            <tr
              key={row.id}
              className={
                'border-t border-line ' +
                (row.isActive ? '' : 'opacity-60')
              }
              data-testid={`peripherals-row-${row.id}`}
            >
              <td className="py-3 font-medium text-secondary-900">
                {t(`peripherals:driver.${row.driver}`, {
                  defaultValue: row.driver,
                })}
              </td>
              <td className="text-secondary-700">
                {row.displayName ?? '—'}
              </td>
              <td>
                <PeripheralStatusBadge
                  lastTestResult={row.lastTestResult}
                  lastTestedAt={row.lastTestedAt}
                />
              </td>
              <td className="text-right">
                <div className="flex justify-end gap-1">
                  <button
                    type="button"
                    className="btn-outline text-xs"
                    onClick={() => onTest(row.id)}
                    disabled={isTestPending}
                  >
                    {t('peripherals:actions.test')}
                  </button>
                  <button
                    type="button"
                    className="btn-icon btn-ghost"
                    aria-label={t('peripherals:actions.edit')}
                    title={t('peripherals:actions.edit')}
                    onClick={() => onEdit(row)}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="btn-icon btn-ghost"
                    aria-label={
                      row.isActive
                        ? t('peripherals:actions.deactivate')
                        : t('peripherals:actions.activate')
                    }
                    title={
                      row.isActive
                        ? t('peripherals:actions.deactivate')
                        : t('peripherals:actions.activate')
                    }
                    onClick={() => onToggleActive(row)}
                    disabled={isSetActivePending}
                  >
                    <Power className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    className="btn-icon btn-ghost text-danger-600 hover:text-danger-700"
                    aria-label={t('peripherals:actions.remove')}
                    title={t('peripherals:actions.remove')}
                    onClick={() => onRemove(row)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hasPagination && (
        <TablePagination {...pagination} onPageChange={pagination.setPage} />
      )}
    </section>
  );
}
