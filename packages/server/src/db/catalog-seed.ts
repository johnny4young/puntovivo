/**
 * ENG-002 Step 3 — post-migration catalog-seed hook.
 *
 * Idempotent (`INSERT OR IGNORE`), table-existence-gated seeders for the
 * read-only catalogs that must exist on every boot: the ENG-017 locale
 * matrices (currency + country) and the ENG-176c fiscal identification
 * types (DIAN / SAT / SUNAT / SII). Invoked from `initDatabase()` after
 * `drizzleMigrate()`.
 *
 * @module db/catalog-seed
 */

import type Database from 'better-sqlite3';
import { createModuleLogger } from '../logging/logger.js';
import type { DatabaseInstance } from './types.js';

const dbLog = createModuleLogger('db');

/**
 * ENG-002 Step 3 — post-migration catalog-seed hook.
 *
 * Invoked from `initDatabase()` after `drizzleMigrate()` runs. Both
 * seeders use `INSERT OR IGNORE`, so re-entry is a no-op on every
 * boot beyond the first.
 *
 * Defensive design: each call is table-existence-gated. Adopted DBs
 * whose journal was pinned by `ensureMigrationBaseline()` BEFORE the
 * ENG-017 / ENG-020 migrations would have run (i.e. the operator
 * skipped the transitional release that materialised those tables)
 * hit the gate and skip the seed with a warning instead of crashing
 * the boot. The warning is actionable — it names the missing table and
 * points at the upgrade sequence.
 */
export function seedCatalogs(database: DatabaseInstance): void {
  const client = (database as unknown as { $client: Database.Database }).$client;
  const tableExists = (name: string): boolean => {
    const row = client
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1")
      .get(name);
    return Boolean(row);
  };

  // ENG-017 — the read-only locale catalogs (currency + country).
  if (tableExists('currency_catalog') && tableExists('country_catalog')) {
    seedLocaleCatalogs(client);
  } else {
    dbLog.warn(
      { reason: 'catalog_tables_missing', seeder: 'seedLocaleCatalogs' },
      'skipping locale-catalog seed because currency_catalog or country_catalog is absent; adopt a transitional version that runs drizzleMigrate against a fresh DB or verify ensureMigrationBaseline did not pin unexecuted migrations'
    );
  }

  // ENG-176c — fiscal identification types (renamed from
  // `dian_identification_types` in 0038). Now keyed by composite
  // (country_code, code) so DIAN + SAT + SUNAT + SII rows coexist.
  if (tableExists('fiscal_identification_types')) {
    seedFiscalIdentificationTypes(client);
  } else {
    dbLog.warn(
      { reason: 'catalog_tables_missing', seeder: 'seedFiscalIdentificationTypes' },
      'skipping fiscal identification types seed because fiscal_identification_types is absent; adopt a transitional version that runs migration 0038 against this DB'
    );
  }
}

/**
 * Seed the global `currency_catalog` + `country_catalog` tables with
 * the ENG-017 matrices (18 currencies, 21 LATAM+USA countries). Uses
 * `INSERT OR IGNORE` so the function is safe to re-run on every boot
 * — existing rows are preserved, new rows are added. Updates to
 * existing rows (e.g. adjusting `display_decimals`) require a targeted
 * migration; this seeder never writes over prior values.
 */
function seedLocaleCatalogs(client: Database.Database): void {
  const insertCurrency = client.prepare(
    'INSERT OR IGNORE INTO currency_catalog (code, name_en, name_es, symbol, decimals, display_decimals) VALUES (?, ?, ?, ?, ?, ?)'
  );
  // ISO 4217 codes ordered to mirror the LOCALE-CURRENCY.md matrix.
  const currencies: Array<[string, string, string, string, number, number]> = [
    ['COP', 'Colombian Peso', 'Peso colombiano', '$', 2, 0],
    ['USD', 'US Dollar', 'Dólar estadounidense', '$', 2, 2],
    ['MXN', 'Mexican Peso', 'Peso mexicano', '$', 2, 2],
    ['ARS', 'Argentine Peso', 'Peso argentino', '$', 2, 2],
    ['CLP', 'Chilean Peso', 'Peso chileno', '$', 0, 0],
    ['PEN', 'Peruvian Sol', 'Sol peruano', 'S/', 2, 2],
    ['VES', 'Venezuelan Sovereign Bolívar', 'Bolívar soberano', 'Bs. S', 2, 2],
    ['UYU', 'Uruguayan Peso', 'Peso uruguayo', '$U', 2, 2],
    ['PYG', 'Paraguayan Guaraní', 'Guaraní', '₲', 0, 0],
    ['BOB', 'Bolivian Boliviano', 'Boliviano', 'Bs', 2, 2],
    ['CRC', 'Costa Rican Colón', 'Colón costarricense', '₡', 2, 2],
    ['PAB', 'Panamanian Balboa', 'Balboa', 'B/.', 2, 2],
    ['GTQ', 'Guatemalan Quetzal', 'Quetzal', 'Q', 2, 2],
    ['HNL', 'Honduran Lempira', 'Lempira', 'L', 2, 2],
    ['NIO', 'Nicaraguan Córdoba', 'Córdoba', 'C$', 2, 2],
    ['DOP', 'Dominican Peso', 'Peso dominicano', 'RD$', 2, 2],
    ['CUP', 'Cuban Peso', 'Peso cubano', '$', 2, 2],
    ['BRL', 'Brazilian Real', 'Real', 'R$', 2, 2],
  ];
  for (const row of currencies) {
    insertCurrency.run(...row);
  }

  const insertCountry = client.prepare(
    `INSERT OR IGNORE INTO country_catalog (
       code, name_en, name_es, default_locale, general_locale,
       default_currency_code, additional_currency_codes,
       default_timezone, first_day_of_week, date_format_short,
       date_format_long, tax_id_types_hint, ui_locale_ready
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  type CountryRow = [
    code: string,
    nameEn: string,
    nameEs: string,
    defaultLocale: string,
    generalLocale: string,
    defaultCurrencyCode: string,
    additionalCurrencyCodes: string,
    defaultTimezone: string,
    firstDayOfWeek: number,
    dateFormatShort: string,
    dateFormatLong: string,
    taxIdTypesHint: string,
    uiLocaleReady: number,
  ];
  // One regulated catalog row per source line; the 13-column tuples exceed
  // printWidth, and prettier would otherwise explode each into 15 lines and
  // hurt the reviewability of this read-only data matrix.
  // prettier-ignore
  const countries: CountryRow[] = [
    ['CO', 'Colombia', 'Colombia', 'es-CO', 'es', 'COP', '[]', 'America/Bogota', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['CC', 'NIT', 'CE', 'TI', 'PA']), 1],
    ['US', 'United States', 'Estados Unidos', 'en-US', 'en', 'USD', '[]', 'America/New_York', 0, 'MM/dd/yyyy', 'MMMM d, yyyy', JSON.stringify(['SSN', 'EIN']), 1],
    ['MX', 'Mexico', 'México', 'es-MX', 'es', 'MXN', '[]', 'America/Mexico_City', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['RFC', 'CURP']), 1],
    ['AR', 'Argentina', 'Argentina', 'es-AR', 'es', 'ARS', '[]', 'America/Argentina/Buenos_Aires', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['DNI', 'CUIT', 'CUIL']), 1],
    ['CL', 'Chile', 'Chile', 'es-CL', 'es', 'CLP', '[]', 'America/Santiago', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['RUT']), 1],
    ['PE', 'Peru', 'Perú', 'es-PE', 'es', 'PEN', '[]', 'America/Lima', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['DNI', 'RUC']), 1],
    ['EC', 'Ecuador', 'Ecuador', 'es-EC', 'es', 'USD', '[]', 'America/Guayaquil', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['CI', 'RUC']), 1],
    ['VE', 'Venezuela', 'Venezuela', 'es-VE', 'es', 'VES', JSON.stringify(['USD']), 'America/Caracas', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['V', 'E', 'J', 'G']), 1],
    ['UY', 'Uruguay', 'Uruguay', 'es-UY', 'es', 'UYU', '[]', 'America/Montevideo', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['CI', 'RUT']), 1],
    ['PY', 'Paraguay', 'Paraguay', 'es-PY', 'es', 'PYG', '[]', 'America/Asuncion', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['CI', 'RUC']), 1],
    ['BO', 'Bolivia', 'Bolivia', 'es-BO', 'es', 'BOB', '[]', 'America/La_Paz', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['CI', 'NIT']), 1],
    ['CR', 'Costa Rica', 'Costa Rica', 'es-CR', 'es', 'CRC', '[]', 'America/Costa_Rica', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['cedula', 'cedula_juridica']), 1],
    ['PA', 'Panama', 'Panamá', 'es-PA', 'es', 'PAB', JSON.stringify(['USD']), 'America/Panama', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['cedula', 'RUC']), 1],
    ['GT', 'Guatemala', 'Guatemala', 'es-GT', 'es', 'GTQ', '[]', 'America/Guatemala', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['DPI', 'NIT']), 1],
    ['SV', 'El Salvador', 'El Salvador', 'es-SV', 'es', 'USD', '[]', 'America/El_Salvador', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['DUI', 'NIT']), 1],
    ['HN', 'Honduras', 'Honduras', 'es-HN', 'es', 'HNL', '[]', 'America/Tegucigalpa', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['DNI', 'RTN']), 1],
    ['NI', 'Nicaragua', 'Nicaragua', 'es-NI', 'es', 'NIO', '[]', 'America/Managua', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['cedula', 'RUC']), 1],
    ['DO', 'Dominican Republic', 'República Dominicana', 'es-DO', 'es', 'DOP', '[]', 'America/Santo_Domingo', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['cedula', 'RNC']), 1],
    ['CU', 'Cuba', 'Cuba', 'es-CU', 'es', 'CUP', '[]', 'America/Havana', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['carne_identidad']), 1],
    ['PR', 'Puerto Rico', 'Puerto Rico', 'es-PR', 'es', 'USD', '[]', 'America/Puerto_Rico', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['SSN']), 1],
    // Brazil is seeded with uiLocaleReady=0 until the pt-BR bundle
    // ships — the admin UI will warn and still let the operator pick
    // it (formatters work because Intl has pt-BR; only the i18next
    // UI copy needs the bundle).
    ['BR', 'Brazil', 'Brasil', 'pt-BR', 'pt', 'BRL', '[]', 'America/Sao_Paulo', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['CPF', 'CNPJ']), 0],
  ];
  for (const row of countries) {
    insertCountry.run(...row);
  }
}

/**
 * Seed the global `fiscal_identification_types` catalog with the
 * official codes that Colombia's DIAN, México's SAT, Perú's SUNAT,
 * and Chile's SII publish. Composite-PK-gated (country_code, code)
 * so the seed is idempotent across reboots. These rows are
 * regulated — the `code` column feeds directly into the fiscal XML
 * each authority accepts, so operators cannot edit them.
 *
 * Sources:
 * - CO (DIAN): Resolución 042/2020 Anexo Técnico — Codificación Tipos
 *   de Documento de Identificación.
 * - MX (SAT): Anexo 20 CFDI 4.0 — c_RegimenFiscal + complemento de
 *   identificación de receptor.
 * - PE (SUNAT): Catálogo Nº 6 — Tipo de Documento de Identidad.
 * - CL (SII): Catálogo Nº 11 — Tipo de RUT / RUN.
 *
 * The MX/PE/CL subsets are minimal viable sets that cover the
 * common cases. ENG-156 (multi-currency operations) and ENG-161
 * (NFe Brazil) may extend per business need.
 */
function seedFiscalIdentificationTypes(client: Database.Database): void {
  const insert = client.prepare(
    'INSERT OR IGNORE INTO fiscal_identification_types (country_code, code, abbr, name_es, name_en, natural_person) VALUES (?, ?, ?, ?, ?, ?)'
  );
  // prettier-ignore
  const rows: Array<[string, string, string, string, string, number]> = [
    // Colombia — DIAN (10 codes, regulated)
    ['CO', '11', 'RC', 'Registro civil', 'Civil registry', 1],
    ['CO', '12', 'TI', 'Tarjeta de identidad', 'Identity card', 1],
    ['CO', '13', 'CC', 'Cédula de ciudadanía', 'Citizenship ID', 1],
    ['CO', '21', 'TE', 'Tarjeta de extranjería', 'Foreigner card', 1],
    ['CO', '22', 'CE', 'Cédula de extranjería', 'Foreigner ID', 1],
    ['CO', '31', 'NIT', 'Número de identificación tributaria', 'Tax identification number', 0],
    ['CO', '41', 'PA', 'Pasaporte', 'Passport', 1],
    ['CO', '42', 'TDE', 'Tipo de documento extranjero', 'Foreign document type', 1],
    ['CO', '47', 'PEP', 'Permiso especial de permanencia', 'Special stay permit', 1],
    ['CO', '91', 'NUIP', 'Número único de identificación personal', 'Unique personal identification number', 1],
    // México — SAT (4 codes, minimal viable set)
    ['MX', 'RFC', 'RFC', 'Registro Federal de Contribuyentes', 'Federal taxpayer registry', 0],
    ['MX', 'CURP', 'CURP', 'Clave Única de Registro de Población', 'Unique population registry code', 1],
    ['MX', 'IFE', 'IFE', 'Credencial para Votar', 'Voter credential', 1],
    ['MX', 'PA', 'PA', 'Pasaporte', 'Passport', 1],
    // Perú — SUNAT Catálogo Nº 6 (5 codes, minimal viable set)
    ['PE', '0', 'NDOM', 'No domiciliado, sin RUC', 'Non-domiciled, no RUC', 0],
    ['PE', '1', 'DNI', 'Documento Nacional de Identidad', 'National identity document', 1],
    ['PE', '4', 'CE', 'Carné de Extranjería', 'Foreigner card', 1],
    ['PE', '6', 'RUC', 'Registro Único de Contribuyentes', 'Unique taxpayer registry', 0],
    ['PE', '7', 'PA', 'Pasaporte', 'Passport', 1],
    // Chile — SII Catálogo Nº 11 (4 codes, minimal viable set)
    ['CL', 'RUT', 'RUT', 'Rol Único Tributario', 'Unique tax registry', 0],
    ['CL', 'RUN', 'RUN', 'Rol Único Nacional', 'Unique national registry', 1],
    ['CL', 'EXT', 'EXT', 'Extranjero', 'Foreigner', 1],
    ['CL', 'PA', 'PA', 'Pasaporte', 'Passport', 1],
  ];
  for (const row of rows) {
    insert.run(...row);
  }
}
