/**
 * A credit note never invents what the sale did not record.
 *
 * `sale_return_items.product_name_snapshot` is nullable on purpose. Migration
 * `0052` backfills every legacy full-ticket return by copying the sale line's
 * snapshot VERBATIM, and leaves it NULL when the sale predates those columns —
 * its own comment says "Unknown provenance stays explicitly unknown", because
 * a credit note is a legally binding attestation about what was sold
 * (Resolución DIAN 165/2023 freezes the emitted document's line data).
 * Substituting the catalog's CURRENT name would attest to something the sale
 * never recorded, so `resolveReturnLines` fails closed with
 * `FISCAL_RETURN_SNAPSHOT_UNKNOWN`.
 *
 * That guard had ZERO tests, which is how migration `0090` was able to tighten
 * the column to NOT NULL and make it unreachable without anything going red.
 * These tests are the reason that cannot happen again: a tightening now has to
 * delete a failing assertion, not merely edit a column type.
 *
 * @module __tests__/fiscal-return-snapshot-unknown.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  cashSessions,
  companies,
  products,
  saleItems,
  saleReturnItems,
  saleReturns,
  sales,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { resolveFiscalDocumentSnapshot } from '../services/fiscal/orchestrator/snapshots.js';

const TENANT = 'tenant-fiscal-return';
const SALE = 'sale-fiscal-return';
const RETURN = 'return-fiscal-return';
const RETURN_ITEM = 'return-item-fiscal-return';
const PRODUCT = 'product-fiscal-return';

let server: PuntovivoServer;

/** The header amounts the orchestrator passes in for a full-ticket source. */
const SALE_AMOUNTS = { subtotal: 100, taxAmount: 19, discountAmount: 0, total: 119 };

async function resolveReturnSnapshot() {
  return resolveFiscalDocumentSnapshot(getDatabase(), {
    tenantId: TENANT,
    source: 'return',
    sourceId: RETURN,
    saleId: SALE,
    sale: SALE_AMOUNTS,
  });
}

/** Rewrite just the frozen labels on the single return line. */
async function setLineSnapshot(name: string | null, sku: string | null): Promise<void> {
  await getDatabase()
    .update(saleReturnItems)
    .set({ productNameSnapshot: name, productSkuSnapshot: sku })
    .where(eq(saleReturnItems.id, RETURN_ITEM));
}

describe('credit note lines from a return with no sale-time snapshot', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();

    await db.insert(tenants).values({ id: TENANT, name: 'Fiscal Return', slug: 'fiscal-return' });
    await db
      .insert(companies)
      .values({ id: 'company-fiscal-return', tenantId: TENANT, name: 'Fiscal Return' });
    await db.insert(sites).values({
      id: 'site-fiscal-return',
      tenantId: TENANT,
      companyId: 'company-fiscal-return',
      name: 'Central',
    });
    await db.insert(users).values({
      id: 'user-fiscal-return',
      tenantId: TENANT,
      name: 'Cashier',
      email: 'fiscal-return@example.test',
      passwordHash: 'unused',
      role: 'admin',
    });
    await db.insert(products).values({
      id: PRODUCT,
      tenantId: TENANT,
      // Renamed AFTER the sale. Any fallback to the live catalog would put
      // this string on the credit note, which is precisely the failure mode.
      name: 'Renamed after the sale',
      sku: 'SKU-RENAMED',
    });
    await db.insert(cashSessions).values({
      id: 'cash-fiscal-return',
      tenantId: TENANT,
      siteId: 'site-fiscal-return',
      cashierId: 'user-fiscal-return',
      registerName: 'Caja 1',
      openingCountDenominations: [],
    });
    await db.insert(sales).values({
      id: SALE,
      tenantId: TENANT,
      saleNumber: 'VTA-FISCAL-RETURN-1',
      subtotal: 100,
      taxAmount: 19,
      total: 119,
      status: 'completed',
      createdBy: 'user-fiscal-return',
      cashSessionId: 'cash-fiscal-return',
    });
    await db.insert(saleItems).values({
      id: 'sale-item-fiscal-return',
      saleId: SALE,
      productId: PRODUCT,
      quantity: 1,
      unitPrice: 100,
      taxRate: 19,
      taxAmount: 19,
      total: 119,
    });
    await db.insert(saleReturns).values({
      id: RETURN,
      tenantId: TENANT,
      saleId: SALE,
      subtotal: 100,
      taxAmount: 19,
      refundAmount: 119,
      createdBy: 'user-fiscal-return',
    });
    await db.insert(saleReturnItems).values({
      id: RETURN_ITEM,
      tenantId: TENANT,
      saleReturnId: RETURN,
      saleItemId: 'sale-item-fiscal-return',
      productId: PRODUCT,
      productNameSnapshot: 'Name as sold',
      productSkuSnapshot: 'SKU-AS-SOLD',
      quantity: 1,
      baseQuantity: 1,
      unitPrice: 100,
      unitEquivalence: 1,
      taxRate: 19,
      subtotal: 100,
      taxAmount: 19,
      total: 119,
    });
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    await setLineSnapshot('Name as sold', 'SKU-AS-SOLD');
  });

  it('refuses to resolve a line whose sale-time name was never recorded', async () => {
    await setLineSnapshot(null, null);
    await expect(resolveReturnSnapshot()).rejects.toMatchObject({
      // The operator gets a specific, translatable reason rather than a
      // generic failure, and the document is never created.
      cause: expect.objectContaining({ errorCode: 'FISCAL_RETURN_SNAPSHOT_UNKNOWN' }),
    });
  });

  it('refuses even when only the name is missing and the sku survives', async () => {
    // The name is what the buyer reads on the credit note; a surviving sku is
    // not evidence of the description.
    await setLineSnapshot(null, 'SKU-AS-SOLD');
    await expect(resolveReturnSnapshot()).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'FISCAL_RETURN_SNAPSHOT_UNKNOWN' }),
    });
  });

  it('resolves the line when the snapshot exists, so the guard is not blanket', async () => {
    // Guards the guard: without this, an implementation that threw
    // unconditionally would satisfy every assertion above.
    const resolved = await resolveReturnSnapshot();
    expect(resolved.lines).toHaveLength(1);
    expect(resolved.lines[0]?.productName).toBe('Name as sold');
  });

  it('carries the sale-time name, never the catalog name it was renamed to', async () => {
    // The invariant the guard exists to protect. The product row says
    // "Renamed after the sale"; the credit note must not.
    const resolved = await resolveReturnSnapshot();
    expect(resolved.lines[0]?.productName).toBe('Name as sold');
    expect(resolved.lines[0]?.productName).not.toBe('Renamed after the sale');
    expect(resolved.lines[0]?.productSku).toBe('SKU-AS-SOLD');
  });

  it('keeps the column nullable, which is what makes the guard reachable', async () => {
    // Pins the schema decision itself. Re-tightening this to NOT NULL turns
    // every assertion above into dead code, and crashes the upgrade of any
    // database carrying a return that 0052 backfilled with no snapshot.
    await expect(setLineSnapshot(null, null)).resolves.not.toThrow();
    const row = await getDatabase()
      .select({ name: saleReturnItems.productNameSnapshot })
      .from(saleReturnItems)
      .where(eq(saleReturnItems.id, RETURN_ITEM))
      .get();
    expect(row?.name).toBeNull();
  });
});
