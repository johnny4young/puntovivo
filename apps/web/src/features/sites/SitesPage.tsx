import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Building2 as Building, Pencil, Plus, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { ConfirmModal, Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { DataTable } from '@/components/tables/DataTable';
import { TableErrorState } from '@/components/tables/TableErrorState';
import { TableLoadingState } from '@/components/tables/TableLoadingState';
import type { Company, Site, UserRole } from '@/types';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { getErrorMessage } from '@/lib/utils';

interface SiteFormValues {
  name: string;
  address: string;
  phone: string;
  isActive: boolean;
}

const defaultValues: SiteFormValues = {
  name: '',
  address: '',
  phone: '',
  isActive: true,
};

function mapSiteToForm(site: Site | null): SiteFormValues {
  if (!site) {
    return defaultValues;
  }

  return {
    name: site.name,
    address: site.address ?? '',
    phone: site.phone ?? '',
    isActive: site.isActive,
  };
}

interface SiteFormModalProps {
  company: Company | null;
  isOpen: boolean;
  site: Site | null;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: SiteFormValues) => Promise<void>;
}

function SiteFormModal({
  company,
  isOpen,
  site,
  isSaving,
  error,
  onClose,
  onSubmit,
}: SiteFormModalProps) {
  const form = useForm<SiteFormValues>({
    defaultValues: mapSiteToForm(site),
  });

  const handleSubmit = form.handleSubmit(onSubmit);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={site ? 'Edit Site' : 'Create Site'}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            Cancel
          </ModalButton>
          <ModalButton
            variant="primary"
            type="submit"
            onClick={handleSubmit}
            disabled={isSaving || !company}
          >
            {isSaving ? 'Saving...' : site ? 'Save Changes' : 'Create Site'}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="site-name" className="label">
            Site Name
          </label>
          <input
            id="site-name"
            className="input mt-1"
            {...form.register('name', { required: 'Site name is required' })}
          />
          {form.formState.errors.name && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.name.message}</p>
          )}
        </div>
        <div>
          <label htmlFor="site-address" className="label">
            Address
          </label>
          <textarea id="site-address" className="input mt-1 min-h-[88px]" {...form.register('address')} />
        </div>
        <div>
          <label htmlFor="site-phone" className="label">
            Phone
          </label>
          <input id="site-phone" className="input mt-1" {...form.register('phone')} />
        </div>
        <label className="flex items-center gap-3 text-sm text-secondary-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-secondary-300"
            {...form.register('isActive')}
          />
          Site is active
        </label>
        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}

function canManageSites(role: UserRole | undefined): boolean {
  return role === 'admin';
}

export function SitesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const companyQuery = trpc.companies.getCurrent.useQuery();
  const sitesQuery = trpc.sites.list.useQuery({ includeInactive: true });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [siteToDelete, setSiteToDelete] = useState<Site | null>(null);

  const company = companyQuery.data ?? null;
  const sites = (sitesQuery.data?.items ?? []).map(site => ({
    ...site,
    isActive: !!site.isActive,
  }));
  const canManage = canManageSites(user?.role);

  const createMutation = trpc.sites.create.useMutation({
    onSuccess: async () => {
      await utils.sites.list.invalidate();
      handleCloseModal();
      toast.success({ title: 'Site created' });
    },
    onError: error => {
      toast.error({
        title: 'Unable to create site',
        description: getErrorMessage(error, 'Unable to create site'),
      });
    },
  });

  const updateMutation = trpc.sites.update.useMutation({
    onSuccess: async () => {
      await utils.sites.list.invalidate();
      handleCloseModal();
      toast.success({ title: 'Site updated' });
    },
    onError: error => {
      toast.error({
        title: 'Unable to update site',
        description: getErrorMessage(error, 'Unable to update site'),
      });
    },
  });

  const deleteMutation = trpc.sites.delete.useMutation({
    onSuccess: async () => {
      await utils.sites.list.invalidate();
      setSiteToDelete(null);
      toast.success({ title: 'Site deleted' });
    },
    onError: error => {
      toast.error({
        title: 'Unable to delete site',
        description: getErrorMessage(error, 'Unable to delete site'),
      });
    },
  });

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setEditingSite(null);
  };

  const handleOpenCreate = () => {
    setEditingSite(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (site: Site) => {
    setEditingSite(site);
    setIsModalOpen(true);
  };

  const onSubmit = async (values: SiteFormValues) => {
    if (!company) {
      return;
    }

    if (editingSite) {
      await updateMutation.mutateAsync({
        id: editingSite.id,
        companyId: company.id,
        name: values.name,
        address: values.address || null,
        phone: values.phone || null,
        isActive: values.isActive,
      });
      return;
    }

    await createMutation.mutateAsync({
      companyId: company.id,
      name: values.name,
      address: values.address || null,
      phone: values.phone || null,
      isActive: values.isActive,
    });
  };

  const columns: ColumnDef<Site>[] = [
    {
      accessorKey: 'name',
      header: 'Site',
      size: 220,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100">
            <Building className="h-4 w-4 text-primary-700" />
          </div>
          <div>
            <p className="font-medium text-secondary-900">{row.original.name}</p>
            <p className="text-xs text-secondary-500">{row.original.address || 'No address'}</p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'phone',
      header: 'Phone',
      size: 180,
      cell: ({ row }) => row.original.phone || '-',
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
      size: 90,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button
            className="btn-ghost btn-icon h-8 w-8"
            onClick={() => handleOpenEdit(row.original)}
            disabled={!canManage}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
            onClick={() => setSiteToDelete(row.original)}
            disabled={!canManage}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Sites</h1>
          <p className="mt-1 text-sm text-secondary-500">
            Manage physical locations tied to the current company.
          </p>
        </div>
        <button
          className="btn-primary flex items-center gap-2"
          onClick={handleOpenCreate}
          disabled={!company || !canManage}
        >
          <Plus className="h-5 w-5" />
          Add Site
        </button>
      </div>

      {!companyQuery.isLoading && !company && (
        <div className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700">
          Create the company profile first before adding sites.
        </div>
      )}

      <div className="card p-6">
        {sitesQuery.isLoading && <TableLoadingState message="Loading sites..." />}
        {sitesQuery.error && (
          <TableErrorState
            title="Unable to load sites"
            message={sitesQuery.error.message}
            onRetry={() => {
              void sitesQuery.refetch();
            }}
          />
        )}
        {!sitesQuery.isLoading && !sitesQuery.error && (
          <DataTable
            columns={columns}
            data={sites}
            searchKey="name"
            searchPlaceholder="Search sites..."
            pageSize={10}
          />
        )}
      </div>

      <SiteFormModal
        key={editingSite?.id ?? 'new-site'}
        company={company}
        isOpen={isModalOpen}
        site={editingSite}
        isSaving={createMutation.isPending || updateMutation.isPending}
        error={createMutation.error?.message ?? updateMutation.error?.message ?? null}
        onClose={handleCloseModal}
        onSubmit={onSubmit}
      />

      <ConfirmModal
        isOpen={!!siteToDelete}
        onClose={() => setSiteToDelete(null)}
        onConfirm={() => {
          if (siteToDelete) {
            void deleteMutation.mutateAsync({ id: siteToDelete.id });
          }
        }}
        title="Delete Site"
        message={
          siteToDelete
            ? `Delete "${siteToDelete.name}"? Sites with sequentials cannot be deleted and should be deactivated instead.`
            : ''
        }
        confirmText={deleteMutation.isPending ? 'Deleting...' : 'Delete'}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
