/** Customer receivable opening-balance import. */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { importOpeningCustomerBalance } from '../application/customers/index.js';
import { auditLogs, customerLedgerEntries, customers, tenants, users } from '../db/schema.js';
import { getDatabase, type DatabaseInstance } from '../db/index.js';
import { createServer, type PuntovivoServer } from '../index.js';
import type { Context } from '../trpc/context.js';
import { appRouter } from '../trpc/router.js';
import {
  commitLaunchCustomerBalanceImportInput,
  previewLaunchCustomerBalanceImportInput,
} from '../trpc/schemas/launchMigration.js';

let server: PuntovivoServer;
let db: DatabaseInstance;
let tenantId: string;
let userId: string;
let firstCustomerId: string;
let existingBalanceCustomerId: string;
let foreignCustomerId: string;

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

function row(rowNumber: number, values: Record<string, string>) {
  return { rowNumber, values };
}

describe(' customer opening-balance migration', () => {
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
    const first = await caller.customers.create({
      name: 'Balance Customer One',
      taxId: 'BALANCE-TAX-ONE',
      email: 'balance-one@example.com',
    });
    firstCustomerId = first.id;
    const existing = await caller.customers.create({
      name: 'Balance Customer Existing',
      taxId: 'BALANCE-TAX-EXISTING',
      email: 'balance-existing@example.com',
    });
    existingBalanceCustomerId = existing.id;
    await db.insert(customerLedgerEntries).values({
      id: nanoid(),
      tenantId,
      customerId: existing.id,
      kind: 'adjustment',
      amount: 25,
      note: 'Existing history',
      createdBy: userId,
    });

    await caller.customers.create({
      name: 'Ambiguous Balance One',
      taxId: 'BALANCE-AMBIGUOUS',
    });
    await caller.customers.create({
      name: 'Ambiguous Balance Two',
      taxId: 'BALANCE-AMBIGUOUS',
    });

    const foreignTenantId = nanoid();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign balance tenant',
      slug: `foreign-balance-${foreignTenantId}`,
      defaultCurrencyCode: 'COP',
      isActive: true,
    });
    foreignCustomerId = nanoid();
    await db.insert(customers).values({
      id: foreignCustomerId,
      tenantId: foreignTenantId,
      name: 'Foreign balance customer',
      taxId: 'FOREIGN-BALANCE-TAX',
      creditLimit: 0,
      isActive: true,
    });
  });

  it('rejects malformed, non-positive, and excessive receivables row by row', async () => {
    const preview = await appRouter
      .createCaller(createTestContext())
      .launchMigration.previewCustomerBalances({
        dataMode: 'demo',
        sourceName: 'invalid-balances.csv',
        rows: [
          row(2, { taxId: 'BALANCE-TAX-ONE', openingBalance: 'not money' }),
          row(3, { taxId: 'BALANCE-TAX-ONE', openingBalance: '-10' }),
          row(4, { taxId: 'BALANCE-TAX-ONE', openingBalance: '1000000000000' }),
        ],
      });

    expect(preview.summary).toEqual({ total: 3, ready: 0, duplicates: 0, invalid: 3 });
    expect(preview.rows[0]?.issues).toContainEqual({
      code: 'invalid_number',
      field: 'openingBalance',
    });
    expect(preview.rows[1]?.issues).toContainEqual({
      code: 'balance_must_be_positive',
      field: 'openingBalance',
    });
    expect(preview.rows[2]?.issues).toContainEqual({
      code: 'out_of_range',
      field: 'openingBalance',
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('keeps the transport strict and forbids demo or unconfirmed commits', () => {
    expect(
      previewLaunchCustomerBalanceImportInput.safeParse({
        dataMode: 'real',
        sourceName: 'balances.csv',
        rows: [
          { ...row(2, { taxId: 'A', openingBalance: '10' }), unexpected: true },
          row(2, { taxId: 'B', openingBalance: '20' }),
        ],
      }).success
    ).toBe(false);
    expect(
      commitLaunchCustomerBalanceImportInput.safeParse({
        dataMode: 'demo',
        confirmedRealData: true,
        sourceName: 'balances.csv',
        previewHash: '0'.repeat(64),
        rows: [row(2, { taxId: 'A', openingBalance: '10' })],
      }).success
    ).toBe(false);
    expect(
      commitLaunchCustomerBalanceImportInput.safeParse({
        dataMode: 'real',
        sourceName: 'balances.csv',
        previewHash: '0'.repeat(64),
        rows: [row(2, { taxId: 'A', openingBalance: '10' })],
      }).success
    ).toBe(false);
  });

  it('resolves tenant customers and classifies duplicate, ambiguous, and invalid rows', async () => {
    const preview = await appRouter
      .createCaller(createTestContext())
      .launchMigration.previewCustomerBalances({
        dataMode: 'demo',
        decimalFormat: 'comma',
        sourceName: 'saldos-clientes.csv',
        rows: [
          row(2, { taxId: ' balance-tax-one ', openingBalance: '1.234,50' }),
          row(3, { email: 'BALANCE-ONE@EXAMPLE.COM', openingBalance: '50' }),
          row(4, { taxId: 'BALANCE-TAX-EXISTING', openingBalance: '25' }),
          row(5, { openingBalance: '10' }),
          row(6, { taxId: 'UNKNOWN-BALANCE', openingBalance: '10' }),
          row(7, { taxId: 'BALANCE-AMBIGUOUS', openingBalance: '10' }),
          row(8, {
            taxId: 'BALANCE-TAX-ONE',
            email: 'balance-existing@example.com',
            openingBalance: '10',
          }),
          row(9, { taxId: 'FOREIGN-BALANCE-TAX', openingBalance: '10' }),
          row(10, { taxId: 'BALANCE-TAX-ONE', openingBalance: '0' }),
        ],
      });

    expect(preview.dataMode).toBe('demo');
    expect(preview.summary).toEqual({ total: 9, ready: 1, duplicates: 2, invalid: 6 });
    expect(preview.rows[0]).toMatchObject({
      status: 'ready',
      normalized: {
        customerId: firstCustomerId,
        customerName: 'Balance Customer One',
        openingBalance: 1234.5,
      },
    });
    expect(preview.rows[1]?.issues).toContainEqual({
      code: 'duplicate_file_customer',
      field: 'email',
    });
    expect(preview.rows[2]?.issues).toContainEqual({
      code: 'duplicate_existing_balance',
      field: 'openingBalance',
    });
    expect(preview.rows[4]?.issues).toContainEqual({
      code: 'customer_not_found',
      field: 'taxId',
    });
    expect(preview.rows[5]?.issues).toContainEqual({
      code: 'ambiguous_customer',
      field: 'taxId',
    });
    expect(preview.rows[6]?.issues).toContainEqual({
      code: 'identifier_conflict',
      field: 'email',
    });
    expect(preview.rows[7]?.issues).toContainEqual({
      code: 'customer_not_found',
      field: 'taxId',
    });
    expect(preview.rows[8]?.issues).toContainEqual({
      code: 'balance_must_be_positive',
      field: 'openingBalance',
    });
  });

  it('commits one atomic opening adjustment, audits counts only, and makes retries safe', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const customer = await caller.customers.create({
      name: 'Committed Balance Customer',
      taxId: 'BALANCE-COMMIT-123D',
      email: 'balance-commit@example.com',
    });
    const input = {
      dataMode: 'real' as const,
      decimalFormat: 'dot' as const,
      sourceName: 'Merchant Name Balances.xlsx',
      rows: [
        row(2, {
          taxId: 'BALANCE-COMMIT-123D',
          email: 'balance-commit@example.com',
          openingBalance: '1234.56',
          note: 'Legacy receivable',
        }),
      ],
    };
    const preview = await caller.launchMigration.previewCustomerBalances(input);
    const result = await caller.launchMigration.importCustomerBalances({
      ...input,
      confirmedRealData: true,
      previewHash: preview.previewHash,
    });

    expect(result.summary).toMatchObject({ imported: 1, skipped: 0, invalid: 0, failed: 0 });
    const ledger = await db
      .select()
      .from(customerLedgerEntries)
      .where(
        and(
          eq(customerLedgerEntries.tenantId, tenantId),
          eq(customerLedgerEntries.customerId, customer.id)
        )
      )
      .all();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ kind: 'adjustment', amount: 1234.56, createdBy: userId });
    expect(ledger[0]?.note).toContain(result.importId);

    const audit = await db
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.action, 'data_import.customer_balances'),
          eq(auditLogs.resourceId, result.importId)
        )
      )
      .get();
    expect(audit?.metadata).toMatchObject({
      dataMode: 'real',
      sourceFormat: 'xlsx',
      totalRows: 1,
      previewHash: preview.previewHash,
    });
    expect(JSON.stringify(audit)).not.toContain('balance-commit@example.com');
    expect(JSON.stringify(audit)).not.toContain('Merchant Name Balances.xlsx');

    const retryPreview = await caller.launchMigration.previewCustomerBalances(input);
    expect(retryPreview.summary).toMatchObject({ ready: 0, duplicates: 1 });
    const retry = await caller.launchMigration.importCustomerBalances({
      ...input,
      confirmedRealData: true,
      previewHash: retryPreview.previewHash,
    });
    expect(retry.summary).toMatchObject({ imported: 0, skipped: 1 });
  });

  it('atomically refuses a second opening balance and rejects stale hashes or non-admins', async () => {
    expect(
      importOpeningCustomerBalance(
        { db, tenantId, user: { id: userId } },
        { customerId: existingBalanceCustomerId, amount: 99, note: 'Must not write' }
      )
    ).toEqual({ status: 'existing' });
    expect(() =>
      importOpeningCustomerBalance(
        { db, tenantId, user: { id: userId } },
        { customerId: firstCustomerId, amount: 0, note: 'Must not write' }
      )
    ).toThrow('Opening customer balance must be a positive finite amount');
    expect(() =>
      importOpeningCustomerBalance(
        { db, tenantId, user: { id: userId } },
        { customerId: foreignCustomerId, amount: 10, note: 'Must not cross tenants' }
      )
    ).toThrow('CUSTOMER_NOT_FOUND');
    await db
      .update(customers)
      .set({ isActive: false })
      .where(and(eq(customers.tenantId, tenantId), eq(customers.id, firstCustomerId)))
      .run();
    expect(() =>
      importOpeningCustomerBalance(
        { db, tenantId, user: { id: userId } },
        { customerId: firstCustomerId, amount: 10, note: 'Must not target inactive customers' }
      )
    ).toThrow('CUSTOMER_NOT_FOUND');

    const input = {
      dataMode: 'real' as const,
      sourceName: 'guard-balances.csv',
      rows: [row(2, { taxId: 'BALANCE-TAX-ONE', openingBalance: '10' })],
    };
    await expect(
      appRouter.createCaller(createTestContext()).launchMigration.importCustomerBalances({
        ...input,
        confirmedRealData: true,
        previewHash: '0'.repeat(64),
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      appRouter
        .createCaller(createTestContext('manager'))
        .launchMigration.previewCustomerBalances(input)
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
