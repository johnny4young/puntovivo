/**
 * tenantLocale tRPC boundary coverage.
 *
 * The resolver has focused service tests; this file verifies the
 * caller-facing contract: role guard, catalog validation, response
 * shape, and tenant isolation through `appRouter.createCaller()`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { tenantLocaleSettings, tenants, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let primaryTenantId: string;
let adminUserId: string;
let secondaryTenantId: string;

function createCallerContext(args: {
  tenantId: string;
  userId: string;
  role: 'admin' | 'manager' | 'cashier' | 'viewer';
}): Context {
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: {},
      user: {
        userId: args.userId,
        email: `${args.role}@localhost`,
        role: args.role,
        tenantId: args.tenantId,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: {
      id: args.userId,
      email: `${args.role}@localhost`,
      role: args.role,
      tenantId: args.tenantId,
    },
    tenantId: args.tenantId,
    siteId: null,
  };
}

async function createTenant(slug: string): Promise<string> {
  const db = getDatabase();
  const id = nanoid();
  const now = new Date().toISOString();
  await db
    .insert(tenants)
    .values({
      id,
      name: slug,
      slug,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

describe('tenantLocale router', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const seededAdmin = await db
      .select({ id: users.id, tenantId: users.tenantId })
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();

    if (!seededAdmin) {
      throw new Error('Expected seeded admin@localhost user');
    }

    primaryTenantId = seededAdmin.tenantId;
    adminUserId = seededAdmin.id;
    secondaryTenantId = await createTenant(`tenant-locale-router-${nanoid(6)}`);
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    const db = getDatabase();
    await db
      .delete(tenantLocaleSettings)
      .where(eq(tenantLocaleSettings.tenantId, primaryTenantId))
      .run();
    await db
      .delete(tenantLocaleSettings)
      .where(eq(tenantLocaleSettings.tenantId, secondaryTenantId))
      .run();
  });

  it('allows admins to update locale settings and returns the resolved shape', async () => {
    const caller = appRouter.createCaller(
      createCallerContext({
        tenantId: primaryTenantId,
        userId: adminUserId,
        role: 'admin',
      })
    );

    const resolved = await caller.tenantLocale.update({
      countryCode: 'CO',
      currencyOverride: 'USD',
      timezoneOverride: 'America/Los_Angeles',
      firstDayOfWeekOverride: 0,
    });

    expect(resolved).toMatchObject({
      countryCode: 'CO',
      locale: 'es-CO',
      currency: 'USD',
      timezone: 'America/Los_Angeles',
      firstDayOfWeek: 0,
      dateFormatShort: 'dd/MM/yyyy',
      currencyOverride: 'USD',
      timezoneOverride: 'America/Los_Angeles',
      firstDayOfWeekOverride: 0,
      isFallback: false,
    });

    const stored = await getDatabase()
      .select()
      .from(tenantLocaleSettings)
      .where(eq(tenantLocaleSettings.tenantId, primaryTenantId))
      .get();
    expect(stored?.countryCode).toBe('CO');
    expect(stored?.currencyOverride).toBe('USD');
    const tenant = await getDatabase()
      .select({ defaultCurrencyCode: tenants.defaultCurrencyCode })
      .from(tenants)
      .where(eq(tenants.id, primaryTenantId))
      .get();
    expect(tenant?.defaultCurrencyCode).toBe('USD');

    const preserved = await caller.tenantLocale.update({
      countryCode: 'CO',
      timezoneOverride: 'America/Bogota',
    });
    expect(preserved.currencyOverride).toBe('USD');
    expect(preserved.currency).toBe('USD');
    expect(
      (
        await getDatabase()
          .select({ defaultCurrencyCode: tenants.defaultCurrencyCode })
          .from(tenants)
          .where(eq(tenants.id, primaryTenantId))
          .get()
      )?.defaultCurrencyCode
    ).toBe('USD');
  });

  it('a second version-0 writer gets STALE_VERSION rather than a constraint crash', async () => {
    // Contract test, NOT a reproduction of the original race. The TOCTOU this
    // guards needed the competing insert to land between a pre-transaction
    // read and the write, and that window no longer exists now that the read
    // happens under the writer reservation — there is no deterministic hook
    // left to interleave. What this pins is the observable contract a losing
    // version-0 writer must see, so a future change that lets the unique
    // tenant constraint surface raw is caught here.
    const caller = appRouter.createCaller(
      createCallerContext({
        tenantId: secondaryTenantId,
        userId: adminUserId,
        role: 'admin',
      })
    );

    await caller.tenantLocale.update({ countryCode: 'CO', version: 0 });

    // A second writer still holding the virtual version 0 from the fallback.
    await expect(
      caller.tenantLocale.update({ countryCode: 'MX', version: 0 })
    ).rejects.toMatchObject({ cause: { errorCode: 'STALE_VERSION' } });
  });

  it('denies non-admin updates through the procedure boundary', async () => {
    const caller = appRouter.createCaller(
      createCallerContext({
        tenantId: primaryTenantId,
        userId: `viewer-${nanoid(4)}`,
        role: 'viewer',
      })
    );

    await expect(caller.tenantLocale.update({ countryCode: 'US' })).rejects.toThrowError(
      /administrators/i
    );
  });

  it('rejects unknown country and currency codes', async () => {
    const caller = appRouter.createCaller(
      createCallerContext({
        tenantId: primaryTenantId,
        userId: adminUserId,
        role: 'admin',
      })
    );

    await expect(caller.tenantLocale.update({ countryCode: 'ZZ' })).rejects.toThrowError(
      /country code zz/i
    );

    await expect(
      caller.tenantLocale.update({
        countryCode: 'US',
        currencyOverride: 'ZZZ',
      })
    ).rejects.toThrowError(/currency code zzz/i);
  });

  it('returns the cached read shape via get', async () => {
    const caller = appRouter.createCaller(
      createCallerContext({
        tenantId: primaryTenantId,
        userId: adminUserId,
        role: 'admin',
      })
    );

    await caller.tenantLocale.update({ countryCode: 'US' });
    const resolved = await caller.tenantLocale.get();

    expect(resolved).toMatchObject({
      countryCode: 'US',
      locale: 'en-US',
      currency: 'USD',
      timezone: 'America/New_York',
      dateFormatShort: 'MM/dd/yyyy',
      localeOverride: null,
      currencyOverride: null,
      timezoneOverride: null,
    });
  });

  it('keeps locale updates isolated per tenant', async () => {
    const primaryCaller = appRouter.createCaller(
      createCallerContext({
        tenantId: primaryTenantId,
        userId: adminUserId,
        role: 'admin',
      })
    );
    const secondaryCaller = appRouter.createCaller(
      createCallerContext({
        tenantId: secondaryTenantId,
        userId: `secondary-admin-${nanoid(4)}`,
        role: 'admin',
      })
    );

    await primaryCaller.tenantLocale.update({ countryCode: 'CO' });
    await secondaryCaller.tenantLocale.update({ countryCode: 'US' });

    const primary = await primaryCaller.tenantLocale.get();
    const secondary = await secondaryCaller.tenantLocale.get();

    expect(primary.countryCode).toBe('CO');
    expect(primary.currency).toBe('COP');
    expect(secondary.countryCode).toBe('US');
    expect(secondary.currency).toBe('USD');

    const tenantCurrencies = await getDatabase()
      .select({ id: tenants.id, currency: tenants.defaultCurrencyCode })
      .from(tenants)
      .all();
    expect(tenantCurrencies.find(row => row.id === primaryTenantId)?.currency).toBe('COP');
    expect(tenantCurrencies.find(row => row.id === secondaryTenantId)?.currency).toBe('USD');
  });
});
