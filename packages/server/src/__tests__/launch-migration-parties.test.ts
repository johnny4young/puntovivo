/** Customer/provider launch-import contracts and persistence. */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditLogs, customers, providers, tenants, users } from '../db/schema.js';
import { getDatabase, type DatabaseInstance } from '../db/index.js';
import { createServer, type PuntovivoServer } from '../index.js';
import type { Context } from '../trpc/context.js';
import { appRouter } from '../trpc/router.js';
import { getSafeImportErrorMetadata } from '../application/launch-migration/safety.js';
import {
  previewLaunchCustomerImportInput,
  previewLaunchProviderImportInput,
} from '../trpc/schemas/launchMigration.js';

let server: PuntovivoServer;
let db: DatabaseInstance;
let tenantId: string;
let userId: string;
let cityCode: string;
let cityId: string;

function createTestContext(
  role: Context['user'] extends infer U ? NonNullable<U>['role'] : never = 'admin'
): Context {
  return {
    req: { server: server.app, headers: {} } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: { id: userId, email: 'admin@localhost', role, tenantId },
    tenantId,
    siteId: null,
  };
}

function row<T extends Record<string, string>>(rowNumber: number, values: Partial<T>) {
  return { rowNumber, values };
}

describe(' customer and provider launch migration', () => {
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

    const caller = appRouter.createCaller(createTestContext());
    const country = await caller.countries.create({
      code: `CO-${nanoid(5)}`,
      name: `Colombia ${nanoid(5)}`,
      isActive: true,
    });
    const department = await caller.departments.create({
      countryId: country.id,
      code: `ANT-${nanoid(5)}`,
      name: `Antioquia ${nanoid(5)}`,
      isActive: true,
    });
    cityCode = `MED-${nanoid(5)}`;
    const city = await caller.cities.create({
      departmentId: department.id,
      code: cityCode,
      name: `Medellin ${nanoid(5)}`,
      isActive: true,
    });
    cityId = city.id;

    await caller.customers.create({
      name: 'Existing launch customer',
      taxId: ' 900-EXISTING-123B ',
      email: 'existing-customer-123b@example.com',
    });
    await caller.providers.create({
      name: 'Existing Launch Provider 123B',
      taxId: '900-PROVIDER-123B',
      email: 'existing-provider-123b@example.com',
      isActive: true,
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('rejects unknown fields and duplicate row numbers for both contracts', () => {
    expect(
      previewLaunchCustomerImportInput.safeParse({
        dataMode: 'real',
        sourceName: 'customers.csv',
        rows: [{ ...row(2, { name: 'One' }), unexpected: true }, row(2, { name: 'Two' })],
      }).success
    ).toBe(false);
    expect(
      previewLaunchProviderImportInput.safeParse({
        dataMode: 'real',
        sourceName: 'providers.csv',
        rows: [row(2, { name: 'One' })],
        unexpected: true,
      }).success
    ).toBe(false);
  });

  it('keeps row values out of unexpected import failure logs', () => {
    const cause = Object.assign(new Error('customer@example.com'), { code: 'SQLITE_IOERR' });
    const error = new Error('Failed query params: Secret Customer, customer@example.com', {
      cause,
    });

    const metadata = getSafeImportErrorMetadata(error);

    expect(metadata).toEqual({ errorCode: 'SQLITE_IOERR', errorType: 'Error' });
    expect(JSON.stringify(metadata)).not.toContain('Secret Customer');
    expect(JSON.stringify(metadata)).not.toContain('customer@example.com');
  });

  it('previews customer validation and tenant-scoped identifier dedupe', async () => {
    const foreignTenantId = nanoid();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign customer tenant',
      slug: `foreign-customer-${foreignTenantId}`,
      defaultCurrencyCode: 'COP',
      isActive: true,
    });
    await db.insert(customers).values({
      id: nanoid(),
      tenantId: foreignTenantId,
      name: 'Foreign customer',
      taxId: 'FOREIGN-SAFE-123B',
      email: 'foreign-safe-123b@example.com',
      creditLimit: 0,
      isActive: true,
    });

    const preview = await appRouter
      .createCaller(createTestContext())
      .launchMigration.previewCustomers({
        dataMode: 'demo',
        sourceName: 'launch-customers.csv',
        rows: [
          row(2, {
            name: 'New customer',
            taxId: 'NEW-CUSTOMER-123B',
            email: 'NEW-CUSTOMER-123B@EXAMPLE.COM',
          }),
          row(3, { name: 'Repeated tax ID', taxId: ' new-customer-123b ' }),
          row(4, {
            name: 'Existing email',
            email: ' EXISTING-CUSTOMER-123B@EXAMPLE.COM ',
          }),
          row(5, { name: '', email: 'not-an-email' }),
          row(6, {
            name: 'Cross tenant safe',
            taxId: 'FOREIGN-SAFE-123B',
            email: 'foreign-safe-123b@example.com',
          }),
          row(7, { name: 'Same display name' }),
          row(8, { name: 'Same display name' }),
        ],
      });

    expect(preview.summary).toEqual({ total: 7, ready: 4, duplicates: 2, invalid: 1 });
    expect(preview.dataMode).toBe('demo');
    expect(preview.rows[0]?.normalized.email).toBe('new-customer-123b@example.com');
    expect(preview.rows[1]?.issues).toContainEqual({
      code: 'duplicate_file_tax_id',
      field: 'taxId',
    });
    expect(preview.rows[2]?.issues).toContainEqual({
      code: 'duplicate_existing_email',
      field: 'email',
    });
    expect(preview.rows[3]?.issues).toEqual(
      expect.arrayContaining([
        { code: 'required', field: 'name' },
        { code: 'invalid_email', field: 'email' },
      ])
    );
    expect(preview.rows[4]?.status).toBe('ready');
    expect(preview.rows[5]?.status).toBe('ready');
    expect(preview.rows[6]?.status).toBe('ready');
  });

  it('imports customers through the canonical profile write and emits PII-free audit evidence', async () => {
    const input = {
      dataMode: 'real' as const,
      sourceName: 'customer-launch.xlsx',
      rows: [
        row(2, {
          name: 'Imported Customer 123B',
          taxId: 'IMPORT-CUSTOMER-123B',
          email: 'IMPORTED-CUSTOMER-123B@EXAMPLE.COM',
          phone: '+57 300 000 0000',
          city: 'Medellín',
          notes: 'Preferred launch customer',
        }),
        row(3, { name: '', email: 'broken' }),
      ],
    };
    const caller = appRouter.createCaller(createTestContext());
    const preview = await caller.launchMigration.previewCustomers(input);
    const result = await caller.launchMigration.importCustomers({
      ...input,
      confirmedRealData: true,
      previewHash: preview.previewHash,
    });

    expect(result.summary).toEqual({
      total: 2,
      imported: 1,
      skipped: 0,
      invalid: 1,
      failed: 0,
      warnings: 0,
    });
    const customer = await db
      .select()
      .from(customers)
      .where(and(eq(customers.tenantId, tenantId), eq(customers.taxId, 'IMPORT-CUSTOMER-123B')))
      .get();
    expect(customer).toMatchObject({
      name: 'Imported Customer 123B',
      email: 'imported-customer-123b@example.com',
      city: 'Medellín',
      syncStatus: 'pending',
      syncVersion: 1,
    });
    const audit = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.resourceId, result.importId),
          eq(auditLogs.action, 'data_import.customers')
        )
      )
      .get();
    expect(audit?.actorId).toBe(userId);
    expect(JSON.stringify(audit)).not.toContain('Imported Customer 123B');
    expect(JSON.stringify(audit)).not.toContain('customer-launch.xlsx');
    expect(audit?.metadata).toMatchObject({
      dataMode: 'real',
      sourceFormat: 'xlsx',
      totalRows: 2,
      previewHash: preview.previewHash,
    });

    const retryPreview = await caller.launchMigration.previewCustomers(input);
    const retry = await caller.launchMigration.importCustomers({
      ...input,
      confirmedRealData: true,
      previewHash: retryPreview.previewHash,
    });
    expect(retry.summary).toMatchObject({ imported: 0, skipped: 1, invalid: 1 });
  });

  it('previews provider dedupe and validates tenant city codes', async () => {
    const foreignTenantId = nanoid();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign provider tenant',
      slug: `foreign-provider-${foreignTenantId}`,
      defaultCurrencyCode: 'COP',
      isActive: true,
    });
    await db.insert(providers).values({
      id: nanoid(),
      tenantId: foreignTenantId,
      name: 'Foreign Launch Provider 123B',
      taxId: 'FOREIGN-PROVIDER-123B',
      email: 'foreign-provider-123b@example.com',
      isActive: true,
    });

    const preview = await appRouter
      .createCaller(createTestContext())
      .launchMigration.previewProviders({
        dataMode: 'demo',
        sourceName: 'launch-providers.csv',
        rows: [
          row(2, {
            name: 'New Launch Provider 123B',
            taxId: 'NEW-PROVIDER-123B',
            email: 'new-provider-123b@example.com',
            cityCode: cityCode.toLocaleLowerCase(),
          }),
          row(3, { name: ' new launch provider 123b ' }),
          row(4, { name: 'Existing Launch Provider 123B' }),
          row(5, { name: 'Missing city', cityCode: 'UNKNOWN-CITY-123B' }),
          row(6, { name: 'Bad email', email: 'broken' }),
          row(7, {
            name: 'Foreign Launch Provider 123B',
            taxId: 'FOREIGN-PROVIDER-123B',
            email: 'foreign-provider-123b@example.com',
          }),
        ],
      });

    expect(preview.summary).toEqual({ total: 6, ready: 2, duplicates: 2, invalid: 2 });
    expect(preview.dataMode).toBe('demo');
    expect(preview.rows[0]?.normalized.cityId).toBe(cityId);
    expect(preview.rows[1]?.issues).toContainEqual({
      code: 'duplicate_file_name',
      field: 'name',
    });
    expect(preview.rows[2]?.issues).toContainEqual({
      code: 'duplicate_existing_name',
      field: 'name',
    });
    expect(preview.rows[3]?.issues).toContainEqual({
      code: 'city_not_found',
      field: 'cityCode',
    });
    expect(preview.rows[4]?.issues).toContainEqual({
      code: 'invalid_email',
      field: 'email',
    });
    expect(preview.rows[5]?.status).toBe('ready');
  });

  it('imports providers through the canonical write and preserves geography', async () => {
    const input = {
      dataMode: 'real' as const,
      sourceName: 'provider-launch.xlsx',
      rows: [
        row(2, {
          name: 'Imported Provider 123B',
          taxId: 'IMPORT-PROVIDER-123B',
          email: 'IMPORTED-PROVIDER-123B@EXAMPLE.COM',
          contactName: 'Launch Contact',
          cityCode,
        }),
      ],
    };
    const caller = appRouter.createCaller(createTestContext());
    const preview = await caller.launchMigration.previewProviders(input);
    const result = await caller.launchMigration.importProviders({
      ...input,
      confirmedRealData: true,
      previewHash: preview.previewHash,
    });

    expect(result.summary).toMatchObject({ imported: 1, skipped: 0, invalid: 0, failed: 0 });
    const provider = await db
      .select()
      .from(providers)
      .where(and(eq(providers.tenantId, tenantId), eq(providers.taxId, 'IMPORT-PROVIDER-123B')))
      .get();
    expect(provider).toMatchObject({
      name: 'Imported Provider 123B',
      email: 'imported-provider-123b@example.com',
      contactName: 'Launch Contact',
      cityId,
    });
    const audit = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceId, result.importId)))
      .get();
    expect(audit?.action).toBe('data_import.providers');
    expect(JSON.stringify(audit)).not.toContain('Imported Provider 123B');
    expect(JSON.stringify(audit)).not.toContain('provider-launch.xlsx');
    expect(audit?.metadata).toMatchObject({
      dataMode: 'real',
      sourceFormat: 'xlsx',
      totalRows: 1,
      previewHash: preview.previewHash,
    });
  });

  it('rejects stale hashes and non-admin party imports', async () => {
    const customerInput = {
      dataMode: 'real' as const,
      sourceName: 'guard-customers.csv',
      rows: [row(2, { name: 'Guarded Customer 123B' })],
    };
    const providerInput = {
      dataMode: 'real' as const,
      sourceName: 'guard-providers.csv',
      rows: [row(2, { name: 'Guarded Provider 123B' })],
    };
    const admin = appRouter.createCaller(createTestContext());
    await expect(
      admin.launchMigration.importCustomers({
        ...customerInput,
        confirmedRealData: true,
        previewHash: '0'.repeat(64),
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      admin.launchMigration.importProviders({
        ...providerInput,
        confirmedRealData: true,
        previewHash: '0'.repeat(64),
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });

    const manager = appRouter.createCaller(createTestContext('manager'));
    await expect(manager.launchMigration.previewCustomers(customerInput)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(manager.launchMigration.previewProviders(providerInput)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
