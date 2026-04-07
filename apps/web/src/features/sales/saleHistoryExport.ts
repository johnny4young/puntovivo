import type { ExportColumn } from '@/services/export/exportService';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { Sale } from '@/types';

export const saleHistoryExportColumns: ExportColumn<Sale>[] = [
  { key: 'saleNumber', header: 'Invoice #' },
  {
    key: 'createdAt',
    header: 'Date',
    formatter: value => formatDateTime(String(value ?? '')),
  },
  {
    key: 'customerName',
    header: 'Customer',
    formatter: value => (typeof value === 'string' && value.length > 0 ? value : 'Walk-in'),
  },
  {
    key: 'subtotal',
    header: 'Subtotal',
    formatter: value => formatCurrency(Number(value ?? 0)),
  },
  {
    key: 'taxAmount',
    header: 'VAT',
    formatter: value => formatCurrency(Number(value ?? 0)),
  },
  {
    key: 'total',
    header: 'Total',
    formatter: value => formatCurrency(Number(value ?? 0)),
  },
  { key: 'paymentMethod', header: 'Payment Method' },
  { key: 'paymentStatus', header: 'Payment Status' },
  { key: 'status', header: 'Status' },
];
