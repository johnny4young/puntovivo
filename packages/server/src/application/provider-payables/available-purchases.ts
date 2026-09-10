import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { providerPayableInvoices, purchases, sites } from '../../db/schema.js';
import type { AvailableProviderPurchasesInput } from '../../trpc/schemas/providerPayables.js';

/** Shared bounded projection for legacy overview and the searchable picker. */
export function readAvailableProviderPurchases(
  db: DatabaseInstance,
  tenantId: string,
  input: AvailableProviderPurchasesInput
) {
  const conditions = and(
    eq(purchases.tenantId, tenantId),
    eq(purchases.providerId, input.providerId),
    eq(purchases.status, 'completed'),
    eq(sites.tenantId, tenantId),
    isNull(providerPayableInvoices.id),
    input.siteId ? eq(purchases.siteId, input.siteId) : undefined,
    // Literal substring matching: '%' and '_' in a purchase number must not
    // expand into a wildcard query. Search stays inside this provider/tenant.
    input.search
      ? sql`instr(lower(${purchases.purchaseNumber}), lower(${input.search})) > 0`
      : undefined
  );
  const invoiceJoin = and(
    eq(providerPayableInvoices.tenantId, tenantId),
    eq(providerPayableInvoices.purchaseId, purchases.id)
  );
  // Count and rows describe the same SQLite read snapshot; another terminal
  // may invoice a purchase, but cannot make this response internally disagree.
  return db.transaction(tx => {
    const total =
      tx
        .select({ count: sql<number>`count(*)` })
        .from(purchases)
        .innerJoin(sites, eq(purchases.siteId, sites.id))
        .leftJoin(providerPayableInvoices, invoiceJoin)
        .where(conditions)
        .get()?.count ?? 0;
    const pageCount = Math.max(1, Math.ceil(total / input.perPage));
    const page = Math.min(input.page, pageCount);
    const items = tx
      .select({
        id: purchases.id,
        purchaseNumber: purchases.purchaseNumber,
        total: purchases.total,
        siteId: purchases.siteId,
        siteName: sites.name,
        createdAt: purchases.createdAt,
      })
      .from(purchases)
      .innerJoin(sites, eq(purchases.siteId, sites.id))
      .leftJoin(providerPayableInvoices, invoiceJoin)
      .where(conditions)
      .orderBy(desc(purchases.createdAt), desc(purchases.id))
      .limit(input.perPage)
      .offset((page - 1) * input.perPage)
      .all();
    return { items, total, page, perPage: input.perPage, pageCount };
  });
}
