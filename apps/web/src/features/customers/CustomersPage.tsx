import { ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil, Trash2, Mail, Phone } from 'lucide-react';
import { DataTable } from '@/components/tables/DataTable';
import type { Customer } from '@/types';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';

const columns = (onDelete: (id: string) => void, canDelete: boolean): ColumnDef<Customer>[] => [
  {
    accessorKey: 'name',
    header: 'Name',
    size: 180,
    cell: ({ row }) => (
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-primary-100 flex items-center justify-center">
          <span className="text-sm font-medium text-primary-700">
            {row.original.name.charAt(0)}
          </span>
        </div>
        <div>
          <p className="font-medium text-secondary-900">{row.getValue('name')}</p>
        </div>
      </div>
    ),
  },
  {
    accessorKey: 'email',
    header: 'Email',
    size: 200,
    cell: ({ row }) => (
      <div className="flex items-center gap-2 text-secondary-600">
        <Mail className="h-4 w-4" />
        {row.getValue('email')}
      </div>
    ),
  },
  {
    accessorKey: 'phone',
    header: 'Phone',
    size: 150,
    cell: ({ row }) => (
      <div className="flex items-center gap-2 text-secondary-600">
        <Phone className="h-4 w-4" />
        {row.getValue('phone') || '-'}
      </div>
    ),
  },
  {
    accessorKey: 'city',
    header: 'Location',
    size: 150,
    cell: ({ row }) => (
      <span className="text-secondary-600">
        {row.original.city}, {row.original.state}
      </span>
    ),
  },
  {
    accessorKey: 'isActive',
    header: 'Status',
    size: 100,
    cell: ({ row }) => (
      <span className={`badge ${row.getValue('isActive') ? 'badge-success' : 'badge-secondary'}`}>
        {row.getValue('isActive') ? 'Active' : 'Inactive'}
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
          onClick={() => console.log('Edit', row.original)}
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

export function CustomersPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const { data, isLoading, error } = trpc.customers.list.useQuery({ page: 1, perPage: 50 });

  const deleteMutation = trpc.customers.delete.useMutation({
    onSuccess: () => utils.customers.list.invalidate(),
  });

  const canDelete = user?.role === 'admin';
  const customers = (data?.items ?? []) as Customer[];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Customers</h1>
          <p className="mt-1 text-sm text-secondary-500">Manage your customer database</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <Plus className="h-5 w-5" />
          Add Customer
        </button>
      </div>

      {/* Customers Table */}
      <div className="card p-6">
        {isLoading && <p className="text-secondary-500 py-4">Loading customers...</p>}
        {error && <p className="text-danger-500 py-4">{error.message}</p>}
        {!isLoading && !error && (
          <DataTable
            columns={columns(id => deleteMutation.mutate({ id }), canDelete)}
            data={customers}
            searchKey="name"
            searchPlaceholder="Search customers..."
            enableRowSelection
            pageSize={10}
          />
        )}
      </div>
    </div>
  );
}
