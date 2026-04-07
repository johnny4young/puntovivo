import { ColumnDef } from '@tanstack/react-table';
import { Pencil, Plus, Ruler, Trash2 } from 'lucide-react';
import { ResourcePage } from '@/components/resources/ResourcePage';
import type { Unit } from '@/types';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';

const columns = (onDelete: (id: string) => void, canDelete: boolean): ColumnDef<Unit>[] => [
  {
    accessorKey: 'name',
    header: 'Unit',
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
    header: 'Abbreviation',
    size: 140,
    cell: ({ row }) => <span className="font-medium text-secondary-900">{row.original.abbreviation}</span>,
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
          onClick={() => console.log('Edit unit', row.original)}
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

export function UnitsPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const { data, isLoading, error } = trpc.units.list.useQuery({ page: 1, perPage: 50 });
  const deleteMutation = trpc.units.delete.useMutation({
    onSuccess: () => utils.units.list.invalidate(),
  });

  const canDelete = user?.role === 'admin';
  const units = (data?.items ?? []).map(unit => ({
    ...unit,
    isActive: unit.isActive ?? false,
  })) as Unit[];

  return (
    <ResourcePage
      title="Units"
      description="Manage measurement units used by products and sales"
      action={
        <button className="btn-primary flex items-center gap-2">
          <Plus className="h-5 w-5" />
          Add Unit
        </button>
      }
      columns={columns(id => deleteMutation.mutate({ id }), canDelete)}
      data={units}
      isLoading={isLoading}
      error={error?.message ?? null}
      searchKey="name"
      searchPlaceholder="Search units..."
      loadingMessage="Loading units..."
    />
  );
}
