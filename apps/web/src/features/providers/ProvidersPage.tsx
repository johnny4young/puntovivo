import { ColumnDef } from '@tanstack/react-table';
import { Mail, Pencil, Plus, Phone, Trash2, Truck } from 'lucide-react';
import { ResourcePage } from '@/components/resources/ResourcePage';
import type { Provider } from '@/types';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';

const columns = (onDelete: (id: string) => void, canDelete: boolean): ColumnDef<Provider>[] => [
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
          onClick={() => console.log('Edit provider', row.original)}
        >
          <Pencil className="h-4 w-4" />
        </button>
        {canDelete && (
          <button
            className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
            onClick={() => onDelete(row.original.id)}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    ),
  },
];

export function ProvidersPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const { data, isLoading, error } = trpc.providers.list.useQuery({ page: 1, perPage: 50 });
  const deleteMutation = trpc.providers.delete.useMutation({
    onSuccess: () => utils.providers.list.invalidate(),
  });

  const canDelete = user?.role === 'admin';
  const providers = (data?.items ?? []).map(provider => ({
    ...provider,
    isActive: provider.isActive ?? false,
  })) as Provider[];

  return (
    <ResourcePage
      title="Providers"
      description="Manage suppliers and vendor contacts"
      action={
        <button className="btn-primary flex items-center gap-2">
          <Plus className="h-5 w-5" />
          Add Provider
        </button>
      }
      columns={columns(id => deleteMutation.mutate({ id }), canDelete)}
      data={providers}
      isLoading={isLoading}
      error={error?.message ?? null}
      searchKey="name"
      searchPlaceholder="Search providers..."
      loadingMessage="Loading providers..."
    />
  );
}
