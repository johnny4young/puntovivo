/**
 * ENG-074b — `peripherals.buildReceiptBytes` + `buildDrawerKickBytes`
 * read-only procedures for the hub_client local hardware bridge.
 *
 * Per ADR-0008 rule 6 the bridge runs on the terminal that owns the
 * physical printer; the server only resolves the active peripheral
 * and serializes the bytes. The procedures MUST NEVER write
 * `hardware_outbox` (or any operational table). Tests pin the row
 * count before + after as a hard invariant.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { and, count, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  companies,
  hardwareOutbox,
  sales,
  sites,
  sitePeripherals,
  tenants,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { seedCommittedSaleSession } from './utils/cashSessionFixture.js';
import { ESCPOS_BYTES } from '../services/peripherals/escpos/byte-builder.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let siteId: string;
let seededSaleId: string;
let foreignTenantId: string;
let foreignSaleId: string;
let foreignSiteId: string;

function buildContext(role: 'admin' | 'manager' | 'cashier' = 'cashier', tenantOverride?: string): Context {
  const db = getDatabase();
  const effectiveTenant = tenantOverride ?? tenantId;
  return {
    req: {
      server: server.app,
      headers: {},
      user: {
        userId,
        email: 'admin@localhost',
        role,
        tenantId: effectiveTenant,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: {
      id: userId,
      email: 'admin@localhost',
      role,
      tenantId: effectiveTenant,
    },
    tenantId: effectiveTenant,
    siteId,
  };
}

async function countHardwareOutbox(): Promise<number> {
  const row = await getDatabase()
    .select({ value: count() })
    .from(hardwareOutbox)
    .where(eq(hardwareOutbox.tenantId, tenantId))
    .get();
  return Number(row?.value ?? 0);
}

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

  const seededSite = await db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
    .get();
  if (!seededSite) throw new Error('Expected seeded site');
  siteId = seededSite.id;

  // Insert a minimal sale row for the in-tenant tests. The seed
  // does not create sales by default in :memory: mode, so the test
  // owns its fixture.
  seededSaleId = nanoid();
  // ENG-177c — a committed sale needs a cash session at the schema level.
  const seededSessionId = await seedCommittedSaleSession({
    tenantId,
    cashierId: userId,
    siteId,
  });
  await db.insert(sales).values({
    id: seededSaleId,
    tenantId,
    saleNumber: 'TEST-074B-001',
    subtotal: 100,
    taxAmount: 19,
    discountAmount: 0,
    total: 119,
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    cashSessionId: seededSessionId,
    createdBy: userId,
  });

  // Manufacture a foreign tenant + sale to assert the cross-tenant
  // guard. The foreign tenant only needs a valid `tenants` row + a
  // sale with the same minimal shape.
  foreignTenantId = nanoid();
  await db.insert(tenants).values({
    id: foreignTenantId,
    name: 'Foreign tenant for cross-tenant test',
    slug: `foreign-${foreignTenantId.slice(0, 6)}`,
    settings: {},
  });
  // A site row owned by the foreign tenant so the cross-tenant
  // siteId guard tests have a valid id that scopes to the OTHER
  // tenant. Without this row, `ensureTenantSite` would
  // fail on missing-id semantics rather than tenant-mismatch
  // semantics — both throw, but the second is what we want to pin.
  // `sites.company_id` is NOT NULL so we mint a foreign company first.
  const foreignCompanyId = nanoid();
  await db.insert(companies).values({
    id: foreignCompanyId,
    tenantId: foreignTenantId,
    name: 'Foreign tenant company',
  });
  foreignSiteId = nanoid();
  await db.insert(sites).values({
    id: foreignSiteId,
    tenantId: foreignTenantId,
    companyId: foreignCompanyId,
    name: 'Foreign tenant flagship',
    code: 'FRN-001',
    isActive: true,
  });
  // The foreign sale needs a `created_by` user belonging to that
  // tenant — reuse the seeded admin since FK only checks the user
  // exists, not their tenant scoping.
  foreignSaleId = nanoid();
  const foreignSessionId = await seedCommittedSaleSession({
    tenantId: foreignTenantId,
    cashierId: userId,
    siteId: foreignSiteId,
  });
  await db.insert(sales).values({
    id: foreignSaleId,
    tenantId: foreignTenantId,
    saleNumber: 'FOREIGN-001',
    subtotal: 50,
    taxAmount: 0,
    discountAmount: 0,
    total: 50,
    paymentMethod: 'cash',
    paymentStatus: 'paid',
    status: 'completed',
    cashSessionId: foreignSessionId,
    createdBy: userId,
  });
});

afterAll(async () => {
  await server.close();
});

afterEach(async () => {
  await getDatabase()
    .delete(sitePeripherals)
    .where(eq(sitePeripherals.tenantId, tenantId));
});

describe('peripherals.buildReceiptBytes (ENG-074b)', () => {
  it('returns system-fallback when no escpos peripheral is registered', async () => {
    const before = await countHardwareOutbox();
    const caller = appRouter.createCaller(buildContext());
    const result = await caller.peripherals.buildReceiptBytes({
      saleId: seededSaleId,
      siteId,
    });
    expect(result.status).toBe('system-fallback');
    expect(result.bytes).toEqual([]);
    expect(result.transportHint).toBeNull();
    expect(await countHardwareOutbox()).toBe(before);
  });

  it('returns system-fallback when the printer driver is not escpos', async () => {
    await getDatabase().insert(sitePeripherals).values({
      id: nanoid(),
      tenantId,
      siteId,
      kind: 'printer',
      driver: 'system',
      config: {},
      displayName: 'System printer',
      isActive: true,
    });
    const before = await countHardwareOutbox();
    const caller = appRouter.createCaller(buildContext());
    const result = await caller.peripherals.buildReceiptBytes({
      saleId: seededSaleId,
      siteId,
    });
    expect(result.status).toBe('system-fallback');
    expect(await countHardwareOutbox()).toBe(before);
  });

  it('returns ready bytes with transport hint when an escpos printer is registered', async () => {
    await getDatabase().insert(sitePeripherals).values({
      id: nanoid(),
      tenantId,
      siteId,
      kind: 'printer',
      driver: 'escpos',
      config: {
        channel: 'tcp',
        host: '192.168.1.50',
        port: 9100,
        paperWidth: '80mm',
        characterSet: 'cp858',
      },
      displayName: 'ESC/POS receipt printer',
      isActive: true,
    });
    const before = await countHardwareOutbox();
    const caller = appRouter.createCaller(buildContext());
    const result = await caller.peripherals.buildReceiptBytes({
      saleId: seededSaleId,
      siteId,
    });
    expect(result.status).toBe('ready');
    expect(result.bytes.length).toBeGreaterThan(0);
    expect(result.bytes[0]).toBe(0x1b); // ESC INIT prefix
    expect(result.paperWidth).toBe('80mm');
    expect(result.characterSet).toBe('cp858');
    expect(result.transportHint).toEqual({
      channel: 'tcp',
      host: '192.168.1.50',
      port: 9100,
      vendorId: null,
      productId: null,
      devicePath: null,
      timeoutMs: null,
    });
    // Hard invariant per ADR-0008 rule 6.
    expect(await countHardwareOutbox()).toBe(before);
  });

  it('rejects a saleId from a foreign tenant (cross-tenant guard)', async () => {
    await getDatabase().insert(sitePeripherals).values({
      id: nanoid(),
      tenantId,
      siteId,
      kind: 'printer',
      driver: 'escpos',
      config: { channel: 'tcp', host: '192.168.1.50', port: 9100 },
      displayName: 'ESC/POS receipt printer',
      isActive: true,
    });
    const caller = appRouter.createCaller(buildContext());
    await expect(
      caller.peripherals.buildReceiptBytes({
        saleId: foreignSaleId,
        siteId,
      })
    ).rejects.toThrow(TRPCError);
  });

  it('rejects a siteId from a foreign tenant (ensureTenantSite guard)', async () => {
    // Pass a saleId that belongs to the local tenant but a siteId
    // owned by the foreign tenant — covers the second guard vector
    // beyond `getSaleRecord`.
    const caller = appRouter.createCaller(buildContext());
    await expect(
      caller.peripherals.buildReceiptBytes({
        saleId: seededSaleId,
        siteId: foreignSiteId,
      })
    ).rejects.toThrow(TRPCError);
  });
});

describe('peripherals.buildDrawerKickBytes (ENG-074b)', () => {
  it('returns no-drawer-registered when no escpos drawer exists', async () => {
    const before = await countHardwareOutbox();
    const caller = appRouter.createCaller(buildContext('manager'));
    const result = await caller.peripherals.buildDrawerKickBytes({ siteId });
    expect(result.status).toBe('no-drawer-registered');
    expect(result.bytes).toEqual([]);
    expect(result.transportHint).toBeNull();
    expect(await countHardwareOutbox()).toBe(before);
  });

  it('returns the canonical drawer-pulse bytes when an escpos drawer is registered', async () => {
    await getDatabase().insert(sitePeripherals).values({
      id: nanoid(),
      tenantId,
      siteId,
      kind: 'cash_drawer',
      driver: 'escpos',
      config: { channel: 'tcp', host: '192.168.1.50', port: 9100 },
      displayName: 'ESC/POS cash drawer',
      isActive: true,
    });
    const before = await countHardwareOutbox();
    const caller = appRouter.createCaller(buildContext('manager'));
    const result = await caller.peripherals.buildDrawerKickBytes({ siteId });
    expect(result.status).toBe('ready');
    expect(result.bytes).toEqual(Array.from(ESCPOS_BYTES.DRAWER_KICK));
    expect(result.transportHint).toEqual({
      channel: 'tcp',
      host: '192.168.1.50',
      port: 9100,
      vendorId: null,
      productId: null,
      devicePath: null,
      timeoutMs: null,
    });
    expect(await countHardwareOutbox()).toBe(before);
  });

  it('rejects a cashier (manager-only role gate)', async () => {
    const caller = appRouter.createCaller(buildContext('cashier'));
    await expect(caller.peripherals.buildDrawerKickBytes({ siteId })).rejects.toThrow(
      TRPCError
    );
  });

  it('rejects a siteId from a foreign tenant (ensureTenantSite guard)', async () => {
    const caller = appRouter.createCaller(buildContext('manager'));
    await expect(
      caller.peripherals.buildDrawerKickBytes({ siteId: foreignSiteId })
    ).rejects.toThrow(TRPCError);
  });
});
