import { ColumnDef } from '@tanstack/react-table';
import { BadgePercent, Pencil, Plus, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/tables/DataTable';
import type { VatRate } from '@/types';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';

const columns = (onDelete: (id: string) => void, canDelete: boolean): ColumnDef<VatRate>[] => [
  {
    accessorKey: 'name',
    header: 'VAT Rate',
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
    header: 'Rate',
    size: 120,
    cell: ({ row }) => <span className="font-medium text-secondary-900">{row.original.rate}%</span>,
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
          onClick={() => console.log('Edit VAT rate', row.original)}
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

export function VatRatesPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const { data, isLoading, error } = trpc.vatRates.list.useQuery({ page: 1, perPage: 50 });
  const deleteMutation = trpc.vatRates.delete.useMutation({
    onSuccess: () => utils.vatRates.list.invalidate(),
  });

  const canDelete = user?.role === 'admin';
  const vatRates = (data?.items ?? []).map(vatRate => ({
    ...vatRate,
    isActive: vatRate.isActive ?? false,
  })) as VatRate[];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">VAT Rates</h1>
          <p className="mt-1 text-sm text-secondary-500">
            Manage tax percentages used by products and sales
          </p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <Plus className="h-5 w-5" />
          Add VAT Rate
        </button>
      </div>

      <div className="card p-6">
        {isLoading && <p className="text-secondary-500 py-4">Loading VAT rates...</p>}
        {error && <p className="text-danger-500 py-4">{error.message}</p>}
        {!isLoading && !error && (
          <DataTable
            columns={columns(id => deleteMutation.mutate({ id }), canDelete)}
            data={vatRates}
            searchKey="name"
            searchPlaceholder="Search VAT rates..."
            enableRowSelection
            pageSize={10}
          />
        )}
      </div>
    </div>
  );
}
