import { lazy, Suspense, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { LoaderCircle, MapPinned, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ConfirmModal, Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { ResourcePage } from '@/components/resources/ResourcePage';
import { useAuth } from '@/features/auth/AuthProvider';
import type { LocationFormValues } from '@/features/locations/locationForm.types';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import type { Location, UserRole } from '@/types';
import { Badge } from '@/components/ui';

const LocationFormModal = lazy(() =>
  import('@/features/locations/LocationFormModal').then(module => ({
    default: module.LocationFormModal,
  }))
);

function canManageLocations(role: UserRole | undefined): boolean {
  return role === 'admin';
}
const buildColumns = (
  t: TFunction,
  onEdit: (location: Location) => void,
  onDelete: (location: Location) => void,
  canEdit: boolean,
  canDelete: boolean
): ColumnDef<Location>[] => [
  {
    accessorKey: 'name',
    header: t('columns.location'),
    size: 240,
    cell: ({ row }) => (
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100">
          <MapPinned className="h-4 w-4 text-primary-700" aria-hidden="true" />
        </div>
        <div>
          <p className="font-medium text-secondary-900">{row.original.name}</p>
          <p className="text-xs text-secondary-500">{row.original.code}</p>
        </div>
      </div>
    ),
  },
  {
    accessorKey: 'description',
    header: t('columns.description'),
    size: 320,
    cell: ({ row }) => row.original.description ?? '-',
  },
  {
    accessorKey: 'isActive',
    header: t('columns.status'),
    size: 120,
    cell: ({ row }) => (
      <Badge variant={row.original.isActive ? 'success' : 'neutral'}>
        {row.original.isActive ? t('columns.active') : t('columns.inactive')}
      </Badge>
    ),
  },
  {
    id: 'actions',
    size: 100,
    cell: ({ row }) => (
      <div className="flex items-center gap-1">
        <button
          className="btn-ghost btn-icon h-8 w-8"
          onClick={() => onEdit(row.original)}
          disabled={!canEdit}
          aria-label={t('common:actions.edit')}
          title={t('common:actions.edit')}
        >
          <Pencil className="h-4 w-4" aria-hidden="true" />
        </button>
        {canDelete && (
          <button
            className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
            onClick={() => onDelete(row.original)}
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
export function LocationsPage() {
  const { t } = useTranslation('locations');
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInstanceKey, setModalInstanceKey] = useState(0);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [locationToDelete, setLocationToDelete] = useState<Location | null>(null);
  const locationsQuery = trpc.locations.list.useQuery({
    page: 1,
    perPage: 50,
  });
  const createMutation = trpc.locations.create.useMutation({
    onSuccess: async () => {
      await utils.locations.list.invalidate();
      handleCloseModal();
      toast.success({
        title: t('toast.created'),
      });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'locations:toast.createError',
    }),
  });
  const updateMutation = trpc.locations.update.useMutation({
    onSuccess: async () => {
      await utils.locations.list.invalidate();
      handleCloseModal();
      toast.success({
        title: t('toast.updated'),
      });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'locations:toast.updateError',
    }),
  });
  const deleteMutation = trpc.locations.delete.useMutation({
    onSuccess: async () => {
      await utils.locations.list.invalidate();
      setLocationToDelete(null);
      toast.success({
        title: t('toast.deleted'),
      });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'locations:toast.deleteError',
    }),
  });
  const canManage = canManageLocations(user?.role);
  const canDelete = user?.role === 'admin';
  const items: Location[] = (locationsQuery.data?.items ?? []).map(location => ({
    ...location,
    isActive: location.isActive ?? false,
  }));
  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingLocation(null);
    createMutation.reset();
    updateMutation.reset();
  };
  const handleOpenCreate = () => {
    setEditingLocation(null);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  };
  const handleOpenEdit = (location: Location) => {
    setEditingLocation(location);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  };
  const handleSubmit = async (values: LocationFormValues) => {
    const payload = {
      code: values.code.trim(),
      name: values.name.trim(),
      description: values.description.trim() || null,
      isActive: values.isActive,
    };
    if (editingLocation) {
      await updateMutation.mutateAsync({
        id: editingLocation.id,
        ...payload,
      });
      return;
    }
    await createMutation.mutateAsync(payload);
  };
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
        columns={buildColumns(t, handleOpenEdit, setLocationToDelete, canManage, canDelete)}
        data={items}
        isLoading={locationsQuery.isLoading}
        error={locationsQuery.error?.message ?? null}
        searchKey="name"
        searchPlaceholder={t('search')}
        loadingMessage={t('loading')}
        onRetry={() => {
          void locationsQuery.refetch();
        }}
      />

      {!canManage && (
        <div className="mt-6 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          {t('permissionNote')}
        </div>
      )}

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
          <LocationFormModal
            key={`${editingLocation?.id ?? 'new-location'}-${modalInstanceKey}`}
            isOpen
            location={editingLocation}
            isSaving={createMutation.isPending || updateMutation.isPending}
            error={createMutation.error?.message ?? updateMutation.error?.message ?? null}
            onClose={handleCloseModal}
            onSubmit={handleSubmit}
          />
        </Suspense>
      ) : null}

      <ConfirmModal
        isOpen={!!locationToDelete}
        title={t('delete.title')}
        message={locationToDelete ? t('delete.description') : ''}
        confirmText={
          deleteMutation.isPending
            ? t('delete.submitting')
            : t('delete.confirm')
        }
        cancelText={t('common:actions.cancel')}
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (locationToDelete) {
            void deleteMutation.mutateAsync({
              id: locationToDelete.id,
            });
          }
        }}
        onClose={() => {
          if (!deleteMutation.isPending) {
            setLocationToDelete(null);
          }
        }}
      />
    </>
  );
}
