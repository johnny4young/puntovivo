/** Transactional redemption of loyalty points and store credit. */
import { and, eq, inArray } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  loyaltyAccounts,
  loyaltyMovements,
  storeCreditAccounts,
  storeCreditMovements,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { roundMoney } from '../../lib/money.js';
import { redeemPointsForPayment, type LoyaltySettings } from '../../services/loyalty.js';
import { redeemStoreCreditForPayment } from '../../services/store-credit.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import type { CompleteSaleContext, CompleteSaleTender, SalePaymentMethod } from './types.js';

const INTERNAL_METHODS: readonly SalePaymentMethod[] = ['loyalty', 'store_credit'];

/**
 * Money that may earn new loyalty points after checkout. Redeemed points are
 * already a reward liability, so awarding points on that same portion would
 * compound rewards without new consideration. Store credit remains eligible:
 * its originating return claws back the original sale's earned points, making
 * the later redemption economically equivalent to customer funds.
 */
export function loyaltyEarningBase(
  saleTotal: number,
  payments: readonly CompleteSaleTender[]
): number {
  const redeemedValue = payments
    .filter(payment => payment.method === 'loyalty')
    .reduce((sum, payment) => roundMoney(sum + payment.amount), 0);
  return roundMoney(Math.max(0, roundMoney(saleTotal) - redeemedValue));
}

export function assertCustomerValueTenderInputs(args: {
  customerId: string | null;
  payments: readonly CompleteSaleTender[] | undefined;
  legacyMethod: SalePaymentMethod;
  loyaltySettings: LoyaltySettings;
  isCompletion: boolean;
}): void {
  if (INTERNAL_METHODS.includes(args.legacyMethod) && !args.payments?.length) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CUSTOMER_VALUE_TENDER_LEGACY_FORBIDDEN',
      message: 'Loyalty and store credit must be submitted as itemized tenders',
    });
  }
  const internal = (args.payments ?? []).filter(payment =>
    INTERNAL_METHODS.includes(payment.method)
  );
  if (internal.length > 0 && !args.isCompletion) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CUSTOMER_VALUE_TENDER_LEGACY_FORBIDDEN',
      message: 'Customer-value tenders can only be consumed by a completed sale',
    });
  }
  if (internal.length > 0 && !args.customerId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'CUSTOMER_VALUE_TENDER_CUSTOMER_REQUIRED',
      message: 'Loyalty and store-credit tenders require a customer',
    });
  }
  for (const payment of args.payments ?? []) {
    if (payment.method === 'loyalty') {
      if (!args.loyaltySettings.enabled || !args.loyaltySettings.redemptionEnabled) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'LOYALTY_REDEMPTION_DISABLED',
          message: 'Loyalty redemption is not enabled for this business',
        });
      }
      if (!Number.isInteger(payment.loyaltyPoints) || (payment.loyaltyPoints ?? 0) <= 0) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'LOYALTY_TENDER_AMOUNT_MISMATCH',
          message: 'Loyalty tenders require a positive whole-points amount',
        });
      }
      const expected = roundMoney(payment.loyaltyPoints! * args.loyaltySettings.valuePerPoint);
      if (roundMoney(payment.amount) !== expected) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'LOYALTY_TENDER_AMOUNT_MISMATCH',
          message: 'The loyalty tender does not match the configured point value',
          details: { expectedAmount: expected, receivedAmount: roundMoney(payment.amount) },
        });
      }
    } else if (payment.loyaltyPoints !== undefined) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'LOYALTY_TENDER_AMOUNT_MISMATCH',
        message: 'Only loyalty tenders may carry points',
      });
    }
  }
}

export interface CustomerValueRedemptionRefs {
  loyaltyAccountIds: string[];
  loyaltyMovementIds: string[];
  storeCreditAccountIds: string[];
  storeCreditMovementIds: string[];
}

export function createCustomerValueRedemptionRefs(): CustomerValueRedemptionRefs {
  return {
    loyaltyAccountIds: [],
    loyaltyMovementIds: [],
    storeCreditAccountIds: [],
    storeCreditMovementIds: [],
  };
}

/**
 * Attach the earn row created by the loyalty savepoint to the same replication
 * batch as redemptions. Earning is intentionally best-effort, so callers only
 * invoke this after `earnPointsForSale` reports a committed positive delta.
 */
export function captureEarnedLoyaltyRefs(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    saleId: string;
    refs: CustomerValueRedemptionRefs;
  }
): void {
  const earned = tx
    .select({ id: loyaltyMovements.id, accountId: loyaltyMovements.accountId })
    .from(loyaltyMovements)
    .where(
      and(
        eq(loyaltyMovements.tenantId, args.tenantId),
        eq(loyaltyMovements.saleId, args.saleId),
        eq(loyaltyMovements.kind, 'earn')
      )
    )
    .get();
  if (!earned) return;
  if (!args.refs.loyaltyAccountIds.includes(earned.accountId)) {
    args.refs.loyaltyAccountIds.push(earned.accountId);
  }
  if (!args.refs.loyaltyMovementIds.includes(earned.id)) {
    args.refs.loyaltyMovementIds.push(earned.id);
  }
}

export function redeemCustomerValueTender(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    customerId: string | null;
    saleId: string;
    salePaymentId: string;
    payment: CompleteSaleTender;
    currencyCode: string;
    loyaltySettings: LoyaltySettings;
    createdBy: string;
    now: string;
    refs: CustomerValueRedemptionRefs;
  }
): void {
  if (args.payment.method === 'loyalty') {
    const redeemed = redeemPointsForPayment(tx, {
      tenantId: args.tenantId,
      customerId: args.customerId,
      saleId: args.saleId,
      salePaymentId: args.salePaymentId,
      points: args.payment.loyaltyPoints ?? 0,
      amount: args.payment.amount,
      currencyCode: args.currencyCode,
      settings: args.loyaltySettings,
      createdBy: args.createdBy,
      nowIso: args.now,
    });
    args.refs.loyaltyAccountIds.push(redeemed.accountId);
    args.refs.loyaltyMovementIds.push(redeemed.movementId);
  } else if (args.payment.method === 'store_credit') {
    const redeemed = redeemStoreCreditForPayment(tx, {
      tenantId: args.tenantId,
      customerId: args.customerId,
      saleId: args.saleId,
      salePaymentId: args.salePaymentId,
      amount: args.payment.amount,
      currencyCode: args.currencyCode,
      createdBy: args.createdBy,
      now: args.now,
    });
    args.refs.storeCreditAccountIds.push(redeemed.accountId);
    args.refs.storeCreditMovementIds.push(redeemed.movementId);
  }
}

export function enqueueCustomerValueRedemptions(
  tx: DatabaseInstance,
  ctx: Pick<CompleteSaleContext, 'tenantId' | 'envelope' | 'deviceId'>,
  refs: CustomerValueRedemptionRefs
): string[] {
  const outboxIds: string[] = [];
  const syncCtx = {
    db: tx,
    tenantId: ctx.tenantId,
    envelope: ctx.envelope ?? null,
    deviceId: ctx.deviceId ?? null,
  };
  const enqueueRows = <T extends { id: string }>(
    entityType:
      'loyalty_accounts' | 'loyalty_movements' | 'store_credit_accounts' | 'store_credit_movements',
    operation: 'create' | 'update',
    rows: readonly T[]
  ) => {
    for (const row of rows) {
      outboxIds.push(
        enqueueSyncInTransaction(syncCtx, {
          entityType,
          entityId: row.id,
          operation,
          data: row,
        }).id
      );
    }
  };

  const loyaltyAccountIds = [...new Set(refs.loyaltyAccountIds)];
  if (loyaltyAccountIds.length > 0) {
    enqueueRows(
      'loyalty_accounts',
      'update',
      tx
        .select()
        .from(loyaltyAccounts)
        .where(
          and(
            eq(loyaltyAccounts.tenantId, ctx.tenantId),
            inArray(loyaltyAccounts.id, loyaltyAccountIds)
          )
        )
        .all()
    );
  }
  if (refs.loyaltyMovementIds.length > 0) {
    enqueueRows(
      'loyalty_movements',
      'create',
      tx
        .select()
        .from(loyaltyMovements)
        .where(
          and(
            eq(loyaltyMovements.tenantId, ctx.tenantId),
            inArray(loyaltyMovements.id, [...new Set(refs.loyaltyMovementIds)])
          )
        )
        .all()
    );
  }
  const storeAccountIds = [...new Set(refs.storeCreditAccountIds)];
  if (storeAccountIds.length > 0) {
    enqueueRows(
      'store_credit_accounts',
      'update',
      tx
        .select()
        .from(storeCreditAccounts)
        .where(
          and(
            eq(storeCreditAccounts.tenantId, ctx.tenantId),
            inArray(storeCreditAccounts.id, storeAccountIds)
          )
        )
        .all()
    );
  }
  if (refs.storeCreditMovementIds.length > 0) {
    enqueueRows(
      'store_credit_movements',
      'create',
      tx
        .select()
        .from(storeCreditMovements)
        .where(
          and(
            eq(storeCreditMovements.tenantId, ctx.tenantId),
            inArray(storeCreditMovements.id, [...new Set(refs.storeCreditMovementIds)])
          )
        )
        .all()
    );
  }
  return outboxIds;
}
