import type { ColumnDef } from '@tanstack/react-table';
import { Building2 as Building, MapPinned, Pencil, Trash2 } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { Site } from '@/types';

export function createSiteColumns({
  t,
  canManage,
  onEdit,
  onDelete,
  onManageLocations,
}: {
  t: TFunction;
  canManage: boolean;
  onEdit: (site: Site) => void;
  onDelete: (site: Site) => void;
  onManageLocations: (site: Site) => void;
}): ColumnDef<Site>[] {
  return [
    {
      accessorKey: 'name',
      header: t('sites.columns.site'),
      size: 220,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100">
            <Building className="h-4 w-4 text-primary-700" />
          </div>
          <div>
            <p className="font-medium text-secondary-900">{row.original.name}</p>
            <p className="text-xs text-secondary-500">{row.original.address || t('sites.columns.noAddress')}</p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'phone',
      header: t('sites.columns.phone'),
      size: 180,
      cell: ({ row }) => row.original.phone || '-',
    },
    {
      accessorKey: 'assignedLocationCount',
      header: t('sites.columns.locations'),
      size: 120,
      cell: ({ row }) => row.original.assignedLocationCount ?? 0,
    },
    {
      accessorKey: 'isActive',
      header: t('sites.columns.status'),
      size: 120,
      cell: ({ row }) => (
        <span className={`badge ${row.original.isActive ? 'badge-success' : 'badge-secondary'}`}>
          {row.original.isActive ? t('common:status.active') : t('common:status.inactive')}
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
            onClick={() => onManageLocations(row.original)}
            disabled={!canManage}
            title={t('sites.columns.manageLocations')}
          >
            <MapPinned className="h-4 w-4" />
          </button>
          <button
            className="btn-ghost btn-icon h-8 w-8"
            onClick={() => onEdit(row.original)}
            disabled={!canManage}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
            onClick={() => onDelete(row.original)}
            disabled={!canManage}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];
}
