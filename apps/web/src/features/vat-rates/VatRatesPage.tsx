import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { BadgePercent, Pencil, Plus, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { ConfirmModal, Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { ResourcePage } from '@/components/resources/ResourcePage';
import type { UserRole, VatRate } from '@/types';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { getErrorMessage } from '@/lib/utils';

interface VatRateFormValues {
  name: string;
  rate: number;
  isActive: boolean;
}

const defaultValues: VatRateFormValues = {
  name: '',
  rate: 0,
  isActive: true,
};

function mapVatRateToForm(vatRate: VatRate | null): VatRateFormValues {
  if (!vatRate) {
    return defaultValues;
  }

  return {
    name: vatRate.name,
    rate: vatRate.rate,
    isActive: vatRate.isActive,
  };
}

interface VatRateFormModalProps {
  isOpen: boolean;
  vatRate: VatRate | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: VatRateFormValues) => Promise<void>;
}

function VatRateFormModal({
  isOpen,
  vatRate,
  isSaving,
  error,
  onClose,
  onSubmit,
}: VatRateFormModalProps) {
  const { t } = useTranslation('settings');
  const form = useForm<VatRateFormValues>({
    defaultValues: mapVatRateToForm(vatRate),
  });

  const handleSubmit = form.handleSubmit(onSubmit);
  const isCreate = !vatRate;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCreate ? t('vatRates.form.createTitle') : t('vatRates.form.editTitle')}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('vatRates.form.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? t('vatRates.form.submitting') : isCreate ? t('vatRates.form.create') : t('vatRates.form.save')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="vat-rate-name" className="label">
            {t('vatRates.form.name')}
          </label>
          <input
            id="vat-rate-name"
            className="input mt-1"
            {...form.register('name', { required: t('vatRates.form.nameRequired') })}
          />
          {form.formState.errors.name && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="vat-rate-value" className="label">
            {t('vatRates.form.percentage')}
          </label>
          <input
            id="vat-rate-value"
            type="number"
            min="0"
            max="100"
            step="0.01"
            className="input mt-1"
            {...form.register('rate', {
              valueAsNumber: true,
              required: t('vatRates.form.rateRequired'),
              min: { value: 0, message: t('vatRates.form.rateNonNegative') },
              max: { value: 100, message: t('vatRates.form.rateMax') },
            })}
          />
          {form.formState.errors.rate && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.rate.message}</p>
          )}
        </div>

        <label className="flex items-center gap-3 text-sm text-secondary-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-secondary-300"
            {...form.register('isActive')}
          />
          {t('vatRates.form.isActive')}
        </label>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}

function canManageVatRates(role: UserRole | undefined): boolean {
  return role === 'admin';
}

export function VatRatesPage() {
  const { t } = useTranslation('settings');
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInstanceKey, setModalInstanceKey] = useState(0);
  const [editingVatRate, setEditingVatRate] = useState<VatRate | null>(null);
  const [vatRateToDelete, setVatRateToDelete] = useState<VatRate | null>(null);

  const { data, isLoading, error, refetch } = trpc.vatRates.list.useQuery({ page: 1, perPage: 50 });
  const createMutation = trpc.vatRates.create.useMutation({
    onSuccess: async () => {
      await utils.vatRates.list.invalidate();
      handleCloseModal();
      toast.success({ title: t('vatRates.toast.created') });
    },
    onError: error => {
      toast.error({
        title: t('vatRates.toast.createError'),
        description: getErrorMessage(error, t('vatRates.toast.createError')),
      });
    },
  });
  const updateMutation = trpc.vatRates.update.useMutation({
    onSuccess: async () => {
      await utils.vatRates.list.invalidate();
      handleCloseModal();
      toast.success({ title: t('vatRates.toast.updated') });
    },
    onError: error => {
      toast.error({
        title: t('vatRates.toast.updateError'),
        description: getErrorMessage(error, t('vatRates.toast.updateError')),
      });
    },
  });
  const deleteMutation = trpc.vatRates.delete.useMutation({
    onSuccess: async () => {
      await utils.vatRates.list.invalidate();
      setVatRateToDelete(null);
      toast.success({ title: t('vatRates.toast.deleted') });
    },
    onError: error => {
      toast.error({
        title: t('vatRates.toast.deleteError'),
        description: getErrorMessage(error, t('vatRates.toast.deleteError')),
      });
    },
  });

  const canManage = canManageVatRates(user?.role);
  const canDelete = user?.role === 'admin';
  const vatRates = (data?.items ?? []).map(vatRate => ({
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
    if (editingVatRate) {
      await updateMutation.mutateAsync({
        id: editingVatRate.id,
        name: values.name,
        rate: values.rate,
        isActive: values.isActive,
      });
      return;
    }

    await createMutation.mutateAsync(values);
  };

  const columns: ColumnDef<VatRate>[] = [
    {
      accessorKey: 'name',
      header: t('vatRates.columns.vatRate'),
      size: 220,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary-100 flex items-center justify-center">
            <BadgePercent className="h-4 w-4 text-primary-700" />
          </div>
          <div>
            <p className="font-medium text-secondary-900">{row.original.name}</p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'rate',
      header: t('vatRates.columns.rate'),
      size: 120,
      cell: ({ row }) => (
        <span className="font-medium text-secondary-900">{row.original.rate}%</span>
      ),
    },
    {
      accessorKey: 'isActive',
      header: t('vatRates.columns.status'),
      size: 100,
      cell: ({ row }) => (
        <span className={`badge ${row.original.isActive ? 'badge-success' : 'badge-secondary'}`}>
          {row.original.isActive ? t('vatRates.columns.active') : t('vatRates.columns.inactive')}
        </span>
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
          >
            <Pencil className="h-4 w-4" />
          </button>
          {canDelete && (
            <button
              className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
              onClick={() => setVatRateToDelete(row.original)}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <ResourcePage
        title={t('vatRates.title')}
        description={t('vatRates.description')}
        action={
          <button
            className="btn-primary flex items-center gap-2"
            onClick={handleOpenCreate}
            disabled={!canManage}
          >
            <Plus className="h-5 w-5" />
            {t('vatRates.add')}
          </button>
        }
        columns={columns}
        data={vatRates}
        isLoading={isLoading}
        error={error?.message ?? null}
        searchKey="name"
        searchPlaceholder={t('vatRates.search')}
        loadingMessage={t('vatRates.loading')}
        onRetry={() => {
          void refetch();
        }}
      />

      <VatRateFormModal
        key={`${editingVatRate?.id ?? 'new-vat-rate'}-${modalInstanceKey}`}
        isOpen={isModalOpen}
        vatRate={editingVatRate}
        isSaving={createMutation.isPending || updateMutation.isPending}
        error={createMutation.error?.message ?? updateMutation.error?.message ?? null}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
      />

      <ConfirmModal
        isOpen={!!vatRateToDelete}
        onClose={() => setVatRateToDelete(null)}
        onConfirm={() => {
          if (vatRateToDelete) {
            void deleteMutation.mutateAsync({ id: vatRateToDelete.id });
          }
        }}
        title={t('vatRates.delete.title')}
        message={t('vatRates.delete.description')}
        confirmText={t('vatRates.delete.title')}
        loading={deleteMutation.isPending}
      />
    </>
  );
}
