/**
 * ENG-090 — credit-sale ledger hook regression.
 *
 * Pins the contract for `recordCreditSaleLedger`: writes a signed
 * delta to `customer_ledger_entries` so SUM(amount) over the
 * customer's rows yields the running receivable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { customers, customerLedgerEntries, tenants } from '../db/schema.js';
import { recordCreditSaleLedger } from '../application/sales/recordCreditSaleLedger.js';
import { createServer } from '../index.js';

describe('recordCreditSaleLedger', () => {
  let server: Awaited<ReturnType<typeof createServer>>;

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
  });

  afterAll(async () => {
    await server.close();
  });

  it('writes a positive sale-kind ledger entry for a credit sale', async () => {
    const tenantId = nanoid();
    const customerId = nanoid();

    await server.db.insert(tenants).values({
      id: tenantId,
      slug: `ledger-tenant-${tenantId.slice(0, 6)}`,
      name: 'Ledger Tenant',
    });
    await server.db.insert(customers).values({
      id: customerId,
      tenantId,
      name: 'Sra. Rosa',
    });

    const result = await recordCreditSaleLedger({
      db: server.db,
      tenantId,
      customerId,
      // Skip saleId since this test doesn't seed a sales row; the
      // helper accepts a null reference for cases like this.
      saleId: null,
      creditAmount: 42_000,
      createdBy: null,
      note: 'VTA-CR-001',
    });

    expect(result.id).toBeDefined();

    const rows = await server.db
      .select()
      .from(customerLedgerEntries)
      .where(
        and(
          eq(customerLedgerEntries.tenantId, tenantId),
          eq(customerLedgerEntries.customerId, customerId)
        )
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'sale',
      amount: 42_000,
      referenceSaleId: null,
      note: 'VTA-CR-001',
    });
  });

  it('rejects zero or negative credit amounts', async () => {
    await expect(
      recordCreditSaleLedger({
        db: server.db,
        tenantId: 'irrelevant',
        customerId: 'irrelevant',
        saleId: 'irrelevant',
        creditAmount: 0,
      })
    ).rejects.toThrow(/positive finite/);

    await expect(
      recordCreditSaleLedger({
        db: server.db,
        tenantId: 'irrelevant',
        customerId: 'irrelevant',
        saleId: 'irrelevant',
        creditAmount: -100,
      })
    ).rejects.toThrow(/positive finite/);
  });
});
