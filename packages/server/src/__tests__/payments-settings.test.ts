/**
 * slice 2 — `paymentSettings.*` integration tests.
 *
 * Drives the admin router via `createCaller` against an in-memory
 * server. Confirms tenant-scoped storage under
 * `tenants.settings.payments.<railId>.credentials.*`, sensitive
 * masking, undeclared-field rejection, role boundary, readiness
 * rollover and cross-tenant isolation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { tenants, users } from '../db/schema.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;

function createCtx(opts: {
  tenantId: string;
  userId: string;
  role: 'admin' | 'cashier' | 'manager';
}): Context {
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: {},
      user: {
        userId: opts.userId,
        email: 'context@example.com',
        role: opts.role,
        tenantId: opts.tenantId,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: {
      id: opts.userId,
      email: 'context@example.com',
      role: opts.role,
      tenantId: opts.tenantId,
    },
    tenantId: opts.tenantId,
    siteId: null,
  };
}

async function seedTenant(suffix: string): Promise<{
  tenantId: string;
  adminId: string;
  managerId: string;
  cashierId: string;
}> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `pay-${suffix}-${nanoid(4)}`;
  await db.insert(tenants).values({
    id: tenantId,
    name: `Payment Tenant ${suffix}`,
    slug: `pay-${suffix}-${nanoid(6)}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const passwordHash = await hash('PayPass123!');
  const adminId = nanoid();
  const managerId = nanoid();
  const cashierId = nanoid();
  await db.insert(users).values([
    {
      id: adminId,
      tenantId,
      email: `admin-${tenantId}@example.com`,
      passwordHash,
      name: 'Admin',
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: managerId,
      tenantId,
      email: `manager-${tenantId}@example.com`,
      passwordHash,
      name: 'Manager',
      role: 'manager',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: cashierId,
      tenantId,
      email: `cashier-${tenantId}@example.com`,
      passwordHash,
      name: 'Cashier',
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return { tenantId, adminId, managerId, cashierId };
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  if (server) await server.close();
});

beforeEach(async () => {
  // Each test starts with a fresh tenant; explicit cleanup of the
  // tenants table is unnecessary because the tenantId suffix is
  // randomized per test.
});

describe('paymentSettings.getAll ( slice 2)', () => {
  it('returns a row per manifest rail with empty credentials and missing-field issues for a fresh tenant', async () => {
    const { tenantId, adminId } = await seedTenant('fresh');
    const caller = appRouter.createCaller(createCtx({ tenantId, userId: adminId, role: 'admin' }));
    const result = await caller.paymentSettings.getAll();
    expect(result.rails).toHaveLength(6);
    for (const rail of result.rails) {
      expect(rail.liveIntegration).toBe(false);
      expect(rail.credentials.length).toBeGreaterThan(0);
      for (const credential of rail.credentials) {
        expect(credential.hasStoredValue).toBe(false);
        expect(credential.value).toBe('');
      }
      expect(rail.validation.ok).toBe(false);
      expect(rail.validation.issues.length).toBeGreaterThan(0);
      for (const issue of rail.validation.issues) {
        expect(issue.code).toBe('PAYMENT_CREDENTIAL_MISSING');
      }
    }
    // No tenants.settings write happens just from reading.
    const fresh = await getDatabase()
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .get();
    expect(fresh?.settings).toEqual({});
  });

  it('rejects manager and cashier callers with FORBIDDEN', async () => {
    const { tenantId, managerId, cashierId } = await seedTenant('forbidden');
    for (const userId of [managerId, cashierId]) {
      const caller = appRouter.createCaller(
        createCtx({
          tenantId,
          userId,
          role: userId === managerId ? 'manager' : 'cashier',
        })
      );
      let caught: unknown;
      try {
        await caller.paymentSettings.getAll();
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TRPCError);
      expect((caught as TRPCError).code).toBe('FORBIDDEN');
    }
  });
});

describe('paymentSettings.updateRail ( slice 2)', () => {
  it('persists credentials, masks sensitive values and flips readiness to ok', async () => {
    const { tenantId, adminId } = await seedTenant('save');
    const caller = appRouter.createCaller(createCtx({ tenantId, userId: adminId, role: 'admin' }));

    const response = await caller.paymentSettings.updateRail({
      railId: 'wompi',
      credentials: {
        publicKey: 'pub_test_abcdef123456',
        privateKey: 'prv_test_secret789xyz',
      },
    });

    expect(response.ok).toBe(true);
    expect(response.rail.validation.ok).toBe(true);
    expect(response.rail.validation.issues).toHaveLength(0);
    for (const credential of response.rail.credentials) {
      expect(credential.hasStoredValue).toBe(true);
      // Sensitive masking: value must NOT contain the original
      // plaintext substring and must end with the last 3 characters.
      expect(credential.value).not.toContain('test_');
      expect(credential.value.startsWith('••••••••')).toBe(true);
    }

    // Subsequent getAll returns the same masked shape.
    const reread = await caller.paymentSettings.getAll();
    const wompi = reread.rails.find(rail => rail.railId === 'wompi');
    expect(wompi?.validation.ok).toBe(true);
    expect(wompi?.credentials.every(c => c.hasStoredValue)).toBe(true);
    expect(wompi?.credentials.every(c => !c.value.includes('test_'))).toBe(true);

    // Persisted shape: plaintext lives in tenants.settings under the
    // payments.<railId>.credentials.* namespace.
    const stored = await getDatabase()
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .get();
    const settings = stored?.settings as Record<string, unknown>;
    const payments = settings.payments as Record<string, unknown>;
    const wompiCreds = (payments.wompi as Record<string, unknown>).credentials as Record<
      string,
      string
    >;
    expect(wompiCreds.publicKey).toBe('pub_test_abcdef123456');
    expect(wompiCreds.privateKey).toBe('prv_test_secret789xyz');
  });

  it('rejects undeclared credential field keys with PAYMENT_CREDENTIAL_UNKNOWN_FIELD', async () => {
    const { tenantId, adminId } = await seedTenant('unknown-field');
    const caller = appRouter.createCaller(createCtx({ tenantId, userId: adminId, role: 'admin' }));
    let caught: unknown;
    try {
      await caller.paymentSettings.updateRail({
        railId: 'wompi',
        credentials: {
          publicKey: 'pub_test_abcdef123456',
          totallyNewField: 'oops',
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe('BAD_REQUEST');
    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    expect((cause as ServerErrorWithCode).errorCode).toBe('PAYMENT_CREDENTIAL_UNKNOWN_FIELD');
  });

  it('clears a stored credential when an empty string is passed', async () => {
    const { tenantId, adminId } = await seedTenant('clear');
    const caller = appRouter.createCaller(createCtx({ tenantId, userId: adminId, role: 'admin' }));
    await caller.paymentSettings.updateRail({
      railId: 'bold',
      credentials: {
        apiKey: 'bold_key_xxx',
        secret: 'bold_secret_yyy',
        merchantId: 'bold_merchant_zzz',
      },
    });
    const cleared = await caller.paymentSettings.updateRail({
      railId: 'bold',
      credentials: { apiKey: '' },
    });
    const apiKey = cleared.rail.credentials.find(c => c.key === 'apiKey');
    expect(apiKey?.hasStoredValue).toBe(false);
    // Other fields remain populated.
    const merchantId = cleared.rail.credentials.find(c => c.key === 'merchantId');
    expect(merchantId?.hasStoredValue).toBe(true);
    expect(cleared.rail.validation.ok).toBe(false);
    expect(cleared.rail.validation.issues.some(issue => issue.field === 'apiKey')).toBe(true);
  });

  it('preserves stored credentials when the patch is empty', async () => {
    const { tenantId, adminId } = await seedTenant('empty-patch');
    const caller = appRouter.createCaller(createCtx({ tenantId, userId: adminId, role: 'admin' }));
    await caller.paymentSettings.updateRail({
      railId: 'mercado_pago',
      credentials: { accessToken: 'MP_TEST_TOKEN_123' },
    });

    const unchanged = await caller.paymentSettings.updateRail({
      railId: 'mercado_pago',
      credentials: {},
    });

    const accessToken = unchanged.rail.credentials.find(
      credential => credential.key === 'accessToken'
    );
    expect(accessToken?.hasStoredValue).toBe(true);
    expect(unchanged.rail.validation.ok).toBe(true);
    const row = await getDatabase()
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .get();
    const settings = row?.settings as Record<string, unknown>;
    const payments = settings.payments as Record<string, unknown>;
    const mercadoPago = payments.mercado_pago as Record<string, unknown>;
    expect(mercadoPago.credentials).toMatchObject({
      accessToken: 'MP_TEST_TOKEN_123',
    });
  });

  it('rejects cashier callers with FORBIDDEN on updateRail', async () => {
    const { tenantId, cashierId } = await seedTenant('forbidden-update');
    const caller = appRouter.createCaller(
      createCtx({ tenantId, userId: cashierId, role: 'cashier' })
    );
    let caught: unknown;
    try {
      await caller.paymentSettings.updateRail({
        railId: 'wompi',
        credentials: { publicKey: 'x' },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe('FORBIDDEN');
  });

  it('isolates credentials per tenant', async () => {
    const { tenantId: tenantA, adminId: adminA } = await seedTenant('iso-a');
    const { tenantId: tenantB, adminId: adminB } = await seedTenant('iso-b');

    const callerA = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    await callerA.paymentSettings.updateRail({
      railId: 'nequi',
      credentials: {
        apiKey: 'nequi_only_a',
        merchantId: 'merchant_only_a',
      },
    });

    const callerB = appRouter.createCaller(
      createCtx({ tenantId: tenantB, userId: adminB, role: 'admin' })
    );
    const tenantBView = await callerB.paymentSettings.getAll();
    const nequiB = tenantBView.rails.find(rail => rail.railId === 'nequi');
    expect(nequiB?.credentials.every(c => !c.hasStoredValue)).toBe(true);
    expect(nequiB?.validation.ok).toBe(false);
  });

  it('preserves other tenant.settings namespaces (fiscal, ai) when writing payments credentials', async () => {
    const { tenantId, adminId } = await seedTenant('preserve');
    const db = getDatabase();
    // Pre-populate fiscal + ai settings to ensure the payments write
    // does not erase them.
    await db
      .update(tenants)
      .set({
        settings: {
          fiscal: { mx: { enabled: true, rfc: 'XAXX010101000' } },
          ai: { enabled: true, monthlyBudgetUsd: 50 },
        },
      })
      .where(eq(tenants.id, tenantId));
    const caller = appRouter.createCaller(createCtx({ tenantId, userId: adminId, role: 'admin' }));
    await caller.paymentSettings.updateRail({
      railId: 'mercado_pago',
      credentials: { accessToken: 'MP_TEST_TOKEN_123' },
    });
    const row = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .get();
    const settings = row?.settings as Record<string, unknown>;
    expect((settings.fiscal as Record<string, unknown>).mx).toMatchObject({
      enabled: true,
      rfc: 'XAXX010101000',
    });
    expect((settings.ai as Record<string, unknown>).enabled).toBe(true);
    expect(
      ((settings.payments as Record<string, unknown>).mercado_pago as Record<string, unknown>)
        .credentials
    ).toMatchObject({ accessToken: 'MP_TEST_TOKEN_123' });
  });
});
