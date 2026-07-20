/** Fiscal issuer-profile launch migration. */
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';

import { auditLogs, tenantLocaleSettings, tenants, users } from '../db/schema.js';
import { getDatabase, type DatabaseInstance } from '../db/index.js';
import { createServer, type PuntovivoServer } from '../index.js';
import { readCoFiscalSettings } from '../services/fiscal/packs/co/settings.js';
import { readMxFiscalSettings } from '../services/fiscal/packs/mx/settings.js';
import { readClFiscalSettings } from '../services/fiscal/packs/cl/settings.js';
import type { Context } from '../trpc/context.js';
import { appRouter } from '../trpc/router.js';
import {
  commitLaunchFiscalProfileImportInput,
  previewLaunchFiscalProfileImportInput,
} from '../trpc/schemas/launchMigration.js';

let server: PuntovivoServer;
let db: DatabaseInstance;
let tenantId: string;
let userId: string;

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

const coValues = {
  countryCode: 'CO',
  taxIdentifier: '900123456-7',
  resolutionNumber: '18764000001234',
  numberingPrefix: 'SETT',
  rangeFrom: '1',
  rangeTo: '5000',
  environment: 'habilitación',
};

describe(' fiscal profile migration', () => {
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
  });

  beforeEach(async () => {
    await db
      .update(tenants)
      .set({ settings: { unrelated: { preserved: true } } })
      .where(eq(tenants.id, tenantId));
    await db
      .insert(tenantLocaleSettings)
      .values({ tenantId, countryCode: 'CO' })
      .onConflictDoUpdate({
        target: tenantLocaleSettings.tenantId,
        set: { countryCode: 'CO' },
      });
    await db.delete(auditLogs).where(eq(auditLogs.tenantId, tenantId));
  });

  afterAll(async () => {
    await server.close();
  });

  it('keeps the transport strict and real commits explicit', () => {
    expect(
      previewLaunchFiscalProfileImportInput.safeParse({
        dataMode: 'real',
        sourceName: 'profile.csv',
        rows: [{ ...row(2, coValues), unexpected: true }],
      }).success
    ).toBe(false);
    expect(
      commitLaunchFiscalProfileImportInput.safeParse({
        dataMode: 'demo',
        confirmedRealData: true,
        sourceName: 'profile.csv',
        previewHash: '0'.repeat(64),
        rows: [row(2, coValues)],
      }).success
    ).toBe(false);
  });

  it('validates the tenant country, duplicate rows, issuer identity, and numbering range', async () => {
    const preview = await appRouter
      .createCaller(createTestContext())
      .launchMigration.previewFiscalProfiles({
        dataMode: 'demo',
        sourceName: 'profiles.csv',
        rows: [
          row(2, coValues),
          row(3, coValues),
          row(4, {
            countryCode: 'MX',
            taxIdentifier: 'XEXX010101000',
            economicActivityCode: '601',
            issueLocation: '01000',
          }),
          row(5, {
            ...coValues,
            taxIdentifier: 'broken',
            rangeFrom: '20',
            rangeTo: '10',
          }),
        ],
      });

    expect(preview).toMatchObject({
      activationRequired: true,
      tenantCountryCode: 'CO',
      summary: { total: 4, ready: 1, duplicates: 1, invalid: 2 },
    });
    expect(preview.rows[1]?.issues).toContainEqual({
      code: 'duplicate_file_profile',
      field: 'countryCode',
    });
    expect(preview.rows[2]?.issues).toContainEqual({
      code: 'tenant_country_mismatch',
      field: 'countryCode',
    });
    expect(preview.rows[3]?.issues).toEqual(
      expect.arrayContaining([
        { code: 'invalid_tax_identifier', field: 'taxIdentifier' },
        { code: 'invalid_range', field: 'rangeFrom' },
      ])
    );
  });

  it('normalizes and validates canonical Mexico and Chile profiles', async () => {
    const caller = appRouter.createCaller(createTestContext());
    await db
      .update(tenantLocaleSettings)
      .set({ countryCode: 'MX' })
      .where(eq(tenantLocaleSettings.tenantId, tenantId));
    const mx = await caller.launchMigration.previewFiscalProfiles({
      dataMode: 'demo',
      sourceName: 'mx.xlsx',
      rows: [
        row(2, {
          countryCode: 'mx',
          taxIdentifier: 'xexx010101000',
          economicActivityCode: '601',
          issueLocation: '01000',
          environment: 'producción',
        }),
      ],
    });
    expect(mx.rows[0]).toMatchObject({
      status: 'ready',
      normalized: {
        countryCode: 'MX',
        taxIdentifier: 'XEXX010101000',
        environment: 'production',
      },
    });

    await db
      .update(tenantLocaleSettings)
      .set({ countryCode: 'CL' })
      .where(eq(tenantLocaleSettings.tenantId, tenantId));
    const cl = await caller.launchMigration.previewFiscalProfiles({
      dataMode: 'demo',
      sourceName: 'cl.csv',
      rows: [
        row(2, {
          countryCode: 'CL',
          taxIdentifier: '55.555.555-5',
          economicActivityCode: '4711',
          issueLocation: 'Av. Libertador 123',
          administrativeAreaCode: '13101',
          environment: 'certificación',
        }),
      ],
    });
    expect(cl.rows[0]).toMatchObject({
      status: 'ready',
      normalized: {
        countryCode: 'CL',
        taxIdentifier: '55555555-5',
        administrativeAreaCode: 13101,
        environment: 'certificacion',
      },
    });

    const invalidComuna = await caller.launchMigration.previewFiscalProfiles({
      dataMode: 'demo',
      sourceName: 'cl-invalid-comuna.csv',
      rows: [
        row(2, {
          countryCode: 'CL',
          taxIdentifier: '55555555-5',
          economicActivityCode: '4711',
          issueLocation: 'Av. Libertador 123',
          administrativeAreaCode: '99999',
          environment: 'certificacion',
        }),
      ],
    });
    expect(invalidComuna.rows[0]).toMatchObject({
      status: 'invalid',
      issues: [{ code: 'invalid_administrative_area', field: 'administrativeAreaCode' }],
    });
  });

  it('ignores established profiles from other tenants', async () => {
    const foreignTenantId = nanoid();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign fiscal tenant',
      slug: `foreign-fiscal-${foreignTenantId}`,
      defaultCurrencyCode: 'COP',
      settings: {
        fiscal_dian_enabled: true,
        fiscal: {
          co: {
            nit: '901999999-1',
            dianResolutionNumber: 'FOREIGN-RESOLUTION',
            rangeFrom: 1,
            rangeTo: 10,
          },
        },
      },
    });
    await db.insert(tenantLocaleSettings).values({
      tenantId: foreignTenantId,
      countryCode: 'CO',
    });

    const preview = await appRouter
      .createCaller(createTestContext())
      .launchMigration.previewFiscalProfiles({
        dataMode: 'demo',
        sourceName: 'tenant-profile.csv',
        rows: [row(2, coValues)],
      });
    expect(preview.summary).toEqual({ total: 1, ready: 1, duplicates: 0, invalid: 0 });
  });

  it('imports a disabled CO profile, preserves unrelated settings, audits safely, and retries idempotently', async () => {
    const input = {
      dataMode: 'real' as const,
      sourceName: 'merchant-fiscal-profile.csv',
      rows: [row(2, coValues)],
    };
    const caller = appRouter.createCaller(createTestContext());
    const preview = await caller.launchMigration.previewFiscalProfiles(input);
    expect(preview.summary.ready).toBe(1);
    const report = await caller.launchMigration.importFiscalProfiles({
      ...input,
      confirmedRealData: true,
      previewHash: preview.previewHash,
    });
    expect(report).toMatchObject({
      activationRequired: true,
      summary: { total: 1, imported: 1, skipped: 0, invalid: 0, failed: 0 },
      importedRows: [{ rowNumber: 2, countryCode: 'CO' }],
    });

    const tenant = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .get();
    expect(tenant?.settings).toMatchObject({ unrelated: { preserved: true } });
    expect(readCoFiscalSettings(tenant?.settings)).toEqual({
      enabled: false,
      nit: '900123456-7',
      dianResolutionNumber: '18764000001234',
      prefix: 'SETT',
      rangeFrom: 1,
      rangeTo: 5000,
      environment: 'habilitacion',
    });

    const audit = await db
      .select()
      .from(auditLogs)
      .where(
        and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.action, 'data_import.fiscal_profile'))
      )
      .get();
    expect(audit).toMatchObject({
      resourceType: 'data_import',
      after: { imported: 1, skipped: 0, invalid: 0, failed: 0 },
      metadata: {
        sourceFormat: 'csv',
        countryCode: 'CO',
        activationRequired: true,
        previewHash: preview.previewHash,
      },
    });
    const auditJson = JSON.stringify(audit);
    expect(auditJson).not.toContain('merchant-fiscal-profile.csv');
    expect(auditJson).not.toContain('900123456');
    expect(auditJson).not.toContain('18764000001234');
    expect(auditJson).not.toContain('SETT');

    const retry = await caller.launchMigration.previewFiscalProfiles(input);
    expect(retry.summary).toEqual({ total: 1, ready: 0, duplicates: 1, invalid: 0 });
  });

  it('persists disabled canonical MX and CL branches', async () => {
    const caller = appRouter.createCaller(createTestContext());
    await db
      .update(tenantLocaleSettings)
      .set({ countryCode: 'MX' })
      .where(eq(tenantLocaleSettings.tenantId, tenantId));
    const mxInput = {
      dataMode: 'real' as const,
      sourceName: 'mx.csv',
      rows: [
        row(2, {
          countryCode: 'MX',
          taxIdentifier: 'XEXX010101000',
          economicActivityCode: '601',
          issueLocation: '01000',
          environment: 'production',
        }),
      ],
    };
    const mxPreview = await caller.launchMigration.previewFiscalProfiles(mxInput);
    await caller.launchMigration.importFiscalProfiles({
      ...mxInput,
      confirmedRealData: true,
      previewHash: mxPreview.previewHash,
    });
    let settings = (
      await db
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .get()
    )?.settings;
    expect(readMxFiscalSettings(settings)).toMatchObject({
      enabled: false,
      rfc: 'XEXX010101000',
      regimenFiscalCode: '601',
      lugarExpedicion: '01000',
      environment: 'production',
    });

    await db.update(tenants).set({ settings: {} }).where(eq(tenants.id, tenantId));
    await db
      .update(tenantLocaleSettings)
      .set({ countryCode: 'CL' })
      .where(eq(tenantLocaleSettings.tenantId, tenantId));
    const clInput = {
      dataMode: 'real' as const,
      sourceName: 'cl.csv',
      rows: [
        row(2, {
          countryCode: 'CL',
          taxIdentifier: '55555555-5',
          economicActivityCode: '4711',
          issueLocation: 'Av. Libertador 123',
          administrativeAreaCode: '13101',
          environment: 'produccion',
        }),
      ],
    };
    const clPreview = await caller.launchMigration.previewFiscalProfiles(clInput);
    await caller.launchMigration.importFiscalProfiles({
      ...clInput,
      confirmedRealData: true,
      previewHash: clPreview.previewHash,
    });
    settings = (
      await db
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .get()
    )?.settings;
    expect(readClFiscalSettings(settings)).toMatchObject({
      enabled: false,
      rut: '55555555-5',
      giroCode: '4711',
      comunaCode: 13101,
      casaMatriz: 'Av. Libertador 123',
      environment: 'produccion',
    });
  });

  it('rechecks profile state at commit time and rejects managers', async () => {
    const input = {
      dataMode: 'real' as const,
      sourceName: 'profile.csv',
      rows: [row(2, coValues)],
    };
    const admin = appRouter.createCaller(createTestContext());
    const preview = await admin.launchMigration.previewFiscalProfiles(input);
    expect(preview.summary.ready).toBe(1);
    await db
      .update(tenants)
      .set({
        settings: {
          fiscal: { co: { nit: '901999999-1' } },
          fiscal_dian_enabled: false,
        },
      })
      .where(eq(tenants.id, tenantId));
    const report = await admin.launchMigration.importFiscalProfiles({
      ...input,
      confirmedRealData: true,
      previewHash: preview.previewHash,
    });
    expect(report.summary).toMatchObject({ imported: 0, invalid: 1, failed: 0 });
    expect(report.invalidRows).toEqual([
      {
        rowNumber: 2,
        issues: [{ code: 'existing_profile_conflict', field: 'taxIdentifier' }],
      },
    ]);

    await expect(
      appRouter.createCaller(createTestContext('manager')).launchMigration.previewFiscalProfiles({
        dataMode: 'demo',
        sourceName: 'profile.csv',
        rows: input.rows,
      })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rolls back the profile when immutable audit evidence cannot be written', async () => {
    const input = {
      dataMode: 'real' as const,
      sourceName: 'audit-rollback.csv',
      rows: [row(2, coValues)],
    };
    const caller = appRouter.createCaller(createTestContext());
    const preview = await caller.launchMigration.previewFiscalProfiles(input);
    expect(preview.summary.ready).toBe(1);

    await db.run(
      sql.raw(`
      CREATE TRIGGER fail_fiscal_profile_import_audit
      BEFORE INSERT ON audit_logs
      WHEN NEW.action = 'data_import.fiscal_profile'
      BEGIN
        SELECT RAISE(ABORT, 'forced fiscal profile audit failure');
      END
    `)
    );
    try {
      await expect(
        caller.launchMigration.importFiscalProfiles({
          ...input,
          confirmedRealData: true,
          previewHash: preview.previewHash,
        })
      ).rejects.toThrow(/forced fiscal profile audit failure/);
    } finally {
      await db.run(sql.raw('DROP TRIGGER IF EXISTS fail_fiscal_profile_import_audit'));
    }

    const tenant = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .get();
    expect(readCoFiscalSettings(tenant?.settings)).toMatchObject({ nit: null, enabled: false });
    expect(tenant?.settings).toMatchObject({ unrelated: { preserved: true } });
  });
});
