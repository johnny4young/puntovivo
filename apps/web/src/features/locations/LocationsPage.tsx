import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { MapPinned, Pencil, Plus, Trash2 } from 'lucide-react';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { ResourcePage } from '@/components/resources/ResourcePage';
import { useAuth } from '@/features/auth/AuthProvider';
import { LocationFormModal, type LocationFormValues } from '@/features/locations/LocationFormModal';
import { getErrorMessage } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import type { Location, UserRole } from '@/types';

function canManageLocations(role: UserRole | undefined): boolean {
  return role === 'admin';
}

const columns = (
  onEdit: (location: Location) => void,
  onDelete: (location: Location) => void,
  canEdit: boolean,
  canDelete: boolean
): ColumnDef<Location>[] => [
  {
    accessorKey: 'name',
    header: 'Location',
    size: 240,
    cell: ({ row }) => (
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100">
          <MapPinned className="h-4 w-4 text-primary-700" />
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
    header: 'Description',
    size: 320,
    cell: ({ row }) => row.original.description ?? '-',
  },
  {
    accessorKey: 'isActive',
    header: 'Status',
    size: 120,
    cell: ({ row }) => (
      <span className={`badge ${row.original.isActive ? 'badge-success' : 'badge-secondary'}`}>
        {row.original.isActive ? 'Active' : 'Inactive'}
      </span>
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
        >
          <Pencil className="h-4 w-4" />
        </button>
        {canDelete && (
          <button
            className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
            onClick={() => onDelete(row.original)}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    ),
  },
];

export function LocationsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInstanceKey, setModalInstanceKey] = useState(0);
  const [editingLocation, setEditingLocation] = useState<Location | null>(null);
  const [locationToDelete, setLocationToDelete] = useState<Location | null>(null);

  const locationsQuery = trpc.locations.list.useQuery({ page: 1, perPage: 50 });
  const createMutation = trpc.locations.create.useMutation({
    onSuccess: async () => {
      await utils.locations.list.invalidate();
      handleCloseModal();
      toast.success({ title: 'Location created' });
    },
    onError: error => {
      toast.error({
        title: 'Unable to create location',
        description: getErrorMessage(error, 'Unable to create location'),
      });
    },
  });
  const updateMutation = trpc.locations.update.useMutation({
    onSuccess: async () => {
      await utils.locations.list.invalidate();
      handleCloseModal();
      toast.success({ title: 'Location updated' });
    },
    onError: error => {
      toast.error({
        title: 'Unable to update location',
        description: getErrorMessage(error, 'Unable to update location'),
      });
    },
  });
  const deleteMutation = trpc.locations.delete.useMutation({
    onSuccess: async () => {
      await utils.locations.list.invalidate();
      setLocationToDelete(null);
      toast.success({ title: 'Location deleted' });
    },
    onError: error => {
      toast.error({
        title: 'Unable to delete location',
        description: getErrorMessage(error, 'Unable to delete location'),
      });
    },
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
        title="Locations"
        description="Manage warehouse and shelf locations used by the product catalog."
        action={
          <button className="btn-primary flex items-center gap-2" onClick={handleOpenCreate} disabled={!canManage}>
            <Plus className="h-5 w-5" />
            Add Location
          </button>
        }
        columns={columns(handleOpenEdit, setLocationToDelete, canManage, canDelete)}
        data={items}
        isLoading={locationsQuery.isLoading}
        error={locationsQuery.error?.message ?? null}
        searchKey="name"
        searchPlaceholder="Search locations..."
        loadingMessage="Loading locations..."
        onRetry={() => {
          void locationsQuery.refetch();
        }}
      />

      {!canManage && (
        <div className="mt-6 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          Only administrators can modify locations. You can still review the catalog.
        </div>
      )}

      <LocationFormModal
        key={`${editingLocation?.id ?? 'new-location'}-${modalInstanceKey}`}
        isOpen={isModalOpen}
        location={editingLocation}
        isSaving={createMutation.isPending || updateMutation.isPending}
        error={createMutation.error?.message ?? updateMutation.error?.message ?? null}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
      />

      <ConfirmModal
        isOpen={!!locationToDelete}
        title="Delete Location"
        message={
          locationToDelete
            ? `Delete ${locationToDelete.name}? Products assigned to this location must be moved first.`
            : ''
        }
        confirmText={deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        cancelText="Cancel"
        variant="danger"
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (locationToDelete) {
            void deleteMutation.mutateAsync({ id: locationToDelete.id });
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
