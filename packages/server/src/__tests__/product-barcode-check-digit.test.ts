import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { products, sites, units, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

const VALID_EAN13 = '7701234567897';
const INVALID_EAN13 = '7701234567890';
const INVALID_EAN8 = '96385071';
const INVALID_UPCA = '036000291453';

/** The catalog must refuse a GS1 code the till would reject on scan. */
describe('product barcode check digit', () => {
  let server: PuntovivoServer;
  let unitId: string;
  let packUnitId: string;
  let fresh: ReturnType<typeof makeFreshContextFactory>;
  const caller = () => appRouter.createCaller(fresh());

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const user = db.select().from(users).where(eq(users.email, 'admin@localhost')).get()!;
    const tenantId = user.tenantId;
    const siteId = db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get()!.id;
    const tenantUnits = db.select().from(units).where(eq(units.tenantId, tenantId)).all();
    unitId = tenantUnits.find(unit => unit.abbreviation === 'UND')!.id;
    packUnitId = tenantUnits.find(unit => unit.id !== unitId && unit.isActive !== false)!.id;
    const device = await registerDevice(db, {
      tenantId,
      userId: user.id,
      kind: 'web',
      name: 'barcode-check-digit',
    });
    fresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId: user.id,
      email: user.email,
      siteId,
      deviceId: device.deviceId,
      defaultRole: 'admin',
    });
  });
  afterAll(async () => server.close());

  function create(barcode: string | null, packBarcode?: string) {
    return caller().products.create({
      name: `Barcode ${nanoid(6)}`,
      sku: nanoid(),
      price: 100,
      barcode,
      unitAssignments: [
        { unitId, equivalence: 1, price: 100, isBase: true },
        ...(packBarcode
          ? [{ unitId: packUnitId, equivalence: 12, price: 1200, barcode: packBarcode }]
          : []),
      ],
    });
  }

  const rejected = { cause: { errorCode: 'PRODUCT_BARCODE_CHECK_DIGIT_INVALID' } };

  it.each([INVALID_EAN13, INVALID_EAN8, INVALID_UPCA])('rejects %s on create', async code => {
    await expect(create(code)).rejects.toMatchObject(rejected);
  });

  it.each([VALID_EAN13, '10001', '1234567890', 'ABC-12345678'])(
    'accepts %s (valid GTIN or internal code)',
    async code => {
      await expect(create(code)).resolves.toMatchObject({ barcode: code });
    }
  );

  it('rejects an invalid presentation barcode', async () => {
    await expect(create(null, INVALID_EAN13)).rejects.toMatchObject(rejected);
  });

  it('rejects an invalid barcode on update but keeps a stored legacy code editable', async () => {
    const product = await create(null);
    await expect(
      caller().products.update({
        id: product.id,
        version: product.version,
        barcode: INVALID_EAN13,
      })
    ).rejects.toMatchObject(rejected);

    getDatabase()
      .update(products)
      .set({ barcode: INVALID_EAN8 })
      .where(eq(products.id, product.id))
      .run();
    const current = getDatabase().select().from(products).where(eq(products.id, product.id)).get()!;
    await expect(
      caller().products.update({
        id: product.id,
        version: current.version,
        name: 'Renamed legacy',
        barcode: INVALID_EAN8,
      })
    ).resolves.toMatchObject({ name: 'Renamed legacy' });
  });

  it('flags an invalid check digit in the import preview', async () => {
    const preview = await caller().launchMigration.previewProducts({
      dataMode: 'demo',
      sourceName: 'check-digit.csv',
      rows: [
        {
          rowNumber: 2,
          values: { name: 'Bad code', sku: `IMPORT-${nanoid()}`, barcode: INVALID_EAN13 },
        },
      ],
    });
    expect(preview.rows[0]?.issues).toContainEqual({
      code: 'invalid_check_digit',
      field: 'barcode',
    });
  });
});
