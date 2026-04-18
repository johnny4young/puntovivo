import { useMemo, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmModal, Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import type { Sequential, Site, UserRole } from '@/types';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { getErrorMessage } from '@/lib/utils';

interface SequentialFormValues {
  siteId: string;
  documentType: Sequential['documentType'];
  prefix: string;
  currentValue: number;
}

const defaultValues: SequentialFormValues = {
  siteId: '',
  documentType: 'sale',
  prefix: '',
  currentValue: 0,
};

// documentTypeLabels is now built inside the component using t()


function mapSequentialToForm(sequential: Sequential | null): SequentialFormValues {
  if (!sequential) {
    return defaultValues;
  }

  return {
    siteId: sequential.siteId,
    documentType: sequential.documentType,
    prefix: sequential.prefix,
    currentValue: sequential.currentValue,
  };
}

interface SequentialFormModalProps {
  isOpen: boolean;
  sequential: Sequential | null;
  sites: Site[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: SequentialFormValues) => Promise<void>;
}

function SequentialFormModal({
  isOpen,
  sequential,
  sites,
  isSaving,
  error,
  onClose,
  onSubmit,
}: SequentialFormModalProps) {
  const { t } = useTranslation('settings');
  const localDocTypeLabels: Record<Sequential['documentType'], string> = {
    sale: t('sequentials.docTypes.sale'),
    purchase: t('sequentials.docTypes.purchase'),
    order: t('sequentials.docTypes.order'),
    quotation: t('sequentials.docTypes.quotation'),
  };
  const form = useForm<SequentialFormValues>({
    defaultValues: mapSequentialToForm(sequential),
  });

  const handleSubmit = form.handleSubmit(async values => {
    await onSubmit({
      ...values,
      currentValue: Number(values.currentValue),
    });
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={sequential ? t('sequentials.form.editTitle') : t('sequentials.form.createTitle')}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('sequentials.form.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? t('sequentials.form.submitting') : sequential ? t('sequentials.form.save') : t('sequentials.form.create')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="sequential-site" className="label">
            {t('sequentials.columns.site')}
          </label>
          <select
            id="sequential-site"
            className="input mt-1"
            disabled={!!sequential}
            {...form.register('siteId', { required: t('sequentials.form.siteRequired') })}
          >
            <option value="">{t('sequentials.form.selectSite')}</option>
            {sites.map(site => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="sequential-document-type" className="label">
            {t('sequentials.columns.documentType')}
          </label>
          <select
            id="sequential-document-type"
            className="input mt-1"
            disabled={!!sequential}
            {...form.register('documentType', { required: t('sequentials.form.documentTypeRequired') })}
          >
            {Object.entries(localDocTypeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="sequential-prefix" className="label">
            {t('sequentials.columns.prefix')}
          </label>
          <input
            id="sequential-prefix"
            className="input mt-1"
            maxLength={20}
            {...form.register('prefix')}
          />
        </div>

        <div>
          <label htmlFor="sequential-current-value" className="label">
            {t('sequentials.columns.currentValue')}
          </label>
          <input
            id="sequential-current-value"
            type="number"
            min={0}
            className="input mt-1"
            {...form.register('currentValue', {
              valueAsNumber: true,
              min: { value: 0, message: t('sequentials.validation.currentValueMin') },
            })}
          />
          {form.formState.errors.currentValue && (
            <p className="mt-1 text-sm text-danger-500">
              {form.formState.errors.currentValue.message}
            </p>
          )}
        </div>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}

function canManageSequentials(role: UserRole | undefined): boolean {
  return role === 'admin';
}

export function SequentialsPage() {
  const { t } = useTranslation('settings');
  const { user } = useAuth();
  const toast = useToast();

  const documentTypeLabels: Record<Sequential['documentType'], string> = {
    sale: t('sequentials.docTypes.sale'),
    purchase: t('sequentials.docTypes.purchase'),
    order: t('sequentials.docTypes.order'),
    quotation: t('sequentials.docTypes.quotation'),
  };
  const utils = trpc.useUtils();
  const sitesQuery = trpc.sites.list.useQuery();
  const sequentialsQuery = trpc.sequentials.list.useQuery();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSequential, setEditingSequential] = useState<Sequential | null>(null);
  const [sequentialToDelete, setSequentialToDelete] = useState<Sequential | null>(null);

  const sites = ((sitesQuery.data?.items ?? []) as Site[]).map(site => ({
    ...site,
    isActive: !!site.isActive,
  }));
  const sequentials = useMemo(
    () => (sequentialsQuery.data?.items ?? []) as Sequential[],
    [sequentialsQuery.data?.items]
  );
  const canManage = canManageSequentials(user?.role);

  const upsertMutation = trpc.sequentials.upsert.useMutation({
    onSuccess: async () => {
      await utils.sequentials.list.invalidate();
      setIsModalOpen(false);
      setEditingSequential(null);
      toast.success({ title: editingSequential ? t('sequentials.toast.updated') : t('sequentials.toast.created') });
    },
    onError: error => {
      const fallback = editingSequential
        ? t('sequentials.toast.updateError')
        : t('sequentials.toast.createError');

      toast.error({
        title: fallback,
        description: getErrorMessage(error, fallback),
      });
    },
  });

  const deleteMutation = trpc.sequentials.delete.useMutation({
    onSuccess: async () => {
      await utils.sequentials.list.invalidate();
      setSequentialToDelete(null);
      toast.success({ title: t('sequentials.toast.deleted') });
    },
    onError: error => {
      toast.error({
        title: t('sequentials.toast.deleteError'),
        description: getErrorMessage(error, t('sequentials.toast.deleteError')),
      });
    },
  });

  const columns: ColumnDef<Sequential>[] = [
    {
      accessorKey: 'siteName',
      header: t('sequentials.columns.site'),
      size: 180,
    },
    {
      accessorKey: 'documentType',
      header: t('sequentials.columns.documentType'),
      size: 140,
      cell: ({ row }) => documentTypeLabels[row.original.documentType],
    },
    {
      accessorKey: 'prefix',
      header: t('sequentials.columns.prefix'),
      size: 120,
      cell: ({ row }) => <span className="font-mono font-medium">{row.original.prefix || '—'}</span>,
    },
    {
      accessorKey: 'currentValue',
      header: t('sequentials.columns.currentValue'),
      size: 130,
      cell: ({ row }) => <span className="font-medium">{row.original.currentValue}</span>,
    },
    {
      id: 'preview',
      header: t('sequentials.columns.preview'),
      size: 160,
      cell: ({ row }) => (
        <span className="font-mono text-secondary-600">
          {row.original.prefix}
          {String(row.original.currentValue + 1).padStart(6, '0')}
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
            onClick={() => {
              setEditingSequential(row.original);
              setIsModalOpen(true);
            }}
            disabled={!canManage}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
            onClick={() => setSequentialToDelete(row.original)}
            disabled={!canManage}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  const onSubmit = async (values: SequentialFormValues) => {
    await upsertMutation.mutateAsync(values);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">{t('sequentials.title')}</h1>
          <p className="mt-1 text-sm text-secondary-500">
            {t('sequentials.description')}
          </p>
        </div>
        <button
          className="btn-primary flex items-center gap-2"
          onClick={() => {
            setEditingSequential(null);
            setIsModalOpen(true);
          }}
          disabled={!canManage}
        >
          <Plus className="h-5 w-5" />
          {t('sequentials.add')}
        </button>
      </div>

      <div className="card p-6">
        {sequentialsQuery.isLoading && <TableLoadingState message={t('sequentials.loading')} />}
        {sequentialsQuery.error && (
          <TableErrorState
            title={t('sequentials.error')}
            message={sequentialsQuery.error.message}
            onRetry={() => {
              void sequentialsQuery.refetch();
            }}
          />
        )}
        {!sequentialsQuery.isLoading && !sequentialsQuery.error && (
          <DataTable
            columns={columns}
            data={sequentials}
            searchKey="siteName"
            searchPlaceholder={t('sequentials.search')}
            pageSize={10}
          />
        )}
      </div>

      <SequentialFormModal
        key={editingSequential?.id ?? 'new-sequential'}
        isOpen={isModalOpen}
        sequential={editingSequential}
        sites={sites}
        isSaving={upsertMutation.isPending}
        error={upsertMutation.error?.message ?? null}
        onClose={() => {
          setIsModalOpen(false);
          setEditingSequential(null);
        }}
        onSubmit={onSubmit}
      />

      <ConfirmModal
        isOpen={!!sequentialToDelete}
        onClose={() => setSequentialToDelete(null)}
        onConfirm={() => {
          if (sequentialToDelete) {
            void deleteMutation.mutateAsync({ id: sequentialToDelete.id });
          }
        }}
        title={t('sequentials.delete.title')}
        message={sequentialToDelete ? `${t('sequentials.delete.title')}: ${documentTypeLabels[sequentialToDelete.documentType]} — ${sequentialToDelete.siteName}` : ''}
        confirmText={deleteMutation.isPending ? t('sequentials.delete.deleting') : t('sequentials.delete.confirm')}
        loading={deleteMutation.isPending}
      />

      {!sitesQuery.isLoading && sites.length === 0 && (
        <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          {t('sequentials.noSite')}
        </div>
      )}

      <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-3 text-sm text-secondary-600">
        {t('sequentials.incrementNote')}
      </div>
    </div>
  );
}
