import type { ExportColumn } from '@/services/export/exportService';
import { formatCurrency } from '@/lib/utils';
import type { Product } from '@/types';

export const productExportColumns: ExportColumn<Product>[] = [
  { key: 'name', header: 'Product' },
  { key: 'sku', header: 'SKU' },
  {
    key: 'categoryName',
    header: 'Category',
    formatter: value => (typeof value === 'string' && value.length > 0 ? value : '-'),
  },
  {
    key: 'providerName',
    header: 'Provider',
    formatter: value => (typeof value === 'string' && value.length > 0 ? value : '-'),
  },
  {
    key: 'locationName',
    header: 'Location',
    formatter: value => (typeof value === 'string' && value.length > 0 ? value : '-'),
  },
  {
    key: 'price',
    header: 'Tier 1',
    formatter: value => formatCurrency(Number(value ?? 0)),
  },
  {
    key: 'price2',
    header: 'Tier 2',
    formatter: value => formatCurrency(Number(value ?? 0)),
  },
  {
    key: 'price3',
    header: 'Tier 3',
    formatter: value => formatCurrency(Number(value ?? 0)),
  },
  { key: 'stock', header: 'Stock' },
  { key: 'minStock', header: 'Min Stock' },
  {
    key: 'isActive',
    header: 'Status',
    formatter: value => (value ? 'Active' : 'Inactive'),
  },
];
