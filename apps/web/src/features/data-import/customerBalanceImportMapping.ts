/** ENG-123d — Customer receivable column mapping and payload helpers. */
import type { ParsedImportFile } from './fileParser';
import { normalizeImportHeader } from './mappingUtils';

export const CUSTOMER_BALANCE_IMPORT_FIELDS = ['taxId', 'email', 'openingBalance', 'note'] as const;

export type CustomerBalanceImportField = (typeof CUSTOMER_BALANCE_IMPORT_FIELDS)[number];
export type CustomerBalanceImportMapping = Record<CustomerBalanceImportField, string>;

const HEADER_ALIASES: Record<CustomerBalanceImportField, readonly string[]> = {
  taxId: [
    'tax id',
    'taxid',
    'nit',
    'documento',
    'identificacion',
    'identificacion tributaria',
    'identification',
  ],
  email: ['email', 'correo', 'correo electronico', 'e-mail'],
  openingBalance: [
    'opening balance',
    'customer balance',
    'receivable balance',
    'balance due',
    'saldo inicial',
    'saldo del cliente',
    'saldo por cobrar',
    'cartera inicial',
    'cuenta por cobrar',
  ],
  note: ['note', 'notes', 'memo', 'nota', 'notas', 'observacion', 'observaciones'],
};

export function autoMapCustomerBalanceHeaders(headers: string[]): CustomerBalanceImportMapping {
  const byNormalized = new Map(headers.map(header => [normalizeImportHeader(header), header]));
  return Object.fromEntries(
    CUSTOMER_BALANCE_IMPORT_FIELDS.map(field => {
      const header = HEADER_ALIASES[field]
        .map(alias => byNormalized.get(normalizeImportHeader(alias)))
        .find((value): value is string => Boolean(value));
      return [field, header ?? ''];
    })
  ) as CustomerBalanceImportMapping;
}

export function mapCustomerBalanceImportRows(
  file: ParsedImportFile,
  mapping: CustomerBalanceImportMapping
) {
  return file.rows.map(row => ({
    rowNumber: row.rowNumber,
    values: Object.fromEntries(
      CUSTOMER_BALANCE_IMPORT_FIELDS.flatMap(field => {
        const source = mapping[field];
        return source ? [[field, row.values[source] ?? '']] : [];
      })
    ) as Partial<Record<CustomerBalanceImportField, string>>,
  }));
}

export function hasRequiredCustomerBalanceMapping(mapping: CustomerBalanceImportMapping): boolean {
  return Boolean(mapping.openingBalance && (mapping.taxId || mapping.email));
}
