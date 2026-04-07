import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Mail, Pencil, Plus, Phone, Trash2, Truck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { ConfirmModal, Modal, ModalButton } from '@/components/form-controls/Modal';
import { ResourcePage } from '@/components/resources/ResourcePage';
import type { Provider, UserRole } from '@/types';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';

interface ProviderFormValues {
  name: string;
  contactName: string;
  taxId: string;
  email: string;
  phone: string;
  address: string;
  isActive: boolean;
}

const defaultValues: ProviderFormValues = {
  name: '',
  contactName: '',
  taxId: '',
  email: '',
  phone: '',
  address: '',
  isActive: true,
};

function mapProviderToForm(provider: Provider | null): ProviderFormValues {
  if (!provider) {
    return defaultValues;
  }

  return {
    name: provider.name,
    contactName: provider.contactName ?? '',
    taxId: provider.taxId ?? '',
    email: provider.email ?? '',
    phone: provider.phone ?? '',
    address: provider.address ?? '',
    isActive: provider.isActive,
  };
}

interface ProviderFormModalProps {
  isOpen: boolean;
  provider: Provider | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: ProviderFormValues) => Promise<void>;
}

function ProviderFormModal({
  isOpen,
  provider,
  isSaving,
  error,
  onClose,
  onSubmit,
}: ProviderFormModalProps) {
  const form = useForm<ProviderFormValues>({
    defaultValues: mapProviderToForm(provider),
  });

  const handleSubmit = form.handleSubmit(onSubmit);
  const isCreate = !provider;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isCreate ? 'Create Provider' : 'Edit Provider'}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            Cancel
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving...' : isCreate ? 'Create Provider' : 'Save Changes'}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="provider-name" className="label">
            Provider Name
          </label>
          <input
            id="provider-name"
            className="input mt-1"
            {...form.register('name', { required: 'Provider name is required' })}
          />
          {form.formState.errors.name && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="provider-contact" className="label">
            Contact Name
          </label>
          <input id="provider-contact" className="input mt-1" {...form.register('contactName')} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="provider-tax-id" className="label">
              Tax ID
            </label>
            <input id="provider-tax-id" className="input mt-1" {...form.register('taxId')} />
          </div>

          <div>
            <label htmlFor="provider-phone" className="label">
              Phone
            </label>
            <input id="provider-phone" className="input mt-1" {...form.register('phone')} />
          </div>
        </div>

        <div>
          <label htmlFor="provider-email" className="label">
            Email
          </label>
          <input
            id="provider-email"
            type="email"
            className="input mt-1"
            {...form.register('email', {
              pattern: {
                value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                message: 'Invalid email address',
              },
            })}
          />
          {form.formState.errors.email && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.email.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="provider-address" className="label">
            Address
          </label>
          <textarea
            id="provider-address"
            className="input mt-1 min-h-[88px]"
            {...form.register('address')}
          />
        </div>

        <label className="flex items-center gap-3 text-sm text-secondary-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-secondary-300"
            {...form.register('isActive')}
          />
          Provider is active
        </label>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}

function canManageProviders(role: UserRole | undefined): boolean {
  return role === 'admin';
}

export function ProvidersPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalInstanceKey, setModalInstanceKey] = useState(0);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [providerToDelete, setProviderToDelete] = useState<Provider | null>(null);

  const { data, isLoading, error } = trpc.providers.list.useQuery({ page: 1, perPage: 50 });
  const createMutation = trpc.providers.create.useMutation({
    onSuccess: async () => {
      await utils.providers.list.invalidate();
      handleCloseModal();
    },
  });
  const updateMutation = trpc.providers.update.useMutation({
    onSuccess: async () => {
      await utils.providers.list.invalidate();
      handleCloseModal();
    },
  });
  const deleteMutation = trpc.providers.delete.useMutation({
    onSuccess: async () => {
      await utils.providers.list.invalidate();
      setProviderToDelete(null);
    },
  });

  const canManage = canManageProviders(user?.role);
  const canDelete = user?.role === 'admin';
  const providers = (data?.items ?? []).map(provider => ({
    ...provider,
    isActive: provider.isActive ?? false,
  })) as Provider[];

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingProvider(null);
    createMutation.reset();
    updateMutation.reset();
  };

  const handleOpenCreate = () => {
    setEditingProvider(null);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (provider: Provider) => {
    setEditingProvider(provider);
    setModalInstanceKey(current => current + 1);
    setIsModalOpen(true);
  };

  const handleSubmit = async (values: ProviderFormValues) => {
    if (editingProvider) {
      await updateMutation.mutateAsync({
        id: editingProvider.id,
        name: values.name,
        contactName: values.contactName || null,
        taxId: values.taxId || null,
        email: values.email || null,
        phone: values.phone || null,
        address: values.address || null,
        isActive: values.isActive,
      });
      return;
    }

    await createMutation.mutateAsync({
      name: values.name,
      contactName: values.contactName || undefined,
      taxId: values.taxId || undefined,
      email: values.email || undefined,
      phone: values.phone || undefined,
      address: values.address || undefined,
      isActive: values.isActive,
    });
  };

  const columns: ColumnDef<Provider>[] = [
    {
      accessorKey: 'name',
      header: 'Provider',
      size: 220,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary-100 flex items-center justify-center">
            <Truck className="h-4 w-4 text-primary-700" />
          </div>
          <div>
            <p className="font-medium text-secondary-900">{row.original.name}</p>
            <p className="text-xs text-secondary-500">{row.original.contactName || 'No contact'}</p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'email',
      header: 'Email',
      size: 220,
      cell: ({ row }) => (
        <div className="flex items-center gap-2 text-secondary-600">
          <Mail className="h-4 w-4" />
          {row.original.email || '-'}
        </div>
      ),
    },
    {
      accessorKey: 'phone',
      header: 'Phone',
      size: 160,
      cell: ({ row }) => (
        <div className="flex items-center gap-2 text-secondary-600">
          <Phone className="h-4 w-4" />
          {row.original.phone || '-'}
        </div>
      ),
    },
    {
      accessorKey: 'taxId',
      header: 'Tax ID',
      size: 150,
      cell: ({ row }) => row.original.taxId || '-',
    },
    {
      accessorKey: 'isActive',
      header: 'Status',
      size: 100,
      cell: ({ row }) => (
        <span className={`badge ${row.original.isActive ? 'badge-success' : 'badge-secondary'}`}>
          {row.original.isActive ? 'Active' : 'Inactive'}
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
              onClick={() => setProviderToDelete(row.original)}
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
        title="Providers"
        description="Manage suppliers and vendor contacts"
        action={
          <button
            className="btn-primary flex items-center gap-2"
            onClick={handleOpenCreate}
            disabled={!canManage}
          >
            <Plus className="h-5 w-5" />
            Add Provider
          </button>
        }
        columns={columns}
        data={providers}
        isLoading={isLoading}
        error={error?.message ?? null}
        searchKey="name"
        searchPlaceholder="Search providers..."
        loadingMessage="Loading providers..."
      />

      <ProviderFormModal
        key={`${editingProvider?.id ?? 'new-provider'}-${modalInstanceKey}`}
        isOpen={isModalOpen}
        provider={editingProvider}
        isSaving={createMutation.isPending || updateMutation.isPending}
        error={createMutation.error?.message ?? updateMutation.error?.message ?? null}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
      />

      <ConfirmModal
        isOpen={!!providerToDelete}
        onClose={() => setProviderToDelete(null)}
        onConfirm={() => {
          if (providerToDelete) {
            void deleteMutation.mutateAsync({ id: providerToDelete.id });
          }
        }}
        title="Delete Provider"
        message={`Are you sure you want to delete ${providerToDelete?.name ?? 'this provider'}?`}
        confirmText="Delete Provider"
        loading={deleteMutation.isPending}
      />
    </>
  );
}
