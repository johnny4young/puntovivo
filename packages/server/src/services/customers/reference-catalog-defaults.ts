import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  countryCatalog,
  fiscalIdentificationTypes,
  identificationTypes,
  personTypes,
  regimeTypes,
} from '../../db/schema.js';

interface CatalogRow {
  code: string;
  name: string;
}

const PERSON_TYPES: Record<'es' | 'en', CatalogRow[]> = {
  es: [
    { code: 'natural', name: 'Persona natural' },
    { code: 'juridica', name: 'Persona jurídica' },
  ],
  en: [
    { code: 'natural', name: 'Natural person' },
    { code: 'juridica', name: 'Legal entity' },
  ],
};

// DIAN fiscal regime codes used on Colombian e-invoices.
const REGIME_TYPES_BY_COUNTRY: Partial<Record<string, CatalogRow[]>> = {
  CO: [
    { code: '48', name: 'Responsable de IVA' },
    { code: '49', name: 'No responsable de IVA' },
  ],
};

/**
 * Seeds the tenant's customer identification, person and regime catalogs for
 * its country. Idempotent per (tenant, code); an existing row is never touched.
 */
export function seedCustomerReferenceCatalogs(
  tx: DatabaseInstance,
  args: { tenantId: string; countryCode: string; now: string }
): void {
  const country = tx
    .select({ generalLocale: countryCatalog.generalLocale, hint: countryCatalog.taxIdTypesHint })
    .from(countryCatalog)
    .where(eq(countryCatalog.code, args.countryCode))
    .get();
  const locale = country?.generalLocale === 'es' ? 'es' : 'en';

  // Codes are the abbreviation the e-invoice mapper translates to the authority code.
  const fiscalTypes = tx
    .select({
      abbr: fiscalIdentificationTypes.abbr,
      nameEs: fiscalIdentificationTypes.nameEs,
      nameEn: fiscalIdentificationTypes.nameEn,
    })
    .from(fiscalIdentificationTypes)
    .where(eq(fiscalIdentificationTypes.countryCode, args.countryCode))
    .all();
  const identification: CatalogRow[] =
    fiscalTypes.length > 0
      ? fiscalTypes.map(row => ({
          code: row.abbr,
          name: locale === 'es' ? row.nameEs : row.nameEn,
        }))
      : (country?.hint ?? []).map(code => ({ code, name: code }));

  const insertAll = (
    table: typeof identificationTypes | typeof personTypes | typeof regimeTypes,
    rows: CatalogRow[]
  ) => {
    for (const row of rows) {
      tx.insert(table)
        .values({
          id: nanoid(),
          tenantId: args.tenantId,
          code: row.code,
          name: row.name,
          description: null,
          isActive: true,
          createdAt: args.now,
          updatedAt: args.now,
        })
        .onConflictDoNothing()
        .run();
    }
  };

  insertAll(identificationTypes, identification);
  insertAll(personTypes, PERSON_TYPES[locale]);
  insertAll(regimeTypes, REGIME_TYPES_BY_COUNTRY[args.countryCode] ?? []);
}
