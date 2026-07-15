import { nanoid } from 'nanoid';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase, type DatabaseInstance } from '../db/index.js';
import {
  auditLogs,
  companies,
  employeeShifts,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { registerDevice } from '../services/devices/devicesService.js';
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
  const email = `${role}-${id}@example.test`;
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    tenantId,
    email,
    name: `Shift ${role}`,
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
    name: `employee-shifts-${role}`,
  });

  return {
    id,
    email,
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

describe('employee shifts router (ENG-106b)', () => {
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

    const seededSite = await db
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.tenantId, tenantId))
      .get();
    if (!seededSite) throw new Error('Expected seeded site');
    siteId = seededSite.id;
  });

  afterAll(async () => {
    await server.close();
  });

  it('clocks the authenticated employee in and out with atomic audit evidence', async () => {
    const employee = await createEmployee();

    expect(await appRouter.createCaller(employee.fresh()).employeeShifts.current()).toBeNull();

    const opened = await appRouter
      .createCaller(employee.fresh())
      .employeeShifts.clockIn({ siteId });
    expect(opened).toMatchObject({
      userId: employee.id,
      siteId,
      clockedOutAt: null,
    });
    expect(Number.isFinite(Date.parse(opened.clockedInAt))).toBe(true);

    const current = await appRouter.createCaller(employee.fresh()).employeeShifts.current();
    expect(current?.id).toBe(opened.id);

    const closed = await appRouter
      .createCaller(employee.fresh())
      .employeeShifts.clockOut({});
    expect(closed.id).toBe(opened.id);
    expect(closed.clockedOutAt).not.toBeNull();
    expect(Date.parse(closed.clockedOutAt!)).toBeGreaterThanOrEqual(
      Date.parse(opened.clockedInAt)
    );
    expect(await appRouter.createCaller(employee.fresh()).employeeShifts.current()).toBeNull();

    const evidence = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceId, opened.id))
      )
      .all();
    expect(evidence.map(row => row.action).sort()).toEqual([
      'employee_shift.clock_in',
      'employee_shift.clock_out',
    ]);
    expect(evidence.every(row => row.actorId === employee.id)).toBe(true);
    expect(evidence.find(row => row.action === 'employee_shift.clock_out')?.after).toMatchObject({
      userId: employee.id,
      siteId,
      clockedOutAt: closed.clockedOutAt,
    });
  });

  it('enforces one open shift and returns stable domain errors', async () => {
    const employee = await createEmployee();
    await appRouter.createCaller(employee.fresh()).employeeShifts.clockIn({ siteId });

    await expect(
      appRouter.createCaller(employee.fresh()).employeeShifts.clockIn({ siteId })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'EMPLOYEE_SHIFT_ALREADY_CLOCKED_IN' }),
    });

    await appRouter.createCaller(employee.fresh()).employeeShifts.clockOut({});
    await expect(
      appRouter.createCaller(employee.fresh()).employeeShifts.clockOut({})
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'EMPLOYEE_SHIFT_NOT_CLOCKED_IN' }),
    });
  });

  it('keeps the one-open-shift invariant race-safe at the database layer', async () => {
    const employee = await createEmployee();
    const firstId = nanoid();
    const now = new Date().toISOString();
    db.insert(employeeShifts)
      .values({
        id: firstId,
        tenantId,
        userId: employee.id,
        siteId,
        clockedInAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    expect(() =>
      db
        .insert(employeeShifts)
        .values({
          id: nanoid(),
          tenantId,
          userId: employee.id,
          siteId,
          clockedInAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run()
    ).toThrow(/UNIQUE constraint failed: employee_shifts\.tenant_id, employee_shifts\.user_id/);

    db.update(employeeShifts)
      .set({ clockedOutAt: now, updatedAt: now })
      .where(eq(employeeShifts.id, firstId))
      .run();
    expect(() =>
      db
        .insert(employeeShifts)
        .values({
          id: nanoid(),
          tenantId,
          userId: employee.id,
          siteId,
          clockedInAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run()
    ).not.toThrow();
  });

  it('keeps current state self-scoped and closes the original site after a site switch', async () => {
    const employeeA = await createEmployee();
    const employeeB = await createEmployee();
    const secondarySite = await db
      .select({ id: sites.id })
      .from(sites)
      .where(and(eq(sites.tenantId, tenantId), eq(sites.isActive, true)))
      .all();
    const alternateSiteId = secondarySite.find(site => site.id !== siteId)?.id ?? siteId;

    const opened = await appRouter
      .createCaller(employeeA.fresh())
      .employeeShifts.clockIn({ siteId });
    expect(await appRouter.createCaller(employeeB.fresh()).employeeShifts.current()).toBeNull();

    const closed = await appRouter
      .createCaller(employeeA.fresh({ siteId: alternateSiteId }))
      .employeeShifts.clockOut({});
    expect(closed.id).toBe(opened.id);
    expect(closed.siteId).toBe(siteId);
  });

  it('rejects inactive and foreign-tenant sites without creating a shift', async () => {
    const employee = await createEmployee();
    const now = new Date().toISOString();
    const inactiveSiteId = nanoid();
    const company = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.tenantId, tenantId))
      .get();
    if (!company) throw new Error('Expected seeded company');
    await db.insert(sites).values({
      id: inactiveSiteId,
      tenantId,
      companyId: company.id,
      name: `Inactive ${inactiveSiteId}`,
      isActive: false,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      appRouter.createCaller(employee.fresh()).employeeShifts.clockIn({ siteId: inactiveSiteId })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'EMPLOYEE_SHIFT_SITE_INACTIVE' }),
    });

    const foreignTenantId = nanoid();
    const foreignCompanyId = nanoid();
    const foreignSiteId = nanoid();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign shift tenant',
      slug: `foreign-shift-${foreignTenantId}`,
      defaultCurrencyCode: 'COP',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companies).values({
      id: foreignCompanyId,
      tenantId: foreignTenantId,
      name: 'Foreign shift company',
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: foreignSiteId,
      tenantId: foreignTenantId,
      companyId: foreignCompanyId,
      name: 'Foreign shift site',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      appRouter.createCaller(employee.fresh()).employeeShifts.clockIn({ siteId: foreignSiteId })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(
      await db
        .select({ id: employeeShifts.id })
        .from(employeeShifts)
        .where(eq(employeeShifts.userId, employee.id))
        .all()
    ).toHaveLength(0);
  });

  it('keeps viewer accounts read-only', async () => {
    const viewer = await createEmployee('viewer');
    await expect(appRouter.createCaller(viewer.fresh()).employeeShifts.current()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(
      appRouter.createCaller(viewer.fresh()).employeeShifts.clockIn({ siteId })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
