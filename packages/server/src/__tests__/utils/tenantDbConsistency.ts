import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  auditLogs,
  cashMovements,
  cashSessions,
  customerLedgerEntries,
  inventoryBalances,
  loyaltyAccounts,
  loyaltyMovements,
  salePayments,
  saleReturnPaymentAllocations,
  saleReturns,
  sales,
  storeCreditAccounts,
  storeCreditMovements,
} from '../../db/schema.js';
import { roundMoney } from '../../lib/money.js';
import { verifyAuditChain } from '../../services/audit-logs.js';
import { getCashMovementSignedAmount } from '../../services/cash-session.js';
import { getProductStockTotals } from '../../services/inventory-balances.js';
import { computeComprehensiveDayCloseReport } from '../../services/reports/comprehensive-day-close.js';
import { resolveUtcDayWindow } from '../../services/reports/day-window.js';
import { resolveTenantLocale } from '../../services/tenant-locale.js';

export interface TenantDbConsistencyOptions {
  businessDate?: string;
  now?: Date;
  allowNegativeStock?: boolean;
  expectedStockByProductId?: Record<string, number>;
  expectedCustomerBalanceById?: Record<string, number>;
}

export interface TenantDbConsistencyReport {
  foreignKeyViolations: number;
  integrityCheck: string;
  salesChecked: number;
  returnsChecked: number;
  cashSessionsChecked: number;
  productsChecked: number;
  storeCreditAccountsChecked: number;
  loyaltyAccountsChecked: number;
  auditChainValid: boolean;
  auditChainCheckedCount: number;
  dayCloseReconciled: boolean;
}

const MONEY_EPSILON = 0.011;
const QUANTITY_EPSILON = 1e-6;

function moneyClose(actual: number, expected: number): boolean {
  return Math.abs(roundMoney(actual) - roundMoney(expected)) <= MONEY_EPSILON;
}

/**
 * Audits 8 relational, financial, inventory, ledger, and cryptographic
 * invariants directly against SQLite for a tenant. Throws with a detailed
 * failure list if any invariant drifts.
 */
export async function assertTenantDbConsistency(
  db: DatabaseInstance,
  tenantId: string,
  options: TenantDbConsistencyOptions = {}
): Promise<TenantDbConsistencyReport> {
  const failures: string[] = [];

  // 1. SQLite foreign key & B-tree structural integrity.
  const fkRows = db.all(sql`PRAGMA foreign_key_check`);
  if (fkRows.length > 0) {
    failures.push(`PRAGMA foreign_key_check returned ${fkRows.length} violation(s)`);
  }
  const integrityRow = db.get<{ integrity_check?: string }>(sql`PRAGMA integrity_check`);
  const integrityCheck = integrityRow?.integrity_check ?? 'unknown';
  if (integrityCheck !== 'ok') {
    failures.push(`PRAGMA integrity_check returned "${integrityCheck}"`);
  }

  // 2. Sale header arithmetic + 3. Sale payments reconciliation.
  const saleRows = db.select().from(sales).where(eq(sales.tenantId, tenantId)).all();
  const paymentRows = db
    .select({
      saleId: salePayments.saleId,
      amount: salePayments.amount,
    })
    .from(salePayments)
    .where(eq(salePayments.tenantId, tenantId))
    .all();
  const paymentsBySale = new Map<string, number[]>();
  for (const row of paymentRows) {
    const bucket = paymentsBySale.get(row.saleId) ?? [];
    bucket.push(row.amount);
    paymentsBySale.set(row.saleId, bucket);
  }

  const returnRows = db.select().from(saleReturns).where(eq(saleReturns.tenantId, tenantId)).all();
  const returnAllocRows = db
    .select({
      saleReturnId: saleReturnPaymentAllocations.saleReturnId,
      amount: saleReturnPaymentAllocations.amount,
    })
    .from(saleReturnPaymentAllocations)
    .where(eq(saleReturnPaymentAllocations.tenantId, tenantId))
    .all();
  const allocSumByReturn = new Map<string, number>();
  for (const alloc of returnAllocRows) {
    allocSumByReturn.set(
      alloc.saleReturnId,
      roundMoney((allocSumByReturn.get(alloc.saleReturnId) ?? 0) + alloc.amount)
    );
  }

  const returnedSumBySale = new Map<string, number>();
  for (const ret of returnRows) {
    if (ret.refundAmount <= 0) {
      failures.push(`sale_return ${ret.id} has non-positive refundAmount=${ret.refundAmount}`);
    }
    const allocSum = allocSumByReturn.get(ret.id);
    if (allocSum !== undefined && !moneyClose(allocSum, ret.refundAmount)) {
      failures.push(
        `sale_return ${ret.id} allocations sum ${allocSum} !== refundAmount ${ret.refundAmount}`
      );
    }
    returnedSumBySale.set(
      ret.saleId,
      roundMoney((returnedSumBySale.get(ret.saleId) ?? 0) + ret.refundAmount)
    );
  }

  for (const sale of saleRows) {
    if (sale.status !== 'completed' && sale.status !== 'voided') continue;

    const recomputedTotal = roundMoney(
      sale.subtotal -
        sale.discountAmount +
        sale.taxAmount +
        sale.tipAmount +
        sale.serviceChargeAmount +
        sale.roundingAdjustment
    );
    if (!moneyClose(sale.total, recomputedTotal)) {
      failures.push(
        `sale ${sale.saleNumber} (${sale.id}) total=${sale.total} !== recomputed ${recomputedTotal}`
      );
    }

    const tenders = paymentsBySale.get(sale.id);
    if (sale.status === 'completed' && tenders && tenders.length > 0) {
      const tenderSum = roundMoney(tenders.reduce((acc, value) => acc + value, 0));
      if (!moneyClose(tenderSum, sale.total)) {
        failures.push(
          `sale ${sale.saleNumber} (${sale.id}) sale_payments sum=${tenderSum} !== total=${sale.total}`
        );
      }
    }

    // 4. Return state & over-refund guard.
    const totalReturned = roundMoney(returnedSumBySale.get(sale.id) ?? 0);
    if (totalReturned > roundMoney(sale.total + MONEY_EPSILON)) {
      failures.push(
        `sale ${sale.saleNumber} over-refunded: returned=${totalReturned} > total=${sale.total}`
      );
    }
    if (sale.status === 'completed') {
      const expectedReturnState =
        totalReturned <= MONEY_EPSILON
          ? null
          : totalReturned >= roundMoney(sale.total - MONEY_EPSILON)
            ? 'refunded'
            : 'partially_refunded';
      if (sale.returnState !== expectedReturnState) {
        failures.push(
          `sale ${sale.saleNumber} returnState=${String(sale.returnState)} !== expected ${String(expectedReturnState)} (returned=${totalReturned}, total=${sale.total})`
        );
      }
    }
  }

  // 5. Cash sessions expected balance & closed over/short reconciliation.
  const sessionRows = db
    .select()
    .from(cashSessions)
    .where(eq(cashSessions.tenantId, tenantId))
    .all();
  const movementRows = db
    .select()
    .from(cashMovements)
    .where(eq(cashMovements.tenantId, tenantId))
    .all();
  const movementsBySession = new Map<string, typeof movementRows>();
  for (const mv of movementRows) {
    const bucket = movementsBySession.get(mv.sessionId) ?? [];
    bucket.push(mv);
    movementsBySession.set(mv.sessionId, bucket);
  }
  for (const session of sessionRows) {
    const sessionMovements = movementsBySession.get(session.id) ?? [];
    const signedDelta = sessionMovements.reduce(
      (sum, mv) => roundMoney(sum + getCashMovementSignedAmount(mv.type, mv.amount)),
      0
    );
    const recomputedExpected = roundMoney(session.openingFloat + signedDelta);
    if (!moneyClose(session.expectedBalance, recomputedExpected)) {
      failures.push(
        `cash_session ${session.id} expectedBalance=${session.expectedBalance} !== opening(${session.openingFloat}) + movements(${signedDelta}) = ${recomputedExpected}`
      );
    }
    if (session.status === 'closed') {
      if (session.actualCount === null) {
        failures.push(`closed cash_session ${session.id} is missing actualCount`);
      } else {
        const expectedOverShort = roundMoney(session.actualCount - session.expectedBalance);
        if (session.overShort === null || !moneyClose(session.overShort, expectedOverShort)) {
          failures.push(
            `closed cash_session ${session.id} overShort=${String(session.overShort)} !== actual(${session.actualCount}) - expected(${session.expectedBalance}) = ${expectedOverShort}`
          );
        }
      }
    }
  }

  // 6. Inventory balances per site vs aggregate stock totals.
  const balanceRows = db
    .select()
    .from(inventoryBalances)
    .where(eq(inventoryBalances.tenantId, tenantId))
    .all();
  const sumByProduct = new Map<string, number>();
  for (const bal of balanceRows) {
    if (!options.allowNegativeStock && bal.onHand < -QUANTITY_EPSILON) {
      failures.push(
        `inventory_balances (${bal.siteId}/${bal.productId}) has negative onHand=${bal.onHand}`
      );
    }
    sumByProduct.set(bal.productId, (sumByProduct.get(bal.productId) ?? 0) + bal.onHand);
  }
  const productIds = [...sumByProduct.keys()];
  const aggregateTotals = getProductStockTotals(db, tenantId, productIds);
  for (const productId of productIds) {
    const fromRows = sumByProduct.get(productId) ?? 0;
    const fromService = aggregateTotals.get(productId) ?? 0;
    if (Math.abs(fromRows - fromService) > QUANTITY_EPSILON) {
      failures.push(
        `product ${productId} balance sum=${fromRows} !== getProductStockTotals=${fromService}`
      );
    }
  }
  if (options.expectedStockByProductId) {
    for (const [productId, expectedQty] of Object.entries(options.expectedStockByProductId)) {
      const actualQty = sumByProduct.get(productId) ?? 0;
      if (Math.abs(actualQty - expectedQty) > QUANTITY_EPSILON) {
        failures.push(`product ${productId} total stock=${actualQty} !== expected ${expectedQty}`);
      }
    }
  }

  // 7. Store credit, loyalty, and customer receivable ledgers.
  const storeCreditAccs = db
    .select()
    .from(storeCreditAccounts)
    .where(eq(storeCreditAccounts.tenantId, tenantId))
    .all();
  for (const acc of storeCreditAccs) {
    const mvSum =
      db
        .select({ total: sql<number>`coalesce(sum(${storeCreditMovements.amount}), 0)` })
        .from(storeCreditMovements)
        .where(
          and(
            eq(storeCreditMovements.tenantId, tenantId),
            eq(storeCreditMovements.accountId, acc.id)
          )
        )
        .get()?.total ?? 0;
    if (!moneyClose(acc.balance, mvSum)) {
      failures.push(
        `store_credit_account ${acc.id} balance=${acc.balance} !== movements sum=${mvSum}`
      );
    }
    if (acc.balance < -MONEY_EPSILON) {
      failures.push(`store_credit_account ${acc.id} has negative balance=${acc.balance}`);
    }
  }

  const loyaltyAccs = db
    .select()
    .from(loyaltyAccounts)
    .where(eq(loyaltyAccounts.tenantId, tenantId))
    .all();
  for (const acc of loyaltyAccs) {
    const ptsSum =
      db
        .select({ total: sql<number>`coalesce(sum(${loyaltyMovements.points}), 0)` })
        .from(loyaltyMovements)
        .where(and(eq(loyaltyMovements.tenantId, tenantId), eq(loyaltyMovements.accountId, acc.id)))
        .get()?.total ?? 0;
    if (acc.points !== ptsSum) {
      failures.push(`loyalty_account ${acc.id} points=${acc.points} !== movements sum=${ptsSum}`);
    }
    if (acc.points < 0) {
      failures.push(`loyalty_account ${acc.id} has negative points=${acc.points}`);
    }
  }

  if (options.expectedCustomerBalanceById) {
    for (const [customerId, expectedBalance] of Object.entries(
      options.expectedCustomerBalanceById
    )) {
      const actualBalance =
        db
          .select({ total: sql<number>`coalesce(sum(${customerLedgerEntries.amount}), 0)` })
          .from(customerLedgerEntries)
          .where(
            and(
              eq(customerLedgerEntries.tenantId, tenantId),
              eq(customerLedgerEntries.customerId, customerId)
            )
          )
          .get()?.total ?? 0;
      if (!moneyClose(actualBalance, expectedBalance)) {
        failures.push(
          `customer ${customerId} ledger balance=${actualBalance} !== expected ${expectedBalance}`
        );
      }
    }
  }

  // 8. Cryptographic audit hash chain & optional day-close reconciliation.
  const auditChain = await verifyAuditChain(db, tenantId);
  if (!auditChain.valid) {
    failures.push(`audit chain invalid: ${auditChain.reason ?? 'unknown'}`);
  }

  let dayCloseReconciled = false;
  if (options.businessDate) {
    const locale = await resolveTenantLocale(db, tenantId);
    const { startIso, endExclusiveIso } = resolveUtcDayWindow(
      options.businessDate,
      locale.timezone
    );
    const report = await computeComprehensiveDayCloseReport(db, {
      tenantId,
      date: options.businessDate,
      ...(options.now ? { now: options.now } : {}),
    });
    const occurredAt = sql<string>`coalesce(${sales.checkoutCompletedAt}, ${sales.createdAt})`;
    const rawGross = db
      .select({
        count: sql<number>`count(*)`,
        total: sql<number>`coalesce(sum(${sales.total}), 0)`,
      })
      .from(sales)
      .where(
        and(
          eq(sales.tenantId, tenantId),
          inArray(sales.status, ['completed', 'voided']),
          gte(occurredAt, startIso),
          lt(occurredAt, endExclusiveIso)
        )
      )
      .get();
    const rawRefunds =
      db
        .select({ total: sql<number>`coalesce(sum(${saleReturns.refundAmount}), 0)` })
        .from(saleReturns)
        .where(
          and(
            eq(saleReturns.tenantId, tenantId),
            gte(saleReturns.createdAt, startIso),
            lt(saleReturns.createdAt, endExclusiveIso)
          )
        )
        .get()?.total ?? 0;
    const rawVoids =
      db
        .select({ total: sql<number>`coalesce(sum(${sales.total}), 0)` })
        .from(auditLogs)
        .leftJoin(sales, and(eq(auditLogs.resourceId, sales.id), eq(sales.tenantId, tenantId)))
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.action, 'sale.void'),
            gte(auditLogs.createdAt, startIso),
            lt(auditLogs.createdAt, endExclusiveIso)
          )
        )
        .get()?.total ?? 0;

    if (report.sales.count !== (rawGross?.count ?? 0)) {
      failures.push(
        `dayClose(${options.businessDate}) sales.count=${report.sales.count} !== raw SQL ${rawGross?.count ?? 0}`
      );
    }
    if (!moneyClose(report.sales.grossRevenue, rawGross?.total ?? 0)) {
      failures.push(
        `dayClose(${options.businessDate}) grossRevenue=${report.sales.grossRevenue} !== raw SQL ${rawGross?.total ?? 0}`
      );
    }
    if (!moneyClose(report.sales.refundAmount, rawRefunds)) {
      failures.push(
        `dayClose(${options.businessDate}) refundAmount=${report.sales.refundAmount} !== raw refunds ${rawRefunds}`
      );
    }
    const expectedNet = roundMoney(report.sales.grossRevenue - rawRefunds - rawVoids);
    if (!moneyClose(report.sales.netRevenue, expectedNet)) {
      failures.push(
        `dayClose(${options.businessDate}) netRevenue=${report.sales.netRevenue} !== gross(${report.sales.grossRevenue}) - refunds(${rawRefunds}) - voids(${rawVoids}) = ${expectedNet}`
      );
    }
    dayCloseReconciled = true;
  }

  if (failures.length > 0) {
    throw new Error(
      `Tenant DB consistency audit failed (${failures.length} violation(s)):\n- ${failures.join('\n- ')}`
    );
  }

  return {
    foreignKeyViolations: fkRows.length,
    integrityCheck,
    salesChecked: saleRows.length,
    returnsChecked: returnRows.length,
    cashSessionsChecked: sessionRows.length,
    productsChecked: productIds.length,
    storeCreditAccountsChecked: storeCreditAccs.length,
    loyaltyAccountsChecked: loyaltyAccs.length,
    auditChainValid: auditChain.valid,
    auditChainCheckedCount: auditChain.checkedCount,
    dayCloseReconciled,
  };
}
