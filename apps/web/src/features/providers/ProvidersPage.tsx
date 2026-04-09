import { useState } from 'react';
import { Plus } from 'lucide-react';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { ResourcePage } from '@/components/resources/ResourcePage';
import { useAuth } from '@/features/auth/AuthProvider';
import {
  ProviderFormModal,
  type ProviderFormValues,
} from '@/features/providers/ProviderFormModal';
import { buildProviderColumns } from '@/features/providers/providerColumns';
import { trpc } from '@/lib/trpc';
import { getErrorMessage } from '@/lib/utils';
import type { City, Provider, UserRole } from '@/types';

function canManageProviders(role: UserRole | undefined): boolean {
  return role === 'admin';
}

export function ProvidersPage() {
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInstanceKey, setModalInstanceKey] = useState(0);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [providerToDelete, setProviderToDelete] = useState<Provider | null>(null);

  const providersQuery = trpc.providers.list.useQuery({ page: 1, perPage: 50 });
  const citiesQuery = trpc.cities.list.useQuery({ page: 1, perPage: 200 });
  const createMutation = trpc.providers.create.useMutation({
    onSuccess: async () => {
      await utils.providers.list.invalidate();
      handleCloseModal();
      toast.success({ title: 'Provider created' });
    },
    onError: error => {
      toast.error({
        title: 'Unable to create provider',
        description: getErrorMessage(error, 'Unable to create provider'),
      });
    },
  });
  const updateMutation = trpc.providers.update.useMutation({
    onSuccess: async () => {
      await utils.providers.list.invalidate();
      handleCloseModal();
      toast.success({ title: 'Provider updated' });
    },
    onError: error => {
      toast.error({
        title: 'Unable to update provider',
        description: getErrorMessage(error, 'Unable to update provider'),
      });
    },
  });
  const deleteMutation = trpc.providers.delete.useMutation({
    onSuccess: async () => {
      await utils.providers.list.invalidate();
      setProviderToDelete(null);
      toast.success({ title: 'Provider deleted' });
    },
    onError: error => {
      toast.error({
        title: 'Unable to delete provider',
        description: getErrorMessage(error, 'Unable to delete provider'),
      });
    },
  });

  const canManage = canManageProviders(user?.role);
  const canDelete = user?.role === 'admin';
  const providers = (providersQuery.data?.items ?? []).map(provider => ({
    ...provider,
    isActive: provider.isActive ?? false,
  })) as Provider[];
  const cities = (citiesQuery.data?.items ?? []).map(city => ({
    ...city,
    isActive: city.isActive ?? false,
  })) as City[];

  function handleCloseModal() {
    setIsModalOpen(false);
    setEditingProvider(null);
    createMutation.reset();
    updateMutation.reset();
  }

  function handleOpenCreate() {
    setEditingProvider(null);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  }

  function handleOpenEdit(provider: Provider) {
    setEditingProvider(provider);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  }

  async function handleSubmit(values: ProviderFormValues) {
    const payload = {
      name: values.name.trim(),
      contactName: values.contactName.trim() || null,
      taxId: values.taxId.trim() || null,
      email: values.email.trim() || null,
      phone: values.phone.trim() || null,
      address: values.address.trim() || null,
      cityId: values.cityId || null,
      isActive: values.isActive,
    };

    if (editingProvider) {
      await updateMutation.mutateAsync({
        id: editingProvider.id,
        ...payload,
      });
      return;
    }

    await createMutation.mutateAsync({
      ...payload,
      contactName: payload.contactName ?? undefined,
      taxId: payload.taxId ?? undefined,
      email: payload.email ?? undefined,
      phone: payload.phone ?? undefined,
      address: payload.address ?? undefined,
      cityId: payload.cityId ?? undefined,
    });
  }

  return (
    <>
      <ResourcePage
        title="Providers"
        description="Manage suppliers, vendor contacts, and normalized city assignments."
        action={
          <button className="btn-primary flex items-center gap-2" onClick={handleOpenCreate} disabled={!canManage}>
            <Plus className="h-5 w-5" />
            Add Provider
          </button>
        }
        columns={buildProviderColumns(handleOpenEdit, setProviderToDelete, canManage, canDelete)}
        data={providers}
        isLoading={providersQuery.isLoading}
        error={providersQuery.error?.message ?? null}
        searchKey="name"
        searchPlaceholder="Search providers..."
        loadingMessage="Loading providers..."
        onRetry={() => {
          void providersQuery.refetch();
        }}
      />

      <ProviderFormModal
        key={`${editingProvider?.id ?? 'new-provider'}-${modalInstanceKey}`}
        isOpen={isModalOpen}
        provider={editingProvider}
        cities={cities}
        isSaving={createMutation.isPending || updateMutation.isPending}
        error={createMutation.error?.message ?? updateMutation.error?.message ?? null}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
      />

      <ConfirmModal
        isOpen={!!providerToDelete}
        title="Delete Provider"
        message={`Are you sure you want to delete ${providerToDelete?.name ?? 'this provider'}?`}
        confirmText={deleteMutation.isPending ? 'Deleting...' : 'Delete Provider'}
        cancelText="Cancel"
        loading={deleteMutation.isPending}
        variant="danger"
        onConfirm={() => {
          if (providerToDelete) {
            void deleteMutation.mutateAsync({ id: providerToDelete.id });
          }
        }}
        onClose={() => {
          if (!deleteMutation.isPending) {
            setProviderToDelete(null);
          }
        }}
      />
    </>
  );
}
