import type { ColumnDef } from '@tanstack/react-table';
import { Mail, MapPinned, Pencil, Phone, Trash2, Truck } from 'lucide-react';
import type { Provider } from '@/types';

export function buildProviderColumns(
  onEdit: (provider: Provider) => void,
  onDelete: (provider: Provider) => void,
  canEdit: boolean,
  canDelete: boolean
): ColumnDef<Provider>[] {
  return [
    {
      accessorKey: 'name',
      header: 'Provider',
      size: 220,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100">
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
      accessorKey: 'cityName',
      header: 'City',
      size: 220,
      cell: ({ row }) => (
        <div className="flex items-center gap-2 text-secondary-600">
          <MapPinned className="h-4 w-4" />
          {row.original.cityName
            ? `${row.original.cityName}${row.original.departmentName ? `, ${row.original.departmentName}` : ''}${
                row.original.countryName ? `, ${row.original.countryName}` : ''
              }`
            : '-'}
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
          <button className="btn-ghost btn-icon h-8 w-8" onClick={() => onEdit(row.original)} disabled={!canEdit}>
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
}
