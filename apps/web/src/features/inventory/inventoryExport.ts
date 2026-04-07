import type { ExportColumn } from '@/services/export/exportService';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { InitialInventoryEntry, InventoryMovement, InventoryStockItem } from '@/types';

function getMovementDelta(movement: InventoryMovement): number {
  if (movement.type === 'sale' || movement.type === 'transfer') {
    return movement.previousStock - movement.newStock > 0 ? -movement.quantity : movement.quantity;
  }

  if (movement.type === 'adjustment') {
    return movement.newStock - movement.previousStock;
  }

  return movement.quantity;
}

export const inventoryMovementExportColumns: ExportColumn<InventoryMovement>[] = [
  {
    key: 'createdAt',
    header: 'Date',
    formatter: value => formatDateTime(String(value ?? '')),
  },
  { key: 'type', header: 'Type' },
  {
    key: 'productName',
    header: 'Product',
    formatter: value => (typeof value === 'string' && value.length > 0 ? value : 'Unknown product'),
  },
  {
    key: 'productSku',
    header: 'SKU',
    formatter: value => (typeof value === 'string' && value.length > 0 ? value : '-'),
  },
  {
    key: 'categoryName',
    header: 'Category',
    formatter: value => (typeof value === 'string' && value.length > 0 ? value : '-'),
  },
  {
    key: 'quantity',
    header: 'Movement',
    formatter: (_value, row) => String(getMovementDelta(row)),
  },
  { key: 'previousStock', header: 'Previous Stock' },
  { key: 'newStock', header: 'Stock After' },
  {
    key: 'reference',
    header: 'Reference',
    formatter: value => (typeof value === 'string' && value.length > 0 ? value : '-'),
  },
  {
    key: 'notes',
    header: 'Notes',
    formatter: value => (typeof value === 'string' && value.length > 0 ? value : '-'),
  },
];

export const inventoryStockExportColumns: ExportColumn<InventoryStockItem>[] = [
  { key: 'name', header: 'Product' },
  { key: 'sku', header: 'SKU' },
  {
    key: 'categoryName',
    header: 'Category',
    formatter: value => (typeof value === 'string' && value.length > 0 ? value : '-'),
  },
  { key: 'stock', header: 'Stock' },
  { key: 'minStock', header: 'Min Stock' },
  {
    key: 'price',
    header: 'Sell Price',
    formatter: value => formatCurrency(Number(value ?? 0)),
  },
  {
    key: 'inventoryValue',
    header: 'Valuation',
    formatter: value => formatCurrency(Number(value ?? 0)),
  },
  {
    key: 'updatedAt',
    header: 'Updated',
    formatter: value => formatDateTime(String(value ?? '')),
  },
  {
    key: 'isLowStock',
    header: 'Status',
    formatter: value => (value ? 'Low stock' : 'Healthy'),
  },
];

export const inventoryEntryExportColumns: ExportColumn<InitialInventoryEntry>[] = [
  {
    key: 'createdAt',
    header: 'Date',
    formatter: value => formatDateTime(String(value ?? '')),
  },
  { key: 'mode', header: 'Mode' },
  {
    key: 'productName',
    header: 'Product',
    formatter: value => (typeof value === 'string' && value.length > 0 ? value : 'Unknown product'),
  },
  {
    key: 'productSku',
    header: 'SKU',
    formatter: value => (typeof value === 'string' && value.length > 0 ? value : '-'),
  },
  {
    key: 'unitName',
    header: 'Unit',
    formatter: (_value, row) => row.unitAbbreviation ?? row.unitName ?? '-',
  },
  { key: 'quantity', header: 'Counted Qty' },
  { key: 'normalizedQuantity', header: 'Normalized Qty' },
  {
    key: 'cost',
    header: 'Cost',
    formatter: value => formatCurrency(Number(value ?? 0)),
  },
  { key: 'previousStock', header: 'Previous Stock' },
  { key: 'newStock', header: 'Stock After' },
  {
    key: 'notes',
    header: 'Notes',
    formatter: value => (typeof value === 'string' && value.length > 0 ? value : '-'),
  },
];
