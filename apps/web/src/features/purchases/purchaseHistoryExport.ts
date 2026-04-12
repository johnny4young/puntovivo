import type { ExportColumn } from '@/services/export/exportService';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { Purchase } from '@/types';

export const purchaseHistoryExportColumns: ExportColumn<Purchase>[] = [
  { key: 'purchaseNumber', header: 'Purchase #' },
  {
    key: 'status',
    header: 'Status',
    formatter: value => String(value ?? '').replace(/_/g, ' '),
  },
  {
    key: 'createdAt',
    header: 'Date',
    formatter: value => formatDateTime(String(value ?? '')),
  },
  {
    key: 'providerName',
    header: 'Provider',
    formatter: value => (typeof value === 'string' && value.length > 0 ? value : '-'),
  },
  {
    key: 'siteName',
    header: 'Site',
    formatter: value => (typeof value === 'string' && value.length > 0 ? value : '-'),
  },
  {
    key: 'subtotal',
    header: 'Subtotal',
    formatter: value => formatCurrency(Number(value ?? 0)),
  },
  {
    key: 'total',
    header: 'Total',
    formatter: value => formatCurrency(Number(value ?? 0)),
  },
  {
    key: 'returnedAmount',
    header: 'Returned Amount',
    formatter: value => formatCurrency(Number(value ?? 0)),
  },
  {
    key: 'returnedAt',
    header: 'Latest Return',
    formatter: value => (value ? formatDateTime(String(value)) : '-'),
  },
  {
    key: 'latestReturnReason',
    header: 'Latest Return Note',
    formatter: value => (typeof value === 'string' && value.length > 0 ? value : '-'),
  },
  {
    key: 'latestReturnCreatedByName',
    header: 'Latest Return By',
    formatter: value => (typeof value === 'string' && value.length > 0 ? value : '-'),
  },
  {
    key: 'notes',
    header: 'Notes',
    formatter: value => (typeof value === 'string' && value.length > 0 ? value : '-'),
  },
];
