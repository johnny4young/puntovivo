/** Opening-cash column mapping and payload helpers. */
import type { ParsedImportFile } from './fileParser';
import { normalizeImportHeader } from './mappingUtils';

export const OPENING_CASH_IMPORT_FIELDS = [
  'siteName',
  'registerName',
  'openingFloat',
  'denominations',
] as const;

export type OpeningCashImportField = (typeof OPENING_CASH_IMPORT_FIELDS)[number];
export type OpeningCashImportMapping = Record<OpeningCashImportField, string>;

const HEADER_ALIASES: Record<OpeningCashImportField, readonly string[]> = {
  siteName: ['site', 'site name', 'location', 'store', 'sede', 'nombre de sede', 'tienda'],
  registerName: [
    'register',
    'register name',
    'drawer',
    'cash register',
    'caja',
    'nombre de caja',
    'cajon',
  ],
  openingFloat: [
    'opening float',
    'opening cash',
    'initial cash',
    'cash base',
    'base de apertura',
    'efectivo inicial',
    'base de caja',
  ],
  denominations: [
    'denominations',
    'denomination counts',
    'cash breakdown',
    'denominaciones',
    'conteo de denominaciones',
    'desglose de efectivo',
  ],
};

export function autoMapOpeningCashHeaders(headers: string[]): OpeningCashImportMapping {
  const byNormalized = new Map(headers.map(header => [normalizeImportHeader(header), header]));
  return Object.fromEntries(
    OPENING_CASH_IMPORT_FIELDS.map(field => {
      const header = HEADER_ALIASES[field]
        .map(alias => byNormalized.get(normalizeImportHeader(alias)))
        .find((value): value is string => Boolean(value));
      return [field, header ?? ''];
    })
  ) as OpeningCashImportMapping;
}

export function mapOpeningCashImportRows(
  file: ParsedImportFile,
  mapping: OpeningCashImportMapping
) {
  return file.rows.map(row => ({
    rowNumber: row.rowNumber,
    values: Object.fromEntries(
      OPENING_CASH_IMPORT_FIELDS.flatMap(field => {
        const source = mapping[field];
        return source ? [[field, row.values[source] ?? '']] : [];
      })
    ) as Partial<Record<OpeningCashImportField, string>>,
  }));
}

export function hasRequiredOpeningCashMapping(mapping: OpeningCashImportMapping): boolean {
  return Boolean(
    mapping.siteName && mapping.registerName && mapping.openingFloat && mapping.denominations
  );
}
