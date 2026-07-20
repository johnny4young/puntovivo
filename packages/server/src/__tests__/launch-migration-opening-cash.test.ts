/** Opening-cash register-template import. */
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  auditLogs,
  cashSessions,
  companies,
  denominationTemplates,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { getDatabase, type DatabaseInstance } from '../db/index.js';
import { createServer, type PuntovivoServer } from '../index.js';
import type { Context } from '../trpc/context.js';
import { appRouter } from '../trpc/router.js';
import {
  commitLaunchOpeningCashImportInput,
  previewLaunchOpeningCashImportInput,
} from '../trpc/schemas/launchMigration.js';

let server: PuntovivoServer;
let db: DatabaseInstance;
let tenantId: string;
let userId: string;
let siteId: string;
const siteName = 'Opening Cash Migración ÁGUILA';

function createTestContext(role: NonNullable<Context['user']>['role'] = 'admin'): Context {
  return {
    req: { server: server.app, headers: {} } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: { id: userId, email: 'admin@localhost', role, tenantId },
    tenantId,
    siteId: null,
  };
}

function row(rowNumber: number, values: Record<string, string>) {
  return { rowNumber, values };
}

describe(' opening cash migration', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    db = getDatabase();
    const admin = await db
      .select({ id: users.id, tenantId: users.tenantId })
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    if (!admin) throw new Error('Expected seeded admin');
    tenantId = admin.tenantId;
    userId = admin.id;
    const company = await db
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.tenantId, tenantId))
      .get();
    if (!company) throw new Error('Expected seeded company');

    siteId = nanoid();
    await db.insert(sites).values({
      id: siteId,
      tenantId,
      companyId: company.id,
      name: siteName,
      isActive: true,
    });
    await db.insert(denominationTemplates).values([
      {
        id: nanoid(),
        tenantId,
        siteId,
        registerName: 'Main register',
        label: 'Main register',
        openingFloat: 0,
        denominations: [],
        sortOrder: 0,
        isActive: true,
      },
      {
        id: nanoid(),
        tenantId,
        siteId,
        registerName: 'CAJA ÑANDÚ',
        label: 'CAJA ÑANDÚ',
        openingFloat: 30,
        denominations: [{ value: 10, count: 3 }],
        sortOrder: 2,
        isActive: true,
      },
      {
        id: nanoid(),
        tenantId,
        siteId,
        registerName: 'Established register',
        label: 'Established register',
        openingFloat: 50,
        denominations: [{ value: 50, count: 1 }],
        sortOrder: 1,
        isActive: true,
      },
    ]);
    await db.insert(cashSessions).values({
      id: nanoid(),
      tenantId,
      siteId,
      cashierId: userId,
      registerName: 'Active register',
      openingFloat: 20,
      openingCountDenominations: [{ value: 20, count: 1 }],
      expectedBalance: 20,
      status: 'open',
    });

    const foreignTenantId = nanoid();
    const foreignCompanyId = nanoid();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign opening cash tenant',
      slug: `foreign-opening-cash-${foreignTenantId}`,
      defaultCurrencyCode: 'COP',
      isActive: true,
    });
    await db.insert(companies).values({
      id: foreignCompanyId,
      tenantId: foreignTenantId,
      name: 'Foreign opening cash company',
    });
    await db.insert(sites).values({
      id: nanoid(),
      tenantId: foreignTenantId,
      companyId: foreignCompanyId,
      name: 'Foreign cash site',
      isActive: true,
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('keeps transport contracts strict and real commits explicit', () => {
    expect(
      previewLaunchOpeningCashImportInput.safeParse({
        dataMode: 'real',
        sourceName: 'cash.csv',
        rows: [
          {
            ...row(2, {
              siteName,
              registerName: 'Front',
              openingFloat: '100',
              denominations: '50:2',
            }),
            unexpected: true,
          },
        ],
      }).success
    ).toBe(false);
    expect(
      commitLaunchOpeningCashImportInput.safeParse({
        dataMode: 'demo',
        confirmedRealData: true,
        sourceName: 'cash.csv',
        previewHash: '0'.repeat(64),
        rows: [
          row(2, {
            siteName,
            registerName: 'Front',
            openingFloat: '100',
            denominations: '50:2',
          }),
        ],
      }).success
    ).toBe(false);
  });

  it('validates denominations, resolves tenant sites, and protects active or established registers', async () => {
    const preview = await appRouter
      .createCaller(createTestContext())
      .launchMigration.previewOpeningCash({
        dataMode: 'demo',
        decimalFormat: 'comma',
        sourceName: 'bases-caja.csv',
        rows: [
          row(2, {
            siteName: ` ${siteName.toLocaleLowerCase()} `,
            registerName: 'Front register',
            openingFloat: '1.200,50',
            denominations: '500,00:2;100,00:2;0,50:1',
          }),
          row(3, {
            siteName,
            registerName: 'front REGISTER',
            openingFloat: '100',
            denominations: '50:2',
          }),
          row(4, {
            siteName,
            registerName: 'Mismatch register',
            openingFloat: '100',
            denominations: '20:2',
          }),
          row(5, {
            siteName: 'Foreign cash site',
            registerName: 'Foreign register',
            openingFloat: '100',
            denominations: '50:2',
          }),
          row(6, {
            siteName,
            registerName: 'Active register',
            openingFloat: '20',
            denominations: '20:1',
          }),
          row(7, {
            siteName,
            registerName: 'Established register',
            openingFloat: '100',
            denominations: '50:2',
          }),
          row(8, {
            siteName,
            registerName: 'Main register',
            openingFloat: '100',
            denominations: '50:2',
          }),
          row(9, {
            siteName,
            registerName: 'Broken denominations',
            openingFloat: '100',
            denominations: 'fifty by two',
          }),
          row(10, {
            siteName: siteName.toLocaleLowerCase(),
            registerName: 'caja ñandú',
            openingFloat: '30',
            denominations: '10:3',
          }),
        ],
      });

    expect(preview.summary).toEqual({ total: 9, ready: 2, duplicates: 3, invalid: 4 });
    expect(preview.rows[0]).toMatchObject({
      status: 'ready',
      normalized: {
        siteId,
        siteName,
        openingFloat: 1200.5,
        denominations: [
          { value: 500, count: 2 },
          { value: 100, count: 2 },
          { value: 0.5, count: 1 },
        ],
      },
    });
    expect(preview.rows[1]?.issues).toContainEqual({
      code: 'duplicate_file_register',
      field: 'registerName',
    });
    expect(preview.rows[2]?.issues).toContainEqual({
      code: 'denomination_total_mismatch',
      field: 'denominations',
    });
    expect(preview.rows[3]?.issues).toContainEqual({
      code: 'site_not_found',
      field: 'siteName',
    });
    expect(preview.rows[4]?.issues).toContainEqual({
      code: 'active_register',
      field: 'registerName',
    });
    expect(preview.rows[5]?.issues).toContainEqual({
      code: 'duplicate_existing_register',
      field: 'registerName',
    });
    expect(preview.rows[6]).toMatchObject({
      status: 'ready',
      normalized: { operation: 'replace_default' },
    });
    expect(preview.rows[7]?.issues).toContainEqual({
      code: 'invalid_denominations',
      field: 'denominations',
    });
    expect(preview.rows[8]?.issues).toContainEqual({
      code: 'duplicate_existing_register',
      field: 'registerName',
    });
  });

  it('imports reconciled templates, replaces only a pristine default, audits counts, and retries safely', async () => {
    const input = {
      dataMode: 'real' as const,
      decimalFormat: 'dot' as const,
      sourceName: 'merchant-opening-cash.csv',
      rows: [
        row(2, {
          siteName,
          registerName: 'Launch front',
          openingFloat: '120',
          denominations: '50:2;20:1',
        }),
        row(3, {
          siteName,
          registerName: 'Main register',
          openingFloat: '100',
          denominations: '50:2',
        }),
      ],
    };
    const caller = appRouter.createCaller(createTestContext());
    const preview = await caller.launchMigration.previewOpeningCash(input);
    expect(preview.summary.ready).toBe(2);
    const report = await caller.launchMigration.importOpeningCash({
      ...input,
      confirmedRealData: true,
      previewHash: preview.previewHash,
    });

    expect(report.summary).toEqual({
      total: 2,
      imported: 2,
      skipped: 0,
      invalid: 0,
      failed: 0,
      warnings: 0,
    });
    const templates = await db
      .select()
      .from(denominationTemplates)
      .where(
        and(eq(denominationTemplates.tenantId, tenantId), eq(denominationTemplates.siteId, siteId))
      )
      .all();
    expect(templates).toContainEqual(
      expect.objectContaining({
        registerName: 'Launch front',
        openingFloat: 120,
        denominations: [
          { value: 50, count: 2 },
          { value: 20, count: 1 },
        ],
      })
    );
    expect(templates).toContainEqual(
      expect.objectContaining({
        registerName: 'Main register',
        openingFloat: 100,
        denominations: [{ value: 50, count: 2 }],
      })
    );

    const audit = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, 'data_import.opening_cash'))
      )
      .get();
    expect(audit).toMatchObject({
      resourceType: 'data_import',
      after: { imported: 2, skipped: 0, invalid: 0, failed: 0 },
      metadata: {
        dataMode: 'real',
        sourceFormat: 'csv',
        previewHash: preview.previewHash,
        totalRows: 2,
      },
    });
    expect(JSON.stringify(audit)).not.toContain('merchant-opening-cash.csv');
    expect(JSON.stringify(audit)).not.toContain('Launch front');
    expect(JSON.stringify(audit)).not.toContain('openingFloat');

    const retry = await caller.launchMigration.previewOpeningCash(input);
    expect(retry.summary).toEqual({ total: 2, ready: 0, duplicates: 2, invalid: 0 });
  });

  it('rechecks active-register state at commit time and rejects managers', async () => {
    const input = {
      dataMode: 'real' as const,
      sourceName: 'late-register.csv',
      rows: [
        row(2, {
          siteName,
          registerName: 'Late active register',
          openingFloat: '40',
          denominations: '20:2',
        }),
      ],
    };
    const admin = appRouter.createCaller(createTestContext());
    const preview = await admin.launchMigration.previewOpeningCash(input);
    expect(preview.summary.ready).toBe(1);
    await db.insert(cashSessions).values({
      id: nanoid(),
      tenantId,
      siteId,
      cashierId: userId,
      registerName: 'late ACTIVE register',
      openingFloat: 40,
      openingCountDenominations: [{ value: 20, count: 2 }],
      expectedBalance: 40,
      status: 'open',
    });
    const report = await admin.launchMigration.importOpeningCash({
      ...input,
      confirmedRealData: true,
      previewHash: preview.previewHash,
    });
    expect(report.summary).toMatchObject({ imported: 0, invalid: 1, failed: 0 });
    expect(report.invalidRows).toEqual([
      {
        rowNumber: 2,
        issues: [{ code: 'active_register', field: 'registerName' }],
      },
    ]);
    expect(report.failedRows).toEqual([]);

    await expect(
      appRouter.createCaller(createTestContext('manager')).launchMigration.previewOpeningCash({
        dataMode: 'demo',
        sourceName: 'cash.csv',
        rows: input.rows,
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rolls back imported templates when immutable audit evidence cannot be written', async () => {
    const input = {
      dataMode: 'real' as const,
      sourceName: 'audit-rollback.csv',
      rows: [
        row(2, {
          siteName,
          registerName: 'Audit rollback register',
          openingFloat: '60',
          denominations: '20:3',
        }),
      ],
    };
    const caller = appRouter.createCaller(createTestContext());
    const preview = await caller.launchMigration.previewOpeningCash(input);
    expect(preview.summary.ready).toBe(1);

    await db.run(
      sql.raw(`
      CREATE TRIGGER fail_opening_cash_import_audit
      BEFORE INSERT ON audit_logs
      WHEN NEW.action = 'data_import.opening_cash'
      BEGIN
        SELECT RAISE(ABORT, 'forced opening cash audit failure');
      END
    `)
    );
    try {
      await expect(
        caller.launchMigration.importOpeningCash({
          ...input,
          confirmedRealData: true,
          previewHash: preview.previewHash,
        })
      ).rejects.toThrow(/forced opening cash audit failure/);
    } finally {
      await db.run(sql.raw('DROP TRIGGER IF EXISTS fail_opening_cash_import_audit'));
    }

    expect(
      await db
        .select({ id: denominationTemplates.id })
        .from(denominationTemplates)
        .where(
          and(
            eq(denominationTemplates.tenantId, tenantId),
            eq(denominationTemplates.registerName, 'Audit rollback register')
          )
        )
        .get()
    ).toBeUndefined();
  });
});
