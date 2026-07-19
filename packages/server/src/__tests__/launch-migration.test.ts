import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  auditLogs,
  initialInventory,
  inventoryBalances,
  products,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { getDatabase, type DatabaseInstance } from '../db/index.js';
import { createServer, type PuntovivoServer } from '../index.js';
import { parseImportNumber } from '../application/launch-migration/index.js';
import type { Context } from '../trpc/context.js';
import { appRouter } from '../trpc/router.js';
import { previewLaunchProductImportInput } from '../trpc/schemas/launchMigration.js';

let server: PuntovivoServer;
let db: DatabaseInstance;
let tenantId: string;
let userId: string;
let siteId: string;

function createTestContext(
  role: Context['user'] extends infer U ? NonNullable<U>['role'] : never = 'admin'
): Context {
  return {
    req: {
      server: server.app,
      headers: {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: {
      id: userId,
      email: 'admin@localhost',
      role,
      tenantId,
    },
    tenantId,
    siteId,
  };
}

function row(
  rowNumber: number,
  values: Partial<{
    name: string;
    sku: string;
    description: string;
    barcode: string;
    price: string;
    cost: string;
    stock: string;
    minStock: string;
    taxRate: string;
    tracksLots: string;
  }>
) {
  return { rowNumber, values };
}

describe('ENG-123a launch migration', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    db = getDatabase();
    const admin = await db
      .select({ id: users.id, tenantId: users.tenantId })
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    if (!admin) throw new Error('Expected seeded admin');
    tenantId = admin.tenantId;
    userId = admin.id;
    const site = await db
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.tenantId, tenantId))
      .get();
    if (!site) throw new Error('Expected seeded site');
    siteId = site.id;

    await appRouter.createCaller(createTestContext()).products.create({
      name: 'Existing product',
      sku: 'EXISTING-123A',
      barcode: ' 7700000123000 ',
      price: 10,
      cost: 4,
      stock: 0,
      minStock: 0,
      taxRate: 0,
      initialCost: 4,
      isActive: true,
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('parses dot, comma, currency, and automatic spreadsheet number formats', () => {
    expect(parseImportNumber('1,234.56', 'dot')).toBe(1234.56);
    expect(parseImportNumber('$ 1.234,56', 'comma')).toBe(1234.56);
    expect(parseImportNumber('1,234,567.89', 'dot')).toBe(1234567.89);
    expect(parseImportNumber('1.234.567,89', 'comma')).toBe(1234567.89);
    expect(parseImportNumber('1.234,56', 'auto')).toBe(1234.56);
    expect(parseImportNumber('2.500', 'auto')).toBe(2500);
    expect(parseImportNumber('1234.567', 'auto')).toBe(1234.567);
    expect(parseImportNumber('2,5', 'auto')).toBe(2.5);
    expect(parseImportNumber('not-a-number', 'auto')).toBeNull();
    expect(parseImportNumber('abc12', 'auto')).toBeNull();
    expect(parseImportNumber('=1+1', 'auto')).toBeNull();
    expect(parseImportNumber('1$2', 'auto')).toBeNull();
    expect(parseImportNumber('1,2,3', 'auto')).toBeNull();
    expect(parseImportNumber('1,23.45', 'dot')).toBeNull();
    expect(parseImportNumber('1 2', 'auto')).toBeNull();
    expect(parseImportNumber('1\n2', 'auto')).toBeNull();
    expect(parseImportNumber('1 234,56', 'auto')).toBe(1234.56);
  });

  it('rejects unknown envelope fields and duplicate row numbers', () => {
    expect(
      previewLaunchProductImportInput.safeParse({
        dataMode: 'real',
        sourceName: 'strict.csv',
        rows: [{ ...row(2, { name: 'Strict', sku: 'STRICT-123A' }), unexpected: true }],
      }).success
    ).toBe(false);
    expect(
      previewLaunchProductImportInput.safeParse({
        dataMode: 'real',
        sourceName: 'strict.csv',
        rows: [row(2, { name: 'Strict', sku: 'STRICT-123A' })],
        unexpected: true,
      }).success
    ).toBe(false);
    expect(
      previewLaunchProductImportInput.safeParse({
        dataMode: 'real',
        sourceName: 'duplicates.csv',
        rows: [
          row(2, { name: 'First', sku: 'ROW-FIRST-123A' }),
          row(2, { name: 'Second', sku: 'ROW-SECOND-123A' }),
        ],
      }).success
    ).toBe(false);
  });

  it('returns row-level description length issues within the bounded transport contract', async () => {
    const preview = await appRouter
      .createCaller(createTestContext())
      .launchMigration.previewProducts({
        dataMode: 'demo',
        sourceName: 'descriptions.csv',
        rows: [
          row(2, {
            name: 'Allowed description',
            sku: 'DESCRIPTION-OK-123A',
            description: 'a'.repeat(1_500),
          }),
          row(3, {
            name: 'Long description',
            sku: 'DESCRIPTION-LONG-123A',
            description: 'b'.repeat(2_001),
          }),
        ],
      });

    expect(preview.rows[0]?.status).toBe('ready');
    expect(preview.dataMode).toBe('demo');
    expect(preview.rows[1]).toMatchObject({
      status: 'invalid',
      issues: [{ code: 'too_long', field: 'description' }],
    });
  });

  it('previews normalized rows with tenant-scoped file and database deduplication', async () => {
    const foreignTenantId = nanoid();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign tenant',
      slug: `foreign-${foreignTenantId}`,
      defaultCurrencyCode: 'COP',
      isActive: true,
    });
    await db.insert(products).values({
      id: nanoid(),
      tenantId: foreignTenantId,
      name: 'Foreign-only SKU',
      sku: 'FOREIGN-SAFE-123A',
      price: 1,
      cost: 1,
      initialCost: 1,
      currencyCode: 'COP',
      minStock: 0,
      isActive: true,
      syncStatus: 'pending',
      syncVersion: 1,
    });

    const preview = await appRouter
      .createCaller(createTestContext())
      .launchMigration.previewProducts({
        dataMode: 'real',
        sourceName: 'catalogo-inicial.csv',
        decimalFormat: 'comma',
        rows: [
          row(2, {
            name: 'Café premium',
            sku: 'NEW-123A',
            barcode: '7700000123999',
            price: '12.345,50',
            cost: '7.000,25',
            stock: '2,5',
            minStock: '1',
            taxRate: '19',
          }),
          row(3, { name: 'Repeated', sku: 'new-123a' }),
          row(4, { sku: 'MISSING-NAME' }),
          row(5, { name: 'Exists', sku: ' existing-123a ' }),
          row(6, { name: 'Existing barcode', sku: 'BARCODE-CLASH', barcode: '7700000123000' }),
          row(7, { name: 'Cross tenant safe', sku: 'FOREIGN-SAFE-123A' }),
        ],
      });

    expect(preview.summary).toEqual({ total: 6, ready: 2, duplicates: 3, invalid: 1 });
    expect(preview.rows[0]).toMatchObject({
      rowNumber: 2,
      status: 'ready',
      normalized: { price: 12345.5, cost: 7000.25, stock: 2.5 },
    });
    expect(preview.rows[1]?.issues).toContainEqual({
      code: 'duplicate_file_sku',
      field: 'sku',
    });
    expect(preview.rows[3]?.issues).toContainEqual({
      code: 'duplicate_existing_sku',
      field: 'sku',
    });
    expect(preview.rows[4]?.issues).toContainEqual({
      code: 'duplicate_existing_barcode',
      field: 'barcode',
    });
    expect(preview.rows[5]?.status).toBe('ready');
  });

  it('validates lot-tracking booleans and rejects opening stock without lot evidence', async () => {
    const preview = await appRouter
      .createCaller(createTestContext())
      .launchMigration.previewProducts({
        dataMode: 'real',
        sourceName: 'lot-products.csv',
        rows: [
          row(2, {
            name: 'Tracked medicine',
            sku: 'TRACKED-IMPORT-123A',
            stock: '0',
            tracksLots: 'Sí',
          }),
          row(3, {
            name: 'Unsafe tracked medicine',
            sku: 'TRACKED-STOCK-123A',
            stock: '3',
            tracksLots: 'yes',
          }),
          row(4, {
            name: 'Unknown tracking mode',
            sku: 'TRACKED-INVALID-123A',
            stock: '0',
            tracksLots: 'sometimes',
          }),
        ],
      });

    expect(preview.rows[0]).toMatchObject({
      status: 'ready',
      normalized: { tracksLots: true, stock: 0 },
    });
    expect(preview.rows[1]).toMatchObject({
      status: 'invalid',
      issues: [{ code: 'lot_tracking_requires_zero_stock', field: 'stock' }],
    });
    expect(preview.rows[2]).toMatchObject({
      status: 'invalid',
      issues: [{ code: 'invalid_boolean', field: 'tracksLots' }],
    });
  });

  it('imports a zero-stock product with lot tracking enabled', async () => {
    const input = {
      dataMode: 'real' as const,
      sourceName: 'tracked-products.csv',
      rows: [
        row(2, {
          name: 'Tracked import ready',
          sku: `TRACKED-READY-${nanoid()}`,
          stock: '0',
          tracksLots: 'true',
        }),
      ],
    };
    const caller = appRouter.createCaller(createTestContext());
    const preview = await caller.launchMigration.previewProducts(input);
    const result = await caller.launchMigration.importProducts({
      ...input,
      confirmedRealData: true,
      previewHash: preview.previewHash,
    });

    expect(result.summary).toMatchObject({ imported: 1, stockInitialized: 0, failed: 0 });
    const imported = await db
      .select({ tracksLots: products.tracksLots })
      .from(products)
      .where(eq(products.sku, input.rows[0]!.values.sku!))
      .get();
    expect(imported?.tracksLots).toBe(true);
  });

  it('imports products, prices, and opening stock with audit evidence and retry-safe skips', async () => {
    const input = {
      dataMode: 'real' as const,
      sourceName: 'launch-products.xlsx',
      decimalFormat: 'dot' as const,
      rows: [
        row(2, {
          name: 'Imported cacao',
          sku: 'IMPORT-123A-CACAO',
          description: 'Launch catalog',
          barcode: '7700000123111',
          price: '15.50',
          cost: '8.25',
          stock: '12.5',
          minStock: '3',
          taxRate: '19',
        }),
        row(3, { name: '', sku: 'INVALID-123A' }),
        row(4, {
          name: 'Imported zero stock',
          sku: 'IMPORT-123A-ZERO',
          price: '5',
          cost: '2',
          stock: '0',
        }),
      ],
    };
    const caller = appRouter.createCaller(createTestContext());
    const preview = await caller.launchMigration.previewProducts(input);
    const result = await caller.launchMigration.importProducts({
      ...input,
      confirmedRealData: true,
      previewHash: preview.previewHash,
    });

    expect(result.summary).toEqual({
      total: 3,
      imported: 2,
      stockInitialized: 1,
      skipped: 0,
      invalid: 1,
      failed: 0,
      warnings: 0,
    });
    const product = await db
      .select()
      .from(products)
      .where(and(eq(products.tenantId, tenantId), eq(products.sku, 'IMPORT-123A-CACAO')))
      .get();
    expect(product).toMatchObject({
      name: 'Imported cacao',
      price: 15.5,
      cost: 8.25,
      initialCost: 8.25,
      minStock: 3,
      taxRate: 19,
    });
    const balance = await db
      .select()
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, siteId),
          eq(inventoryBalances.productId, product!.id)
        )
      )
      .get();
    expect(balance?.onHand).toBe(12.5);
    const opening = await db
      .select()
      .from(initialInventory)
      .where(
        and(eq(initialInventory.tenantId, tenantId), eq(initialInventory.productId, product!.id))
      )
      .get();
    expect(opening).toMatchObject({ mode: 'initial', quantity: 12.5, cost: 8.25 });

    const audit = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceId, result.importId),
          eq(auditLogs.action, 'data_import.products')
        )
      )
      .get();
    expect(audit?.actorId).toBe(userId);
    expect(audit?.resourceType).toBe('data_import');
    expect(JSON.stringify(audit)).not.toContain('Imported cacao');
    expect(JSON.stringify(audit)).not.toContain('launch-products.xlsx');
    expect(audit?.metadata).toMatchObject({ dataMode: 'real', sourceFormat: 'xlsx' });

    const retryPreview = await caller.launchMigration.previewProducts(input);
    const retry = await caller.launchMigration.importProducts({
      ...input,
      confirmedRealData: true,
      previewHash: retryPreview.previewHash,
    });
    expect(retry.summary).toMatchObject({ imported: 0, skipped: 2, invalid: 1 });
    expect(retry.skippedRows).toEqual(
      expect.arrayContaining([
        {
          rowNumber: 2,
          issues: expect.arrayContaining([
            { code: 'duplicate_existing_sku', field: 'sku' },
            { code: 'duplicate_existing_barcode', field: 'barcode' },
          ]),
        },
        {
          rowNumber: 4,
          issues: [{ code: 'duplicate_existing_sku', field: 'sku' }],
        },
      ])
    );
  });

  it('rejects stale preview hashes and non-admin callers', async () => {
    const input = {
      dataMode: 'real' as const,
      sourceName: 'guard.csv',
      decimalFormat: 'auto' as const,
      rows: [row(2, { name: 'Guarded', sku: 'GUARD-123A' })],
    };
    const admin = appRouter.createCaller(createTestContext());
    await expect(
      admin.launchMigration.importProducts({
        ...input,
        confirmedRealData: true,
        previewHash: '0'.repeat(64),
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const manager = appRouter.createCaller(createTestContext('manager'));
    await expect(manager.launchMigration.previewProducts(input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
