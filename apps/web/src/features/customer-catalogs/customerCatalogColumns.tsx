import type { TFunction } from 'i18next';
import type { ColumnDef } from '@tanstack/react-table';
import { Pencil, Tag, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui';
import type { CustomerCatalogItem } from '@/types';
import type { CustomerCatalogKey } from './customerCatalogConfig';
import { resolveCustomerCatalogDisplayName } from './customerCatalogDisplayName';

interface CustomerCatalogColumnOptions {
  t: TFunction<'customerCatalogs'>;
  catalog: CustomerCatalogKey;
  canManage: boolean;
  onEdit: (item: CustomerCatalogItem) => void;
  onDelete: (item: CustomerCatalogItem) => void;
}

export function buildCustomerCatalogColumns({
  t,
  catalog,
  canManage,
  onEdit,
  onDelete,
}: CustomerCatalogColumnOptions): ColumnDef<CustomerCatalogItem>[] {
  const columns: ColumnDef<CustomerCatalogItem>[] = [
    {
      id: 'name',
      accessorFn: item =>
        `${resolveCustomerCatalogDisplayName(t, catalog, item)} ${item.code}`,
      header: t('columns.name'),
      size: 280,
      cell: ({ row }) => (
        <div className="prod">
          <span className="pic">
            <Tag className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="pname">{resolveCustomerCatalogDisplayName(t, catalog, row.original)}</p>
            <p className="sku">{row.original.code}</p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'description',
      header: t('columns.description'),
      size: 360,
      cell: ({ row }) => row.original.description || t('columns.noDescription'),
    },
    {
      accessorKey: 'isActive',
      header: t('columns.status'),
      size: 120,
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? 'success' : 'neutral'}>
          {row.original.isActive ? t('columns.active') : t('columns.inactive')}
        </Badge>
      ),
    },
  ];

  if (canManage) {
    columns.push({
      id: 'actions',
      size: 96,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="btn-ghost btn-icon h-8 w-8"
            onClick={() => onEdit(row.original)}
            aria-label={t('common:actions.edit')}
            title={t('common:actions.edit')}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
            onClick={() => onDelete(row.original)}
            aria-label={t('common:actions.delete')}
            title={t('common:actions.delete')}
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ),
    });
  }

  return columns;
}
