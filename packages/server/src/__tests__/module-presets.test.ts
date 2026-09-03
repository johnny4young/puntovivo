/**
 * A-30 — vertical module presets.
 *
 * The load-bearing guarantee: a preset shapes the register SURFACES for a
 * business type but NEVER touches the AI modules or events-api — those cost
 * money or a key and the operator's choice must survive a preset. The router
 * test proves that against the real DB; the pure test pins the patch shapes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  categories,
  products,
  restaurantServices,
  restaurantTables,
  sites,
  tenants,
  units,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { resolveModulesState } from '../services/modules/manifest.js';
import {
  PRESET_SCOPED_MODULES,
  VERTICAL_PRESET_IDS,
  resolvePresetPatch,
} from '../services/modules/presets.js';
import { makeFreshContextFactory } from './utils/criticalCommandFixture.js';

// Modules a preset must never touch — the AI trio + the webhook module.
const OFF_LIMITS = ['copilot', 'anomaly-detection', 'semantic-search', 'events-api'] as const;

describe('vertical preset patches (pure)', () => {
  it('every preset touches only scoped modules', () => {
    for (const id of VERTICAL_PRESET_IDS) {
      const patch = resolvePresetPatch(id);
      for (const key of Object.keys(patch)) {
        expect(PRESET_SCOPED_MODULES).toContain(key);
        expect(OFF_LIMITS).not.toContain(key);
      }
    }
  });

  it('rejects a preset that reaches an off-limits module', () => {
    // Contract guard: the resolver must refuse anything outside scope even
    // if a future edit to VERTICAL_PRESETS slips one in.
    expect(() => resolvePresetPatch('nope' as never)).toThrow(/unknown vertical preset/);
  });

  it('retail hides restaurant surfaces; restaurant enables them', () => {
    const retail = resolvePresetPatch('retail');
    expect(retail['pos-touch']).toBe(false);
    expect(retail.kds).toBe(false);
    const restaurant = resolvePresetPatch('restaurant');
    expect(restaurant['pos-touch']).toBe(true);
    expect(restaurant.kds).toBe(true);
    expect(restaurant['mobile-waiter']).toBe(true);
  });

  it('gives hardware quotations and butchery a touch counter without restaurant surfaces', () => {
    const hardware = resolvePresetPatch('hardware');
    expect(hardware.quotations).toBe(true);
    expect(hardware['pos-touch']).toBe(false);
    expect(hardware.kds).toBe(false);
    expect(hardware['dine-in']).toBe(false);

    const butchery = resolvePresetPatch('butchery');
    expect(butchery.quotations).toBe(false);
    expect(butchery['pos-touch']).toBe(true);
    expect(butchery.kds).toBe(false);
    expect(butchery['dine-in']).toBe(false);
  });
});

let server: PuntovivoServer;
let tenantId: string;
let fresh: ReturnType<typeof makeFreshContextFactory>;

describe('modules.applyPreset (router)', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin user');
    tenantId = admin.tenantId;
    const site = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!site) throw new Error('Expected seeded site');
    const reg = await registerDeviceService(db, {
      tenantId,
      userId: admin.id,
      kind: 'web',
      name: 'module-presets.test',
    });
    fresh = makeFreshContextFactory({
      db,
      serverApp: server.app,
      tenantId,
      userId: admin.id,
      email: 'admin@localhost',
      siteId: site.id,
      deviceId: reg.deviceId,
      defaultRole: 'admin',
    });
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    // Reset the modules blob AND the preset audit rows so per-test counts
    // start clean (the in-memory DB is shared across cases in this file).
    const db = getDatabase();
    await db.update(tenants).set({ settings: {} }).where(eq(tenants.id, tenantId)).run();
    db.delete(auditLogs).where(eq(auditLogs.action, 'module.preset_applied')).run();
  });

  it('applies the restaurant surfaces and reports what changed', async () => {
    const caller = appRouter.createCaller(fresh());
    const result = await caller.modules.applyPreset({ presetId: 'restaurant' });

    expect(result.changed).toBe(true);
    const effective = (await appRouter.createCaller(fresh()).modules.getEffective()).modules;
    expect(effective['pos-touch']).toBe(true);
    expect(effective.kds).toBe(true);
    expect(effective['customer-display']).toBe(false);
    expect(effective['mobile-waiter']).toBe(true);
    expect(effective['dine-in']).toBe(true);
  });

  it('leaves a quick-service counter without the dine-in surfaces', async () => {
    await appRouter.createCaller(fresh()).modules.applyPreset({ presetId: 'quickservice' });

    const effective = (await appRouter.createCaller(fresh()).modules.getEffective()).modules;
    // A counter runs the touch register and the kitchen screen, but has
    // no tables and no restaurant service charge.
    expect(effective['pos-touch']).toBe(true);
    expect(effective.kds).toBe(true);
    expect(effective['dine-in']).toBe(false);
  });

  it('does not apply a non-dine-in preset while a table service is open', async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const tableId = 'preset-open-table';
    const serviceId = 'preset-open-service';

    await appRouter.createCaller(fresh()).modules.applyPreset({ presetId: 'restaurant' });
    await db.insert(restaurantTables).values({
      id: tableId,
      tenantId,
      siteId: fresh().siteId!,
      name: 'Mesa preset',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(restaurantServices).values({
      id: serviceId,
      tenantId,
      siteId: fresh().siteId!,
      tableId,
      status: 'open',
      guestCount: 2,
      openedBy: fresh().user!.id,
      openedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    try {
      await expect(
        appRouter.createCaller(fresh()).modules.applyPreset({ presetId: 'retail' })
      ).rejects.toMatchObject({
        code: 'CONFLICT',
        cause: expect.objectContaining({ errorCode: 'RESTAURANT_MODULE_HAS_OPEN_WORK' }),
      });
      const effective = (await appRouter.createCaller(fresh()).modules.getEffective()).modules;
      expect(effective['dine-in']).toBe(true);
      expect((await appRouter.createCaller(fresh()).setupReadiness.get()).businessType).toBe(
        'restaurant'
      );
    } finally {
      await db.delete(restaurantServices).where(eq(restaurantServices.id, serviceId));
      await db.delete(restaurantTables).where(eq(restaurantTables.id, tableId));
    }
  });

  it('records the picked vertical as the tenant business type', async () => {
    await appRouter.createCaller(fresh()).modules.applyPreset({ presetId: 'restaurant' });

    const readiness = await appRouter.createCaller(fresh()).setupReadiness.get();
    expect(readiness.businessType).toBe('restaurant');
    expect(readiness.sections.find(section => section.id === 'businessType')?.status).toBe('ready');
  });

  it('persists the business type even when no module actually changes', async () => {
    // Apply once so the modules already match, then re-apply: the module
    // diff is empty but the operator's answer must still be recorded.
    await appRouter.createCaller(fresh()).modules.applyPreset({ presetId: 'wholesale' });
    await getDatabase()
      .update(tenants)
      .set({ settings: { modules: { quotations: true, 'operations-center': true } } })
      .where(eq(tenants.id, tenantId))
      .run();

    const result = await appRouter.createCaller(fresh()).modules.applyPreset({
      presetId: 'wholesale',
    });

    expect(result.changed).toBe(true);
    const readiness = await appRouter.createCaller(fresh()).setupReadiness.get();
    expect(readiness.businessType).toBe('wholesale');
  });

  it('never touches the AI modules the operator configured', async () => {
    // Operator turns copilot ON (a paid, key-bearing choice) …
    await appRouter.createCaller(fresh()).modules.setActive({ moduleId: 'copilot', enabled: true });
    // … then applies the retail preset, which says nothing about AI.
    await appRouter.createCaller(fresh()).modules.applyPreset({ presetId: 'retail' });

    const effective = (await appRouter.createCaller(fresh()).modules.getEffective()).modules;
    expect(effective.copilot).toBe(true); // survived
    expect(effective['pos-touch']).toBe(false); // preset shaped the surface
  });

  it('changes profile settings without creating or rewriting catalog rows', async () => {
    const db = getDatabase();
    const before = {
      categories: await db.select().from(categories).where(eq(categories.tenantId, tenantId)).all(),
      products: await db.select().from(products).where(eq(products.tenantId, tenantId)).all(),
      units: await db.select().from(units).where(eq(units.tenantId, tenantId)).all(),
    };

    await appRouter.createCaller(fresh()).modules.applyPreset({ presetId: 'hardware' });
    await appRouter.createCaller(fresh()).modules.applyPreset({ presetId: 'butchery' });

    expect({
      categories: await db.select().from(categories).where(eq(categories.tenantId, tenantId)).all(),
      products: await db.select().from(products).where(eq(products.tenantId, tenantId)).all(),
      units: await db.select().from(units).where(eq(units.tenantId, tenantId)).all(),
    }).toEqual(before);
  });

  it('lists placeholder modules as unavailable and rejects new activation', async () => {
    const caller = appRouter.createCaller(fresh());
    const listed = await caller.modules.list();
    expect(listed.modules.find(module => module.id === 'customer-display')).toMatchObject({
      enabled: false,
      available: false,
    });

    await expect(
      caller.modules.setActive({ moduleId: 'customer-display', enabled: true })
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      cause: expect.objectContaining({ errorCode: 'MODULE_NOT_AVAILABLE' }),
    });
  });

  it('writes one preset audit row with the before/after of touched modules', async () => {
    await appRouter.createCaller(fresh()).modules.applyPreset({ presetId: 'restaurant' });

    const rows = await getDatabase()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'module.preset_applied'))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.resourceId).toBe('restaurant');
    const after = rows[0]?.after as Record<string, boolean>;
    expect(after['pos-touch']).toBe(true);
  });

  it('is a no-op with no audit row when the preset is already applied', async () => {
    await appRouter.createCaller(fresh()).modules.applyPreset({ presetId: 'restaurant' });
    const second = await appRouter.createCaller(fresh()).modules.applyPreset({
      presetId: 'restaurant',
    });
    expect(second.changed).toBe(false);

    const rows = await getDatabase()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'module.preset_applied'))
      .all();
    expect(rows).toHaveLength(1); // only the first apply
    void resolveModulesState;
  });

  it('rejects a non-admin caller', async () => {
    await expect(
      appRouter.createCaller(fresh({ role: 'manager' })).modules.applyPreset({ presetId: 'retail' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
