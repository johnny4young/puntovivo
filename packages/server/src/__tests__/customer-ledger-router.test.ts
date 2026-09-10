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
 *
 * Both writes are critical commands, so every mutating call needs a registered
 * device plus a command envelope. Devices claim an activeUserId, so each role
 * carries its own; a shared one would be rejected as `different_user` rather
 * than reaching the assertion under test.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { customers, customerLedgerEntries, sites, tenants, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { registerDevice } from '../services/devices/devicesService.js';
import {
  COMMAND_ENVELOPE_HEADER,
  DEVICE_ID_HEADER,
  type CommandEnvelope,
} from '../trpc/schemas/envelope.js';

let server: PuntovivoServer;
let tenantId: string;
let primarySiteId: string;
let adminUserId: string;
let managerUserId: string;
let cashierUserId: string;
let foreignTenantId: string;
let foreignCustomerId: string;
const deviceIdByUserId = new Map<string, string>();

function createCallerContext(overrides: {
  userId: string;
  role: 'admin' | 'manager' | 'cashier' | 'viewer';
  email: string;
  tenantOverride?: string;
  /** Replay the exact same envelope, to exercise the idempotency path. */
  envelope?: CommandEnvelope;
  /** Drop the envelope header, to prove the procedure demands one. */
  omitEnvelope?: boolean;
  /** Drop the device header, to prove the procedure demands one. */
  omitDevice?: boolean;
}): Context {
  const db = getDatabase();
  const effectiveTenant = overrides.tenantOverride ?? tenantId;
  // A fresh envelope per context: two calls that must both land (rather than
  // deduplicate) each get their own idempotency key, exactly as the client
  // mints one per logical input.
  const envelope: CommandEnvelope = {
    operationId: randomUUID(),
    idempotencyKey: randomUUID(),
    clientCreatedAt: new Date().toISOString(),
  };
  const deviceId = overrides.omitDevice ? undefined : deviceIdByUserId.get(overrides.userId);
  const headers: Record<string, string> = {
    ...(deviceId ? { [DEVICE_ID_HEADER]: deviceId } : {}),
    ...(overrides.omitEnvelope
      ? {}
      : { [COMMAND_ENVELOPE_HEADER]: JSON.stringify(overrides.envelope ?? envelope) }),
  };
  return {
    req: {
      server: server.app,
      headers,
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

/** A caller with a freshly minted envelope, for one deliberate write. */
function adminCaller(envelope?: CommandEnvelope) {
  return appRouter.createCaller(
    createCallerContext({
      userId: adminUserId,
      role: 'admin',
      email: 'admin@localhost',
      ...(envelope ? { envelope } : {}),
    })
  );
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

    for (const userId of [adminUserId, managerUserId, cashierUserId]) {
      const registration = await registerDevice(db, {
        tenantId,
        userId,
        kind: 'web',
        name: `ledger-test-${userId.slice(0, 6)}`,
      });
      deviceIdByUserId.set(userId, registration.deviceId);
    }
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

    it('stores the payment rounded to two decimals', async () => {
      // The input schema accepts any positive finite number, and the balance
      // is a SUM over these rows, so an unrounded entry is not a display
      // artifact a later round can absorb - it compounds into every balance
      // read from then on, including the credit-limit decision.
      const customerId = await seedCustomer('Pagador Residuo');
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: adminUserId,
          role: 'admin',
          email: 'admin@localhost',
        })
      );
      const result = await caller.customerLedger.addPayment({ customerId, amount: 10.005 });
      const db = getDatabase();
      const [row] = await db
        .select()
        .from(customerLedgerEntries)
        .where(eq(customerLedgerEntries.id, result.id))
        .limit(1);
      expect(row?.amount).toBe(-10.01);
    });

    it('normalizes a positive input even when the caller sends a negative number', async () => {
      // The Zod refinement rejects non-positive amounts BEFORE the
      // handler runs, so the safe behavior is "always rejects ≤ 0".
      const customerId = await seedCustomer('Pagador Negativo');
      // A caller per attempt: the two payloads differ, so replaying one
      // envelope across both would be an IDEMPOTENCY_KEY_CONFLICT rather than
      // the validation error under test.
      await expect(
        adminCaller().customerLedger.addPayment({ customerId, amount: -100 })
      ).rejects.toThrow(/positive/i);
      await expect(
        adminCaller().customerLedger.addPayment({ customerId, amount: 0 })
      ).rejects.toThrow(/positive/i);
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
    it('stores the adjustment rounded to two decimals', async () => {
      const customerId = await seedCustomer('Ajuste Residuo');
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: adminUserId,
          role: 'admin',
          email: 'admin@localhost',
        })
      );
      const result = await caller.customerLedger.addAdjustment({
        customerId,
        amount: -3.334,
        note: 'Ajuste con residuo',
      });
      const db = getDatabase();
      const [row] = await db
        .select()
        .from(customerLedgerEntries)
        .where(eq(customerLedgerEntries.id, result.id))
        .limit(1);
      expect(row?.amount).toBe(-3.33);
    });

    it('accepts both signs and stores the amount as-is', async () => {
      const customerId = await seedCustomer('Ajuste Dual');
      // Two deliberate, different writes: each needs its own envelope, the
      // same way the client mints one per logical input.
      const positive = await adminCaller().customerLedger.addAdjustment({
        customerId,
        amount: 75,
        note: 'Saldo anterior',
      });
      const negative = await adminCaller().customerLedger.addAdjustment({
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
  // -------------------------------------------------------------------------
  // command envelope
  // -------------------------------------------------------------------------

  describe('command envelope', () => {
    /**
     * The write path the operator actually drives is a modal whose confirm
     * button sits OUTSIDE the form (the modal renders its footer as a sibling
     * of the body), so a submit event dispatched at the form -- what Enter
     * does -- never consults the button's disabled state. The client-side
     * guard closes that on the one machine that has it. The envelope is what
     * closes it for every other caller: a second delivery of the same logical
     * payment collapses onto the first write instead of halving the
     * customer's debt again.
     */
    it('replaying one envelope writes a single payment row', async () => {
      const customerId = await seedCustomer('Cliente Reintento');
      const envelope: CommandEnvelope = {
        operationId: randomUUID(),
        idempotencyKey: randomUUID(),
        clientCreatedAt: new Date().toISOString(),
      };

      const first = await adminCaller(envelope).customerLedger.addPayment({
        customerId,
        amount: 500,
      });
      const replay = await adminCaller(envelope).customerLedger.addPayment({
        customerId,
        amount: 500,
      });

      // The replay is served from the idempotency record, so it reports the
      // same entry rather than creating a second one.
      expect(replay).toEqual(first);

      const db = getDatabase();
      const rows = await db
        .select()
        .from(customerLedgerEntries)
        .where(eq(customerLedgerEntries.customerId, customerId));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.amount).toBe(-500);

      const balance = await adminCaller().customerLedger.getBalance({ customerId });
      expect(balance.balance).toBe(-500);
    });

    it('replaying one envelope writes a single adjustment row', async () => {
      const customerId = await seedCustomer('Cliente Ajuste Reintento');
      const envelope: CommandEnvelope = {
        operationId: randomUUID(),
        idempotencyKey: randomUUID(),
        clientCreatedAt: new Date().toISOString(),
      };
      const input = { customerId, amount: 120, note: 'Saldo inicial' };

      const first = await adminCaller(envelope).customerLedger.addAdjustment(input);
      const replay = await adminCaller(envelope).customerLedger.addAdjustment(input);
      expect(replay).toEqual(first);

      const db = getDatabase();
      const rows = await db
        .select()
        .from(customerLedgerEntries)
        .where(eq(customerLedgerEntries.customerId, customerId));
      expect(rows).toHaveLength(1);
    });

    it('refuses a write with no envelope at all', async () => {
      // Pins the decorator itself. Reverting either procedure to a bare role
      // guard makes this pass silently, which is exactly the regression this
      // assertion exists to catch.
      const customerId = await seedCustomer('Cliente Sin Sobre');
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: adminUserId,
          role: 'admin',
          email: 'admin@localhost',
          omitEnvelope: true,
        })
      );
      await expect(
        caller.customerLedger.addPayment({ customerId, amount: 10 })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      await expect(
        caller.customerLedger.addAdjustment({ customerId, amount: 10, note: 'x' })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

      const db = getDatabase();
      const rows = await db
        .select()
        .from(customerLedgerEntries)
        .where(eq(customerLedgerEntries.customerId, customerId));
      expect(rows).toHaveLength(0);
    });

    it('refuses a write from an unregistered device', async () => {
      const customerId = await seedCustomer('Cliente Sin Dispositivo');
      const caller = appRouter.createCaller(
        createCallerContext({
          userId: adminUserId,
          role: 'admin',
          email: 'admin@localhost',
          omitDevice: true,
        })
      );
      await expect(caller.customerLedger.addPayment({ customerId, amount: 10 })).rejects.toThrow(
        /x-device-id/i
      );
    });

    it('checks the role before the envelope, on both writes', async () => {
      // The documented ordering: guards chain BEFORE commandEnvelope, because
      // the envelope short-circuits on a cache hit without calling next(). A
      // cashier with no device must be refused for the ROLE, not merely for
      // the missing header -- otherwise registering a device would be enough
      // to reach an admin-only write's cached result.
      const customerId = await seedCustomer('Cliente Rol');
      const cashier = appRouter.createCaller(
        createCallerContext({
          userId: cashierUserId,
          role: 'cashier',
          email: 'cashier@localhost',
          omitDevice: true,
          omitEnvelope: true,
        })
      );
      await expect(
        cashier.customerLedger.addPayment({ customerId, amount: 10 })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });

      const manager = appRouter.createCaller(
        createCallerContext({
          userId: managerUserId,
          role: 'manager',
          email: 'manager@localhost',
          omitDevice: true,
          omitEnvelope: true,
        })
      );
      await expect(
        manager.customerLedger.addAdjustment({ customerId, amount: 10, note: 'x' })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
