/**
 * ENG-177a — optimistic-concurrency versioning tests.
 *
 * Exercises the `version` guard on the four user-edited catalogs that wire
 * it through their `*.update` procedures (products / customers / providers /
 * categories) plus the `tenant_locale_settings` upsert. The marquee
 * acceptance criterion — "concurrent edit from two browsers raises
 * STALE_VERSION" — is proven by re-issuing an update with a version that the
 * first update already superseded.
 *
 * Calls the routers directly via `appRouter.createCaller()` (HTTP-less) with
 * an in-memory SQLite DB, per the server test convention.
 *
 * @module __tests__/optimistic-version.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { TRPCError } from '@trpc/server';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { companies, sites, tenants, users } from '../db/schema.js';

let server: PuntovivoServer;

interface TenantFixture {
  tenantId: string;
  adminUserId: string;
  siteId: string;
}

async function seedTenant(label: string): Promise<TenantFixture> {
  const db = getDatabase();
  const tenantId = nanoid();
  const companyId = nanoid();
  const siteId = nanoid();
  const adminUserId = nanoid();
  const now = new Date().toISOString();

  await db.insert(tenants).values({
    id: tenantId,
    name: `${label} Tenant`,
    slug: `${label.toLowerCase()}-${nanoid(6)}`,
    settings: {},
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: `${label} Company`,
    taxId: '900000000-0',
    address: 'Addr',
    phone: '0000000000',
    email: `company@${label.toLowerCase()}.test`,
    logoUrl: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sites).values({
    id: siteId,
    tenantId,
    companyId,
    name: 'Main Site',
    address: 'Addr',
    phone: '0000000000',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: adminUserId,
    tenantId,
    email: `admin@${label.toLowerCase()}.test`,
    passwordHash: await hash('AdminPass123!'),
    name: 'Admin',
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  return { tenantId, adminUserId, siteId };
}

function adminContext(fixture: TenantFixture): Context {
  const db = getDatabase();
  const user = {
    id: fixture.adminUserId,
    email: `admin@test`,
    role: 'admin',
    tenantId: fixture.tenantId,
  };
  return {
    req: {
      server: server.app,
      headers: {},
      user: { userId: user.id, email: user.email, role: user.role, tenantId: user.tenantId },
      jwtVerify: async () => undefined,
    } as unknown as Context['req'],
    res: {} as unknown as Context['res'],
    db,
    user,
    tenantId: fixture.tenantId,
    siteId: fixture.siteId,
  };
}

/** Assert a thrown error is a CONFLICT TRPCError carrying STALE_VERSION. */
async function expectStaleVersion(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
    expect.unreachable('expected STALE_VERSION');
  } catch (err) {
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe('CONFLICT');
    const cause = (err as TRPCError).cause as { errorCode?: string } | undefined;
    expect(cause?.errorCode).toBe('STALE_VERSION');
  }
}

let tenantA: TenantFixture;
let tenantB: TenantFixture;

describe('ENG-177a optimistic concurrency', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    tenantA = await seedTenant('Alpha');
    tenantB = await seedTenant('Beta');
  });

  afterAll(async () => {
    await server.close();
  });

  describe('products.update', () => {
    it('increments the version on a matching-version update', async () => {
      const caller = appRouter.createCaller(adminContext(tenantA));
      const created = await caller.products.create({
        name: 'Versioned Product',
        sku: `VER-${nanoid(6)}`,
        price: 10,
      });
      expect(created.version).toBe(0);

      const updated = await caller.products.update({
        id: created.id,
        version: created.version,
        price: 12,
      });
      expect(updated.version).toBe(1);
      expect(updated.price).toBe(12);
    });

    it('rejects a stale version and leaves the row unchanged', async () => {
      const caller = appRouter.createCaller(adminContext(tenantA));
      const created = await caller.products.create({
        name: 'Race Product',
        sku: `RACE-${nanoid(6)}`,
        price: 20,
      });

      // First tab saves successfully (version 0 -> 1).
      await caller.products.update({ id: created.id, version: created.version, price: 25 });

      // Second tab still holds version 0 — must be rejected.
      await expectStaleVersion(
        caller.products.update({ id: created.id, version: created.version, price: 99 })
      );

      // The stale write left the first save intact.
      const fetched = await caller.products.getById({ id: created.id });
      expect(fetched.price).toBe(25);
      expect(fetched.version).toBe(1);
    });

    it('keeps existence checks tenant-scoped (cross-tenant => NOT_FOUND)', async () => {
      const callerA = appRouter.createCaller(adminContext(tenantA));
      const created = await callerA.products.create({
        name: 'Tenant A Product',
        sku: `TA-${nanoid(6)}`,
        price: 5,
      });

      const callerB = appRouter.createCaller(adminContext(tenantB));
      try {
        await callerB.products.update({ id: created.id, version: created.version, price: 7 });
        expect.unreachable('cross-tenant update should not resolve');
      } catch (err) {
        expect((err as TRPCError).code).toBe('NOT_FOUND');
      }
    });
  });

  describe('customers.update', () => {
    it('rejects a stale version', async () => {
      const caller = appRouter.createCaller(adminContext(tenantA));
      const created = await caller.customers.create({ name: 'Versioned Customer' });
      await caller.customers.update({ id: created.id, version: created.version, name: 'First' });
      await expectStaleVersion(
        caller.customers.update({ id: created.id, version: created.version, name: 'Second' })
      );
    });

    it('still bumps the version when only the credit limit changes', async () => {
      const caller = appRouter.createCaller(adminContext(tenantA));
      const created = await caller.customers.create({ name: 'Credit Customer' });
      const updated = await caller.customers.update({
        id: created.id,
        version: created.version,
        creditLimit: 100000,
      });
      expect(updated.version).toBe(1);
      expect(updated.creditLimit).toBe(100000);
    });
  });

  describe('providers.update', () => {
    it('rejects a stale version', async () => {
      const caller = appRouter.createCaller(adminContext(tenantA));
      const created = await caller.providers.create({ name: 'Versioned Provider' });
      await caller.providers.update({ id: created.id, version: created.version, phone: '111' });
      await expectStaleVersion(
        caller.providers.update({ id: created.id, version: created.version, phone: '222' })
      );
    });
  });

  describe('categories.update', () => {
    it('rejects a stale version', async () => {
      const caller = appRouter.createCaller(adminContext(tenantA));
      const created = await caller.categories.create({ name: 'Versioned Category' });
      await caller.categories.update({ id: created.id, version: created.version, name: 'First' });
      await expectStaleVersion(
        caller.categories.update({ id: created.id, version: created.version, name: 'Second' })
      );
    });
  });

  describe('tenantLocale.update', () => {
    it('stores the first real save at version 1 and rejects stale fallback saves', async () => {
      // Tenant B has no locale row yet. `tenantLocale.get()` would return the
      // virtual fallback version 0, so the first persisted row must advance to
      // version 1; otherwise another tab holding fallback version 0 could
      // overwrite the first save without seeing STALE_VERSION.
      const caller = appRouter.createCaller(adminContext(tenantB));
      await caller.tenantLocale.update({ version: 0, countryCode: 'CO' });

      const first = await caller.tenantLocale.get();
      expect(first.countryCode).toBe('CO');
      expect(first.version).toBe(1);

      await expectStaleVersion(
        caller.tenantLocale.update({ version: 0, countryCode: 'CL' })
      );
      expect((await caller.tenantLocale.get()).countryCode).toBe('CO');

      const updated = await caller.tenantLocale.update({
        version: first.version,
        countryCode: 'MX',
      });
      expect(updated.countryCode).toBe('MX');
      expect(updated.version).toBe(2);
    });
  });
});
