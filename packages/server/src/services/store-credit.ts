/** Immutable customer store-credit ledger with an in-transaction balance. */

import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../db/index.js';
import { customers, storeCreditAccounts, storeCreditMovements } from '../db/schema.js';
import { throwServerError } from '../lib/errorCodes.js';
import { roundMoney } from '../lib/money.js';

interface StoreCreditMovementBase {
  accountId: string;
  movementId: string;
  balanceAfter: number;
}

export interface StoreCreditIssueResult extends StoreCreditMovementBase {
  /**
   * True when THIS call inserted the account row. Replication needs it: a
   * peer applying operation semantics has no row to update on the very first
   * issuance, so the account must replicate as `create` that once and as
   * `update` from then on. Measured from the insert's own row count, so a
   * concurrent insert that lost the onConflictDoNothing race correctly
   * reports false.
   *
   * Lives on the ISSUE result only: redeeming or adjusting an existing
   * balance cannot bring an account into being, so the flag would be
   * meaningless — and always false — on those paths.
   */
  accountCreated: boolean;
}

export interface StoreCreditMovementResult extends StoreCreditMovementBase {
  amount: number;
}

function getAccount(
  tx: DatabaseInstance,
  input: { tenantId: string; customerId: string; currencyCode: string }
) {
  return tx
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

function moveBalance(
  tx: DatabaseInstance,
  input: {
    tenantId: string;
    account: NonNullable<ReturnType<typeof getAccount>>;
    delta: number;
    now: string;
  }
): number {
  const balanceAfter = roundMoney(input.account.balance + input.delta);
  if (balanceAfter < 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'STORE_CREDIT_INSUFFICIENT_BALANCE',
      message: 'The customer does not have enough store credit',
      details: { balance: input.account.balance, requested: Math.abs(input.delta) },
    });
  }
  const updated = tx
    .update(storeCreditAccounts)
    .set({
      balance: balanceAfter,
      syncStatus: 'pending',
      syncVersion: (input.account.syncVersion ?? 0) + 1,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(storeCreditAccounts.id, input.account.id),
        eq(storeCreditAccounts.tenantId, input.tenantId),
        eq(storeCreditAccounts.balance, input.account.balance)
      )
    )
    .run();
  if (updated.changes !== 1) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'STORE_CREDIT_BALANCE_CHANGED',
      message: 'The customer store-credit balance changed; retry the operation',
    });
  }
  return balanceAfter;
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

  let account = getAccount(tx, input);
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
    account = getAccount(tx, input);
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

  const balanceAfter = moveBalance(tx, {
    tenantId: input.tenantId,
    account,
    delta: amount,
    now: input.now,
  });

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

/** Debit one store-credit tender inside the enclosing sale transaction. */
export function redeemStoreCreditForPayment(
  tx: DatabaseInstance,
  input: {
    tenantId: string;
    customerId: string | null;
    saleId: string;
    salePaymentId: string;
    amount: number;
    currencyCode: string;
    createdBy: string;
    now: string;
  }
): StoreCreditMovementResult {
  if (!input.customerId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CUSTOMER_VALUE_TENDER_CUSTOMER_REQUIRED',
      message: 'Store-credit redemption requires a customer',
    });
  }
  const amount = roundMoney(input.amount);
  if (amount <= 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'STORE_CREDIT_AMOUNT_INVALID',
      message: 'Store credit must be greater than zero',
    });
  }
  const account = getAccount(tx, {
    tenantId: input.tenantId,
    customerId: input.customerId,
    currencyCode: input.currencyCode,
  });
  if (!account || account.balance < amount) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'STORE_CREDIT_INSUFFICIENT_BALANCE',
      message: 'The customer does not have enough store credit',
      details: { balance: account?.balance ?? 0, requested: amount },
    });
  }
  const balanceAfter = moveBalance(tx, {
    tenantId: input.tenantId,
    account,
    delta: -amount,
    now: input.now,
  });
  const movementId = nanoid();
  tx.insert(storeCreditMovements)
    .values({
      id: movementId,
      tenantId: input.tenantId,
      accountId: account.id,
      customerId: input.customerId,
      saleId: input.saleId,
      salePaymentId: input.salePaymentId,
      kind: 'redeem',
      amount: -amount,
      balanceAfter,
      currencyCode: input.currencyCode,
      createdBy: input.createdBy,
      createdAt: input.now,
    })
    .run();
  return { accountId: account.id, movementId, balanceAfter, amount };
}

function restoreRedemption(
  tx: DatabaseInstance,
  input: {
    tenantId: string;
    saleId: string;
    saleReturnId: string | null;
    salePaymentId: string;
    amount: number | null;
    createdBy: string;
    now: string;
  }
): StoreCreditMovementResult | null {
  const source = tx
    .select()
    .from(storeCreditMovements)
    .where(
      and(
        eq(storeCreditMovements.tenantId, input.tenantId),
        eq(storeCreditMovements.salePaymentId, input.salePaymentId),
        eq(storeCreditMovements.kind, 'redeem')
      )
    )
    .get();
  if (!source) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'STORE_CREDIT_SOURCE_MISSING',
      message: 'The original store-credit redemption could not be verified',
    });
  }
  const originalAmount = Math.abs(source.amount);
  const restored = tx
    .select({ amount: storeCreditMovements.amount })
    .from(storeCreditMovements)
    .where(
      and(
        eq(storeCreditMovements.tenantId, input.tenantId),
        eq(storeCreditMovements.sourceMovementId, source.id),
        eq(storeCreditMovements.kind, 'revert')
      )
    )
    .all()
    .reduce((sum, movement) => roundMoney(sum + Math.max(0, movement.amount)), 0);
  const amount = roundMoney(input.amount ?? originalAmount - restored);
  if (amount < 0 || roundMoney(restored + amount) > originalAmount) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'STORE_CREDIT_RESTORE_INVALID',
      message: 'The store-credit restoration exceeds the original redemption',
    });
  }
  if (amount === 0) return null;
  const account = tx
    .select()
    .from(storeCreditAccounts)
    .where(
      and(
        eq(storeCreditAccounts.id, source.accountId),
        eq(storeCreditAccounts.tenantId, input.tenantId)
      )
    )
    .get();
  if (!account) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'STORE_CREDIT_SOURCE_MISSING',
      message: 'The store-credit account could not be verified',
    });
  }
  const balanceAfter = moveBalance(tx, {
    tenantId: input.tenantId,
    account,
    delta: amount,
    now: input.now,
  });
  const movementId = nanoid();
  tx.insert(storeCreditMovements)
    .values({
      id: movementId,
      tenantId: input.tenantId,
      accountId: account.id,
      customerId: source.customerId,
      saleId: input.saleId,
      saleReturnId: input.saleReturnId,
      sourceMovementId: source.id,
      kind: 'revert',
      amount,
      balanceAfter,
      currencyCode: source.currencyCode,
      createdBy: input.createdBy,
      createdAt: input.now,
    })
    .run();
  return { accountId: account.id, movementId, balanceAfter, amount };
}

export function restoreStoreCreditForReturn(
  tx: DatabaseInstance,
  input: Omit<Parameters<typeof restoreRedemption>[1], 'saleReturnId'> & {
    saleReturnId: string;
    amount: number;
  }
): StoreCreditMovementResult | null {
  return restoreRedemption(tx, input);
}

export function restoreStoreCreditForVoid(
  tx: DatabaseInstance,
  input: Omit<Parameters<typeof restoreRedemption>[1], 'saleReturnId' | 'amount'>
): StoreCreditMovementResult | null {
  return restoreRedemption(tx, { ...input, saleReturnId: null, amount: null });
}

export async function getStoreCreditForCustomer(
  db: DatabaseInstance,
  input: { tenantId: string; customerId: string; currencyCode: string; limit?: number }
) {
  const account = getAccount(db, input);
  if (!account) return { balance: 0, currencyCode: input.currencyCode, movements: [] };
  const movements = await db
    .select({
      id: storeCreditMovements.id,
      saleId: storeCreditMovements.saleId,
      saleReturnId: storeCreditMovements.saleReturnId,
      kind: storeCreditMovements.kind,
      amount: storeCreditMovements.amount,
      balanceAfter: storeCreditMovements.balanceAfter,
      note: storeCreditMovements.note,
      createdAt: storeCreditMovements.createdAt,
    })
    .from(storeCreditMovements)
    .where(
      and(
        eq(storeCreditMovements.tenantId, input.tenantId),
        eq(storeCreditMovements.accountId, account.id)
      )
    )
    .orderBy(desc(storeCreditMovements.createdAt), desc(storeCreditMovements.id))
    .limit(input.limit ?? 20)
    .all();
  return { balance: account.balance, currencyCode: account.currencyCode, movements };
}
