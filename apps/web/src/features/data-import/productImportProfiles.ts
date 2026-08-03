/** Versioned, fail-closed mappings for tested third-party POS export shapes. */
import { normalizeImportHeader } from './mappingUtils';
import {
  autoMapProductHeaders,
  PRODUCT_IMPORT_FIELDS,
  type ProductImportField,
  type ProductImportMapping,
} from './productImportMapping';

export const PRODUCT_IMPORT_PROFILE_IDS = [
  'generic',
  'loyverse-items-en-v1',
  'alegra-inventory-es-v1',
  'siigo-products-es-v1',
  'world-office-inventory-es-v1',
] as const;

export type ProductImportProfileId = (typeof PRODUCT_IMPORT_PROFILE_IDS)[number];

export interface ProductImportProfile {
  id: Exclude<ProductImportProfileId, 'generic'>;
  signature: readonly string[];
  mapping: Partial<Record<ProductImportField, string>>;
}

export const PRODUCT_IMPORT_PROFILES: readonly ProductImportProfile[] = [
  {
    id: 'loyverse-items-en-v1',
    signature: [
      'Handle',
      'SKU',
      'Name',
      'Price',
      'Cost',
      'Barcode',
      'Sold by weight',
      'Track stock',
      'In stock',
      'Low stock',
    ],
    mapping: {
      name: 'Name',
      sku: 'SKU',
      barcode: 'Barcode',
      price: 'Price',
      cost: 'Cost',
      stock: 'In stock',
      minStock: 'Low stock',
    },
  },
  {
    id: 'alegra-inventory-es-v1',
    signature: [
      'Código',
      'Nombre',
      'Referencia',
      'Precio de venta',
      'Costo unitario',
      'Cantidad inicial',
      'Nombre impuesto',
      'Porcentaje impuesto',
    ],
    mapping: {
      name: 'Nombre',
      sku: 'Código',
      description: 'Descripción',
      barcode: 'Código de barras',
      unit: 'Unidad de medida',
      price: 'Precio de venta',
      cost: 'Costo unitario',
      stock: 'Cantidad inicial',
      minStock: 'Cantidad mínima',
      taxName: 'Nombre impuesto',
      taxRate: 'Porcentaje impuesto',
    },
  },
  {
    id: 'siigo-products-es-v1',
    signature: [
      'Código producto',
      'Nombre producto',
      'Precio de venta',
      'Costo',
      'Existencia',
      'Impuesto cargo',
      'Unidad de medida',
    ],
    mapping: {
      name: 'Nombre producto',
      sku: 'Código producto',
      description: 'Descripción',
      barcode: 'Código de barras',
      unit: 'Unidad de medida',
      price: 'Precio de venta',
      cost: 'Costo',
      stock: 'Existencia',
      minStock: 'Stock mínimo',
      taxName: 'Impuesto cargo',
      taxRate: 'Porcentaje impuesto',
    },
  },
  {
    id: 'world-office-inventory-es-v1',
    signature: [
      'Código artículo',
      'Descripción artículo',
      'Precio venta',
      'Costo promedio',
      'Existencia',
      'Porcentaje IVA',
      'Unidad',
    ],
    mapping: {
      name: 'Descripción artículo',
      sku: 'Código artículo',
      barcode: 'Código de barras',
      unit: 'Unidad',
      price: 'Precio venta',
      cost: 'Costo promedio',
      stock: 'Existencia',
      minStock: 'Stock mínimo',
      taxRate: 'Porcentaje IVA',
    },
  },
] as const;

function normalizedHeaders(headers: readonly string[]): Map<string, string> {
  return new Map(headers.map(header => [normalizeImportHeader(header), header]));
}

export function detectProductImportProfile(headers: string[]): ProductImportProfileId {
  const actual = normalizedHeaders(headers);
  const matches = PRODUCT_IMPORT_PROFILES.filter(profile =>
    profile.signature.every(header => actual.has(normalizeImportHeader(header)))
  );
  return matches.length === 1 ? matches[0]!.id : 'generic';
}

export function buildProductImportProfileMapping(
  headers: string[],
  profileId: ProductImportProfileId
): ProductImportMapping {
  if (profileId === 'generic') return autoMapProductHeaders(headers);
  const actual = normalizedHeaders(headers);
  const profile = PRODUCT_IMPORT_PROFILES.find(candidate => candidate.id === profileId);
  return Object.fromEntries(
    PRODUCT_IMPORT_FIELDS.map(field => {
      const expected = profile?.mapping[field];
      return [field, expected ? (actual.get(normalizeImportHeader(expected)) ?? '') : ''];
    })
  ) as ProductImportMapping;
}

export function matchesProductImportProfileSignature(
  headers: string[],
  profileId: ProductImportProfileId
): boolean {
  if (profileId === 'generic') return false;
  const actual = normalizedHeaders(headers);
  const profile = PRODUCT_IMPORT_PROFILES.find(candidate => candidate.id === profileId);
  return Boolean(profile?.signature.every(header => actual.has(normalizeImportHeader(header))));
}
