import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Pencil, Plus, Ruler, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { UNIT_DIMENSIONS } from '@puntovivo/shared/units';
import { ConfirmModal, Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { ResourcePage } from '@/components/resources/ResourcePage';
import type { Unit, UnitDimension, UserRole } from '@/types';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { onErrorToast } from '@/lib/mutationHelpers';

// '' = "auto / none" — the server backfills the dimension + standard code
// from the units catalog when the operator leaves it blank on create.
import { Badge } from '@/components/ui';
interface UnitFormValues {
  name: string;
  abbreviation: string;
  dimension: UnitDimension | '';
  standardCode: string;
  isActive: boolean;
}
const defaultValues: UnitFormValues = {
  name: '',
  abbreviation: '',
  dimension: '',
  standardCode: '',
  isActive: true,
};
function mapUnitToForm(unit: Unit | null): UnitFormValues {
  if (!unit) {
    return defaultValues;
  }
  return {
    name: unit.name,
    abbreviation: unit.abbreviation,
    dimension: unit.dimension ?? '',
    standardCode: unit.standardCode ?? '',
    isActive: unit.isActive,
  };
}
interface UnitFormModalProps {
  isOpen: boolean;
  unit: Unit | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: UnitFormValues) => Promise<void>;
}
function UnitFormModal({ isOpen, unit, isSaving, error, onClose, onSubmit }: UnitFormModalProps) {
  const { t } = useTranslation('settings');
  const form = useForm<UnitFormValues>({
    defaultValues: mapUnitToForm(unit),
  });
  const handleSubmit = form.handleSubmit(onSubmit);
  const isCreate = !unit;
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCreate ? t('units.form.createTitle') : t('units.form.editTitle')}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            {t('units.form.cancel')}
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving
              ? t('units.form.submitting')
              : isCreate
                ? t('units.form.create')
                : t('units.form.save')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="unit-name" className="label">
            {t('units.form.name')}
          </label>
          <input
            id="unit-name"
            className="input mt-1"
            {...form.register('name', {
              required: t('units.form.nameRequired'),
            })}
          />
          {form.formState.errors.name && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="unit-abbreviation" className="label">
            {t('units.form.abbreviation')}
          </label>
          <input
            id="unit-abbreviation"
            className="input mt-1"
            {...form.register('abbreviation', {
              required: t('units.form.abbreviationRequired'),
            })}
          />
          {form.formState.errors.abbreviation && (
            <p className="mt-1 text-sm text-danger-500">
              {form.formState.errors.abbreviation.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="unit-dimension" className="label">
            {t('units.form.dimension')}
          </label>
          <select id="unit-dimension" className="input mt-1" {...form.register('dimension')}>
            <option value="">{t('units.form.dimensionAuto')}</option>
            {UNIT_DIMENSIONS.map(dimension => (
              <option key={dimension} value={dimension}>
                {t(`units.dimensions.${dimension}`)}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-secondary-500">{t('units.form.dimensionHint')}</p>
        </div>

        <div>
          <label htmlFor="unit-standard-code" className="label">
            {t('units.form.standardCode')}
          </label>
          <input
            id="unit-standard-code"
            className="input mt-1"
            placeholder={t('units.form.standardCodePlaceholder')}
            {...form.register('standardCode')}
          />
          <p className="mt-1 text-xs text-secondary-500">{t('units.form.standardCodeHint')}</p>
        </div>

        <label className="flex items-center gap-3 text-sm text-secondary-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-secondary-300"
            {...form.register('isActive')}
          />
          {t('units.form.isActive')}
        </label>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
function canManageUnits(role: UserRole | undefined): boolean {
  return role === 'admin';
}
export function UnitsPage() {
  const { t } = useTranslation('settings');
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
  const columns: ColumnDef<Unit>[] = [
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
          >
            <Pencil className="h-4 w-4" />
          </button>
          {canDelete && (
            <button
              className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
              onClick={() => setUnitToDelete(row.original)}
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

      <UnitFormModal
        key={`${editingUnit?.id ?? 'new-unit'}-${modalInstanceKey}`}
        isOpen={isModalOpen}
        unit={editingUnit}
        isSaving={createMutation.isPending || updateMutation.isPending}
        error={createMutation.error?.message ?? updateMutation.error?.message ?? null}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
      />

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
