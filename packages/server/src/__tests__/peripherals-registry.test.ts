/**
 * ENG-060 — Unit tests for `services/peripherals/registry.ts`.
 *
 * Tests the dispatch table + config validation + cross-tenant
 * isolation + the partial-unique constraint on `site_peripherals`.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  sitePeripherals,
  sites,
  users,
  tenants,
  companies,
} from '../db/schema.js';
import {
  __clearPeripheralAdapterOverridesForTest,
  __setPeripheralAdapterForTest,
  getPeripheralAdapter,
  instantiateAdapter,
  listSupportedDrivers,
  validatePeripheralConfig,
  type BasePeripheralAdapter,
} from '../services/peripherals/index.js';

let server: PuntovivoServer;
let tenantId: string;
let siteId: string;

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
  const seededSite = await db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();
  if (!seededSite) throw new Error('Expected seeded site');
  siteId = seededSite.id;
});

afterAll(async () => {
  __clearPeripheralAdapterOverridesForTest();
  await server.close();
});

afterEach(async () => {
  __clearPeripheralAdapterOverridesForTest();
  // Wipe all peripherals between tests so each starts clean.
  await getDatabase()
    .delete(sitePeripherals)
    .where(eq(sitePeripherals.tenantId, tenantId));
});

describe('listSupportedDrivers', () => {
  it('returns ENG-060/061/062 default drivers (system + escpos printer, escpos drawer, wedge scanner, manual payment terminal)', () => {
    const drivers = listSupportedDrivers();
    expect(drivers).toEqual(
      expect.arrayContaining([
        { kind: 'printer', driverId: 'system' },
        // ENG-062 — ESC/POS printer driver registered.
        { kind: 'printer', driverId: 'escpos' },
        { kind: 'payment_terminal', driverId: 'manual' },
        { kind: 'scanner', driverId: 'wedge' },
        // ENG-062 — ESC/POS cash drawer driver registered.
        { kind: 'cash_drawer', driverId: 'escpos' },
      ])
    );
    // customer_display still has no drivers shipped.
    expect(drivers.find(d => d.kind === 'customer_display')).toBeUndefined();
  });
});

describe('validatePeripheralConfig', () => {
  it('accepts an empty config for the system printer driver', () => {
    const result = validatePeripheralConfig({
      kind: 'printer',
      driver: 'system',
      config: {},
    });
    expect(result).toEqual({ ok: true });
  });

  it('accepts a valid manual payment terminal config with prompt', () => {
    const result = validatePeripheralConfig({
      kind: 'payment_terminal',
      driver: 'manual',
      config: { prompt: 'Insert card' },
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects an unknown driver for a known kind with PERIPHERAL_DRIVER_INVALID', () => {
    const result = validatePeripheralConfig({
      kind: 'printer',
      driver: 'unknown-driver-id',
      config: {},
    });
    expect(result).toMatchObject({ ok: false, code: 'PERIPHERAL_DRIVER_INVALID' });
  });

  it('rejects every kind with no registered driver yet (customer_display)', () => {
    const result = validatePeripheralConfig({
      kind: 'customer_display',
      driver: 'escpos',
      config: {},
    });
    expect(result).toMatchObject({ ok: false, code: 'PERIPHERAL_DRIVER_INVALID' });
  });

  it('rejects malformed config with PERIPHERAL_CONFIG_INVALID', () => {
    const result = validatePeripheralConfig({
      kind: 'payment_terminal',
      driver: 'manual',
      config: { prompt: 12345 } as unknown as Record<string, unknown>,
    });
    expect(result).toMatchObject({ ok: false, code: 'PERIPHERAL_CONFIG_INVALID' });
  });
});

describe('getPeripheralAdapter', () => {
  it('returns null when no active row exists for the site/kind', async () => {
    const adapter = await getPeripheralAdapter({
      db: getDatabase(),
      tenantId,
      siteId,
      kind: 'printer',
    });
    expect(adapter).toBeNull();
  });

  it('returns null for an inactive row', async () => {
    const db = getDatabase();
    const id = nanoid();
    await db.insert(sitePeripherals).values({
      id,
      tenantId,
      siteId,
      kind: 'printer',
      driver: 'system',
      config: {},
      isActive: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const adapter = await getPeripheralAdapter({
      db,
      tenantId,
      siteId,
      kind: 'printer',
    });
    expect(adapter).toBeNull();
  });

  it('dispatches to SystemReceiptPrinterAdapter for printer/system', async () => {
    const db = getDatabase();
    const id = nanoid();
    await db.insert(sitePeripherals).values({
      id,
      tenantId,
      siteId,
      kind: 'printer',
      driver: 'system',
      config: {},
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const adapter = await getPeripheralAdapter({
      db,
      tenantId,
      siteId,
      kind: 'printer',
    });
    expect(adapter).not.toBeNull();
    expect(adapter?.kind).toBe('printer');
    expect(adapter?.driverId).toBe('system');
    expect(adapter?.tenantId).toBe(tenantId);
    expect(adapter?.siteId).toBe(siteId);
    expect(adapter?.peripheralId).toBe(id);
  });

  it('honors __setPeripheralAdapterForTest override', async () => {
    const stub: BasePeripheralAdapter = {
      kind: 'printer',
      driverId: 'stub',
      tenantId,
      siteId,
      peripheralId: 'stub-id',
    };
    __setPeripheralAdapterForTest({ tenantId, siteId, kind: 'printer' }, stub);
    const adapter = await getPeripheralAdapter({
      db: getDatabase(),
      tenantId,
      siteId,
      kind: 'printer',
    });
    expect(adapter).toBe(stub);
  });

  it('isolates rows across tenants', async () => {
    const db = getDatabase();
    // Seed a peripheral on tenant A.
    await db.insert(sitePeripherals).values({
      id: nanoid(),
      tenantId,
      siteId,
      kind: 'printer',
      driver: 'system',
      config: {},
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    // A query scoped to a different tenant must NOT see it.
    const adapter = await getPeripheralAdapter({
      db,
      tenantId: 'unknown-tenant',
      siteId,
      kind: 'printer',
    });
    expect(adapter).toBeNull();
  });
});

describe('instantiateAdapter', () => {
  it('returns null when the row references an unimplemented driver', async () => {
    const db = getDatabase();
    const id = nanoid();
    // Bypass validatePeripheralConfig to insert a row with a stale driver
    // pointing at customer_display, which has no driver registered yet.
    await db.insert(sitePeripherals).values({
      id,
      tenantId,
      siteId,
      kind: 'customer_display',
      driver: 'escpos',
      config: {},
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const row = await db
      .select()
      .from(sitePeripherals)
      .where(eq(sitePeripherals.id, id))
      .get();
    expect(row).toBeTruthy();
    const adapter = instantiateAdapter(row!);
    expect(adapter).toBeNull();
  });

  it('returns an EscPosReceiptPrinterAdapter for the (printer, escpos) pair (ENG-062)', async () => {
    const db = getDatabase();
    const id = nanoid();
    await db.insert(sitePeripherals).values({
      id,
      tenantId,
      siteId,
      kind: 'printer',
      driver: 'escpos',
      config: { channel: 'mock', paperWidth: '80mm' },
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const row = await db
      .select()
      .from(sitePeripherals)
      .where(eq(sitePeripherals.id, id))
      .get();
    const adapter = instantiateAdapter(row!);
    expect(adapter).not.toBeNull();
    expect(adapter!.kind).toBe('printer');
    expect(adapter!.driverId).toBe('escpos');
  });

  it('returns an EscPosCashDrawerAdapter for the (cash_drawer, escpos) pair (ENG-062)', async () => {
    const db = getDatabase();
    const id = nanoid();
    await db.insert(sitePeripherals).values({
      id,
      tenantId,
      siteId,
      kind: 'cash_drawer',
      driver: 'escpos',
      config: { channel: 'mock' },
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const row = await db
      .select()
      .from(sitePeripherals)
      .where(eq(sitePeripherals.id, id))
      .get();
    const adapter = instantiateAdapter(row!);
    expect(adapter).not.toBeNull();
    expect(adapter!.kind).toBe('cash_drawer');
    expect(adapter!.driverId).toBe('escpos');
  });

  it('returns a BarcodeScannerAdapter for the wedge driver (ENG-061)', async () => {
    const db = getDatabase();
    const id = nanoid();
    await db.insert(sitePeripherals).values({
      id,
      tenantId,
      siteId,
      kind: 'scanner',
      driver: 'wedge',
      // Defaults populate via the Zod schema; an empty {} is enough.
      config: {},
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const row = await db
      .select()
      .from(sitePeripherals)
      .where(eq(sitePeripherals.id, id))
      .get();
    const adapter = instantiateAdapter(row!);
    expect(adapter).not.toBeNull();
    expect(adapter!.kind).toBe('scanner');
    expect(adapter!.driverId).toBe('wedge');
    expect(adapter!.tenantId).toBe(tenantId);
  });
});

describe('validatePeripheralConfig — wedge scanner (ENG-061)', () => {
  it('accepts an empty config and applies defaults', () => {
    const result = validatePeripheralConfig({
      kind: 'scanner',
      driver: 'wedge',
      config: {},
    });
    expect(result).toEqual({ ok: true });
  });

  it('accepts a tuned config with custom timing', () => {
    const result = validatePeripheralConfig({
      kind: 'scanner',
      driver: 'wedge',
      config: {
        minLength: 8,
        maxLength: 24,
        interCharGapMs: 50,
        endOfScan: 'tab',
        prefix: '*',
        suffix: '#',
        gs1Scheme: 'co',
      },
    });
    expect(result).toEqual({ ok: true });
  });

  it('rejects a config with non-numeric minLength', () => {
    const result = validatePeripheralConfig({
      kind: 'scanner',
      driver: 'wedge',
      config: { minLength: 'short' as unknown as number },
    });
    expect(result).toMatchObject({ ok: false, code: 'PERIPHERAL_CONFIG_INVALID' });
  });

  it('rejects a config with interCharGapMs outside [10, 500]', () => {
    const result = validatePeripheralConfig({
      kind: 'scanner',
      driver: 'wedge',
      config: { interCharGapMs: 5 },
    });
    expect(result).toMatchObject({ ok: false, code: 'PERIPHERAL_CONFIG_INVALID' });
  });

  it('rejects a config where minLength exceeds maxLength', () => {
    const result = validatePeripheralConfig({
      kind: 'scanner',
      driver: 'wedge',
      config: { minLength: 32, maxLength: 8 },
    });
    expect(result).toMatchObject({ ok: false, code: 'PERIPHERAL_CONFIG_INVALID' });
  });
});

describe('partial unique index — at most one active per kind per site', () => {
  it('allows registering a second peripheral when the first is inactive', async () => {
    const db = getDatabase();
    const firstId = nanoid();
    await db.insert(sitePeripherals).values({
      id: firstId,
      tenantId,
      siteId,
      kind: 'printer',
      driver: 'system',
      config: {},
      isActive: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const secondId = nanoid();
    await db.insert(sitePeripherals).values({
      id: secondId,
      tenantId,
      siteId,
      kind: 'printer',
      driver: 'system',
      config: {},
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const rows = await db
      .select()
      .from(sitePeripherals)
      .where(eq(sitePeripherals.tenantId, tenantId))
      .all();
    expect(rows).toHaveLength(2);
  });

  it('rejects a second active peripheral of the same kind for the same site', async () => {
    const db = getDatabase();
    await db.insert(sitePeripherals).values({
      id: nanoid(),
      tenantId,
      siteId,
      kind: 'printer',
      driver: 'system',
      config: {},
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await expect(
      db.insert(sitePeripherals).values({
        id: nanoid(),
        tenantId,
        siteId,
        kind: 'printer',
        driver: 'system',
        config: {},
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
    ).rejects.toThrow(/UNIQUE constraint failed/);
  });

  it('allows the same kind active on a different site for the same tenant', async () => {
    const db = getDatabase();
    // Seed a second site with its own company.
    const otherCompanyId = nanoid();
    const otherSiteId = nanoid();
    const now = new Date().toISOString();
    await db.insert(companies).values({
      id: otherCompanyId,
      tenantId,
      name: 'Site B Company',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: otherSiteId,
      tenantId,
      companyId: otherCompanyId,
      name: 'Site B',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sitePeripherals).values({
      id: nanoid(),
      tenantId,
      siteId,
      kind: 'printer',
      driver: 'system',
      config: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sitePeripherals).values({
      id: nanoid(),
      tenantId,
      siteId: otherSiteId,
      kind: 'printer',
      driver: 'system',
      config: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const rows = await db
      .select()
      .from(sitePeripherals)
      .where(eq(sitePeripherals.tenantId, tenantId))
      .all();
    expect(rows).toHaveLength(2);
    // Cleanup — the seeded second site stays for subsequent tests; the
    // afterEach wipes the peripherals.
    void tenants;
  });
});
