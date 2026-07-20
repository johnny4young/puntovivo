/** Product import column mapping and server-payload helpers. */
import type { ParsedImportFile } from './fileParser';
import { normalizeImportHeader } from './mappingUtils';

export const PRODUCT_IMPORT_FIELDS = [
  'name',
  'sku',
  'description',
  'barcode',
  'price',
  'cost',
  'stock',
  'minStock',
  'taxRate',
  'tracksLots',
] as const;

export type ProductImportField = (typeof PRODUCT_IMPORT_FIELDS)[number];
export type ProductImportMapping = Record<ProductImportField, string>;

const HEADER_ALIASES: Record<ProductImportField, readonly string[]> = {
  name: ['name', 'product name', 'nombre', 'nombre del producto', 'product', 'producto'],
  sku: ['sku', 'codigo', 'codigo interno', 'referencia', 'reference'],
  description: ['description', 'descripcion', 'detalle'],
  barcode: ['barcode', 'codigo de barras', 'ean', 'gtin'],
  price: ['price', 'precio', 'precio venta', 'precio de venta', 'sale price'],
  cost: ['cost', 'costo', 'precio compra', 'purchase price'],
  stock: ['stock', 'existencia', 'cantidad', 'opening stock', 'stock inicial', 'stock de apertura'],
  minStock: ['min stock', 'minimum stock', 'stock minimo', 'minimo'],
  taxRate: ['tax rate', 'vat', 'iva', 'impuesto', 'tasa impuesto', 'tasa de impuesto'],
  tracksLots: [
    'track lots',
    'track lots and expiry',
    'lot tracking',
    'tracks lots',
    'control de lotes',
    'controlar lotes',
    'controlar lotes y vencimientos',
    'lotes',
  ],
};

export function autoMapProductHeaders(headers: string[]): ProductImportMapping {
  const byNormalized = new Map(headers.map(header => [normalizeImportHeader(header), header]));
  return Object.fromEntries(
    PRODUCT_IMPORT_FIELDS.map(field => {
      const header = HEADER_ALIASES[field]
        .map(alias => byNormalized.get(normalizeImportHeader(alias)))
        .find((value): value is string => Boolean(value));
      return [field, header ?? ''];
    })
  ) as ProductImportMapping;
}

export function mapProductImportRows(file: ParsedImportFile, mapping: ProductImportMapping) {
  return file.rows.map(row => ({
    rowNumber: row.rowNumber,
    values: Object.fromEntries(
      PRODUCT_IMPORT_FIELDS.flatMap(field => {
        const source = mapping[field];
        return source ? [[field, row.values[source] ?? '']] : [];
      })
    ) as Partial<Record<ProductImportField, string>>,
  }));
}

export function hasRequiredProductMapping(mapping: ProductImportMapping): boolean {
  return Boolean(mapping.name && mapping.sku);
}
