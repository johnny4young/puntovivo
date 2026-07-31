import { lazy, Suspense, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { BadgePercent, LoaderCircle, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { ConfirmModal, Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { ResourcePage } from '@/components/resources/ResourcePage';
import { Badge } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import type { UserRole, VatRate } from '@/types';
import type { VatRateFormValues } from './vatRateForm.types';

const VatRateFormModal = lazy(() =>
  import('./VatRateFormModal').then(module => ({ default: module.VatRateFormModal }))
);

function canManageVatRates(role: UserRole | undefined): boolean {
  return role === 'admin';
}

export function VatRatesPage() {
  const { t } = useTranslation('vatRates');
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInstanceKey, setModalInstanceKey] = useState(0);
  const [editingVatRate, setEditingVatRate] = useState<VatRate | null>(null);
  const [vatRateToDelete, setVatRateToDelete] = useState<VatRate | null>(null);

  const vatRatesQuery = trpc.vatRates.list.useQuery({ page: 1, perPage: 50 });
  const createMutation = trpc.vatRates.create.useMutation({
    onSuccess: async () => {
      await utils.vatRates.list.invalidate();
      handleCloseModal();
      toast.success({ title: t('toast.created') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'vatRates:toast.createError' }),
  });
  const updateMutation = trpc.vatRates.update.useMutation({
    onSuccess: async () => {
      await utils.vatRates.list.invalidate();
      handleCloseModal();
      toast.success({ title: t('toast.updated') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'vatRates:toast.updateError' }),
  });
  const deleteMutation = trpc.vatRates.delete.useMutation({
    onSuccess: async () => {
      await utils.vatRates.list.invalidate();
      setVatRateToDelete(null);
      toast.success({ title: t('toast.deleted') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'vatRates:toast.deleteError' }),
  });

  const canManage = canManageVatRates(user?.role);
  const vatRates = (vatRatesQuery.data?.items ?? []).map(vatRate => ({
    ...vatRate,
    isActive: vatRate.isActive ?? false,
  })) as VatRate[];

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingVatRate(null);
    createMutation.reset();
    updateMutation.reset();
  };
  const handleOpenCreate = () => {
    setEditingVatRate(null);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  };
  const handleOpenEdit = (vatRate: VatRate) => {
    setEditingVatRate(vatRate);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  };
  const handleSubmit = async (values: VatRateFormValues) => {
    const payload = {
      name: values.name.trim(),
      rate: values.rate,
      isActive: values.isActive,
    };

    if (editingVatRate) {
      await updateMutation.mutateAsync({ id: editingVatRate.id, ...payload });
      return;
    }
    await createMutation.mutateAsync(payload);
  };

  const columns: ColumnDef<VatRate>[] = [
    {
      accessorKey: 'name',
      header: t('columns.vatRate'),
      size: 220,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100">
            <BadgePercent className="h-4 w-4 text-primary-700" aria-hidden="true" />
          </div>
          <p className="font-medium text-secondary-900">{row.original.name}</p>
        </div>
      ),
    },
    {
      accessorKey: 'rate',
      header: t('columns.rate'),
      size: 120,
      cell: ({ row }) => (
        <span className="font-medium text-secondary-900">
          {t('columns.percentageValue', { value: row.original.rate })}
        </span>
      ),
    },
    {
      accessorKey: 'isActive',
      header: t('columns.status'),
      size: 100,
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? 'success' : 'neutral'}>
          {row.original.isActive ? t('columns.active') : t('columns.inactive')}
        </Badge>
      ),
    },
    {
      id: 'actions',
      size: 80,
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
              onClick={() => setVatRateToDelete(row.original)}
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

  return (
    <>
      <ResourcePage
        title={t('title')}
        action={
          <button
            className="btn-primary flex items-center gap-2"
            onClick={handleOpenCreate}
            disabled={!canManage}
          >
            <Plus className="h-5 w-5" aria-hidden="true" />
            {t('add')}
          </button>
        }
        columns={columns}
        data={vatRates}
        isLoading={vatRatesQuery.isLoading}
        error={vatRatesQuery.error?.message ?? null}
        searchKey="name"
        searchPlaceholder={t('search')}
        loadingMessage={t('loading')}
        onRetry={() => {
          void vatRatesQuery.refetch();
        }}
        enableRowSelection={false}
      />

      {!canManage ? (
        <div className="mt-6 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
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
                <p className="text-sm font-medium text-secondary-700">
                  {t('form.loadingMessage')}
                </p>
              </div>
            </Modal>
          }
        >
          <VatRateFormModal
            key={`${editingVatRate?.id ?? 'new-vat-rate'}-${modalInstanceKey}`}
            isOpen
            vatRate={editingVatRate}
            isSaving={createMutation.isPending || updateMutation.isPending}
            error={createMutation.error?.message ?? updateMutation.error?.message ?? null}
            onClose={handleCloseModal}
            onSubmit={handleSubmit}
          />
        </Suspense>
      ) : null}

      <ConfirmModal
        isOpen={!!vatRateToDelete}
        onClose={() => {
          if (!deleteMutation.isPending) setVatRateToDelete(null);
        }}
        onConfirm={() => {
          if (vatRateToDelete) {
            void deleteMutation.mutateAsync({ id: vatRateToDelete.id });
          }
        }}
        title={t('delete.title')}
        message={vatRateToDelete ? t('delete.description') : ''}
        confirmText={deleteMutation.isPending ? t('delete.submitting') : t('delete.confirm')}
        cancelText={t('common:actions.cancel')}
        variant="danger"
        loading={deleteMutation.isPending}
      />
    </>
  );
}
