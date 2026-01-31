import { useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil, Trash2, Mail, Phone } from 'lucide-react';
import { DataTable } from '@/components/tables/DataTable';
import type { Customer } from '@/types';

// Sample data
const sampleCustomers: Customer[] = [
  {
    id: '1',
    tenantId: '1',
    name: 'John Doe',
    email: 'john@example.com',
    phone: '+1 (555) 123-4567',
    address: '123 Main St',
    city: 'New York',
    state: 'NY',
    postalCode: '10001',
    country: 'USA',
    isActive: true,
    createdAt: '2024-01-10T10:00:00Z',
    updatedAt: '2024-01-10T10:00:00Z',
  },
  {
    id: '2',
    tenantId: '1',
    name: 'Jane Smith',
    email: 'jane@example.com',
    phone: '+1 (555) 234-5678',
    address: '456 Oak Ave',
    city: 'Los Angeles',
    state: 'CA',
    postalCode: '90001',
    country: 'USA',
    isActive: true,
    createdAt: '2024-01-11T10:00:00Z',
    updatedAt: '2024-01-11T10:00:00Z',
  },
  {
    id: '3',
    tenantId: '1',
    name: 'Bob Wilson',
    email: 'bob@example.com',
    phone: '+1 (555) 345-6789',
    address: '789 Pine Rd',
    city: 'Chicago',
    state: 'IL',
    postalCode: '60601',
    country: 'USA',
    isActive: true,
    createdAt: '2024-01-12T10:00:00Z',
    updatedAt: '2024-01-12T10:00:00Z',
  },
  {
    id: '4',
    tenantId: '1',
    name: 'Alice Brown',
    email: 'alice@example.com',
    phone: '+1 (555) 456-7890',
    address: '321 Elm St',
    city: 'Houston',
    state: 'TX',
    postalCode: '77001',
    country: 'USA',
    isActive: false,
    createdAt: '2024-01-13T10:00:00Z',
    updatedAt: '2024-01-13T10:00:00Z',
  },
];

const columns: ColumnDef<Customer>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    size: 180,
    cell: ({ row }) => (
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-primary-100 flex items-center justify-center">
          <span className="text-sm font-medium text-primary-700">
            {row.original.name.charAt(0)}
          </span>
        </div>
        <div>
          <p className="font-medium text-secondary-900">{row.getValue('name')}</p>
        </div>
      </div>
    ),
  },
  {
    accessorKey: 'email',
    header: 'Email',
    size: 200,
    cell: ({ row }) => (
      <div className="flex items-center gap-2 text-secondary-600">
        <Mail className="h-4 w-4" />
        {row.getValue('email')}
      </div>
    ),
  },
  {
    accessorKey: 'phone',
    header: 'Phone',
    size: 150,
    cell: ({ row }) => (
      <div className="flex items-center gap-2 text-secondary-600">
        <Phone className="h-4 w-4" />
        {row.getValue('phone') || '-'}
      </div>
    ),
  },
  {
    accessorKey: 'city',
    header: 'Location',
    size: 150,
    cell: ({ row }) => (
      <span className="text-secondary-600">
        {row.original.city}, {row.original.state}
      </span>
    ),
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

export function CustomersPage() {
  const [customers] = useState<Customer[]>(sampleCustomers);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Customers</h1>
          <p className="mt-1 text-sm text-secondary-500">Manage your customer database</p>
        </div>
        <button className="btn-primary flex items-center gap-2">
          <Plus className="h-5 w-5" />
          Add Customer
        </button>
      </div>

      {/* Customers Table */}
      <div className="card p-6">
        <DataTable
          columns={columns}
          data={customers}
          searchKey="name"
          searchPlaceholder="Search customers..."
          enableRowSelection
          pageSize={10}
        />
      </div>
    </div>
  );
}
