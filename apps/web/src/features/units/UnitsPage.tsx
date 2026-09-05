import { lazy, Suspense, useState } from 'react';
import type { DataTableColumnDef } from '@/components/tables/DataTable';
import { LoaderCircle, Pencil, Plus, Ruler, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConfirmModal, Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { ResourcePage } from '@/components/resources/ResourcePage';
import type { Unit, UserRole } from '@/types';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import type { UnitFormValues } from './unitForm.types';

import { Badge } from '@/components/ui';

const UnitFormModal = lazy(() =>
  import('@/features/units/UnitFormModal').then(module => ({ default: module.UnitFormModal }))
);
function canManageUnits(role: UserRole | undefined): boolean {
  return role === 'admin';
}
export function UnitsPage() {
  const { t } = useTranslation(['settings', 'unitErrors', 'errors']);
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInstanceKey, setModalInstanceKey] = useState(0);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [unitToDelete, setUnitToDelete] = useState<Unit | null>(null);
  const { data, isLoading, error, refetch } = trpc.units.list.useQuery({
    page: 1,
    perPage: 50,
  });
  const createMutation = trpc.units.create.useMutation({
    onSuccess: async () => {
      await utils.units.list.invalidate();
      handleCloseModal();
      toast.success({
        title: t('units.toast.created'),
      });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'settings:units.toast.createError',
    }),
  });
  const updateMutation = trpc.units.update.useMutation({
    onSuccess: async () => {
      await utils.units.list.invalidate();
      handleCloseModal();
      toast.success({
        title: t('units.toast.updated'),
      });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'settings:units.toast.updateError',
    }),
  });
  const deleteMutation = trpc.units.delete.useMutation({
    onSuccess: async () => {
      await utils.units.list.invalidate();
      setUnitToDelete(null);
      toast.success({
        title: t('units.toast.deleted'),
      });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'settings:units.toast.deleteError',
    }),
  });
  const canManage = canManageUnits(user?.role);
  const canDelete = user?.role === 'admin';
  const mutationError = createMutation.error ?? updateMutation.error;
  const localizedMutationError = mutationError
    ? translateServerError(mutationError, t, t('errors:server.unknown'))
    : null;
  const units = (data?.items ?? []).map(unit => ({
    ...unit,
    isActive: unit.isActive ?? false,
  })) as Unit[];
  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingUnit(null);
    createMutation.reset();
    updateMutation.reset();
  };
  const handleOpenCreate = () => {
    setEditingUnit(null);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  };
  const handleOpenEdit = (unit: Unit) => {
    setEditingUnit(unit);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  };
  const handleSubmit = async (values: UnitFormValues) => {
    const trimmedCode = values.standardCode.trim();
    if (editingUnit) {
      await updateMutation.mutateAsync({
        id: editingUnit.id,
        name: values.name,
        abbreviation: values.abbreviation,
        // On edit, '' clears the field (null); a value sets it.
        dimension: values.dimension === '' ? null : values.dimension,
        standardCode: trimmedCode === '' ? null : trimmedCode,
        isActive: values.isActive,
      });
      return;
    }

    // On create, omit blank enrichment fields so the server backfills them
    // from the standards catalog.
    await createMutation.mutateAsync({
      name: values.name,
      abbreviation: values.abbreviation,
      isActive: values.isActive,
      ...(values.dimension !== ''
        ? {
            dimension: values.dimension,
          }
        : {}),
      ...(trimmedCode !== ''
        ? {
            standardCode: trimmedCode,
          }
        : {}),
    });
  };
  const columns: DataTableColumnDef<Unit>[] = [
    {
      accessorKey: 'name',
      header: t('units.columns.unit'),
      size: 220,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary-100 flex items-center justify-center">
            <Ruler className="h-4 w-4 text-primary-700" />
          </div>
          <div>
            <p className="font-medium text-secondary-900">{row.original.name}</p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'abbreviation',
      header: t('units.columns.abbreviation'),
      size: 140,
      cell: ({ row }) => (
        <span className="font-medium text-secondary-900">{row.original.abbreviation}</span>
      ),
    },
    {
      id: 'dimension',
      header: t('units.columns.dimension'),
      size: 160,
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="text-sm text-secondary-700">
            {row.original.dimension ? t(`units.dimensions.${row.original.dimension}`) : '—'}
          </span>
          {row.original.standardCode && (
            <span className="font-mono text-[11px] text-secondary-500">
              {row.original.standardCode}
            </span>
          )}
        </div>
      ),
    },
    {
      accessorKey: 'isActive',
      header: t('units.columns.status'),
      size: 100,
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? 'success' : 'neutral'}>
          {row.original.isActive ? t('units.columns.active') : t('units.columns.inactive')}
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
          {canDelete && (
            <button
              className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
              onClick={() => setUnitToDelete(row.original)}
              aria-label={t('common:actions.delete')}
              title={t('common:actions.delete')}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      ),
    },
  ];
  return (
    <>
      <ResourcePage
        title={t('units.title')}
        action={
          <button
            className="btn-primary flex items-center gap-2"
            onClick={handleOpenCreate}
            disabled={!canManage}
          >
            <Plus className="h-5 w-5" />
            {t('units.add')}
          </button>
        }
        columns={columns}
        data={units}
        isLoading={isLoading}
        error={error?.message ?? null}
        searchKey="name"
        searchPlaceholder={t('units.search')}
        loadingMessage={t('units.loading')}
        onRetry={() => {
          void refetch();
        }}
      />

      {isModalOpen ? (
        <Suspense
          fallback={
            <Modal
              isOpen
              onClose={handleCloseModal}
              title={t('units.form.loadingTitle')}
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
                  {t('units.form.loadingMessage')}
                </p>
              </div>
            </Modal>
          }
        >
          <UnitFormModal
            key={`${editingUnit?.id ?? 'new-unit'}-${modalInstanceKey}`}
            isOpen
            unit={editingUnit}
            isSaving={createMutation.isPending || updateMutation.isPending}
            error={localizedMutationError}
            onClose={handleCloseModal}
            onSubmit={handleSubmit}
          />
        </Suspense>
      ) : null}

      <ConfirmModal
        isOpen={!!unitToDelete}
        onClose={() => setUnitToDelete(null)}
        onConfirm={() => {
          if (unitToDelete) {
            void deleteMutation.mutateAsync({
              id: unitToDelete.id,
            });
          }
        }}
        title={t('units.delete.title')}
        message={t('units.delete.description')}
        confirmText={t('units.delete.title')}
        loading={deleteMutation.isPending}
      />
    </>
  );
}
