/**
 * An emitted document carries what the sale recorded, or it is not emitted.
 *
 * Two fallbacks used to replace a missing sale-time snapshot with the
 * catalog's CURRENT value:
 *
 *   snapshots.ts     productName: snapshot ?? liveProductName ?? 'Unknown product'
 *   return-planner   productNameSnapshot: snapshot ?? line.productName
 *
 * Both attest, on a legally binding document, to something the sale never
 * recorded — and the first could put the literal string `Unknown product` on
 * an invoice. Migration `0052` states the rule the rest of the subsystem
 * follows: snapshots are copied verbatim and stay null where the sale recorded
 * nothing, because freezing today's name after a rename fabricates history.
 *
 * The refusal lives at the document boundary, in `tax-lines.ts`, because that
 * is the only place a `ResolvedLine` becomes part of a document. Callers
 * upstream fail earlier and more usefully — the enqueue reader refuses, and
 * `prepareSaleFiscalIntent` records a durable blocked intent rather than
 * throwing while a sale is being completed.
 *
 * @module __tests__/fiscal-line-snapshot-fabrication.test
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
  sales,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { resolveLines } from '../services/fiscal/orchestrator/snapshots.js';
import { toAdapterLines, toDocumentItemValues } from '../services/fiscal/orchestrator/tax-lines.js';
import type { ResolvedLine } from '../services/fiscal/orchestrator/types.js';

const TENANT = 'tenant-fab';
const SALE = 'sale-fab';
const SALE_ITEM = 'sale-item-fab';
const PRODUCT = 'product-fab';

let server: PuntovivoServer;

/** A line shaped like the resolver's output, with only the name in question. */
function lineWithName(productName: string | null): ResolvedLine {
  return {
    lineNumber: 1,
    productId: PRODUCT,
    productName,
    productSku: null,
    quantity: 1,
    unitPrice: 100,
    discountAmount: 0,
    taxRate: 19,
    taxKind: 'iva',
    taxAmount: 19,
    lineTotal: 119,
    unitStandardCode: null,
  } as ResolvedLine;
}

async function setSaleLineSnapshot(name: string | null, sku: string | null): Promise<void> {
  await getDatabase()
    .update(saleItems)
    .set({ productNameSnapshot: name, productSkuSnapshot: sku })
    .where(eq(saleItems.id, SALE_ITEM));
}

describe('fiscal lines never invent a sale-time description', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();

    await db.insert(tenants).values({ id: TENANT, name: 'Fab', slug: 'fab' });
    await db.insert(companies).values({ id: 'company-fab', tenantId: TENANT, name: 'Fab' });
    await db
      .insert(sites)
      .values({ id: 'site-fab', tenantId: TENANT, companyId: 'company-fab', name: 'Central' });
    await db.insert(users).values({
      id: 'user-fab',
      tenantId: TENANT,
      name: 'Cashier',
      email: 'fab@example.test',
      passwordHash: 'unused',
      role: 'admin',
    });
    await db.insert(products).values({
      id: PRODUCT,
      tenantId: TENANT,
      // Renamed AFTER the sale. Any fallback to the live catalog puts this
      // string on the document, which is the failure mode under test.
      name: 'Renamed after the sale',
      sku: 'SKU-RENAMED',
    });
    await db.insert(cashSessions).values({
      id: 'cash-fab',
      tenantId: TENANT,
      siteId: 'site-fab',
      cashierId: 'user-fab',
      registerName: 'Caja 1',
      openingCountDenominations: [],
    });
    await db.insert(sales).values({
      id: SALE,
      tenantId: TENANT,
      saleNumber: 'VTA-FAB-1',
      subtotal: 100,
      taxAmount: 19,
      total: 119,
      status: 'completed',
      createdBy: 'user-fab',
      cashSessionId: 'cash-fab',
    });
    await db.insert(saleItems).values({
      id: SALE_ITEM,
      saleId: SALE,
      productId: PRODUCT,
      productNameSnapshot: 'Name as sold',
      productSkuSnapshot: 'SKU-AS-SOLD',
      quantity: 1,
      unitPrice: 100,
      taxRate: 19,
      taxAmount: 19,
      total: 119,
    });
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    await setSaleLineSnapshot('Name as sold', 'SKU-AS-SOLD');
  });

  it('resolves the sale-time name, never the name the product now carries', async () => {
    const lines = await resolveLines(getDatabase(), TENANT, SALE);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.productName).toBe('Name as sold');
    expect(lines[0]?.productName).not.toBe('Renamed after the sale');
    expect(lines[0]?.productSku).toBe('SKU-AS-SOLD');
  });

  it('resolves null when the sale recorded nothing, rather than the catalog name', async () => {
    // The load-bearing assertion. Before this change the resolver returned
    // `liveProductName`, so a renamed product silently attested under its new
    // name, and a product with no name at all produced the literal string
    // 'Unknown product'.
    await setSaleLineSnapshot(null, null);
    const lines = await resolveLines(getDatabase(), TENANT, SALE);
    expect(lines[0]?.productName).toBeNull();
    expect(lines[0]?.productName).not.toBe('Renamed after the sale');
    expect(lines[0]?.productName).not.toBe('Unknown product');
    expect(lines[0]?.productSku).toBeNull();
  });

  it('refuses to build an adapter line without a recorded description', () => {
    expect(() => toAdapterLines([lineWithName(null)])).toThrowError(
      /no recorded sale-time product description/i
    );
    try {
      toAdapterLines([lineWithName(null)]);
    } catch (error) {
      expect(error).toMatchObject({
        cause: expect.objectContaining({ errorCode: 'FISCAL_LINE_SNAPSHOT_UNKNOWN' }),
      });
    }
  });

  it('refuses to build a frozen document item without one either', () => {
    // Both document boundaries share one refusal. Guarding only the adapter
    // would still let the persisted fiscal_document_items row carry a
    // fabricated name, which is the copy an audit reads.
    expect(() => toDocumentItemValues('doc-1', lineWithName(null))).toThrowError(
      /no recorded sale-time product description/i
    );
  });

  it('builds both when the description is present, so the guard is not blanket', () => {
    // Guards the guard: an implementation that threw unconditionally would
    // satisfy every refusal above.
    const [adapterLine] = toAdapterLines([lineWithName('Name as sold')]);
    expect(adapterLine?.productName).toBe('Name as sold');
    expect(toDocumentItemValues('doc-1', lineWithName('Name as sold')).productName).toBe(
      'Name as sold'
    );
  });
});
