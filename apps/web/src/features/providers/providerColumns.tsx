import type { ColumnDef } from '@tanstack/react-table';
import { FolderTree, Mail, MapPinned, Pencil, Phone, Trash2, Truck } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { Provider } from '@/types';
import { Badge } from '@/components/ui';
export function createProviderColumns({
  t,
  canManage,
  canDelete,
  onEdit,
  onDelete,
  onManageCategories,
}: {
  t: TFunction;
  canManage: boolean;
  canDelete: boolean;
  onEdit: (provider: Provider) => void;
  onDelete: (provider: Provider) => void;
  onManageCategories: (provider: Provider) => void;
}): ColumnDef<Provider>[] {
  return [
    {
      accessorKey: 'name',
      header: t('providers.columns.name'),
      size: 220,
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-100">
            <Truck className="h-4 w-4 text-primary-700" />
          </div>
          <div>
            <p className="font-medium text-secondary-900">{row.original.name}</p>
            <p className="text-xs text-secondary-500">
              {row.original.contactName || t('providers.columns.noContact')}
            </p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'email',
      header: t('providers.columns.email'),
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
      header: t('providers.columns.phone'),
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
      header: t('providers.columns.city'),
      size: 220,
      cell: ({ row }) => (
        <div className="flex items-center gap-2 text-secondary-600">
          <MapPinned className="h-4 w-4" />
          {row.original.cityName
            ? `${row.original.cityName}${row.original.departmentName ? `, ${row.original.departmentName}` : ''}${row.original.countryName ? `, ${row.original.countryName}` : ''}`
            : '-'}
        </div>
      ),
    },
    {
      accessorKey: 'assignedCategoryCount',
      header: t('providers.columns.categories'),
      size: 120,
      cell: ({ row }) => row.original.assignedCategoryCount ?? 0,
    },
    {
      accessorKey: 'taxId',
      header: t('providers.columns.taxId'),
      size: 150,
      cell: ({ row }) => row.original.taxId || '-',
    },
    {
      accessorKey: 'isActive',
      header: t('providers.columns.status'),
      size: 100,
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? 'success' : 'neutral'}>
          {row.original.isActive ? t('common:status.active') : t('common:status.inactive')}
        </Badge>
      ),
    },
    {
      id: 'actions',
      size: 120,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button
            className="btn-ghost btn-icon h-8 w-8"
            onClick={() => onManageCategories(row.original)}
            disabled={!canManage}
            title={t('providers.columns.manageCategories')}
          >
            <FolderTree className="h-4 w-4" />
          </button>
          <button
            className="btn-ghost btn-icon h-8 w-8"
            onClick={() => onEdit(row.original)}
            disabled={!canManage}
          >
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
