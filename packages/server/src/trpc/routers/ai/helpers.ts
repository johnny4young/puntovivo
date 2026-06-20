/**
 * AI router shared helpers (ENG-178 split).
 *
 * Leaf module: the tax-id normalizer + the provider lookup used by the invoice
 * OCR extract path to map a parsed supplier (NIT / name) to an existing
 * provider row. Imported by `invoiceOcr.ts`; never imports a router module.
 *
 * @module trpc/routers/ai/helpers
 */

import { and, eq } from 'drizzle-orm';
import { providers } from '../../../db/schema.js';
import type { DatabaseInstance } from '../../../db/index.js';

function normalizeTaxId(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

export async function findProviderIdForInvoice(
  db: DatabaseInstance,
  tenantId: string,
  supplier: { name: string; nit: string | null }
): Promise<string | null> {
  const rows = await db
    .select({ id: providers.id, name: providers.name, taxId: providers.taxId })
    .from(providers)
    .where(and(eq(providers.tenantId, tenantId), eq(providers.isActive, true)))
    .all();
  const targetNit = normalizeTaxId(supplier.nit);
  if (targetNit) {
    const byNit = rows.find(row => normalizeTaxId(row.taxId) === targetNit);
    if (byNit) return byNit.id;
  }

  const supplierName = supplier.name.trim().toLowerCase();
  if (!supplierName) return null;
  const byName = rows.find(row => {
    const candidate = row.name.trim().toLowerCase();
    return candidate === supplierName || supplierName.includes(candidate) || candidate.includes(supplierName);
  });
  return byName?.id ?? null;
}
