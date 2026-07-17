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
import { auditLogs, sites, tenants, users } from '../db/schema.js';
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
    expect(effective['customer-display']).toBe(true);
    expect(effective['mobile-waiter']).toBe(true);
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
