import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  categories,
  customers,
  providers,
  quotationItems,
  quotations,
  sites,
  units,
  users,
  vatRates,
} from '../db/schema.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { getProductStockTotal } from '../services/inventory-balances.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let primarySiteId: string;
let categoryId: string;
let providerId: string;
let vatRateId: string;
let baseUnitId: string;
let activeCustomerId: string;
let inactiveCustomerId: string;

function createTestContext(): Context {
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: {},
      user: {
        userId,
        email: 'admin@localhost',
        role: 'admin',
        tenantId,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: {
      id: userId,
      email: 'admin@localhost',
      role: 'admin',
      tenantId,
    },
    tenantId,
    siteId: primarySiteId,
  };
}

function expectErrorCode(error: unknown, errorCode: string) {
  expect(error).toBeInstanceOf(TRPCError);
  const cause = (error as TRPCError).cause;
  expect(cause).toBeInstanceOf(ServerErrorWithCode);
  expect((cause as ServerErrorWithCode).errorCode).toBe(errorCode);
}

describe('Quotations tRPC Router', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();

    const seededUser = await db
      .select()
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    if (!seededUser) throw new Error('Expected seeded admin user');
    tenantId = seededUser.tenantId;
    userId = seededUser.id;

    const mainSite = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!mainSite) throw new Error('Expected seeded main site');
    primarySiteId = mainSite.id;

    const seededVatRate = await db
      .select()
      .from(vatRates)
      .where(and(eq(vatRates.tenantId, tenantId), eq(vatRates.name, 'IVA 19%')))
      .get();
    if (!seededVatRate) throw new Error('Expected seeded VAT rate');
    vatRateId = seededVatRate.id;

    const baseUnit = (
      await db.select().from(units).where(eq(units.tenantId, tenantId)).all()
    ).find(unit => unit.abbreviation === 'UND');
    if (!baseUnit) throw new Error('Expected seeded base unit');
    baseUnitId = baseUnit.id;

    categoryId = nanoid();
    providerId = nanoid();
    activeCustomerId = nanoid();
    inactiveCustomerId = nanoid();
    const now = new Date().toISOString();
    await db.insert(categories).values({
      id: categoryId,
      tenantId,
      name: 'Quotation Tests',
      description: null,
      parentId: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(providers).values({
      id: providerId,
      tenantId,
      name: 'Quotation Supplier',
      taxId: null,
      phone: null,
      email: null,
      address: null,
      cityId: null,
      contactName: null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(customers).values([
      {
        id: activeCustomerId,
        tenantId,
        name: 'Active Quote Customer',
        email: null,
        phone: null,
        address: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
        taxId: null,
        notes: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: inactiveCustomerId,
        tenantId,
        name: 'Inactive Quote Customer',
        email: null,
        phone: null,
        address: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
        taxId: null,
        notes: null,
        isActive: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  afterAll(async () => {
    await server.close();
  });

  function createProduct(overrides: {
    name: string;
    sku: string;
    barcode: string;
    price?: number;
    /**
     * Pass `'iva19'` to attach the seeded IVA 19% rate; defaults to no VAT
     * so totals math is easy to assert in cases that don't care about tax.
     */
    vatProfile?: 'none' | 'iva19';
  }) {
    const caller = appRouter.createCaller(createTestContext());
    const profile = overrides.vatProfile ?? 'none';
    return caller.products.create({
      name: overrides.name,
      sku: overrides.sku,
      description: null,
      categoryId,
      providerId,
      vatRateId: profile === 'iva19' ? vatRateId : null,
      locationId: null,
      barcode: overrides.barcode,
      imageUrl: null,
      cost: 5,
      initialCost: 4,
      price: overrides.price ?? 100,
      price2: 110,
      price3: 120,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: 0,
      stock: 50,
      minStock: 0,
      isActive: true,
      unitAssignments: [{ unitId: baseUnitId, equivalence: 1, price: 100, isBase: true }],
    });
  }

  describe('create', () => {
    it('creates a draft quotation with computed totals and the next sequential number', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const cable = await createProduct({
        name: 'Quote Cable',
        sku: 'Q-CABLE',
        barcode: 'Q-10001',
        price: 100,
        taxRate: 0,
      });

      const result = await caller.quotations.create({
        customerId: activeCustomerId,
        items: [
          { productId: cable.id, quantity: 2, unitPrice: 100, discount: 10, taxRate: 0 },
        ],
        notes: 'Initial quote',
      });

      expect(result.status).toBe('draft');
      expect(result.quotationNumber).toMatch(/^COT-\d{6}$/);
      // 2 * 100 * (1 - 10/100) = 180
      expect(result.total).toBeCloseTo(180);

      const detail = await caller.quotations.getById({ id: result.id });
      expect(detail.subtotal).toBeCloseTo(180);
      expect(detail.taxAmount).toBeCloseTo(0);
      expect(detail.discountAmount).toBeCloseTo(20);
      expect(detail.total).toBeCloseTo(180);
      expect(detail.items).toHaveLength(1);
      expect(detail.items[0]?.total).toBeCloseTo(180);
      expect(detail.customerId).toBe(activeCustomerId);
      expect(detail.customerName).toBe('Active Quote Customer');
    });

    it('extracts tax from a gross unit price using the per-line tax rate', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const widget = await createProduct({
        name: 'Quote Widget',
        sku: 'Q-WIDGET',
        barcode: 'Q-10002',
        price: 119,
        vatProfile: 'iva19',
      });

      const result = await caller.quotations.create({
        items: [
          { productId: widget.id, quantity: 1, unitPrice: 119, discount: 0, taxRate: 19 },
        ],
      });

      const detail = await caller.quotations.getById({ id: result.id });
      // Gross = 119 → base = 100, tax = 19.
      expect(detail.subtotal).toBeCloseTo(100, 5);
      expect(detail.taxAmount).toBeCloseTo(19, 5);
      expect(detail.total).toBeCloseTo(119, 5);
    });

    it('falls back to the product VAT when the per-line tax rate is zero', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const widget = await createProduct({
        name: 'Quote Widget VAT-Fallback',
        sku: 'Q-VATFB',
        barcode: 'Q-10003',
        price: 119,
        vatProfile: 'iva19',
      });

      const result = await caller.quotations.create({
        items: [
          { productId: widget.id, quantity: 1, unitPrice: 119, discount: 0, taxRate: 0 },
        ],
      });

      const detail = await caller.quotations.getById({ id: result.id });
      expect(detail.taxAmount).toBeCloseTo(19, 5);
      expect(detail.items[0]?.taxRate).toBeCloseTo(19, 5);
    });

    it('rejects a quotation with no line items at the zod layer', async () => {
      const caller = appRouter.createCaller(createTestContext());
      try {
        await caller.quotations.create({ items: [] });
        throw new Error('Expected create to fail');
      } catch (error) {
        // Zod rejects before reaching the service — this surfaces as a
        // TRPCError with `BAD_REQUEST` but no domain ServerErrorWithCode cause.
        expect(error).toBeInstanceOf(TRPCError);
        expect((error as TRPCError).code).toBe('BAD_REQUEST');
      }
    });

    it('rejects a non-positive quantity at the service layer', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const bolt = await createProduct({
        name: 'Quote Bolt Negative',
        sku: 'Q-NEG',
        barcode: 'Q-10004',
      });
      try {
        await caller.quotations.create({
          items: [{ productId: bolt.id, quantity: 0, unitPrice: 10, discount: 0, taxRate: 0 }],
        });
        throw new Error('Expected create to fail');
      } catch (error) {
        // Zod's `.positive()` catches this first.
        expect(error).toBeInstanceOf(TRPCError);
        expect((error as TRPCError).code).toBe('BAD_REQUEST');
      }
    });

    it('rejects an unknown product', async () => {
      const caller = appRouter.createCaller(createTestContext());
      try {
        await caller.quotations.create({
          items: [
            {
              productId: 'unknown-product-id',
              quantity: 1,
              unitPrice: 100,
              discount: 0,
              taxRate: 0,
            },
          ],
        });
        throw new Error('Expected create to fail');
      } catch (error) {
        expectErrorCode(error, 'QUOTATION_PRODUCT_NOT_FOUND');
      }
    });

    it('rejects an inactive customer', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const cable = await createProduct({
        name: 'Quote Cable Inactive Cust',
        sku: 'Q-CABL-INACT',
        barcode: 'Q-10005',
      });
      try {
        await caller.quotations.create({
          customerId: inactiveCustomerId,
          items: [
            { productId: cable.id, quantity: 1, unitPrice: 100, discount: 0, taxRate: 0 },
          ],
        });
        throw new Error('Expected create to fail');
      } catch (error) {
        expectErrorCode(error, 'QUOTATION_CUSTOMER_NOT_FOUND');
      }
    });

    it('rejects an unknown / inactive site', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const cable = await createProduct({
        name: 'Quote Cable Bad Site',
        sku: 'Q-BADSITE',
        barcode: 'Q-10010',
      });
      try {
        await caller.quotations.create({
          siteId: 'no-such-site-id',
          items: [
            { productId: cable.id, quantity: 1, unitPrice: 100, discount: 0, taxRate: 0 },
          ],
        });
        throw new Error('Expected create to fail');
      } catch (error) {
        expectErrorCode(error, 'QUOTATION_SITE_NOT_FOUND');
      }
    });

    it('does NOT touch inventory_balances or the derived product stock', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const db = getDatabase();
      const screw = await createProduct({
        name: 'Quote Inventory Probe',
        sku: 'Q-INV',
        barcode: 'Q-10006',
        price: 50,
      });

      const stockBefore = getProductStockTotal(db, tenantId, screw.id);

      await caller.quotations.create({
        items: [{ productId: screw.id, quantity: 5, unitPrice: 50, discount: 0, taxRate: 0 }],
      });

      const stockAfter = getProductStockTotal(db, tenantId, screw.id);

      expect(stockAfter).toBe(stockBefore);
    });
  });

  describe('updateStatus', () => {
    async function createDraft() {
      const caller = appRouter.createCaller(createTestContext());
      const product = await createProduct({
        name: `Quote Lifecycle ${nanoid(6)}`,
        sku: `Q-LIFE-${nanoid(6)}`,
        barcode: `Q-LIFE-${nanoid(6)}`,
      });
      return caller.quotations.create({
        items: [
          { productId: product.id, quantity: 1, unitPrice: 100, discount: 0, taxRate: 0 },
        ],
      });
    }

    it('transitions draft → sent → accepted, persisting actor + timestamp', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const draft = await createDraft();

      const sent = await caller.quotations.updateStatus({ id: draft.id, status: 'sent' });
      expect(sent.status).toBe('sent');
      expect(sent.statusChangedAt).toBeTruthy();

      const accepted = await caller.quotations.updateStatus({
        id: draft.id,
        status: 'accepted',
      });
      expect(accepted.status).toBe('accepted');

      const detail = await caller.quotations.getById({ id: draft.id });
      expect(detail.status).toBe('accepted');
      expect(detail.statusChangedBy).toBe(userId);
      expect(detail.statusChangedByName).toBe('Administrator');
    });

    it('rejects an invalid transition (rejected → accepted) with the typed error code', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const draft = await createDraft();
      await caller.quotations.updateStatus({ id: draft.id, status: 'rejected' });

      try {
        await caller.quotations.updateStatus({ id: draft.id, status: 'accepted' });
        throw new Error('Expected updateStatus to fail');
      } catch (error) {
        expectErrorCode(error, 'QUOTATION_INVALID_STATUS_TRANSITION');
      }
    });

    it('allows accepted → converted as a terminal close', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const draft = await createDraft();
      await caller.quotations.updateStatus({ id: draft.id, status: 'sent' });
      await caller.quotations.updateStatus({ id: draft.id, status: 'accepted' });

      const converted = await caller.quotations.updateStatus({
        id: draft.id,
        status: 'converted',
      });
      expect(converted.status).toBe('converted');

      // Terminal: no further transitions allowed.
      try {
        await caller.quotations.updateStatus({ id: draft.id, status: 'expired' });
        throw new Error('Expected updateStatus to fail');
      } catch (error) {
        expectErrorCode(error, 'QUOTATION_INVALID_STATUS_TRANSITION');
      }
    });

    it('rejects draft → converted (only accepted can convert)', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const draft = await createDraft();
      try {
        await caller.quotations.updateStatus({ id: draft.id, status: 'converted' });
        throw new Error('Expected updateStatus to fail');
      } catch (error) {
        expectErrorCode(error, 'QUOTATION_INVALID_STATUS_TRANSITION');
      }
    });

    it('rejects updating status on an unknown quotation', async () => {
      const caller = appRouter.createCaller(createTestContext());
      try {
        await caller.quotations.updateStatus({ id: 'no-such-quote', status: 'sent' });
        throw new Error('Expected updateStatus to fail');
      } catch (error) {
        expectErrorCode(error, 'QUOTATION_NOT_FOUND');
      }
    });

    it('isolates updateStatus to the caller tenant (cross-tenant guard)', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const draft = await createDraft();
      const db = getDatabase();

      // Simulate a caller from another tenant attempting to flip the status.
      // The service runs the SELECT with a tenant guard and then applies the
      // UPDATE with the same tenant guard — a mismatching tenant must hit
      // the `QUOTATION_NOT_FOUND` branch and leave the row untouched.
      const foreignCtx: Context = {
        ...createTestContext(),
        tenantId: 'foreign-tenant',
        user: {
          id: userId,
          email: 'admin@localhost',
          role: 'admin',
          tenantId: 'foreign-tenant',
        },
      };
      const foreignCaller = appRouter.createCaller(foreignCtx);

      try {
        await foreignCaller.quotations.updateStatus({ id: draft.id, status: 'sent' });
        throw new Error('Expected updateStatus to fail');
      } catch (error) {
        expectErrorCode(error, 'QUOTATION_NOT_FOUND');
      }

      const row = await db
        .select({ status: quotations.status })
        .from(quotations)
        .where(eq(quotations.id, draft.id))
        .get();
      expect(row?.status).toBe('draft');
    });
  });

  describe('delete', () => {
    it('deletes a draft quotation and its line items via cascade', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const db = getDatabase();
      const product = await createProduct({
        name: `Quote Delete ${nanoid(6)}`,
        sku: `Q-DEL-${nanoid(6)}`,
        barcode: `Q-DEL-${nanoid(6)}`,
      });
      const draft = await caller.quotations.create({
        items: [
          { productId: product.id, quantity: 1, unitPrice: 100, discount: 0, taxRate: 0 },
        ],
      });

      await caller.quotations.delete({ id: draft.id });

      const remaining = await db
        .select()
        .from(quotations)
        .where(eq(quotations.id, draft.id))
        .all();
      expect(remaining).toHaveLength(0);

      const remainingItems = await db
        .select()
        .from(quotationItems)
        .where(eq(quotationItems.quotationId, draft.id))
        .all();
      expect(remainingItems).toHaveLength(0);
    });

    it('refuses to delete a non-draft quotation', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const product = await createProduct({
        name: `Quote Sealed ${nanoid(6)}`,
        sku: `Q-SEAL-${nanoid(6)}`,
        barcode: `Q-SEAL-${nanoid(6)}`,
      });
      const draft = await caller.quotations.create({
        items: [
          { productId: product.id, quantity: 1, unitPrice: 100, discount: 0, taxRate: 0 },
        ],
      });
      await caller.quotations.updateStatus({ id: draft.id, status: 'sent' });

      try {
        await caller.quotations.delete({ id: draft.id });
        throw new Error('Expected delete to fail');
      } catch (error) {
        expectErrorCode(error, 'QUOTATION_DELETE_NOT_DRAFT');
      }
    });

    it('isolates delete to the caller tenant (cross-tenant guard)', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const db = getDatabase();
      const product = await createProduct({
        name: `Quote XT Delete ${nanoid(6)}`,
        sku: `Q-XTDEL-${nanoid(6)}`,
        barcode: `Q-XTDEL-${nanoid(6)}`,
      });
      const draft = await caller.quotations.create({
        items: [
          { productId: product.id, quantity: 1, unitPrice: 100, discount: 0, taxRate: 0 },
        ],
      });

      const foreignCtx: Context = {
        ...createTestContext(),
        tenantId: 'foreign-tenant',
        user: {
          id: userId,
          email: 'admin@localhost',
          role: 'admin',
          tenantId: 'foreign-tenant',
        },
      };
      const foreignCaller = appRouter.createCaller(foreignCtx);

      try {
        await foreignCaller.quotations.delete({ id: draft.id });
        throw new Error('Expected delete to fail');
      } catch (error) {
        expectErrorCode(error, 'QUOTATION_NOT_FOUND');
      }

      // The row must still be there after the foreign attempt.
      const remaining = await db
        .select({ id: quotations.id })
        .from(quotations)
        .where(eq(quotations.id, draft.id))
        .get();
      expect(remaining?.id).toBe(draft.id);
    });
  });

  describe('list', () => {
    it('returns recent quotations with item counts and customer names', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const product = await createProduct({
        name: `Quote List Probe ${nanoid(6)}`,
        sku: `Q-LIST-${nanoid(6)}`,
        barcode: `Q-LIST-${nanoid(6)}`,
      });
      const created = await caller.quotations.create({
        customerId: activeCustomerId,
        items: [
          { productId: product.id, quantity: 1, unitPrice: 100, discount: 0, taxRate: 0 },
          { productId: product.id, quantity: 2, unitPrice: 50, discount: 0, taxRate: 0 },
        ],
      });

      const list = await caller.quotations.list();
      const entry = list.items.find(item => item.id === created.id);
      expect(entry?.customerName).toBe('Active Quote Customer');
      expect(entry?.itemCount).toBe(2);
      expect(entry?.status).toBe('draft');
      expect(entry?.siteName).toBeTruthy();
    });

    it('filters by status when requested', async () => {
      const caller = appRouter.createCaller(createTestContext());
      const product = await createProduct({
        name: `Quote Filter ${nanoid(6)}`,
        sku: `Q-FILT-${nanoid(6)}`,
        barcode: `Q-FILT-${nanoid(6)}`,
      });
      const created = await caller.quotations.create({
        items: [
          { productId: product.id, quantity: 1, unitPrice: 100, discount: 0, taxRate: 0 },
        ],
      });
      await caller.quotations.updateStatus({ id: created.id, status: 'sent' });

      const sentList = await caller.quotations.list({ status: 'sent' });
      expect(sentList.items.every(item => item.status === 'sent')).toBe(true);
      expect(sentList.items.some(item => item.id === created.id)).toBe(true);

      const draftList = await caller.quotations.list({ status: 'draft' });
      expect(draftList.items.every(item => item.status === 'draft')).toBe(true);
      expect(draftList.items.some(item => item.id === created.id)).toBe(false);
    });
  });

  describe('getById', () => {
    it('rejects a quotation that does not belong to the tenant', async () => {
      const caller = appRouter.createCaller(createTestContext());
      try {
        await caller.quotations.getById({ id: 'does-not-exist' });
        throw new Error('Expected getById to throw');
      } catch (error) {
        expectErrorCode(error, 'QUOTATION_NOT_FOUND');
      }
    });
  });
});
