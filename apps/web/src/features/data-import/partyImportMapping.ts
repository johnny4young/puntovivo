/** ENG-123b — Customer/provider column mapping and payload helpers. */
import type { ParsedImportFile } from './fileParser';

export type ImportEntity = 'products' | 'customers' | 'providers';
export type PartyImportEntity = Exclude<ImportEntity, 'products'>;

export const PARTY_IMPORT_FIELDS = {
  customers: [
    'name',
    'taxId',
    'email',
    'phone',
    'address',
    'city',
    'state',
    'postalCode',
    'country',
    'notes',
  ],
  providers: ['name', 'taxId', 'email', 'phone', 'address', 'contactName', 'cityCode'],
} as const;

export type CustomerImportField = (typeof PARTY_IMPORT_FIELDS.customers)[number];
export type ProviderImportField = (typeof PARTY_IMPORT_FIELDS.providers)[number];
export type PartyImportField = CustomerImportField | ProviderImportField;
export type PartyImportMapping = Partial<Record<PartyImportField, string>>;

const HEADER_ALIASES: Record<PartyImportEntity, Record<string, readonly string[]>> = {
  customers: {
    name: ['name', 'customer name', 'nombre', 'nombre del cliente', 'cliente'],
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
    phone: ['phone', 'telefono', 'celular', 'mobile'],
    address: ['address', 'direccion'],
    city: ['city', 'ciudad', 'municipio'],
    state: [
      'state',
      'state or department',
      'department',
      'departamento',
      'departamento o estado',
      'provincia',
      'region',
    ],
    postalCode: ['postal code', 'zip', 'codigo postal'],
    country: ['country', 'pais'],
    notes: ['notes', 'notas', 'observaciones'],
  },
  providers: {
    name: ['name', 'provider name', 'supplier name', 'nombre', 'nombre del proveedor', 'proveedor'],
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
    phone: ['phone', 'telefono', 'celular', 'mobile'],
    address: ['address', 'direccion'],
    contactName: ['contact', 'contact name', 'nombre de contacto', 'contacto'],
    cityCode: ['city code', 'codigo ciudad', 'codigo de ciudad', 'codigo municipio', 'city id'],
  },
};

function normalizeHeader(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function autoMapPartyHeaders(
  entity: PartyImportEntity,
  headers: string[]
): PartyImportMapping {
  const byNormalized = new Map(headers.map(header => [normalizeHeader(header), header]));
  return Object.fromEntries(
    PARTY_IMPORT_FIELDS[entity].map(field => {
      const header = (HEADER_ALIASES[entity][field] ?? [])
        .map(alias => byNormalized.get(normalizeHeader(alias)))
        .find((value): value is string => Boolean(value));
      return [field, header ?? ''];
    })
  );
}

export function mapPartyImportRows(
  entity: PartyImportEntity,
  file: ParsedImportFile,
  mapping: PartyImportMapping
) {
  return file.rows.map(row => ({
    rowNumber: row.rowNumber,
    values: Object.fromEntries(
      PARTY_IMPORT_FIELDS[entity].flatMap(field => {
        const source = mapping[field];
        return source ? [[field, row.values[source] ?? '']] : [];
      })
    ),
  }));
}

export function hasRequiredPartyMapping(mapping: PartyImportMapping): boolean {
  return Boolean(mapping.name);
}
