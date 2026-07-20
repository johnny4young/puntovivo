/**
 * `customerLedger.*` tRPC router coverage.
 *
 * Pins the contract that the schema scaffold (commit e4a1294) shipped
 * but never tested directly: `list`, `getBalance`, `addPayment`,
 * `addAdjustment`. Also covers the new `creditLimit` field on
 * `customers.create` / `customers.update` (this change) so the
 * persistence layer + Zod input round-trip both sides of the V5
 * "Cuenta corriente" UI panel.
 *
 * Multi-tenant invariant: every procedure scopes by `ctx.tenantId`
 * and re-validates the customerId belongs to the caller's tenant.
 * Cross-tenant attempts must throw `CUSTOMER_NOT_FOUND`.
 *
 * Role gates:
 * - list / getBalance / addPayment → manager + admin
 * - addAdjustment                  → admin only
 * - cashier never reaches any procedure
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { customers, customerLedgerEntries, sites, tenants, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let primarySiteId: string;
let adminUserId: string;
let managerUserId: string;
let cashierUserId: string;
let foreignTenantId: string;
let foreignCustomerId: string;

function createCallerContext(overrides: {
  userId: string;
  role: 'admin' | 'manager' | 'cashier' | 'viewer';
  email: string;
  tenantOverride?: string;
}): Context {
  const db = getDatabase();
  const effectiveTenant = overrides.tenantOverride ?? tenantId;
  return {
    req: {
      server: server.app,
      headers: {},
      user: {
        userId: overrides.userId,
        email: overrides.email,
        role: overrides.role,
        tenantId: effectiveTenant,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: {
      id: overrides.userId,
      email: overrides.email,
      role: overrides.role,
      tenantId: effectiveTenant,
    },
    tenantId: effectiveTenant,
    siteId: primarySiteId,
  };
}

async function seedCustomer(name: string, tenantOverride?: string): Promise<string> {
  const db = getDatabase();
  const id = nanoid();
  await db.insert(customers).values({
    id,
    tenantId: tenantOverride ?? tenantId,
    name,
  });
  return id;
}

describe('customerLedger.* router', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();

    const seededAdmin = await db
      .select()
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    if (!seededAdmin) throw new Error('Expected seeded admin user');
    tenantId = seededAdmin.tenantId;
    adminUserId = seededAdmin.id;

    const mainSite = await db
      .select()
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!mainSite) throw new Error('Expected seeded site');
    primarySiteId = mainSite.id;

    // Manager + cashier users in the same tenant for the role-gate
    // assertions.
    managerUserId = nanoid();
    cashierUserId = nanoid();
    await db.insert(users).values([
      {
        id: managerUserId,
        tenantId,
        email: `manager-${managerUserId.slice(0, 6)}@localhost`,
        passwordHash: 'x',
        name: 'Manager',
        role: 'manager',
        isActive: true,
      },
      {
        id: cashierUserId,
        tenantId,
        email: `cashier-${cashierUserId.slice(0, 6)}@localhost`,
        passwordHash: 'x',
        name: 'Cashier',
        role: 'cashier',
        isActive: true,
      },
    ]);

    // A foreign tenant + customer for the cross-tenant isolation
    // assertions.
    foreignTenantId = nanoid();
    await db.insert(tenants).values({
      id: foreignTenantId,
      slug: `foreign-${foreignTenantId.slice(0, 6)}`,
      name: 'Foreign Tenant',
    });
    foreignCustomerId = await seedCustomer('Foreign Customer', foreignTenantId);
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    // Keep ledger isolated per test so balance math is predictable.
    const db = getDatabase();
    await db.delete(customerLedgerEntries).where(eq(customerLedgerEntries.tenantId, tenantId));
  });

  // -------------------------------------------------------------------------
  // list
  // -------------------------------------------------------------------------

  describe('list', () => {
    it('returns rows in occurredAt DESC order, capped at the limit', async () => {
      const customerId = await seedCustomer('Cliente Lista');
      const db = getDatabase();
      // Three rows with explicit occurredAt so the ordering assertion is
      // deterministic.
      await db.insert(customerLedgerEntries).values([
        {
          id: nanoid(),
          tenantId,
          customerId,
          occurredAt: '2026-05-10T10:00:00.000Z',
          kind: 'sale',
          amount: 100,
        },
        {
          id: nanoid(),
          tenantId,
          customerId,
          occurredAt: '2026-05-15T10:00:00.000Z',
          kind: 'payment',
          amount: -50,
        },
        {
          id: nanoid(),
          tenantId,
          customerId,
          occurredAt: '2026-05-12T10:00:00.000Z',
          kind: 'adjustment',
          amount: 25,
        },
      ]);

      const caller = appRouter.createCaller(
        createCallerContext({
          userId: adminUserId,
          role: 'admin',
          email: 'admin@localhost',
        })
      );
      const rows = await caller.customerLedger.list({ customerId, limit: 2 });
      expect(rows).toHaveLength(2);
      // Newest first.
      expect(rows[0]?.kind).toBe('payment');
      expect(rows[1]?.kind).toBe('adjustment');
    });

    it('returns an empty array for a customer with no entries', async () => {
      const customerId = await seedCustomer('Cliente Vacío');
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: adminUserId,
          role: 'admin',
          email: 'admin@localhost',
        })
      );
      const rows = await caller.customerLedger.list({ customerId });
      expect(rows).toEqual([]);
    });

    it('rejects cashier callers (manager+ only)', async () => {
      const customerId = await seedCustomer('Cliente Cash');
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: cashierUserId,
          role: 'cashier',
          email: 'cashier@localhost',
        })
      );
      await expect(caller.customerLedger.list({ customerId })).rejects.toThrow(
        /FORBIDDEN|UNAUTHORIZED|forbidden|Only administrators/i
      );
    });

    it('does not leak rows from a foreign tenant', async () => {
      const db = getDatabase();
      // Insert a row under the foreign tenant.
      await db.insert(customerLedgerEntries).values({
        id: nanoid(),
        tenantId: foreignTenantId,
        customerId: foreignCustomerId,
        kind: 'sale',
        amount: 999,
      });
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: adminUserId,
          role: 'admin',
          email: 'admin@localhost',
        })
      );
      // Asking for the foreign customer's ledger from the caller's
      // tenant returns zero rows — the tenant filter holds even when
      // the customerId is real (in the foreign tenant).
      const rows = await caller.customerLedger.list({
        customerId: foreignCustomerId,
      });
      expect(rows).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // getBalance
  // -------------------------------------------------------------------------

  describe('getBalance', () => {
    it('returns 0 for a customer with no entries', async () => {
      const customerId = await seedCustomer('Saldo Cero');
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: adminUserId,
          role: 'admin',
          email: 'admin@localhost',
        })
      );
      const result = await caller.customerLedger.getBalance({ customerId });
      expect(result.balance).toBe(0);
    });

    it('sums signed entries to the running balance', async () => {
      const customerId = await seedCustomer('Saldo Mixto');
      const db = getDatabase();
      await db.insert(customerLedgerEntries).values([
        { id: nanoid(), tenantId, customerId, kind: 'sale', amount: 1000 },
        { id: nanoid(), tenantId, customerId, kind: 'payment', amount: -300 },
        { id: nanoid(), tenantId, customerId, kind: 'adjustment', amount: 50 },
      ]);
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: adminUserId,
          role: 'admin',
          email: 'admin@localhost',
        })
      );
      const result = await caller.customerLedger.getBalance({ customerId });
      expect(result.balance).toBe(750);
    });
  });

  // -------------------------------------------------------------------------
  // addPayment
  // -------------------------------------------------------------------------

  describe('addPayment', () => {
    it('inserts a negative-signed payment row + returns the id', async () => {
      const customerId = await seedCustomer('Pagador');
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: adminUserId,
          role: 'admin',
          email: 'admin@localhost',
        })
      );
      const result = await caller.customerLedger.addPayment({
        customerId,
        amount: 250,
        note: 'Abono efectivo',
      });
      expect(result.id).toBeDefined();
      const db = getDatabase();
      const [row] = await db
        .select()
        .from(customerLedgerEntries)
        .where(eq(customerLedgerEntries.id, result.id))
        .limit(1);
      expect(row).toBeDefined();
      expect(row?.kind).toBe('payment');
      expect(row?.amount).toBe(-250);
      expect(row?.note).toBe('Abono efectivo');
      expect(row?.createdBy).toBe(adminUserId);
    });

    it('normalizes a positive input even when the caller sends a negative number', async () => {
      // The Zod refinement rejects non-positive amounts BEFORE the
      // handler runs, so the safe behavior is "always rejects ≤ 0".
      const customerId = await seedCustomer('Pagador Negativo');
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: adminUserId,
          role: 'admin',
          email: 'admin@localhost',
        })
      );
      await expect(caller.customerLedger.addPayment({ customerId, amount: -100 })).rejects.toThrow(
        /positive/i
      );
      await expect(caller.customerLedger.addPayment({ customerId, amount: 0 })).rejects.toThrow(
        /positive/i
      );
    });

    it('rejects a customerId from a foreign tenant', async () => {
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: adminUserId,
          role: 'admin',
          email: 'admin@localhost',
        })
      );
      await expect(
        caller.customerLedger.addPayment({
          customerId: foreignCustomerId,
          amount: 100,
        })
      ).rejects.toThrow(/CUSTOMER_NOT_FOUND|NOT_FOUND/i);
    });

    it('allows manager callers (manager+ gate)', async () => {
      const customerId = await seedCustomer('Pagador Manager');
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: managerUserId,
          role: 'manager',
          email: 'manager@localhost',
        })
      );
      const result = await caller.customerLedger.addPayment({
        customerId,
        amount: 100,
      });
      expect(result.id).toBeDefined();
    });

    it('rejects cashier callers', async () => {
      const customerId = await seedCustomer('Pagador Cashier');
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: cashierUserId,
          role: 'cashier',
          email: 'cashier@localhost',
        })
      );
      await expect(caller.customerLedger.addPayment({ customerId, amount: 100 })).rejects.toThrow(
        /FORBIDDEN|UNAUTHORIZED|forbidden|Only administrators/i
      );
    });
  });

  // -------------------------------------------------------------------------
  // addAdjustment
  // -------------------------------------------------------------------------

  describe('addAdjustment', () => {
    it('accepts both signs and stores the amount as-is', async () => {
      const customerId = await seedCustomer('Ajuste Dual');
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: adminUserId,
          role: 'admin',
          email: 'admin@localhost',
        })
      );
      const positive = await caller.customerLedger.addAdjustment({
        customerId,
        amount: 75,
        note: 'Saldo anterior',
      });
      const negative = await caller.customerLedger.addAdjustment({
        customerId,
        amount: -40,
        note: 'Devolución producto fuera de plazo',
      });
      const db = getDatabase();
      const rows = await db
        .select()
        .from(customerLedgerEntries)
        .where(eq(customerLedgerEntries.customerId, customerId))
        .orderBy(desc(customerLedgerEntries.createdAt));
      expect(rows.find(r => r.id === positive.id)?.amount).toBe(75);
      expect(rows.find(r => r.id === negative.id)?.amount).toBe(-40);
    });

    it('rejects an empty note', async () => {
      const customerId = await seedCustomer('Sin Nota');
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: adminUserId,
          role: 'admin',
          email: 'admin@localhost',
        })
      );
      await expect(
        caller.customerLedger.addAdjustment({
          customerId,
          amount: 100,
          note: '',
        })
      ).rejects.toThrow(/note/i);
    });

    it('rejects a zero amount', async () => {
      const customerId = await seedCustomer('Ajuste Cero');
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: adminUserId,
          role: 'admin',
          email: 'admin@localhost',
        })
      );
      await expect(
        caller.customerLedger.addAdjustment({
          customerId,
          amount: 0,
          note: 'No-op adjustment',
        })
      ).rejects.toThrow(/non-zero/i);
    });

    it('rejects manager callers (admin-only gate)', async () => {
      const customerId = await seedCustomer('Ajuste Manager');
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: managerUserId,
          role: 'manager',
          email: 'manager@localhost',
        })
      );
      await expect(
        caller.customerLedger.addAdjustment({
          customerId,
          amount: 100,
          note: 'Test',
        })
      ).rejects.toThrow(/FORBIDDEN|UNAUTHORIZED|forbidden|Only administrators/i);
    });

    it('rejects a customerId from a foreign tenant', async () => {
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: adminUserId,
          role: 'admin',
          email: 'admin@localhost',
        })
      );
      await expect(
        caller.customerLedger.addAdjustment({
          customerId: foreignCustomerId,
          amount: 100,
          note: 'cross-tenant probe',
        })
      ).rejects.toThrow(/CUSTOMER_NOT_FOUND|NOT_FOUND/i);
    });
  });

  // -------------------------------------------------------------------------
  // customers.{create,update} — creditLimit round-trip ()
  // -------------------------------------------------------------------------

  describe('creditLimit on customers.{create,update}', () => {
    it('accepts and persists a zero creditLimit on create (default sentinel)', async () => {
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: adminUserId,
          role: 'admin',
          email: 'admin@localhost',
        })
      );
      const created = await caller.customers.create({
        name: 'Cliente Sin Cupo',
        isActive: true,
      });
      expect((created as { creditLimit: number }).creditLimit).toBe(0);
    });

    it('persists a positive creditLimit through create', async () => {
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: adminUserId,
          role: 'admin',
          email: 'admin@localhost',
        })
      );
      const created = await caller.customers.create({
        name: 'Cliente Con Cupo',
        creditLimit: 500_000,
        isActive: true,
      });
      expect((created as { creditLimit: number }).creditLimit).toBe(500_000);
    });

    it('updates the creditLimit via customers.update', async () => {
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: adminUserId,
          role: 'admin',
          email: 'admin@localhost',
        })
      );
      const created = await caller.customers.create({
        name: 'Cliente A Editar',
        isActive: true,
      });
      const updated = await caller.customers.update({
        id: (created as { id: string }).id,
        version: (created as { version: number }).version,
        creditLimit: 150_000,
      });
      expect((updated as { creditLimit: number }).creditLimit).toBe(150_000);

      // Setting back to 0 (sentinel for "no limit") must also work — the
      // first update bumped the optimistic version, so reuse the returned one.
      const cleared = await caller.customers.update({
        id: (created as { id: string }).id,
        version: (updated as { version: number }).version,
        creditLimit: 0,
      });
      expect((cleared as { creditLimit: number }).creditLimit).toBe(0);
    });

    it('rejects a negative creditLimit at the Zod input layer', async () => {
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: adminUserId,
          role: 'admin',
          email: 'admin@localhost',
        })
      );
      await expect(
        caller.customers.create({
          name: 'Cliente Cupo Inválido',
          creditLimit: -100,
          isActive: true,
        })
      ).rejects.toThrow(/creditLimit|nonnegative|greater/i);
    });
  });
});
