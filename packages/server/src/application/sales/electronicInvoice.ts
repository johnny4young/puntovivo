/**
 * The FEV replaces the DEE only when the buyer asks; the DEE has no amount cap.
 * Rules and sources: docs/FISCAL-INTEGRATION.md.
 * @module application/sales/electronicInvoice
 */
import { and, asc, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { customers, fiscalIdentificationTypes, tenants } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import {
  isCountryFiscalEnabled,
  isDianEnabled,
} from '../../services/fiscal/orchestrator/helpers.js';
import {
  peekNumberingRange,
  readTenantNumberingEnvironment,
} from '../../services/fiscal/numbering/select.js';
import type { ResolvedBuyer } from '../../services/fiscal/orchestrator/types.js';
import { normalizeCoBuyerId } from '../../services/fiscal/packs/co/buyer-id.js';
import { resolveTenantLocale } from '../../services/tenant-locale.js';
import type { ElectronicInvoiceRequest } from './types.js';

const COLOMBIA = 'CO';

async function isColombianPackOn(db: DatabaseInstance, tenantId: string): Promise<boolean> {
  if (!(await isDianEnabled(db, tenantId))) return false;
  const locale = await resolveTenantLocale(db, tenantId);
  if (locale.countryCode !== COLOMBIA) return false;
  const row = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  return isCountryFiscalEnabled((row?.settings ?? {}) as Record<string, unknown>, COLOMBIA);
}

function hasUsableFevRange(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string,
  now: string
): boolean {
  return peekNumberingRange(db, {
    tenantId,
    siteId,
    kind: 'FEV',
    environment: readTenantNumberingEnvironment(db, tenantId),
    at: now,
  }).ok;
}

export interface ElectronicInvoiceAvailability {
  available: boolean;
  identificationTypes: Array<{ code: string; abbr: string; nameEs: string; nameEn: string }>;
}

/**
 * Checkout offers the request only when an FEV can actually be numbered at
 * the site, so the cashier never promises a document the shop cannot issue.
 */
export async function getElectronicInvoiceAvailability(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string,
  now: string = new Date().toISOString()
): Promise<ElectronicInvoiceAvailability> {
  const unavailable: ElectronicInvoiceAvailability = { available: false, identificationTypes: [] };
  if (!(await isColombianPackOn(db, tenantId)) || !hasUsableFevRange(db, tenantId, siteId, now)) {
    return unavailable;
  }

  const identificationTypes = await db
    .select({
      code: fiscalIdentificationTypes.code,
      abbr: fiscalIdentificationTypes.abbr,
      nameEs: fiscalIdentificationTypes.nameEs,
      nameEn: fiscalIdentificationTypes.nameEn,
    })
    .from(fiscalIdentificationTypes)
    .where(eq(fiscalIdentificationTypes.countryCode, COLOMBIA))
    .orderBy(asc(fiscalIdentificationTypes.code))
    .all();
  return { available: true, identificationTypes };
}

function invalidBuyer(field: string, reason: string): never {
  throwServerError({
    trpcCode: 'BAD_REQUEST',
    errorCode: 'ELECTRONIC_INVOICE_BUYER_INVALID',
    message: `Electronic invoice buyer ${field} is invalid`,
    details: { field, reason },
  });
}

/**
 * Validate the request before the sale transaction opens and freeze the buyer
 * the FEV will carry. A blocked FEV intent cannot fall back to a DEE, so a
 * request the site cannot number is refused while the cashier can still
 * charge with the POS document; refusing here leaves nothing to revert.
 */
export async function resolveElectronicInvoiceBuyer(
  db: DatabaseInstance,
  tenantId: string,
  request: ElectronicInvoiceRequest,
  sale: { customerId: string | null; siteId: string; now: string }
): Promise<ResolvedBuyer> {
  if (
    !(await isColombianPackOn(db, tenantId)) ||
    !(await hasUsableFevRange(db, tenantId, sale.siteId, sale.now))
  ) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'ELECTRONIC_INVOICE_UNAVAILABLE',
      message: 'This site cannot issue an electronic invoice right now',
    });
  }

  const { buyer } = request;
  const name = buyer.name.trim();
  if (name.length === 0) invalidBuyer('name', 'empty');

  const typeCode = buyer.identificationTypeCode.trim();
  const type = await db
    .select({ code: fiscalIdentificationTypes.code })
    .from(fiscalIdentificationTypes)
    .where(
      and(
        eq(fiscalIdentificationTypes.countryCode, COLOMBIA),
        eq(fiscalIdentificationTypes.code, typeCode)
      )
    )
    .get();
  if (!type) invalidBuyer('identificationTypeCode', 'unknown');

  const taxId = normalizeCoBuyerId(typeCode, buyer.identificationNumber);
  if (!taxId.ok) invalidBuyer('identificationNumber', taxId.reason);

  return {
    customerId: await linkedCustomerId(db, tenantId, sale.customerId, typeCode, taxId.value),
    taxId: taxId.value,
    taxIdTypeCode: typeCode,
    name,
    email: buyer.email?.trim() || null,
    address: null,
    city: null,
    department: null,
    country: null,
  };
}

/**
 * Link the FEV to the sale's customer only when it names that customer, so a
 * third party's invoice never shows up in the customer's privacy export.
 */
async function linkedCustomerId(
  db: DatabaseInstance,
  tenantId: string,
  customerId: string | null,
  typeCode: string,
  buyerTaxId: string
): Promise<string | null> {
  if (!customerId) return null;
  const customer = await db
    .select({ taxId: customers.taxId })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
    .get();
  if (!customer?.taxId) return null;
  const customerTaxId = normalizeCoBuyerId(typeCode, customer.taxId);
  return customerTaxId.ok && customerTaxId.value === buyerTaxId ? customerId : null;
}
