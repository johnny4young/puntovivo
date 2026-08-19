import { lazy, Suspense, useMemo, useState } from 'react';
import type { DataTableColumnDef } from '@/components/tables/DataTable';
import { CircleHelp, Hash, LoaderCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ConfirmModal, Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { ResourcePage } from '@/components/resources/ResourcePage';
import { useAuth } from '@/features/auth/AuthProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import type { Sequential, Site, UserRole } from '@/types';
import { formatSequentialPreview } from './sequentialForm.types';
import type { SequentialFormSubmission } from './sequentialForm.types';

const SequentialFormModal = lazy(() =>
  import('./SequentialFormModal').then(module => ({ default: module.SequentialFormModal }))
);

function canManageSequentials(role: UserRole | undefined): boolean {
  return role === 'admin';
}

export function SequentialsPage(): React.ReactElement {
  const { t } = useTranslation('sequentials');
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const sitesQuery = trpc.sites.list.useQuery();
  const sequentialsQuery = trpc.sequentials.list.useQuery();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInstanceKey, setModalInstanceKey] = useState(0);
  const [editingSequential, setEditingSequential] = useState<Sequential | null>(null);
  const [sequentialToDelete, setSequentialToDelete] = useState<Sequential | null>(null);

  const documentTypeLabels: Record<Sequential['documentType'], string> = {
    sale: t('docTypes.sale'),
    purchase: t('docTypes.purchase'),
    order: t('docTypes.order'),
    quotation: t('docTypes.quotation'),
  };
  const activeSites = ((sitesQuery.data?.items ?? []) as Site[])
    .map(site => ({ ...site, isActive: Boolean(site.isActive) }))
    .filter(site => site.isActive);
  const sequentials = useMemo(
    () => (sequentialsQuery.data?.items ?? []) as Sequential[],
    [sequentialsQuery.data?.items]
  );
  const canManage = canManageSequentials(user?.role);

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingSequential(null);
  };
  const handleOpenCreate = () => {
    setEditingSequential(null);
    setModalInstanceKey(key => key + 1);
    setIsModalOpen(true);
  };
  const handleOpenEdit = (sequential: Sequential) => {
    setEditingSequential(sequential);
    setModalInstanceKey(key => key + 1);
    setIsModalOpen(true);
  };

  const upsertMutation = trpc.sequentials.upsert.useMutation({
    onSuccess: async () => {
      await utils.sequentials.list.invalidate();
      handleCloseModal();
      toast.success({
        title: editingSequential ? t('toast.updated') : t('toast.created'),
      });
    },
    onError: error =>
      onErrorToast(toast, t, {
        titleKey: editingSequential
          ? 'sequentials:toast.updateError'
          : 'sequentials:toast.createError',
      })(error),
  });
  const deleteMutation = trpc.sequentials.delete.useMutation({
    onSuccess: async () => {
      await utils.sequentials.list.invalidate();
      setSequentialToDelete(null);
      toast.success({ title: t('toast.deleted') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'sequentials:toast.deleteError' }),
  });

  const columns: DataTableColumnDef<Sequential>[] = [
    {
      accessorKey: 'siteName',
      header: t('columns.site'),
      size: 180,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100">
            <Hash className="h-4 w-4 text-primary-700" aria-hidden="true" />
          </div>
          <span className="font-medium text-secondary-950">{row.original.siteName}</span>
        </div>
      ),
    },
    {
      accessorKey: 'documentType',
      header: t('columns.documentType'),
      size: 140,
      cell: ({ row }) => documentTypeLabels[row.original.documentType],
    },
    {
      accessorKey: 'prefix',
      header: t('columns.prefix'),
      size: 120,
      cell: ({ row }) => (
        <span className="font-mono font-medium">
          {row.original.prefix || t('columns.noPrefix')}
        </span>
      ),
    },
    {
      accessorKey: 'currentValue',
      header: t('columns.currentValue'),
      size: 130,
      cell: ({ row }) => <span className="font-mono font-medium">{row.original.currentValue}</span>,
    },
    {
      id: 'preview',
      header: t('columns.preview'),
      size: 160,
      cell: ({ row }) => (
        <span className="font-mono font-semibold text-primary-800">
          {formatSequentialPreview(row.original.prefix, row.original.currentValue)}
        </span>
      ),
    },
    {
      id: 'actions',
      size: 90,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button
            className="btn-ghost btn-icon h-8 w-8"
            onClick={() => handleOpenEdit(row.original)}
            disabled={!canManage}
            aria-label={t('common:actions.edit')}
            title={t('common:actions.edit')}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </button>
          {canManage ? (
            <button
              className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
              onClick={() => setSequentialToDelete(row.original)}
              aria-label={t('common:actions.delete')}
              title={t('common:actions.delete')}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>
      ),
    },
  ];

  const handleSubmit = async (values: SequentialFormSubmission) => {
    await upsertMutation.mutateAsync(values);
  };
  const deleteMessage = sequentialToDelete
    ? t('delete.description', {
        documentType: documentTypeLabels[sequentialToDelete.documentType],
        site: sequentialToDelete.siteName,
      })
    : '';

  return (
    <div className="space-y-6">
      <ResourcePage
        title={t('title')}
        description={t('description')}
        action={
          <button
            className="btn-primary flex items-center gap-2"
            onClick={handleOpenCreate}
            disabled={!canManage || activeSites.length === 0 || sitesQuery.isLoading}
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
            {t('add')}
          </button>
        }
        columns={columns}
        data={sequentials}
        isLoading={sequentialsQuery.isLoading}
        error={sequentialsQuery.error?.message ?? null}
        searchKey="siteName"
        searchPlaceholder={t('search')}
        loadingMessage={t('loading')}
        enableRowSelection={false}
        onRetry={() => {
          void sequentialsQuery.refetch();
        }}
      />

      <div className="flex gap-3 rounded-xl border border-primary-100 bg-primary-50/70 px-4 py-3 text-sm text-primary-900">
        <CircleHelp className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="leading-5">{t('automaticNote')}</p>
      </div>

      {!sitesQuery.isLoading && !sitesQuery.error && activeSites.length === 0 ? (
        <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          {t('noSite')}
        </div>
      ) : null}

      {sitesQuery.error ? (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          <span>{t('siteLoadError')}</span>
          <button
            type="button"
            className="btn-secondary shrink-0"
            onClick={() => void sitesQuery.refetch()}
          >
            {t('common:actions.retry')}
          </button>
        </div>
      ) : null}

      {!canManage ? (
        <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          {t('permissionNote')}
        </div>
      ) : null}

      {isModalOpen ? (
        <Suspense
          fallback={
            <Modal
              isOpen
              onClose={handleCloseModal}
              title={t('form.loadingTitle')}
              size="lg"
              closeOnBackdrop={false}
              closeOnEsc={false}
              showCloseButton={false}
            >
              <div
                className="flex min-h-52 flex-col items-center justify-center gap-3 text-center"
                role="status"
              >
                <LoaderCircle
                  className="h-6 w-6 animate-spin text-primary-700"
                  aria-hidden="true"
                />
                <p className="text-sm font-medium text-secondary-700">{t('form.loadingMessage')}</p>
              </div>
            </Modal>
          }
        >
          <SequentialFormModal
            key={`${editingSequential?.id ?? 'new-sequential'}-${modalInstanceKey}`}
            isOpen
            sequential={editingSequential}
            sites={activeSites}
            isSaving={upsertMutation.isPending}
            error={upsertMutation.error?.message ?? null}
            onClose={handleCloseModal}
            onSubmit={handleSubmit}
          />
        </Suspense>
      ) : null}

      <ConfirmModal
        isOpen={Boolean(sequentialToDelete)}
        onClose={() => {
          if (!deleteMutation.isPending) setSequentialToDelete(null);
        }}
        onConfirm={() => {
          if (sequentialToDelete) {
            void deleteMutation.mutateAsync({ id: sequentialToDelete.id });
          }
        }}
        title={t('delete.title')}
        message={deleteMessage}
        confirmText={deleteMutation.isPending ? t('delete.deleting') : t('delete.confirm')}
        cancelText={t('common:actions.cancel')}
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
