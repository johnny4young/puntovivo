/** Immutable customer store-credit ledger with an in-transaction balance. */

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../db/index.js';
import { customers, storeCreditAccounts, storeCreditMovements } from '../db/schema.js';
import { throwServerError } from '../lib/errorCodes.js';
import { roundMoney } from '../lib/money.js';

export interface StoreCreditIssueResult {
  accountId: string;
  movementId: string;
  balanceAfter: number;
  /**
   * True when THIS call inserted the account row. Replication needs it: a
   * peer applying operation semantics has no row to update on the very first
   * issuance, so the account must replicate as `create` that once and as
   * `update` from then on. Measured from the insert's own row count, so a
   * concurrent insert that lost the onConflictDoNothing race correctly
   * reports false.
   */
  accountCreated: boolean;
}

export function issueStoreCreditForReturn(
  tx: DatabaseInstance,
  input: {
    tenantId: string;
    customerId: string;
    saleReturnId: string;
    saleId: string;
    amount: number;
    currencyCode: string;
    createdBy: string;
    note?: string | null;
    now: string;
  }
): StoreCreditIssueResult {
  const amount = roundMoney(input.amount);
  if (amount <= 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'STORE_CREDIT_AMOUNT_INVALID',
      message: 'Store credit must be greater than zero',
    });
  }
  const customer = tx
    .select({ id: customers.id })
    .from(customers)
    .where(and(eq(customers.tenantId, input.tenantId), eq(customers.id, input.customerId)))
    .get();
  if (!customer) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_RETURN_CUSTOMER_REQUIRED',
      message: 'Store credit requires a customer from this business',
    });
  }

  let account = tx
    .select()
    .from(storeCreditAccounts)
    .where(
      and(
        eq(storeCreditAccounts.tenantId, input.tenantId),
        eq(storeCreditAccounts.customerId, input.customerId),
        eq(storeCreditAccounts.currencyCode, input.currencyCode)
      )
    )
    .get();
  let accountCreated = false;
  if (!account) {
    const inserted = tx
      .insert(storeCreditAccounts)
      .values({
        id: nanoid(),
        tenantId: input.tenantId,
        customerId: input.customerId,
        currencyCode: input.currencyCode,
        balance: 0,
        syncStatus: 'pending',
        syncVersion: 0,
        createdAt: input.now,
        updatedAt: input.now,
      })
      .onConflictDoNothing({
        target: [
          storeCreditAccounts.tenantId,
          storeCreditAccounts.customerId,
          storeCreditAccounts.currencyCode,
        ],
      })
      .run();
    accountCreated = inserted.changes === 1;
    account = tx
      .select()
      .from(storeCreditAccounts)
      .where(
        and(
          eq(storeCreditAccounts.tenantId, input.tenantId),
          eq(storeCreditAccounts.customerId, input.customerId),
          eq(storeCreditAccounts.currencyCode, input.currencyCode)
        )
      )
      .get();
  }
  if (!account) {
    // A concurrent insert is normally recovered by the re-read above. If the
    // row is still unavailable, keep the API fail-closed and return a stable,
    // translated conflict instead of leaking an internal exception string.
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'STORE_CREDIT_BALANCE_CHANGED',
      message: 'The customer store-credit account changed; retry the return',
    });
  }

  const balanceAfter = roundMoney(account.balance + amount);
  const updated = tx
    .update(storeCreditAccounts)
    .set({
      balance: balanceAfter,
      syncStatus: 'pending',
      syncVersion: (account.syncVersion ?? 0) + 1,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(storeCreditAccounts.id, account.id),
        eq(storeCreditAccounts.tenantId, input.tenantId),
        eq(storeCreditAccounts.balance, account.balance)
      )
    )
    .run();
  if (updated.changes !== 1) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'STORE_CREDIT_BALANCE_CHANGED',
      message: 'The customer store-credit balance changed; retry the return',
    });
  }

  const movementId = nanoid();
  tx.insert(storeCreditMovements)
    .values({
      id: movementId,
      tenantId: input.tenantId,
      accountId: account.id,
      customerId: input.customerId,
      saleReturnId: input.saleReturnId,
      saleId: input.saleId,
      kind: 'issue',
      amount,
      balanceAfter,
      currencyCode: input.currencyCode,
      note: input.note ?? null,
      createdBy: input.createdBy,
      createdAt: input.now,
    })
    .run();
  return { accountId: account.id, movementId, balanceAfter, accountCreated };
}
