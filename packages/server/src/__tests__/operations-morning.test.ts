import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  appSettings,
  cashSessions,
  companies,
  denominationTemplates,
  fiscalDocuments,
  fiscalNumberingResolutions,
  sales,
  sites,
  tenantLocaleSettings,
  tenants,
  users,
} from '../db/schema.js';
import {
  BACKUP_STATUS_SETTING_KEY,
  readBackupStatus,
} from '../services/operations/backup-status.js';
import { computeMorningRecap } from '../services/operations/morning.js';
import { signDayClose } from '../services/reports/day-close-signoff.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

// 07:00 in Bogotá; yesterday's business day runs 2026-07-14T05:00Z to 2026-07-15T05:00Z.
const NOW = new Date('2026-07-15T12:00:00.000Z');
const YESTERDAY = '2026-07-14';

let server: PuntovivoServer;

function ctx(tenantId: string, userId: string, role: 'manager' | 'cashier'): Context {
  return {
    req: { server: server.app, headers: {}, user: { userId, role, tenantId } },
    res: {},
    db: getDatabase(),
    user: { id: userId, email: `${userId}@example.test`, role, tenantId },
    tenantId,
    siteId: null,
  } as unknown as Context;
}

function seedTenant(suffix: string) {
  const db = getDatabase();
  const ids = {
    tenantId: `morning-${suffix}`,
    companyId: `morning-company-${suffix}`,
    siteId: `morning-site-${suffix}`,
    managerId: `morning-manager-${suffix}`,
    cashierId: `morning-cashier-${suffix}`,
  };
  db.insert(tenants)
    .values({ id: ids.tenantId, name: suffix, slug: `morning-${suffix}`, settings: {} })
    .run();
  db.insert(tenantLocaleSettings).values({ tenantId: ids.tenantId, countryCode: 'CO' }).run();
  db.insert(companies).values({ id: ids.companyId, tenantId: ids.tenantId, name: suffix }).run();
  db.insert(sites)
    .values({
      id: ids.siteId,
      tenantId: ids.tenantId,
      companyId: ids.companyId,
      name: 'Sede Norte',
    })
    .run();
  db.insert(users)
    .values(
      (
        [
          [ids.managerId, 'manager'],
          [ids.cashierId, 'cashier'],
        ] as const
      ).map(([id, role]) => ({
        id,
        tenantId: ids.tenantId,
        email: `${id}@example.test`,
        name: id,
        passwordHash: 'x',
        role,
      }))
    )
    .run();
  return ids;
}

type Tenant = ReturnType<typeof seedTenant>;

function closedSession(t: Tenant, id: string, registerName: string, openingFloat: number) {
  return {
    id,
    tenantId: t.tenantId,
    siteId: t.siteId,
    cashierId: t.cashierId,
    registerName,
    openingFloat,
    openingCountDenominations: [],
    expectedBalance: openingFloat,
    actualCount: openingFloat,
    overShort: 0,
    status: 'closed' as const,
    openedAt: '2026-07-14T13:00:00.000Z',
    closedAt: '2026-07-15T02:00:00.000Z',
  };
}

function sale(t: Tenant, id: string, total: number, at: string) {
  return {
    id,
    tenantId: t.tenantId,
    saleNumber: id,
    subtotal: total,
    taxAmount: 0,
    discountAmount: 0,
    total,
    paymentMethod: 'cash' as const,
    paymentStatus: 'paid' as const,
    status: 'completed' as const,
    cashSessionId: `${t.tenantId}-s1`,
    createdBy: t.cashierId,
    createdAt: at,
    checkoutCompletedAt: at,
  };
}

function fiscalDocument(t: Tenant, n: number, status: 'pending' | 'sent' | 'accepted') {
  return {
    id: `${t.tenantId}-doc-${n}`,
    tenantId: t.tenantId,
    source: 'sale' as const,
    sourceId: `${t.tenantId}-sale-${n}`,
    kind: 'FEV' as const,
    resolutionId: `${t.tenantId}-res`,
    consecutive: n,
    documentNumber: `M-${n}`,
    cufe: `${t.tenantId}-${n}`.padEnd(96, '0'),
    status,
    buyerTaxId: '222222222222',
    buyerCountryCode: 'CO',
    buyerTaxIdTypeCode: '13',
    buyerName: 'Consumidor final',
    totalAmount: 100,
    currencyCode: 'COP',
    localeCode: 'es-CO',
    providerId: 'mock',
    emittedByUserId: t.cashierId,
    emittedAt: '2026-07-14T18:00:00.000Z',
  };
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  await server?.close();
});

describe('operations.morningRecap', () => {
  let t: Tenant;

  beforeAll(async () => {
    const db = getDatabase();
    t = seedTenant('a');

    db.insert(cashSessions)
      .values([
        closedSession(t, `${t.tenantId}-s1`, 'Caja 1', 150000),
        closedSession(t, `${t.tenantId}-s2`, 'Caja 2', 100000),
        closedSession(t, `${t.tenantId}-s3`, 'Caja 3', 100000),
        // Caja 3 already opened again, so it is not on the list.
        {
          ...closedSession(t, `${t.tenantId}-s4`, 'Caja 3', 100000),
          status: 'open' as const,
          openedAt: '2026-07-15T11:30:00.000Z',
          closedAt: null,
          actualCount: null,
          overShort: null,
        },
      ])
      .run();
    db.insert(denominationTemplates)
      .values({
        id: `${t.tenantId}-tpl`,
        tenantId: t.tenantId,
        siteId: t.siteId,
        registerName: 'Caja 2',
        label: 'Caja 2',
        openingFloat: 200000,
        denominations: [],
      })
      .run();
    db.insert(sales)
      .values([
        sale(t, 'm-y1', 100000, '2026-07-14T15:00:00.000Z'),
        sale(t, 'm-y2', 50000, '2026-07-14T20:00:00.000Z'),
        sale(t, 'm-w1', 120000, '2026-07-07T15:00:00.000Z'),
        {
          ...sale(t, 'm-carried', 42100, '2026-07-14T21:00:00.000Z'),
          status: 'draft' as const,
          paymentStatus: 'pending' as const,
          checkoutCompletedAt: null,
          suspendedAt: '2026-07-14T21:00:00.000Z',
          suspendedLabel: 'Domicilio Calle 80',
          carriedOverAt: '2026-07-15T02:30:00.000Z',
        },
      ])
      .run();
    db.insert(fiscalNumberingResolutions)
      .values({
        id: `${t.tenantId}-res`,
        tenantId: t.tenantId,
        siteId: t.siteId,
        kind: 'FEV',
        resolutionNumber: 'M-RES',
        prefix: 'M',
        fromNumber: 1,
        toNumber: 100,
        currentNumber: 3,
        technicalKey: 'test-key',
        validFrom: '2026-01-01T00:00:00.000Z',
        validUntil: '2026-12-31T23:59:59.999Z',
      })
      .run();
    db.insert(fiscalDocuments)
      .values([
        fiscalDocument(t, 1, 'accepted'),
        fiscalDocument(t, 2, 'pending'),
        fiscalDocument(t, 3, 'pending'),
        fiscalDocument(t, 4, 'sent'),
      ])
      .run();

    await signDayClose(db, {
      tenantId: t.tenantId,
      actorId: t.managerId,
      date: YESTERDAY,
      operationId: 'morning-seal',
      now: new Date('2026-07-15T02:41:00.000Z'),
    });
    // Overnight the DIAN accepts one pending document and rejects the other.
    db.update(fiscalDocuments)
      .set({ status: 'accepted' })
      .where(eq(fiscalDocuments.id, `${t.tenantId}-doc-2`))
      .run();
    db.update(fiscalDocuments)
      .set({ status: 'rejected' })
      .where(eq(fiscalDocuments.id, `${t.tenantId}-doc-3`))
      .run();
    db.insert(appSettings)
      .values({
        key: BACKUP_STATUS_SETTING_KEY,
        value: {
          [t.tenantId]: {
            frequency: 'daily',
            lastAttemptAt: '2026-07-15T03:00:00.000Z',
            lastSuccessAt: '2026-07-15T03:01:00.000Z',
            lastError: null,
          },
        },
      })
      .run();
  });

  it('recaps yesterday from the seal, what the DIAN decided since and the backup', async () => {
    const recap = await computeMorningRecap(getDatabase(), t.tenantId, NOW);
    expect(recap.date).toBe(YESTERDAY);
    expect(recap.yesterday.total).toBe(150000);
    expect(recap.yesterday.comparisonTotal).toBe(120000);
    expect(recap.yesterday.dayStartIso).toBe('2026-07-14T05:00:00.000Z');
    expect(recap.yesterday.hourly[10]).toEqual({ hour: 10, revenue: 100000 });
    expect(recap.seal).toEqual({
      signedAt: '2026-07-15T02:41:00.000Z',
      netRevenue: 150000,
      salesCount: 2,
    });
    expect(recap.fiscal).toEqual({ accepted: 1, rejected: 1, inProgress: 1 });
    expect(recap.backup).toEqual({ state: 'ok', at: '2026-07-15T03:01:00.000Z' });
  });

  it('lists what to do before opening', async () => {
    const recap = await computeMorningRecap(getDatabase(), t.tenantId, NOW);
    expect(recap.registersToOpen).toEqual([
      { siteId: t.siteId, siteName: 'Sede Norte', registerName: 'Caja 1', openingFloat: 150000 },
      { siteId: t.siteId, siteName: 'Sede Norte', registerName: 'Caja 2', openingFloat: 200000 },
    ]);
    expect(recap.carriedSales).toEqual([
      { id: 'm-carried', saleNumber: 'm-carried', label: 'Domicilio Calle 80', total: 42100 },
    ]);
  });

  it('leaves the seal and the DIAN out while yesterday is unsigned', async () => {
    const recap = await computeMorningRecap(
      getDatabase(),
      t.tenantId,
      new Date('2026-07-16T12:00:00.000Z')
    );
    expect(recap.date).toBe('2026-07-15');
    expect(recap.seal).toBeNull();
    expect(recap.fiscal).toBeNull();
    // A draft carried at the earlier close is not this close's decision.
    expect(recap.carriedSales).toEqual([]);
  });

  it('is for managers of the calling tenant only', async () => {
    const other = seedTenant('b');
    await expect(
      appRouter.createCaller(ctx(t.tenantId, t.cashierId, 'cashier')).operations.morningRecap()
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const foreign = await appRouter
      .createCaller(ctx(other.tenantId, other.managerId, 'manager'))
      .operations.morningRecap();
    expect(foreign.registersToOpen).toEqual([]);
    expect(foreign.carriedSales).toEqual([]);
    expect(foreign.backup).toBeNull();
    expect(foreign.yesterday.total).toBe(0);
  });
});

describe('readBackupStatus', () => {
  const tenantId = 'backup-tenant';
  const write = (record: Record<string, unknown> | null) => {
    const db = getDatabase();
    db.delete(appSettings).where(eq(appSettings.key, BACKUP_STATUS_SETTING_KEY)).run();
    if (record) {
      db.insert(appSettings)
        .values({ key: BACKUP_STATUS_SETTING_KEY, value: { [tenantId]: record } })
        .run();
    }
  };

  it('reports a failed attempt, a late success and nothing when off or unknown', () => {
    const db = getDatabase();
    write(null);
    expect(readBackupStatus(db, tenantId, NOW)).toBeNull();

    write({
      frequency: 'daily',
      lastAttemptAt: '2026-07-15T03:00:00.000Z',
      lastSuccessAt: '2026-07-13T03:00:00.000Z',
      lastError: 'snapshot_failed',
    });
    expect(readBackupStatus(db, tenantId, NOW)).toEqual({
      state: 'failed',
      at: '2026-07-15T03:00:00.000Z',
    });

    write({ frequency: 'daily', lastSuccessAt: '2026-07-12T12:00:00.000Z', lastError: null });
    expect(readBackupStatus(db, tenantId, NOW)?.state).toBe('late');

    write({ frequency: 'weekly', lastSuccessAt: '2026-07-05T12:00:00.000Z', lastError: null });
    expect(readBackupStatus(db, tenantId, NOW)?.state).toBe('ok');

    write({ frequency: 'off', lastSuccessAt: '2026-07-15T03:00:00.000Z', lastError: null });
    expect(readBackupStatus(db, tenantId, NOW)).toBeNull();
    expect(readBackupStatus(db, 'another-tenant', NOW)).toBeNull();
  });
});
