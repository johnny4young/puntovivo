import { ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { ResourcePage } from '@/components/resources/ResourcePage';
import type { Product } from '@/types';
import { formatCurrency } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';

const columns = (onDelete: (id: string) => void, canDelete: boolean): ColumnDef<Product>[] => [
  {
    accessorKey: 'sku',
    header: 'SKU',
    size: 100,
  },
  {
    accessorKey: 'name',
    header: 'Name',
    size: 200,
  },
  {
    accessorKey: 'price',
    header: 'Price',
    size: 100,
    cell: ({ row }) => formatCurrency(row.getValue('price')),
  },
  {
    accessorKey: 'cost',
    header: 'Cost',
    size: 100,
    cell: ({ row }) => formatCurrency(row.getValue('cost')),
  },
  {
    accessorKey: 'stock',
    header: 'Stock',
    size: 80,
    cell: ({ row }) => {
      const stock = row.getValue('stock') as number;
      const minStock = row.original.minStock;
      const isLow = stock < minStock;
      return (
        <span className={isLow ? 'text-danger-500 font-medium' : ''}>
          {stock}
          {isLow && ' (Low)'}
        </span>
      );
    },
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

export function ProductsPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();

  const { data, isLoading, error } = trpc.products.list.useQuery({ page: 1, perPage: 50 });

  const deleteMutation = trpc.products.delete.useMutation({
    onSuccess: () => utils.products.list.invalidate(),
  });

  const canDelete = user?.role === 'admin';
  const products = (data?.items ?? []) as Product[];

  return (
    <ResourcePage
      title="Products"
      description="Manage your product catalog"
      action={
        <button className="btn-primary flex items-center gap-2">
          <Plus className="h-5 w-5" />
          Add Product
        </button>
      }
      columns={columns(id => deleteMutation.mutate({ id }), canDelete)}
      data={products}
      isLoading={isLoading}
      error={error?.message ?? null}
      searchKey="name"
      searchPlaceholder="Search products..."
      loadingMessage="Loading products..."
    />
  );
}
