/**
 * Sale-time receipt snapshots.
 *
 * Monetary and quantity evidence already lives on `sales` / `sale_items`.
 * This helper resolves the mutable labels plus company/customer identity that
 * an ordinary receipt needs to reproduce later, without coupling the write
 * path to the receipt renderer. Every lookup is tenant-scoped.
 *
 * @module application/sales/receipt-snapshots
 */

import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { companies, customers, sites, users } from '../../db/schema.js';
import type { ReceiptLayout } from '../../trpc/schemas/receiptTemplates.js';
import { listReceiptTemplates } from '../../services/receipt-templates/index.js';
import { resolveTenantLocale } from '../../services/tenant-locale.js';

export const RECEIPT_IDENTITY_SNAPSHOT_VERSION = 1;
export const RECEIPT_PRESENTATION_SNAPSHOT_VERSION = 1;

export interface SaleHeaderReceiptSnapshots {
  customerNameSnapshot: string | null;
  siteNameSnapshot: string | null;
  cashierNameSnapshot: string | null;
  receiptIdentitySnapshotVersion: number;
  companyNameSnapshot: string;
  companyTaxIdSnapshot: string | null;
  companyAddressSnapshot: string | null;
  companyPhoneSnapshot: string | null;
  companyEmailSnapshot: string | null;
  customerTaxIdSnapshot: string | null;
  receiptPresentationSnapshotVersion: number;
  receiptTemplateIdSnapshot: string | null;
  receiptTemplateKindSnapshot: 'sale' | null;
  receiptTemplateNameSnapshot: string | null;
  receiptTemplateLayoutSnapshot: ReceiptLayout | null;
  receiptLogoUrlSnapshot: string | null;
  receiptLocaleSnapshot: string;
}

export async function resolveSaleHeaderReceiptSnapshots(
  db: DatabaseInstance,
  tenantId: string,
  input: {
    customerId: string | null | undefined;
    siteId: string;
    cashierId: string;
  }
): Promise<SaleHeaderReceiptSnapshots> {
  const saleTemplate =
    listReceiptTemplates(db, tenantId, {
      kind: 'sale',
      includeInactive: false,
      limit: 1,
    })[0] ?? null;
  const [customer, siteCompany, cashier, tenantLocale] = await Promise.all([
    input.customerId
      ? db
          .select({ name: customers.name, taxId: customers.taxId })
          .from(customers)
          .where(and(eq(customers.id, input.customerId), eq(customers.tenantId, tenantId)))
          .get()
      : Promise.resolve(undefined),
    db
      .select({
        siteName: sites.name,
        companyName: companies.name,
        companyTaxId: companies.taxId,
        companyAddress: companies.address,
        companyPhone: companies.phone,
        companyEmail: companies.email,
        companyLogoUrl: companies.logoUrl,
      })
      .from(sites)
      .innerJoin(
        companies,
        and(eq(companies.id, sites.companyId), eq(companies.tenantId, tenantId))
      )
      .where(and(eq(sites.id, input.siteId), eq(sites.tenantId, tenantId)))
      .get(),
    db
      .select({ name: users.name })
      .from(users)
      .where(and(eq(users.id, input.cashierId), eq(users.tenantId, tenantId)))
      .get(),
    resolveTenantLocale(db, tenantId),
  ]);

  if (!siteCompany) {
    throw new Error(`Cannot snapshot receipt identity for missing tenant site ${input.siteId}`);
  }

  return {
    customerNameSnapshot: customer?.name ?? null,
    siteNameSnapshot: siteCompany.siteName,
    cashierNameSnapshot: cashier?.name ?? null,
    receiptIdentitySnapshotVersion: RECEIPT_IDENTITY_SNAPSHOT_VERSION,
    companyNameSnapshot: siteCompany.companyName,
    companyTaxIdSnapshot: siteCompany.companyTaxId,
    companyAddressSnapshot: siteCompany.companyAddress,
    companyPhoneSnapshot: siteCompany.companyPhone,
    companyEmailSnapshot: siteCompany.companyEmail,
    customerTaxIdSnapshot: customer?.taxId ?? null,
    receiptPresentationSnapshotVersion: RECEIPT_PRESENTATION_SNAPSHOT_VERSION,
    receiptTemplateIdSnapshot: saleTemplate?.id ?? null,
    receiptTemplateKindSnapshot: saleTemplate ? 'sale' : null,
    receiptTemplateNameSnapshot: saleTemplate?.name ?? null,
    receiptTemplateLayoutSnapshot: saleTemplate?.layout ?? null,
    receiptLogoUrlSnapshot: siteCompany.companyLogoUrl,
    receiptLocaleSnapshot: tenantLocale.locale,
  };
}
