import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase, type DatabaseInstance } from '../db/index.js';
import { auditLogs, scheduledShifts, sites, tenants, users } from '../db/schema.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { zonedWallTimeToIso } from '../services/labor/timezone.js';
import { appRouter } from '../trpc/router.js';
import {
  freshCriticalContext,
  type FreshContextOverrides,
} from './utils/criticalCommandFixture.js';

let server: PuntovivoServer;
let db: DatabaseInstance;
let tenantId: string;
let siteId: string;

type EmployeeRole = 'admin' | 'manager' | 'cashier' | 'viewer';

async function createEmployee(role: EmployeeRole = 'cashier') {
  const id = nanoid();
  const email = `schedule-${role}-${id}@example.test`;
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    tenantId,
    email,
    name: `Schedule ${role} ${id.slice(0, 4)}`,
    passwordHash: 'not-used-by-router-tests',
    role,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const registration = await registerDevice(db, {
    tenantId,
    userId: id,
    kind: 'web',
    name: `employee-schedules-${role}`,
  });
  return {
    id,
    role,
    fresh(overrides?: FreshContextOverrides) {
      return freshCriticalContext({
        db,
        serverApp: server.app,
        tenantId,
        userId: id,
        email,
        role,
        siteId,
        deviceId: registration.deviceId,
        ...overrides,
      });
    },
  };
}

function scheduleInput(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    userId,
    siteId,
    startDate: '2026-07-20',
    startTime: '08:00',
    endDate: '2026-07-20',
    endTime: '16:00',
    notes: '  Front register  ',
    ...overrides,
  };
}

describe('employee schedule router', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    db = getDatabase();
    const seededAdmin = await db
      .select({ tenantId: users.tenantId })
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    if (!seededAdmin) throw new Error('Expected seeded admin user');
    tenantId = seededAdmin.tenantId;
    const site = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .get();
    if (!site) throw new Error('Expected seeded site');
    siteId = site.id;
  });

  afterAll(async () => {
    await server.close();
  });

  it('exposes only employees the current role can schedule', async () => {
    const manager = await createEmployee('manager');
    const cashier = await createEmployee('cashier');
    const admin = await createEmployee('admin');
    const viewer = await createEmployee('viewer');

    const managerContext = await appRouter
      .createCaller(manager.fresh())
      .employeeShifts.schedule.context();
    expect(managerContext.employees.map(row => row.id)).toEqual(
      expect.arrayContaining([manager.id, cashier.id])
    );
    expect(managerContext.employees.map(row => row.id)).not.toEqual(
      expect.arrayContaining([admin.id, viewer.id])
    );
    expect(managerContext.sites.map(row => row.id)).toContain(siteId);
    expect(managerContext.timeZone).toMatch(/^[A-Za-z_]+\/[A-Za-z_]+/);

    const adminContext = await appRouter
      .createCaller(admin.fresh())
      .employeeShifts.schedule.context();
    expect(adminContext.employees.map(row => row.id)).toEqual(
      expect.arrayContaining([manager.id, cashier.id, admin.id])
    );
    expect(adminContext.employees.map(row => row.id)).not.toContain(viewer.id);
  });

  it('creates and lists a tenant-timezone schedule with atomic audit evidence', async () => {
    const manager = await createEmployee('manager');
    const cashier = await createEmployee('cashier');
    const context = await appRouter.createCaller(manager.fresh()).employeeShifts.schedule.context();

    const created = await appRouter
      .createCaller(manager.fresh())
      .employeeShifts.schedule.create(scheduleInput(cashier.id));
    expect(created).toMatchObject({
      userId: cashier.id,
      siteId,
      status: 'scheduled',
      notes: 'Front register',
      timeZone: context.timeZone,
      version: 1,
    });
    expect(created.startsAt).toBe(zonedWallTimeToIso('2026-07-20', '08:00', context.timeZone));

    const listed = await appRouter
      .createCaller(manager.fresh())
      .employeeShifts.schedule.list({ fromDate: '2026-07-20', toDate: '2026-07-27' });
    expect(listed.map(row => row.id)).toContain(created.id);

    const evidence = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceId, created.id)))
      .get();
    expect(evidence).toMatchObject({
      actorId: manager.id,
      action: 'scheduled_shift.create',
      resourceType: 'scheduled_shift',
    });
    expect(evidence?.operationId).toBeTruthy();
    expect(evidence?.after).toMatchObject({ userId: cashier.id, notes: 'Front register' });
  });

  it('allows adjacent shifts but blocks overlaps in the service and database', async () => {
    const manager = await createEmployee('manager');
    const cashier = await createEmployee('cashier');
    const first = await appRouter
      .createCaller(manager.fresh())
      .employeeShifts.schedule.create(scheduleInput(cashier.id));

    await expect(
      appRouter
        .createCaller(manager.fresh())
        .employeeShifts.schedule.create(
          scheduleInput(cashier.id, { startTime: '15:30', endTime: '20:00' })
        )
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SCHEDULE_SHIFT_OVERLAP' }),
    });

    await expect(
      appRouter
        .createCaller(manager.fresh())
        .employeeShifts.schedule.create(
          scheduleInput(cashier.id, { startTime: '16:00', endTime: '20:00' })
        )
    ).resolves.toMatchObject({ startsAt: expect.any(String) });

    expect(() =>
      db
        .insert(scheduledShifts)
        .values({
          id: nanoid(),
          tenantId,
          userId: cashier.id,
          siteId,
          startsAt: first.startsAt,
          endsAt: first.endsAt,
          timeZone: first.timeZone,
          status: 'scheduled',
          version: 1,
          createdByUserId: manager.id,
          updatedByUserId: manager.id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run()
    ).toThrow(/SCHEDULE_SHIFT_OVERLAP/);
  });

  it('updates with optimistic concurrency and cancels without deleting evidence', async () => {
    const manager = await createEmployee('manager');
    const cashier = await createEmployee('cashier');
    const created = await appRouter
      .createCaller(manager.fresh())
      .employeeShifts.schedule.create(scheduleInput(cashier.id));

    const updated = await appRouter.createCaller(manager.fresh()).employeeShifts.schedule.update({
      ...scheduleInput(cashier.id, { startTime: '09:00', endTime: '17:00', notes: null }),
      id: created.id,
      version: created.version,
    });
    expect(updated).toMatchObject({ version: 2, notes: null });

    await expect(
      appRouter.createCaller(manager.fresh()).employeeShifts.schedule.update({
        ...scheduleInput(cashier.id),
        id: created.id,
        version: 1,
      })
    ).rejects.toMatchObject({ cause: expect.objectContaining({ errorCode: 'STALE_VERSION' }) });

    const cancelled = await appRouter
      .createCaller(manager.fresh())
      .employeeShifts.schedule.cancel({ id: created.id, version: updated.version });
    expect(cancelled).toMatchObject({ status: 'cancelled', version: 3 });
    expect(cancelled.cancelledAt).toBeTruthy();
    expect(
      await db.select().from(scheduledShifts).where(eq(scheduledShifts.id, created.id)).get()
    ).toMatchObject({ status: 'cancelled' });

    const hidden = await appRouter
      .createCaller(manager.fresh())
      .employeeShifts.schedule.list({ fromDate: '2026-07-20', toDate: '2026-07-27' });
    expect(hidden.map(row => row.id)).not.toContain(created.id);
    const withCancelled = await appRouter
      .createCaller(manager.fresh())
      .employeeShifts.schedule.list({
        fromDate: '2026-07-20',
        toDate: '2026-07-27',
        includeCancelled: true,
      });
    expect(withCancelled.find(row => row.id === created.id)?.status).toBe('cancelled');

    const actions = await db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.resourceId, created.id))
      .all();
    expect(actions.map(row => row.action)).toEqual([
      'scheduled_shift.create',
      'scheduled_shift.update',
      'scheduled_shift.cancel',
    ]);
  });

  it('enforces role and tenant boundaries without leaking admin schedules', async () => {
    const manager = await createEmployee('manager');
    const cashier = await createEmployee('cashier');
    const admin = await createEmployee('admin');

    await expect(
      appRouter.createCaller(cashier.fresh()).employeeShifts.schedule.context()
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      appRouter
        .createCaller(manager.fresh())
        .employeeShifts.schedule.create(scheduleInput(admin.id))
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SCHEDULE_EMPLOYEE_NOT_FOUND' }),
    });

    const foreignTenantId = nanoid();
    const foreignUserId = nanoid();
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign schedule tenant',
      slug: `foreign-schedule-${foreignTenantId}`,
      defaultCurrencyCode: 'COP',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: foreignUserId,
      tenantId: foreignTenantId,
      email: `foreign-schedule-${foreignUserId}@example.test`,
      name: 'Foreign employee',
      passwordHash: 'not-used',
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      appRouter
        .createCaller(manager.fresh())
        .employeeShifts.schedule.create(scheduleInput(foreignUserId))
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SCHEDULE_EMPLOYEE_NOT_FOUND' }),
    });
    expect(() =>
      db
        .insert(scheduledShifts)
        .values({
          id: nanoid(),
          tenantId,
          userId: foreignUserId,
          siteId,
          startsAt: '2026-07-22T13:00:00.000Z',
          endsAt: '2026-07-22T21:00:00.000Z',
          timeZone: 'America/Bogota',
          createdByUserId: manager.id,
          updatedByUserId: manager.id,
          createdAt: now,
          updatedAt: now,
        })
        .run()
    ).toThrow(/SCHEDULE_TENANT_SCOPE/);
  });

  it('fails closed on malformed dates, excessive duration, and oversized ranges', async () => {
    const manager = await createEmployee('manager');
    const cashier = await createEmployee('cashier');
    await expect(
      appRouter
        .createCaller(manager.fresh())
        .employeeShifts.schedule.create(scheduleInput(cashier.id, { startDate: '2026-02-30' }))
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SCHEDULE_WINDOW_INVALID' }),
    });
    await expect(
      appRouter.createCaller(manager.fresh()).employeeShifts.schedule.create(
        scheduleInput(cashier.id, {
          endDate: '2026-07-21',
          endTime: '09:00',
        })
      )
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SCHEDULE_WINDOW_INVALID' }),
    });
    await expect(
      appRouter
        .createCaller(manager.fresh())
        .employeeShifts.schedule.list({ fromDate: '2026-07-01', toDate: '2026-08-02' })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'SCHEDULE_DATE_RANGE_INVALID' }),
    });
  });
});
