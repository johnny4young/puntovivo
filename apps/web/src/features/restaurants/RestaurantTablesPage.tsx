/**
 * ENG-039b — admin page for the restaurant table catalog.
 *
 * Mirrors the `LocationsPage` shape: `ResourcePage` wrapper + a
 * dedicated form modal + a `ConfirmModal` for archive. Adds a site
 * selector at the top because tables are `(tenantId, siteId)`-scoped.
 */
import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { Archive, Pencil, Plus, Table2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { ResourcePage } from '@/components/resources/ResourcePage';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import {
  RestaurantTableFormModal,
  type RestaurantTableFormInitial,
  type RestaurantTableFormPayload,
} from './RestaurantTableFormModal';

interface RestaurantTableRow {
  id: string;
  tenantId: string;
  siteId: string;
  name: string;
  seatCount: number | null;
  area: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function buildColumns(
  t: TFunction,
  onEdit: (row: RestaurantTableRow) => void,
  onArchive: (row: RestaurantTableRow) => void,
  canManage: boolean
): ColumnDef<RestaurantTableRow>[] {
  return [
    {
      accessorKey: 'name',
      header: t('tables.columns.name'),
      size: 220,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100">
            <Table2 className="h-4 w-4 text-primary-700" />
          </div>
          <p className="font-medium text-secondary-900">{row.original.name}</p>
        </div>
      ),
    },
    {
      accessorKey: 'seatCount',
      header: t('tables.columns.seatCount'),
      size: 100,
      cell: ({ row }) =>
        row.original.seatCount !== null ? String(row.original.seatCount) : '—',
    },
    {
      accessorKey: 'area',
      header: t('tables.columns.area'),
      size: 180,
      cell: ({ row }) => row.original.area ?? '—',
    },
    {
      accessorKey: 'isActive',
      header: t('tables.columns.status'),
      size: 120,
      cell: ({ row }) => (
        <span
          className={`badge ${row.original.isActive ? 'badge-success' : 'badge-secondary'}`}
        >
          {row.original.isActive
            ? t('tables.status.active')
            : t('tables.status.archived')}
        </span>
      ),
    },
    {
      id: 'actions',
      header: t('tables.columns.actions'),
      size: 120,
      cell: ({ row }) => {
        const editLabel = t('tables.actions.edit');
        const archiveLabel = t('tables.actions.archive');
        return (
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn-ghost btn-icon h-8 w-8"
              onClick={() => onEdit(row.original)}
              disabled={!canManage}
              aria-label={editLabel}
              title={editLabel}
              data-testid={`restaurant-table-edit-${row.original.id}`}
            >
              <Pencil className="h-4 w-4" />
            </button>
            {canManage && row.original.isActive && (
              <button
                type="button"
                className="btn-ghost btn-icon h-8 w-8 text-warning-700 hover:text-warning-900"
                onClick={() => onArchive(row.original)}
                aria-label={archiveLabel}
                title={archiveLabel}
                data-testid={`restaurant-table-archive-${row.original.id}`}
              >
                <Archive className="h-4 w-4" />
              </button>
            )}
          </div>
        );
      },
    },
  ];
}

export function RestaurantTablesPage() {
  const { t } = useTranslation(['restaurants', 'errors']);
  const { user } = useAuth();
  const { currentSite } = useTenant();
  const toast = useToast();
  const utils = trpc.useUtils();
  const isAdmin = user?.role === 'admin';

  const sitesQuery = trpc.sites.list.useQuery({ includeInactive: false });
  const sites = useMemo(() => sitesQuery.data?.items ?? [], [sitesQuery.data]);
  // `siteOverride` captures only the operator's explicit picks; the
  // derived `selectedSiteId` resolves to that override first, then the
  // tenant's active site, then the first available site. This keeps
  // the dropdown render-time-derived (no setState-in-effect) while
  // still letting the operator switch sites.
  const [siteOverride, setSiteOverride] = useState<string | null>(null);
  const selectedSiteId = useMemo(() => {
    if (siteOverride && sites.some(site => site.id === siteOverride)) {
      return siteOverride;
    }
    if (currentSite && sites.some(site => site.id === currentSite.id)) {
      return currentSite.id;
    }
    return sites[0]?.id ?? '';
  }, [siteOverride, sites, currentSite]);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInstanceKey, setModalInstanceKey] = useState(0);
  const [editing, setEditing] = useState<RestaurantTableFormInitial | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<RestaurantTableRow | null>(
    null
  );

  const tablesQuery = trpc.restaurantTables.list.useQuery(
    {
      siteId: selectedSiteId || 'placeholder',
      includeArchived,
    },
    { enabled: selectedSiteId.length > 0 }
  );

  const createMutation = trpc.restaurantTables.create.useMutation({
    onSuccess: async () => {
      await utils.restaurantTables.list.invalidate();
      toast.success({ title: t('tables.toast.created') });
      handleCloseModal();
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'restaurants:tables.toast.createError',
    }),
  });

  const updateMutation = trpc.restaurantTables.update.useMutation({
    onSuccess: async () => {
      await utils.restaurantTables.list.invalidate();
      toast.success({ title: t('tables.toast.updated') });
      handleCloseModal();
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'restaurants:tables.toast.updateError',
    }),
  });

  const archiveMutation = trpc.restaurantTables.archive.useMutation({
    onSuccess: async () => {
      await utils.restaurantTables.list.invalidate();
      toast.success({ title: t('tables.toast.archived') });
      setArchiveTarget(null);
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'restaurants:tables.toast.archiveError',
    }),
  });

  function handleCloseModal() {
    setIsModalOpen(false);
    setEditing(null);
    setEditingId(null);
    createMutation.reset();
    updateMutation.reset();
  }

  function handleOpenCreate() {
    setEditing(null);
    setEditingId(null);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  }

  function handleOpenEdit(row: RestaurantTableRow) {
    setEditing({
      id: row.id,
      name: row.name,
      seatCount: row.seatCount,
      area: row.area,
      notes: row.notes,
    });
    setEditingId(row.id);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  }

  async function handleSubmit(values: RestaurantTableFormPayload) {
    if (editingId) {
      await updateMutation.mutateAsync({
        id: editingId,
        name: values.name,
        seatCount: values.seatCount,
        area: values.area,
        notes: values.notes,
      });
      return;
    }
    if (!selectedSiteId) return;
    await createMutation.mutateAsync({
      siteId: selectedSiteId,
      name: values.name,
      seatCount: values.seatCount,
      area: values.area,
      notes: values.notes,
    });
  }

  const items: RestaurantTableRow[] = (tablesQuery.data?.items ?? []).map(row => ({
    id: row.id,
    tenantId: row.tenantId,
    siteId: row.siteId,
    name: row.name,
    seatCount: row.seatCount,
    area: row.area,
    notes: row.notes,
    isActive: row.isActive ?? false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
  const tableListError = tablesQuery.error
    ? translateServerError(tablesQuery.error, t, t('tables.error'))
    : null;
  const modalError = createMutation.error ?? updateMutation.error;
  const modalErrorMessage = modalError
    ? translateServerError(modalError, t, t('tables.form.errorFallback'))
    : null;

  return (
    <>
      <ResourcePage
        title={t('tables.title')}
        description={t('tables.description')}
        action={
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-secondary-700">
              <span className="text-xs uppercase tracking-wide text-secondary-500">
                {t('tables.siteSelector')}
              </span>
              <select
                className="input"
                value={selectedSiteId}
                onChange={event => setSiteOverride(event.target.value)}
                data-testid="restaurant-tables-site-select"
              >
                {sites.length === 0 && <option value="">—</option>}
                {sites.map(site => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm text-secondary-700">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-secondary-300"
                checked={includeArchived}
                onChange={event => setIncludeArchived(event.target.checked)}
                data-testid="restaurant-tables-show-archived"
              />
              {t('tables.toolbar.showArchived')}
            </label>
            <button
              type="button"
              className="btn-primary flex items-center gap-2"
              onClick={handleOpenCreate}
              disabled={!isAdmin || selectedSiteId.length === 0}
              data-testid="restaurant-tables-create-cta"
            >
              <Plus className="h-5 w-5" />
              {t('tables.toolbar.createCta')}
            </button>
          </div>
        }
        columns={buildColumns(t, handleOpenEdit, setArchiveTarget, isAdmin)}
        data={items}
        isLoading={tablesQuery.isLoading}
        error={tableListError}
        searchKey="name"
        searchPlaceholder={t('tables.title')}
        loadingMessage={t('tables.loading')}
        onRetry={() => {
          void tablesQuery.refetch();
        }}
      />

      {!isAdmin && (
        <div
          className="mt-6 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700"
          data-testid="restaurant-tables-permission-note"
        >
          {t('tables.permissionNote')}
        </div>
      )}

      <RestaurantTableFormModal
        key={`${editing?.id ?? 'new'}-${modalInstanceKey}`}
        isOpen={isModalOpen}
        initial={editing}
        isSaving={createMutation.isPending || updateMutation.isPending}
        error={modalErrorMessage}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
      />

      <ConfirmModal
        isOpen={archiveTarget !== null}
        title={t('tables.archive.title')}
        message={archiveTarget ? t('tables.archive.message') : ''}
        confirmText={
          archiveMutation.isPending
            ? t('tables.archive.submitting')
            : t('tables.archive.confirm')
        }
        cancelText={t('tables.archive.cancel')}
        variant="primary"
        loading={archiveMutation.isPending}
        onConfirm={() => {
          if (archiveTarget) {
            void archiveMutation.mutateAsync({ id: archiveTarget.id });
          }
        }}
        onClose={() => {
          if (!archiveMutation.isPending) {
            setArchiveTarget(null);
          }
        }}
      />
    </>
  );
}
