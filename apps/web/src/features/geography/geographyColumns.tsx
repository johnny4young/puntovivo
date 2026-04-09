import type { ColumnDef } from '@tanstack/react-table';
import { Building2, Flag, MapPinned, Pencil, Trash2 } from 'lucide-react';
import type { City, Country, Department } from '@/types';

export function buildCountryColumns(
  onEdit: (country: Country) => void,
  onDelete: (country: Country) => void,
  canEdit: boolean,
  canDelete: boolean
): ColumnDef<Country>[] {
  return [
    {
      accessorKey: 'name',
      header: 'Country',
      size: 260,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100">
            <Flag className="h-4 w-4 text-primary-700" />
          </div>
          <div>
            <p className="font-medium text-secondary-900">{row.original.name}</p>
            <p className="text-xs text-secondary-500">{row.original.code}</p>
          </div>
        </div>
      ),
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

export function buildDepartmentColumns(
  onEdit: (department: Department) => void,
  onDelete: (department: Department) => void,
  canEdit: boolean,
  canDelete: boolean
): ColumnDef<Department>[] {
  return [
    {
      accessorKey: 'name',
      header: 'Department',
      size: 260,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100">
            <Building2 className="h-4 w-4 text-primary-700" />
          </div>
          <div>
            <p className="font-medium text-secondary-900">{row.original.name}</p>
            <p className="text-xs text-secondary-500">{row.original.code}</p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'countryName',
      header: 'Country',
      size: 200,
      cell: ({ row }) => row.original.countryName ?? '-',
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

export function buildCityColumns(
  onEdit: (city: City) => void,
  onDelete: (city: City) => void,
  canEdit: boolean,
  canDelete: boolean
): ColumnDef<City>[] {
  return [
    {
      accessorKey: 'name',
      header: 'City',
      size: 260,
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
      accessorKey: 'departmentName',
      header: 'Department',
      size: 200,
      cell: ({ row }) => row.original.departmentName ?? '-',
    },
    {
      accessorKey: 'countryName',
      header: 'Country',
      size: 180,
      cell: ({ row }) => row.original.countryName ?? '-',
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
