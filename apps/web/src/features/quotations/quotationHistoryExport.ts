import type { ExportColumn } from '@/services/export/exportService';
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils';
import type { QuotationListEntry } from '@/types';

/**
 * Phase 5 / Tier-2 #6 step 3 — CSV/Excel/PDF export columns for the
 * quotations history table. Mirrors the convention used by
 * `sales/saleHistoryExport.ts` and `purchases/purchasesHistoryExport.ts`.
 *
 * Column headers stay in English today to match the rest of the export
 * column definitions in the codebase (the generic CSV service does not
 * route through i18next). When the export layer gets localization, flip
 * these along with every other module's export columns in one pass.
 */
export const quotationHistoryExportColumns: ExportColumn<QuotationListEntry>[] = [
  { key: 'quotationNumber', header: 'Number' },
  {
    key: 'createdAt',
    header: 'Created At',
    formatter: value => formatDateTime(String(value ?? '')),
  },
  {
    key: 'customerName',
    header: 'Customer',
    formatter: value =>
      typeof value === 'string' && value.length > 0 ? value : 'Walk-in',
  },
  { key: 'siteName', header: 'Site' },
  { key: 'itemCount', header: 'Items' },
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
  {
    key: 'validUntil',
    header: 'Valid Until',
    formatter: value => (value ? formatDate(String(value)) : '—'),
  },
  { key: 'status', header: 'Status' },
];
