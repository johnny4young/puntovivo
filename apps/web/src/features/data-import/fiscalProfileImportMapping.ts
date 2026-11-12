/** Fiscal-profile column mapping and payload helpers. */
import type { ParsedImportFile } from './fileParser';
import { normalizeImportHeader } from './mappingUtils';

export const FISCAL_PROFILE_IMPORT_FIELDS = [
  'countryCode',
  'taxIdentifier',
  'economicActivityCode',
  'issueLocation',
  'administrativeAreaCode',
  'environment',
  'siteName',
  'resolutionNumber',
  'resolutionDate',
  'numberingPrefix',
  'rangeFrom',
  'rangeTo',
  'validFrom',
  'validUntil',
] as const;

export type FiscalProfileImportField = (typeof FISCAL_PROFILE_IMPORT_FIELDS)[number];
export type FiscalProfileImportMapping = Record<FiscalProfileImportField, string>;

// The downloadable example is a canonical Colombian profile. Keep machine data out of i18n so
// optional country-specific cells can remain genuinely empty without looking like untranslated copy.
export const FISCAL_PROFILE_IMPORT_TEMPLATE: Record<FiscalProfileImportField, string> = {
  countryCode: 'CO',
  taxIdentifier: '900123456-8',
  economicActivityCode: '',
  issueLocation: '',
  administrativeAreaCode: '',
  environment: 'habilitacion',
  siteName: '',
  resolutionNumber: '',
  resolutionDate: '',
  numberingPrefix: '',
  rangeFrom: '',
  rangeTo: '',
  validFrom: '',
  validUntil: '',
};

const HEADER_ALIASES: Record<FiscalProfileImportField, readonly string[]> = {
  countryCode: ['country', 'country code', 'fiscal country', 'pais', 'codigo de pais'],
  taxIdentifier: [
    'tax identifier',
    'tax id',
    'issuer tax id',
    'nit',
    'rfc',
    'rut',
    'identificacion tributaria',
    'identificador fiscal',
  ],
  economicActivityCode: [
    'economic activity code',
    'regime or activity code',
    'tax regime',
    'regime code',
    'activity code',
    'regimen fiscal',
    'codigo de regimen',
    'codigo de regimen o actividad',
    'codigo de actividad',
    'giro',
  ],
  issueLocation: [
    'issue location',
    'postal code',
    'head office address',
    'lugar de expedicion',
    'codigo postal',
    'direccion casa matriz',
    'casa matriz',
  ],
  administrativeAreaCode: [
    'administrative area code',
    'municipality code',
    'comuna code',
    'codigo de comuna',
    'codigo de municipio',
  ],
  environment: ['environment', 'fiscal environment', 'ambiente', 'ambiente fiscal'],
  siteName: ['site', 'site name', 'store', 'sede', 'nombre de sede', 'establecimiento'],
  resolutionNumber: [
    'resolution number',
    'dian resolution',
    'resolucion',
    'numero de resolucion',
    'resolucion dian',
    'resolucion de numeracion',
    'numbering resolution',
  ],
  resolutionDate: ['resolution date', 'fecha de resolucion', 'fecha resolucion'],
  numberingPrefix: ['prefix', 'numbering prefix', 'prefijo'],
  rangeFrom: [
    'range from',
    'from number',
    'desde',
    'rango desde',
    'numero inicial',
    'consecutivo inicial',
  ],
  rangeTo: ['range to', 'to number', 'hasta', 'rango hasta', 'numero final', 'consecutivo final'],
  validFrom: ['valid from', 'vigente desde', 'vigencia desde', 'fecha inicial'],
  validUntil: ['valid until', 'vigente hasta', 'vigencia hasta', 'fecha final', 'vencimiento'],
};

export function autoMapFiscalProfileHeaders(headers: string[]): FiscalProfileImportMapping {
  const byNormalized = new Map(headers.map(header => [normalizeImportHeader(header), header]));
  return Object.fromEntries(
    FISCAL_PROFILE_IMPORT_FIELDS.map(field => {
      const header = HEADER_ALIASES[field]
        .map(alias => byNormalized.get(normalizeImportHeader(alias)))
        .find((value): value is string => Boolean(value));
      return [field, header ?? ''];
    })
  ) as FiscalProfileImportMapping;
}

export function mapFiscalProfileImportRows(
  file: ParsedImportFile,
  mapping: FiscalProfileImportMapping
) {
  return file.rows.map(row => ({
    rowNumber: row.rowNumber,
    values: Object.fromEntries(
      FISCAL_PROFILE_IMPORT_FIELDS.flatMap(field => {
        const source = mapping[field];
        return source ? [[field, row.values[source] ?? '']] : [];
      })
    ) as Partial<Record<FiscalProfileImportField, string>>,
  }));
}

export function hasRequiredFiscalProfileMapping(mapping: FiscalProfileImportMapping): boolean {
  return Boolean(mapping.countryCode && mapping.taxIdentifier);
}
