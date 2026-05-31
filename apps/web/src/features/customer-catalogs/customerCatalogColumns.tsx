import type { ColumnDef } from '@tanstack/react-table';
import { Pencil, Tag, Trash2 } from 'lucide-react';
import i18next from 'i18next';
import type { CustomerCatalogItem } from '@/types';

export function buildCustomerCatalogColumns(
  onEdit: (item: CustomerCatalogItem) => void,
  onDelete: (item: CustomerCatalogItem) => void
): ColumnDef<CustomerCatalogItem>[] {
  return [
    {
      accessorKey: 'name',
      header: () => i18next.t('customers:table.name'),
      size: 280,
      // Rediseño FASE 3/7 — celda ancla (.pv-table .prod/.pic/.pname/.sku):
      // glifo tonal + nombre fuerte + código mono legible debajo.
      cell: ({ row }) => (
        <div className="prod">
          <span className="pic">
            <Tag className="h-4 w-4" />
          </span>
          <div>
            <p className="pname">{row.original.name}</p>
            <p className="sku">{row.original.code}</p>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'description',
      header: () => i18next.t('customers:table.description'),
      size: 360,
      cell: ({ row }) => row.original.description ?? '-',
    },
    {
      accessorKey: 'isActive',
      header: () => i18next.t('customers:table.status'),
      size: 120,
      cell: ({ row }) => (
        <span className={`pv-badge ${row.original.isActive ? 'success' : 'neutral'}`}>
          {row.original.isActive ? i18next.t('customers:table.active') : i18next.t('customers:table.inactive')}
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
