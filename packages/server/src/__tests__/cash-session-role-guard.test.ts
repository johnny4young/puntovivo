/**
 * The cash drawer is cashier-or-above, and the envelope is not a role guard.
 *
 * `cashSessions.open` / `close` / `recordMovement` ran on
 * `criticalCommandProcedure`, which is `tenantProcedure.use(commandEnvelope)`
 * and nothing else — idempotency, no authorization. `viewer` is an assignable
 * role, so a viewer could open the drawer, move cash and close it, mutating
 * `expected_balance`, `over_short` and the evidence the day-close signoff
 * freezes.
 *
 * Sharpest part: `openCashSession` also inserts an `employee_shifts` row and an
 * `employee_shift.clock_in` audit entry, while the direct route
 * `employeeShifts.clockIn` IS gated — so this was a strict bypass of an
 * existing guard into the attendance and payroll pipeline.
 *
 * `roleAccess.test.ts` types its context as admin | manager | cashier, so
 * `viewer` was never exercised anywhere. That is why this went unnoticed.
 *
 * @module __tests__/cash-session-role-guard.test
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { companies, sites, tenants, users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import type { UserRole } from '@puntovivo/shared/roles';

let server: PuntovivoServer;
let tenantId: string;
let siteId: string;
const userIdByRole = new Map<UserRole, string>();

function contextFor(role: UserRole): Context {
  const db = getDatabase();
  const id = userIdByRole.get(role)!;
  const user = { id, email: `${role}@localhost`, role, tenantId };
  return {
    req: {
      server: server.app,
      headers: {},
      user: { userId: id, email: user.email, role, tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user,
    tenantId,
    siteId,
  };
}

describe('cash session role guard', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const now = new Date().toISOString();
    tenantId = nanoid();
    const companyId = nanoid();
    siteId = nanoid();

    await db.insert(tenants).values({
      id: tenantId,
      name: 'Drawer Tenant',
      slug: `drawer-${nanoid(6)}`,
      settings: {},
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companies).values({
      id: companyId,
      tenantId,
      name: 'Drawer Company',
      taxId: '900000004-0',
      address: 'Addr',
      phone: '0000000000',
      email: 'company@drawer.test',
      logoUrl: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: siteId,
      tenantId,
      companyId,
      name: 'Drawer Site',
      address: 'Addr',
      phone: '0',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    for (const role of ['viewer', 'cashier'] as const) {
      const id = nanoid();
      userIdByRole.set(role, id);
      await db.insert(users).values({
        id,
        tenantId,
        email: `${role}@drawer.test`,
        name: `Drawer ${role}`,
        passwordHash: 'x',
        role,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  afterAll(async () => {
    await server.close();
  });

  it('refuses a viewer on every drawer write', async () => {
    const viewer = appRouter.createCaller(contextFor('viewer'));

    await expect(
      viewer.cashSessions.open({ openingFloat: 100, registerName: 'Main register' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      viewer.cashSessions.recordMovement({ type: 'paid_out', amount: 50, reason: 'x' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(viewer.cashSessions.close({ actualCount: 100 })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('refuses a viewer on the sale reprint command', async () => {
    // Same ungated procedure; it bumps reprintCount and returns full sale PII.
    await expect(
      appRouter.createCaller(contextFor('viewer')).sales.getForReprint({ saleId: nanoid() })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('still lets a cashier past the guard', async () => {
    // The guard must reject the role, not the operation: a cashier reaching
    // the handler and failing on business state is the correct outcome here.
    const cashier = appRouter.createCaller(contextFor('cashier'));
    await expect(cashier.cashSessions.close({ actualCount: 100 })).rejects.not.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
