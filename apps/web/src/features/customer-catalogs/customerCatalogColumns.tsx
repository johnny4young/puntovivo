import type { ColumnDef } from '@tanstack/react-table';
import { Pencil, Trash2 } from 'lucide-react';
import type { CustomerCatalogItem } from '@/types';

export function buildCustomerCatalogColumns(
  onEdit: (item: CustomerCatalogItem) => void,
  onDelete: (item: CustomerCatalogItem) => void
): ColumnDef<CustomerCatalogItem>[] {
  return [
    {
      accessorKey: 'name',
      header: 'Name',
      size: 280,
      cell: ({ row }) => (
        <div>
          <p className="font-medium text-secondary-900">{row.original.name}</p>
          <p className="text-xs text-secondary-500">{row.original.code}</p>
        </div>
      ),
    },
    {
      accessorKey: 'description',
      header: 'Description',
      size: 360,
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
      size: 96,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button className="btn-ghost btn-icon h-8 w-8" onClick={() => onEdit(row.original)}>
            <Pencil className="h-4 w-4" />
          </button>
          <button
            className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
            onClick={() => onDelete(row.original)}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];
}
