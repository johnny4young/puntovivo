import { and, asc, eq, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import {
  pharmacyInvimaCatalog,
  pharmacyProductProfiles,
  type PharmacyClassification,
  type PharmacyInvimaStatus,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { normalizeSanitaryRegistration } from '../../services/pharmacy/product-profile.js';
import type {
  ImportPharmacyInvimaCatalogInput,
  SearchPharmacyInvimaCatalogInput,
} from '../../trpc/schemas/pharmacy.js';
import { resolveDosesPerPack } from './generic-alternatives.js';
import { clampPharmacyPage } from './types.js';

export interface ParsedInvimaEntry {
  cumCode: string;
  productName: string;
  activeIngredient: string;
  concentration: string | null;
  dosageForm: string | null;
  administrationRoute: string | null;
  presentation: string | null;
  dosesPerPack: number | null;
  manufacturer: string | null;
  authorizationHolder: string | null;
  sanitaryRegistration: string;
  registrationStatus: PharmacyInvimaStatus;
  registrationExpiresAt: string | null;
  classification: PharmacyClassification;
}

function normalizeHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]/g, '');
}

export function normalizeCumCode(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, '').toLocaleUpperCase('en-US');
}

function normalizeInvimaDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const isoPrefix = /^(\d{4}-\d{2}-\d{2})[T ]/.exec(trimmed);
  if (isoPrefix) return isoPrefix[1]!;
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(trimmed);
  if (dmy) {
    const day = dmy[1]!.padStart(2, '0');
    const month = dmy[2]!.padStart(2, '0');
    const year = dmy[3]!;
    const candidate = `${year}-${month}-${day}`;
    const parsed = new Date(`${candidate}T00:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === candidate) {
      return candidate;
    }
  }
  return null;
}

function normalizeInvimaStatus(raw: string | null | undefined): PharmacyInvimaStatus {
  if (!raw) return 'vigente';
  const key = normalizeHeader(raw);
  if (key.includes('tramite') || key.includes('renov')) return 'en_tramite_renovacion';
  if (key.includes('vencid') || key.includes('expir')) return 'vencido';
  if (key.includes('cancel') || key.includes('perdid')) return 'cancelado';
  if (key.includes('suspen')) return 'suspendido';
  return 'vigente';
}

function normalizeInvimaClassification(raw: string | null | undefined): PharmacyClassification {
  if (!raw) return 'otc';
  const key = normalizeHeader(raw);
  if (
    key.includes('control') ||
    key.includes('estupef') ||
    key.includes('violeta') ||
    key === 'fne'
  ) {
    return 'controlled';
  }
  if (
    key.includes('formula') ||
    key.includes('prescrip') ||
    key.includes('receta') ||
    key.includes('facultativa')
  ) {
    return 'prescription';
  }
  return 'otc';
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parse official Colombia Datos Abiertos / INVIMA CUM CSV or semicolon-delimited text.
 */
export function parseInvimaCsv(csvText: string): ParsedInvimaEntry[] {
  const rawLines = csvText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);
  if (rawLines.length < 2) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PHARMACY_INVIMA_IMPORT_INVALID',
      message: 'INVIMA CSV must contain a header row and at least one medicine row',
    });
  }

  const headerLine = rawLines[0]!;
  const semicolonCount = (headerLine.match(/;/g) ?? []).length;
  const commaCount = (headerLine.match(/,/g) ?? []).length;
  const tabCount = (headerLine.match(/\t/g) ?? []).length;
  const delimiter =
    tabCount > commaCount && tabCount > semicolonCount
      ? '\t'
      : semicolonCount > commaCount
        ? ';'
        : ',';

  const headers = splitDelimitedLine(headerLine, delimiter).map(normalizeHeader);
  const colIndex = (...aliases: string[]) => {
    for (const alias of aliases) {
      const idx = headers.indexOf(alias);
      if (idx !== -1) return idx;
    }
    return -1;
  };

  const idxCum = colIndex('cum', 'codigocum', 'cumcode');
  const idxExpediente = colIndex('expediente', 'expedientecum');
  const idxConsecutivo = colIndex('consecutivocum', 'consecutivo');
  const idxProduct = colIndex('producto', 'nombreproducto', 'productname', 'medicamento');
  const idxIngredient = colIndex('principioactivo', 'activeingredient', 'dci', 'generico');
  const idxConcentration = colIndex('concentracion', 'concentration');
  const idxCantidad = colIndex('cantidad');
  const idxUnidad = colIndex('unidadmedida', 'unidadreferencia');
  const idxDosageForm = colIndex('formafarmaceutica', 'dosageform', 'forma');
  const idxRoute = colIndex('viaadministracion', 'administrationroute', 'via');
  const idxPresentation = colIndex(
    'descripcioncomercial',
    'presentacion',
    'presentation',
    'presentacioncomercial'
  );
  const idxDoses = colIndex('dosisporempaque', 'dosesperpack', 'unidadesporempaque');
  const idxHolder = colIndex('titular', 'authorizationholder');
  const idxManufacturer = colIndex('fabricante', 'laboratorio', 'manufacturer');
  const idxReg = colIndex('registrosanitario', 'sanitaryregistration', 'registro');
  const idxStatus = colIndex('estadoregistro', 'estadocum', 'status', 'estado');
  const idxExpiry = colIndex(
    'fechavencimiento',
    'registrationexpiresat',
    'vencimientoregistro',
    'vigencia'
  );
  const idxClass = colIndex(
    'condicionventa',
    'clasificacion',
    'classification',
    'tipoventa',
    'modalidadventa'
  );

  const entries: ParsedInvimaEntry[] = [];
  for (let i = 1; i < rawLines.length; i += 1) {
    const cols = splitDelimitedLine(rawLines[i]!, delimiter);
    const val = (idx: number) => (idx >= 0 ? (cols[idx]?.trim() ?? '') : '');

    let cumCode = val(idxCum);
    if (!cumCode && idxExpediente >= 0) {
      const exp = val(idxExpediente);
      const cons = val(idxConsecutivo);
      cumCode = cons ? `${exp}-${cons.padStart(2, '0')}` : exp;
    }
    const productName = val(idxProduct);
    const activeIngredient = val(idxIngredient);
    const sanitaryRegistration = val(idxReg);
    if (!cumCode || !productName || !activeIngredient || !sanitaryRegistration) continue;

    let concentration = val(idxConcentration) || null;
    if (!concentration && idxCantidad >= 0 && val(idxCantidad)) {
      const qty = val(idxCantidad);
      const unit = val(idxUnidad);
      concentration = unit ? `${qty} ${unit}` : qty;
    }

    const presentation = val(idxPresentation) || null;
    const explicitDosesRaw = Number(val(idxDoses));
    const explicitDoses =
      Number.isInteger(explicitDosesRaw) && explicitDosesRaw > 0 ? explicitDosesRaw : null;
    const dosesPerPack = resolveDosesPerPack(explicitDoses, presentation);

    entries.push({
      cumCode,
      productName,
      activeIngredient,
      concentration,
      dosageForm: val(idxDosageForm) || null,
      administrationRoute: val(idxRoute) || null,
      presentation,
      dosesPerPack,
      manufacturer: val(idxManufacturer) || val(idxHolder) || null,
      authorizationHolder: val(idxHolder) || null,
      sanitaryRegistration,
      registrationStatus: normalizeInvimaStatus(val(idxStatus)),
      registrationExpiresAt: normalizeInvimaDate(val(idxExpiry)),
      classification: normalizeInvimaClassification(val(idxClass)),
    });
  }

  if (entries.length === 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PHARMACY_INVIMA_IMPORT_INVALID',
      message:
        'No valid INVIMA rows found. Ensure CUM/expediente, product, active ingredient, and sanitary registration columns are present.',
    });
  }

  return entries;
}

export function importPharmacyInvimaCatalog(
  db: DatabaseInstance,
  ctx: { tenantId: string; actorId: string },
  input: ImportPharmacyInvimaCatalogInput
) {
  const parsedRows: ParsedInvimaEntry[] = input.csvText
    ? parseInvimaCsv(input.csvText)
    : (input.rows ?? []).map(row => ({
        cumCode: row.cumCode,
        productName: row.productName,
        activeIngredient: row.activeIngredient,
        concentration: row.concentration ?? null,
        dosageForm: row.dosageForm ?? null,
        administrationRoute: row.administrationRoute ?? null,
        presentation: row.presentation ?? null,
        dosesPerPack: resolveDosesPerPack(row.dosesPerPack ?? null, row.presentation ?? null),
        manufacturer: row.manufacturer ?? null,
        authorizationHolder: row.authorizationHolder ?? null,
        sanitaryRegistration: row.sanitaryRegistration,
        registrationStatus: row.registrationStatus ?? 'vigente',
        registrationExpiresAt: row.registrationExpiresAt ?? null,
        classification: row.classification ?? 'otc',
      }));

  if (parsedRows.length === 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'PHARMACY_INVIMA_IMPORT_INVALID',
      message: 'Provide at least one INVIMA catalog entry or CSV text to import',
    });
  }

  const now = new Date().toISOString();

  return db.transaction(
    tx => {
      let inserted = 0;
      let updated = 0;
      let linkedProducts = 0;

      for (const row of parsedRows) {
        const cumNormalized = normalizeCumCode(row.cumCode);
        const sanitaryRegistrationNormalized = normalizeSanitaryRegistration(
          row.sanitaryRegistration
        );
        const existing = tx
          .select({ id: pharmacyInvimaCatalog.id })
          .from(pharmacyInvimaCatalog)
          .where(
            and(
              eq(pharmacyInvimaCatalog.tenantId, ctx.tenantId),
              eq(pharmacyInvimaCatalog.cumNormalized, cumNormalized)
            )
          )
          .get();

        if (existing) {
          tx.update(pharmacyInvimaCatalog)
            .set({
              cumCode: row.cumCode,
              productName: row.productName,
              activeIngredient: row.activeIngredient,
              concentration: row.concentration,
              dosageForm: row.dosageForm,
              administrationRoute: row.administrationRoute,
              presentation: row.presentation,
              dosesPerPack: row.dosesPerPack,
              manufacturer: row.manufacturer,
              authorizationHolder: row.authorizationHolder,
              sanitaryRegistration: row.sanitaryRegistration,
              sanitaryRegistrationNormalized,
              registrationStatus: row.registrationStatus,
              registrationExpiresAt: row.registrationExpiresAt,
              classification: row.classification,
              updatedAt: now,
            })
            .where(
              and(
                eq(pharmacyInvimaCatalog.id, existing.id),
                eq(pharmacyInvimaCatalog.tenantId, ctx.tenantId)
              )
            )
            .run();
          updated += 1;
        } else {
          tx.insert(pharmacyInvimaCatalog)
            .values({
              id: nanoid(),
              tenantId: ctx.tenantId,
              cumCode: row.cumCode,
              cumNormalized,
              productName: row.productName,
              activeIngredient: row.activeIngredient,
              concentration: row.concentration,
              dosageForm: row.dosageForm,
              administrationRoute: row.administrationRoute,
              presentation: row.presentation,
              dosesPerPack: row.dosesPerPack,
              manufacturer: row.manufacturer,
              authorizationHolder: row.authorizationHolder,
              sanitaryRegistration: row.sanitaryRegistration,
              sanitaryRegistrationNormalized,
              registrationStatus: row.registrationStatus,
              registrationExpiresAt: row.registrationExpiresAt,
              classification: row.classification,
              importedAt: now,
              updatedAt: now,
            })
            .run();
          inserted += 1;
        }

        if (input.syncMatchingProducts) {
          const updatedProfiles = tx
            .update(pharmacyProductProfiles)
            .set({
              cumCode: row.cumCode,
              registrationExpiresAt: row.registrationExpiresAt,
              ...(row.dosesPerPack !== null ? { dosesPerPack: row.dosesPerPack } : {}),
              updatedAt: now,
            })
            .where(
              and(
                eq(pharmacyProductProfiles.tenantId, ctx.tenantId),
                or(
                  eq(pharmacyProductProfiles.cumCode, row.cumCode),
                  eq(
                    pharmacyProductProfiles.sanitaryRegistrationNormalized,
                    sanitaryRegistrationNormalized
                  )
                )
              )
            )
            .run();
          linkedProducts += updatedProfiles.changes;
        }
      }

      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        action: 'pharmacy.invima.import',
        resourceType: 'pharmacy_invima_catalog',
        resourceId: ctx.tenantId,
        after: {
          imported: parsedRows.length,
          inserted,
          updated,
          linkedProducts,
        },
      });

      return {
        imported: parsedRows.length,
        inserted,
        updated,
        linkedProducts,
      };
    },
    { behavior: 'immediate' }
  );
}

export function searchPharmacyInvimaCatalog(
  db: DatabaseInstance,
  tenantId: string,
  input: SearchPharmacyInvimaCatalogInput
) {
  const q = input.search?.trim();
  const pattern = q ? `%${q.toLowerCase()}%` : null;

  const where = and(
    eq(pharmacyInvimaCatalog.tenantId, tenantId),
    input.status ? eq(pharmacyInvimaCatalog.registrationStatus, input.status) : undefined,
    pattern
      ? or(
          sql`lower(${pharmacyInvimaCatalog.cumCode}) like ${pattern}`,
          sql`lower(${pharmacyInvimaCatalog.sanitaryRegistration}) like ${pattern}`,
          sql`lower(${pharmacyInvimaCatalog.productName}) like ${pattern}`,
          sql`lower(${pharmacyInvimaCatalog.activeIngredient}) like ${pattern}`,
          sql`lower(coalesce(${pharmacyInvimaCatalog.authorizationHolder}, '')) like ${pattern}`
        )
      : undefined
  );

  const totalRow = db
    .select({ count: sql<number>`count(*)` })
    .from(pharmacyInvimaCatalog)
    .where(where)
    .get();
  const total = Number(totalRow?.count ?? 0);
  const perPage = input.perPage;
  const page = clampPharmacyPage(total, perPage, input.page);
  const offset = (page - 1) * perPage;

  const items = db
    .select()
    .from(pharmacyInvimaCatalog)
    .where(where)
    .orderBy(asc(pharmacyInvimaCatalog.productName), asc(pharmacyInvimaCatalog.cumCode))
    .limit(perPage)
    .offset(offset)
    .all();

  return { items, total, page, perPage };
}
