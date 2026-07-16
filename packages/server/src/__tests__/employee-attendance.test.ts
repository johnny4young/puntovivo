import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDatabase, type DatabaseInstance } from '../db/index.js';
import {
  auditLogs,
  companies,
  employeeShiftBreaks,
  employeeShiftCorrections,
  employeeShifts,
  sites,
  tenantLocaleSettings,
  tenants,
  users,
} from '../db/schema.js';
import { createServer, type PuntovivoServer } from '../index.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { zonedWallTimeToIso } from '../services/labor/timezone.js';
import { appRouter } from '../trpc/router.js';
import {
  freshCriticalContext,
  type FreshContextOverrides,
} from './utils/criticalCommandFixture.js';

type EmployeeRole = 'admin' | 'manager' | 'cashier' | 'viewer';

let server: PuntovivoServer;
let db: DatabaseInstance;
let tenantId: string;
let siteId: string;

async function createEmployee(role: EmployeeRole = 'cashier') {
  const id = nanoid();
  const email = `attendance-${role}-${id}@example.test`;
  const now = new Date().toISOString();
  await db.insert(users).values({
    id,
    tenantId,
    email,
    name: `Attendance ${role} ${id.slice(0, 4)}`,
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
    name: `employee-attendance-${role}`,
  });
  return {
    id,
    email,
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

function insertClosedShift(args: {
  userId: string;
  clockedInAt: string;
  clockedOutAt: string;
  breakStart?: string;
  breakEnd?: string;
  siteId?: string;
}) {
  const shiftId = nanoid();
  db.insert(employeeShifts)
    .values({
      id: shiftId,
      tenantId,
      userId: args.userId,
      siteId: args.siteId ?? siteId,
      clockedInAt: args.clockedInAt,
      clockedOutAt: args.clockedOutAt,
      createdAt: args.clockedInAt,
      updatedAt: args.clockedOutAt,
    })
    .run();
  if (args.breakStart && args.breakEnd) {
    db.insert(employeeShiftBreaks)
      .values({
        id: nanoid(),
        tenantId,
        employeeShiftId: shiftId,
        userId: args.userId,
        startedAt: args.breakStart,
        endedAt: args.breakEnd,
        startedByUserId: args.userId,
        endedByUserId: args.userId,
        createdAt: args.breakStart,
        updatedAt: args.breakEnd,
      })
      .run();
  }
  return shiftId;
}

describe('employee attendance and breaks (ENG-140b)', () => {
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

  it('starts and ends one break, blocks clock-out, and writes atomic audit evidence', async () => {
    const employee = await createEmployee();
    const caller = () => appRouter.createCaller(employee.fresh());
    const shift = await caller().employeeShifts.clockIn({ siteId });

    expect(await caller().employeeShifts.breaks.current()).toBeNull();
    const started = await caller().employeeShifts.breaks.start({});
    expect(started).toMatchObject({
      employeeShiftId: shift.id,
      userId: employee.id,
      endedAt: null,
    });
    expect((await caller().employeeShifts.breaks.current())?.id).toBe(started.id);

    await expect(caller().employeeShifts.breaks.start({})).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'EMPLOYEE_SHIFT_BREAK_ALREADY_ACTIVE' }),
    });
    await expect(caller().employeeShifts.clockOut({})).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'EMPLOYEE_SHIFT_BREAK_ACTIVE' }),
    });

    const ended = await caller().employeeShifts.breaks.end({});
    expect(ended.id).toBe(started.id);
    expect(Date.parse(ended.endedAt!)).toBeGreaterThan(Date.parse(started.startedAt));
    expect(await caller().employeeShifts.breaks.current()).toBeNull();
    await expect(caller().employeeShifts.breaks.end({})).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'EMPLOYEE_SHIFT_BREAK_NOT_ACTIVE' }),
    });
    expect((await caller().employeeShifts.clockOut({})).clockedOutAt).not.toBeNull();

    const evidence = await db
      .select({ action: auditLogs.action, resourceId: auditLogs.resourceId })
      .from(auditLogs)
      .where(
        and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceType, 'employee_shift_break'))
      )
      .all();
    expect(evidence.filter(row => row.resourceId === started.id).map(row => row.action)).toEqual([
      'employee_shift_break.start',
      'employee_shift_break.end',
    ]);
  });

  it('enforces parent identity, interval, one-open-break, and clock-out at the database layer', async () => {
    const employee = await createEmployee();
    const other = await createEmployee();
    const shiftId = nanoid();
    const clockedInAt = '2026-07-14T13:00:00.000Z';
    db.insert(employeeShifts)
      .values({
        id: shiftId,
        tenantId,
        userId: employee.id,
        siteId,
        clockedInAt,
        clockedOutAt: null,
        createdAt: clockedInAt,
        updatedAt: clockedInAt,
      })
      .run();
    const activeBreakId = nanoid();
    db.insert(employeeShiftBreaks)
      .values({
        id: activeBreakId,
        tenantId,
        employeeShiftId: shiftId,
        userId: employee.id,
        startedAt: '2026-07-14T17:00:00.000Z',
        startedByUserId: employee.id,
        createdAt: '2026-07-14T17:00:00.000Z',
        updatedAt: '2026-07-14T17:00:00.000Z',
      })
      .run();

    expect(() =>
      db
        .insert(employeeShiftBreaks)
        .values({
          id: nanoid(),
          tenantId,
          employeeShiftId: shiftId,
          userId: employee.id,
          startedAt: '2026-07-14T18:00:00.000Z',
          startedByUserId: employee.id,
          createdAt: '2026-07-14T18:00:00.000Z',
          updatedAt: '2026-07-14T18:00:00.000Z',
        })
        .run()
    ).toThrow(/UNIQUE constraint failed/);
    expect(() =>
      db
        .insert(employeeShiftBreaks)
        .values({
          id: nanoid(),
          tenantId,
          employeeShiftId: shiftId,
          userId: other.id,
          startedAt: '2026-07-14T18:00:00.000Z',
          endedAt: '2026-07-14T18:30:00.000Z',
          startedByUserId: other.id,
          endedByUserId: other.id,
          createdAt: '2026-07-14T18:00:00.000Z',
          updatedAt: '2026-07-14T18:30:00.000Z',
        })
        .run()
    ).toThrow(/EMPLOYEE_SHIFT_BREAK_(?:TENANT_SCOPE|OUTSIDE_SHIFT)/);
    expect(() =>
      db
        .update(employeeShifts)
        .set({ clockedOutAt: '2026-07-14T22:00:00.000Z' })
        .where(eq(employeeShifts.id, shiftId))
        .run()
    ).toThrow(/EMPLOYEE_SHIFT_BREAK_ACTIVE/);

    db.update(employeeShiftBreaks)
      .set({
        endedAt: '2026-07-14T17:30:00.000Z',
        endedByUserId: employee.id,
        updatedAt: '2026-07-14T17:30:00.000Z',
      })
      .where(eq(employeeShiftBreaks.id, activeBreakId))
      .run();
    expect(() =>
      db
        .update(employeeShifts)
        .set({ clockedOutAt: '2026-07-14T17:15:00.000Z' })
        .where(eq(employeeShifts.id, shiftId))
        .run()
    ).toThrow(/EMPLOYEE_SHIFT_BREAK_OUTSIDE_SHIFT/);
    db.update(employeeShifts)
      .set({ clockedOutAt: '2026-07-14T22:00:00.000Z' })
      .where(eq(employeeShifts.id, shiftId))
      .run();
    expect(() =>
      db
        .insert(employeeShiftBreaks)
        .values({
          id: nanoid(),
          tenantId,
          employeeShiftId: shiftId,
          userId: employee.id,
          startedAt: '2026-07-14T12:00:00.000Z',
          endedAt: '2026-07-14T12:30:00.000Z',
          startedByUserId: employee.id,
          endedByUserId: employee.id,
          createdAt: '2026-07-14T12:00:00.000Z',
          updatedAt: '2026-07-14T12:30:00.000Z',
        })
        .run()
    ).toThrow(/EMPLOYEE_SHIFT_BREAK_OUTSIDE_SHIFT/);
  });

  it('returns paginated weekly attendance with break and worked durations under role gates', async () => {
    const manager = await createEmployee('manager');
    const cashier = await createEmployee('cashier');
    const admin = await createEmployee('admin');
    const viewer = await createEmployee('viewer');
    insertClosedShift({
      userId: cashier.id,
      clockedInAt: '2026-07-14T13:00:00.000Z',
      clockedOutAt: '2026-07-14T22:00:00.000Z',
      breakStart: '2026-07-14T17:00:00.000Z',
      breakEnd: '2026-07-14T17:30:00.000Z',
    });
    insertClosedShift({
      userId: manager.id,
      clockedInAt: '2026-07-14T14:00:00.000Z',
      clockedOutAt: '2026-07-14T15:00:00.000Z',
    });
    insertClosedShift({
      userId: admin.id,
      clockedInAt: '2026-07-14T15:00:00.000Z',
      clockedOutAt: '2026-07-14T16:00:00.000Z',
    });
    insertClosedShift({
      userId: viewer.id,
      clockedInAt: '2026-07-14T16:00:00.000Z',
      clockedOutAt: '2026-07-14T17:00:00.000Z',
    });
    const range = {
      fromDate: '2026-07-14',
      toDate: '2026-07-15',
      page: 1,
      perPage: 10,
    };

    const managerResult = await appRouter
      .createCaller(manager.fresh())
      .employeeShifts.attendance.list(range);
    const managerUserIds = managerResult.rows.map(row => row.userId);
    expect(managerUserIds).toEqual(expect.arrayContaining([cashier.id, manager.id]));
    expect(managerUserIds).not.toContain(admin.id);
    expect(managerUserIds).not.toContain(viewer.id);
    const cashierRow = managerResult.rows.find(row => row.userId === cashier.id);
    expect(cashierRow).toMatchObject({
      elapsedSeconds: 9 * 60 * 60,
      breakSeconds: 30 * 60,
      workedSeconds: 8.5 * 60 * 60,
      status: 'closed',
      overtime: null,
    });
    expect(cashierRow?.breaks).toHaveLength(1);

    const adminResult = await appRouter
      .createCaller(admin.fresh())
      .employeeShifts.attendance.list({ ...range, userId: admin.id });
    expect(adminResult).toMatchObject({ total: 1, page: 1, perPage: 10 });
    expect(adminResult.rows[0]?.userId).toBe(admin.id);
    const adminAll = await appRouter
      .createCaller(admin.fresh())
      .employeeShifts.attendance.list(range);
    expect(adminAll.rows.map(row => row.userId)).not.toContain(viewer.id);
    await expect(
      appRouter
        .createCaller(manager.fresh())
        .employeeShifts.attendance.list({ ...range, userId: admin.id })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        errorCode: 'EMPLOYEE_SHIFT_ATTENDANCE_EMPLOYEE_NOT_FOUND',
      }),
    });
    await expect(
      appRouter.createCaller(viewer.fresh()).employeeShifts.attendance.list(range)
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('classifies overtime across every tenant site while displaying the requested site', async () => {
    const manager = await createEmployee('manager');
    const cashier = await createEmployee('cashier');
    const previousLocale = await db
      .select({ countryCode: tenantLocaleSettings.countryCode })
      .from(tenantLocaleSettings)
      .where(eq(tenantLocaleSettings.tenantId, tenantId))
      .get();
    const existingSite = await db
      .select({ companyId: sites.companyId })
      .from(sites)
      .where(eq(sites.id, siteId))
      .get();
    if (!existingSite) throw new Error('Expected seeded company site');
    const secondSiteId = nanoid();
    const now = new Date().toISOString();
    db.insert(sites)
      .values({
        id: secondSiteId,
        tenantId,
        companyId: existingSite.companyId,
        name: 'Attendance Overtime Site',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    if (previousLocale) {
      db.update(tenantLocaleSettings)
        .set({ countryCode: 'CO' })
        .where(eq(tenantLocaleSettings.tenantId, tenantId))
        .run();
    } else {
      db.insert(tenantLocaleSettings).values({ tenantId, countryCode: 'CO' }).run();
    }

    try {
      for (let day = 20; day <= 23; day += 1) {
        insertClosedShift({
          userId: cashier.id,
          clockedInAt: `2026-07-${day}T13:00:00.000Z`,
          clockedOutAt: `2026-07-${day}T21:30:00.000Z`,
        });
      }
      const visibleShiftId = insertClosedShift({
        userId: cashier.id,
        siteId: secondSiteId,
        clockedInAt: '2026-07-24T13:00:00.000Z',
        clockedOutAt: '2026-07-24T22:00:00.000Z',
      });

      const result = await appRouter.createCaller(manager.fresh()).employeeShifts.attendance.list({
        fromDate: '2026-07-20',
        toDate: '2026-07-25',
        siteId: secondSiteId,
      });

      expect(result).toMatchObject({
        total: 1,
        overtimePolicy: {
          supported: true,
          countryCode: 'CO',
          profiles: [
            {
              id: 'CO-2026-42H',
              weeklyRegularSeconds: 42 * 60 * 60,
            },
          ],
        },
      });
      expect(result.rows[0]).toMatchObject({
        id: visibleShiftId,
        overtime: {
          regularSeconds: 8 * 60 * 60,
          overtimeSeconds: 60 * 60,
          premiums: [{ code: 'co_day_overtime', multiplier: 1.25, seconds: 60 * 60 }],
        },
      });
    } finally {
      if (previousLocale) {
        db.update(tenantLocaleSettings)
          .set({ countryCode: previousLocale.countryCode })
          .where(eq(tenantLocaleSettings.tenantId, tenantId))
          .run();
      } else {
        db.delete(tenantLocaleSettings).where(eq(tenantLocaleSettings.tenantId, tenantId)).run();
      }
    }
  });

  it('appends a complete correction snapshot and reports effective evidence without rewriting raw clocks', async () => {
    const manager = await createEmployee('manager');
    const cashier = await createEmployee('cashier');
    const shiftId = insertClosedShift({
      userId: cashier.id,
      clockedInAt: '2026-07-14T13:00:00.000Z',
      clockedOutAt: '2026-07-14T22:00:00.000Z',
      breakStart: '2026-07-14T17:00:00.000Z',
      breakEnd: '2026-07-14T17:30:00.000Z',
    });
    const originalBreak = await db
      .select({ id: employeeShiftBreaks.id })
      .from(employeeShiftBreaks)
      .where(eq(employeeShiftBreaks.employeeShiftId, shiftId))
      .get();
    if (!originalBreak) throw new Error('Expected correction break fixture');
    const timeZone = (
      await appRouter.createCaller(manager.fresh()).employeeShifts.attendance.list({
        fromDate: '2026-07-14',
        toDate: '2026-07-15',
        userId: cashier.id,
      })
    ).timeZone;
    const correctedClockedInAt = zonedWallTimeToIso('2026-07-14', '08:15', timeZone);
    const correctedClockedOutAt = zonedWallTimeToIso('2026-07-14', '17:30', timeZone);
    const correctedBreakStartedAt = zonedWallTimeToIso('2026-07-14', '12:00', timeZone);
    const correctedBreakEndedAt = zonedWallTimeToIso('2026-07-14', '12:45', timeZone);

    const correction = await appRouter
      .createCaller(manager.fresh())
      .employeeShifts.attendance.corrections.create({
        employeeShiftId: shiftId,
        expectedVersion: 0,
        startDate: '2026-07-14',
        startTime: '08:15',
        endDate: '2026-07-14',
        endTime: '17:30',
        breaks: [
          {
            id: originalBreak.id,
            startDate: '2026-07-14',
            startTime: '12:00',
            endDate: '2026-07-14',
            endTime: '12:45',
          },
        ],
        reason: 'Verified against the signed opening and closing register log.',
      });
    expect(correction).toMatchObject({
      employeeShiftId: shiftId,
      version: 1,
      clockedInAt: correctedClockedInAt,
      clockedOutAt: correctedClockedOutAt,
      breaks: [
        {
          id: originalBreak.id,
          startedAt: correctedBreakStartedAt,
          endedAt: correctedBreakEndedAt,
        },
      ],
    });

    const raw = await db
      .select({
        clockedInAt: employeeShifts.clockedInAt,
        clockedOutAt: employeeShifts.clockedOutAt,
      })
      .from(employeeShifts)
      .where(eq(employeeShifts.id, shiftId))
      .get();
    expect(raw).toEqual({
      clockedInAt: '2026-07-14T13:00:00.000Z',
      clockedOutAt: '2026-07-14T22:00:00.000Z',
    });

    const report = await appRouter.createCaller(manager.fresh()).employeeShifts.attendance.list({
      fromDate: '2026-07-14',
      toDate: '2026-07-15',
      userId: cashier.id,
    });
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      id: shiftId,
      clockedInAt: correctedClockedInAt,
      clockedOutAt: correctedClockedOutAt,
      elapsedSeconds: 9.25 * 60 * 60,
      breakSeconds: 45 * 60,
      workedSeconds: 8.5 * 60 * 60,
      original: {
        clockedInAt: '2026-07-14T13:00:00.000Z',
        clockedOutAt: '2026-07-14T22:00:00.000Z',
      },
      correction: {
        version: 1,
        reason: 'Verified against the signed opening and closing register log.',
        createdByUserId: manager.id,
      },
    });
    const history = await appRouter
      .createCaller(manager.fresh())
      .employeeShifts.attendance.corrections.list({ employeeShiftId: shiftId });
    expect(history).toMatchObject([
      { version: 1, createdByUserId: manager.id, createdByName: expect.any(String) },
    ]);
    const audit = await db
      .select({ action: auditLogs.action, after: auditLogs.after })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceId, shiftId),
          eq(auditLogs.action, 'employee_shift.correct')
        )
      )
      .get();
    expect(audit?.after).toMatchObject({ version: 1, reason: expect.any(String) });
  });

  it('discovers shifts moved into a range and filters superseded correction windows', async () => {
    const manager = await createEmployee('manager');
    const cashier = await createEmployee('cashier');
    const shiftId = insertClosedShift({
      userId: cashier.id,
      clockedInAt: '2026-07-10T13:00:00.000Z',
      clockedOutAt: '2026-07-10T21:00:00.000Z',
    });
    const attendance = appRouter.createCaller(manager.fresh()).employeeShifts.attendance;

    await attendance.corrections.create({
      employeeShiftId: shiftId,
      expectedVersion: 0,
      startDate: '2026-07-14',
      startTime: '08:00',
      endDate: '2026-07-14',
      endTime: '16:00',
      breaks: [],
      reason: 'First review moved the shift into the requested payroll date.',
    });
    await expect(
      attendance.list({
        fromDate: '2026-07-14',
        toDate: '2026-07-15',
        userId: cashier.id,
      })
    ).resolves.toMatchObject({
      total: 1,
      rows: [{ id: shiftId, correction: { version: 1 } }],
    });

    await appRouter
      .createCaller(manager.fresh())
      .employeeShifts.attendance.corrections.create({
        employeeShiftId: shiftId,
        expectedVersion: 1,
        startDate: '2026-07-16',
        startTime: '08:00',
        endDate: '2026-07-16',
        endTime: '16:00',
        breaks: [],
        reason: 'Second review superseded the prior effective payroll date.',
      });
    await expect(
      appRouter.createCaller(manager.fresh()).employeeShifts.attendance.list({
        fromDate: '2026-07-14',
        toDate: '2026-07-15',
        userId: cashier.id,
      })
    ).resolves.toMatchObject({ total: 0, rows: [] });
    await expect(
      appRouter.createCaller(manager.fresh()).employeeShifts.attendance.list({
        fromDate: '2026-07-16',
        toDate: '2026-07-17',
        userId: cashier.id,
      })
    ).resolves.toMatchObject({
      total: 1,
      rows: [{ id: shiftId, correction: { version: 2 } }],
    });
  });

  it('rejects stale, active, hidden, and malformed correction writes while keeping snapshots immutable', async () => {
    const manager = await createEmployee('manager');
    const cashier = await createEmployee('cashier');
    const admin = await createEmployee('admin');
    const shiftId = insertClosedShift({
      userId: cashier.id,
      clockedInAt: '2026-07-16T13:00:00.000Z',
      clockedOutAt: '2026-07-16T21:00:00.000Z',
    });
    const input = {
      employeeShiftId: shiftId,
      expectedVersion: 0,
      startDate: '2026-07-16',
      startTime: '08:00',
      endDate: '2026-07-16',
      endTime: '16:00',
      breaks: [],
      reason: 'Approved after reviewing the supervisor attendance note.',
    };
    const created = await appRouter
      .createCaller(manager.fresh())
      .employeeShifts.attendance.corrections.create(input);
    await expect(
      appRouter.createCaller(manager.fresh()).employeeShifts.attendance.corrections.create(input)
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'STALE_VERSION' }),
    });

    const activeShiftId = nanoid();
    const now = new Date().toISOString();
    db.insert(employeeShifts)
      .values({
        id: activeShiftId,
        tenantId,
        userId: manager.id,
        siteId,
        clockedInAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    await expect(
      appRouter.createCaller(manager.fresh()).employeeShifts.attendance.corrections.create({
        ...input,
        employeeShiftId: activeShiftId,
      })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'EMPLOYEE_SHIFT_CORRECTION_ACTIVE' }),
    });

    const adminShiftId = insertClosedShift({
      userId: admin.id,
      clockedInAt: '2026-07-17T13:00:00.000Z',
      clockedOutAt: '2026-07-17T21:00:00.000Z',
    });
    await expect(
      appRouter
        .createCaller(manager.fresh())
        .employeeShifts.attendance.corrections.list({ employeeShiftId: adminShiftId })
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'EMPLOYEE_SHIFT_CORRECTION_NOT_FOUND' }),
    });

    expect(() =>
      db
        .update(employeeShiftCorrections)
        .set({ reason: 'Attempt to rewrite immutable correction evidence.' })
        .where(eq(employeeShiftCorrections.id, created.id))
        .run()
    ).toThrow(/EMPLOYEE_SHIFT_CORRECTION_IMMUTABLE/);
    expect(() =>
      db
        .insert(employeeShiftCorrections)
        .values({
          id: nanoid(),
          tenantId,
          employeeShiftId: shiftId,
          version: 2,
          clockedInAt: '2026-07-16T13:00:00.000Z',
          clockedOutAt: '2026-07-16T21:00:00.000Z',
          breaks: [
            {
              id: nanoid(),
              startedAt: '2026-07-16T20:30:00.000Z',
              endedAt: '2026-07-16T21:30:00.000Z',
            },
          ],
          reason: 'Malformed direct database correction for trigger coverage.',
          createdByUserId: manager.id,
          createdAt: now,
        })
        .run()
    ).toThrow(/EMPLOYEE_SHIFT_CORRECTION_BREAKS_INVALID/);
    expect(() =>
      db
        .insert(employeeShiftCorrections)
        .values({
          id: nanoid(),
          tenantId,
          employeeShiftId: shiftId,
          version: 2,
          clockedInAt: '2026-07-16T13:00:00.000Z',
          clockedOutAt: '2026-07-16T21:00:00.000Z',
          breaks: [
            {
              // Deliberately omit the required break id at the SQL boundary.
              startedAt: '2026-07-16T16:00:00.000Z',
              endedAt: '2026-07-16T16:30:00.000Z',
            } as never,
          ],
          reason: 'Malformed direct database correction missing a break identity.',
          createdByUserId: manager.id,
          createdAt: now,
        })
        .run()
    ).toThrow(/EMPLOYEE_SHIFT_CORRECTION_BREAKS_INVALID/);
  });

  it('isolates rows and optional filters from other tenants', async () => {
    const manager = await createEmployee('manager');
    const otherTenantId = nanoid();
    const otherCompanyId = nanoid();
    const otherSiteId = nanoid();
    const otherEmployeeId = nanoid();
    const now = new Date().toISOString();
    db.insert(tenants)
      .values({
        id: otherTenantId,
        name: 'Attendance Other Tenant',
        slug: `attendance-other-${nanoid(6).toLowerCase()}`,
        defaultCurrencyCode: 'COP',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(companies)
      .values({
        id: otherCompanyId,
        tenantId: otherTenantId,
        name: 'Attendance Other Company',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(users)
      .values({
        id: otherEmployeeId,
        tenantId: otherTenantId,
        email: `attendance-other-${nanoid()}@example.test`,
        name: 'Other Tenant Employee',
        passwordHash: 'not-used-by-router-tests',
        role: 'cashier',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(sites)
      .values({
        id: otherSiteId,
        tenantId: otherTenantId,
        companyId: otherCompanyId,
        name: 'Other Tenant Site',
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    db.insert(employeeShifts)
      .values({
        id: nanoid(),
        tenantId: otherTenantId,
        userId: otherEmployeeId,
        siteId: otherSiteId,
        clockedInAt: '2026-07-14T13:00:00.000Z',
        clockedOutAt: '2026-07-14T22:00:00.000Z',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const mismatchedSiteShiftId = nanoid();
    db.insert(employeeShifts)
      .values({
        id: mismatchedSiteShiftId,
        tenantId,
        userId: manager.id,
        siteId: otherSiteId,
        clockedInAt: '2026-07-14T13:00:00.000Z',
        clockedOutAt: '2026-07-14T22:00:00.000Z',
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const caller = appRouter.createCaller(manager.fresh()).employeeShifts.attendance;
    const range = { fromDate: '2026-07-14', toDate: '2026-07-15' };
    expect((await caller.list(range)).rows.map(row => row.userId)).not.toContain(otherEmployeeId);
    await expect(caller.list({ ...range, userId: manager.id })).resolves.toMatchObject({
      total: 0,
      rows: [],
    });
    await expect(caller.list({ ...range, userId: otherEmployeeId })).rejects.toMatchObject({
      cause: expect.objectContaining({
        errorCode: 'EMPLOYEE_SHIFT_ATTENDANCE_EMPLOYEE_NOT_FOUND',
      }),
    });
    await expect(caller.list({ ...range, siteId: otherSiteId })).rejects.toMatchObject({
      cause: expect.objectContaining({ errorCode: 'EMPLOYEE_SHIFT_ATTENDANCE_SITE_NOT_FOUND' }),
    });
  });
});
