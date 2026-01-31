import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Plus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/tables/DataTable';
import type { Product } from '@/types';
import { formatCurrency } from '@/lib/utils';

// Sample data - in real app, this would come from API
const sampleProducts: Product[] = [
  {
    id: '1',
    tenantId: '1',
    name: 'Wireless Mouse',
    sku: 'WM-001',
    description: 'Ergonomic wireless mouse',
    categoryId: '1',
    price: 29.99,
    cost: 15.0,
    taxRate: 0.07,
    stock: 150,
    minStock: 20,
    isActive: true,
    barcode: '1234567890',
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-15T10:30:00Z',
  },
  {
    id: '2',
    tenantId: '1',
    name: 'Mechanical Keyboard',
    sku: 'MK-001',
    description: 'RGB mechanical keyboard',
    categoryId: '1',
    price: 89.99,
    cost: 45.0,
    taxRate: 0.07,
    stock: 75,
    minStock: 10,
    isActive: true,
    barcode: '1234567891',
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-15T10:30:00Z',
  },
  {
    id: '3',
    tenantId: '1',
    name: 'USB-C Hub',
    sku: 'UC-001',
    description: '7-in-1 USB-C hub',
    categoryId: '2',
    price: 49.99,
    cost: 25.0,
    taxRate: 0.07,
    stock: 200,
    minStock: 30,
    isActive: true,
    barcode: '1234567892',
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-15T10:30:00Z',
  },
  {
    id: '4',
    tenantId: '1',
    name: 'Monitor Stand',
    sku: 'MS-001',
    description: 'Adjustable monitor stand',
    categoryId: '3',
    price: 39.99,
    cost: 18.0,
    taxRate: 0.07,
    stock: 8,
    minStock: 15,
    isActive: true,
    barcode: '1234567893',
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-15T10:30:00Z',
  },
  {
    id: '5',
    tenantId: '1',
    name: 'Webcam HD',
    sku: 'WC-001',
    description: '1080p HD webcam',
    categoryId: '1',
    price: 69.99,
    cost: 35.0,
    taxRate: 0.07,
    stock: 45,
    minStock: 10,
    isActive: false,
    barcode: '1234567894',
    createdAt: '2024-01-15T10:30:00Z',
    updatedAt: '2024-01-15T10:30:00Z',
  },
];

const columns: ColumnDef<Product>[] = [
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
        <button
          className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
          onClick={() => console.log('Delete', row.original)}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    ),
  },
];

export function ProductsPage() {
  const [products] = useState<Product[]>(sampleProducts);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Products</h1>
          <p className="mt-1 text-sm text-secondary-500">Manage your product catalog</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <Plus className="h-5 w-5" />
          Add Product
        </button>
      </div>

      {/* Products Table */}
      <div className="card p-6">
        <DataTable
          columns={columns}
          data={products}
          searchKey="name"
          searchPlaceholder="Search products..."
          enableRowSelection
          pageSize={10}
        />
      </div>
    </div>
  );
}
