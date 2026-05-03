/**
 * ENG-052b — MEGA seed orchestrator.
 *
 * Runs AFTER the default seed has populated the foundation (tenant,
 * sites, users, products, customers, sequentials, etc.). Layers on
 * top:
 *
 * 1. 90-day cash session ledger + cash movements (bulk SQL).
 * 2. ~salesPerActiveDay sales per closed session, with refunds + voids.
 * 3. Purchases + supplier returns distributed across the period.
 * 4. Inter-site transfers (mostly completed, a couple in_transit).
 * 5. Quotations across all 5 states.
 * 6. Purchase orders pending + completed.
 * 7. Suspended drafts (0-7 days old).
 * 8. Sync queue + sync conflicts (resolved + unresolved).
 * 9. AI audit log + anomaly snoozes.
 * 10. Login attempts (failed + successful).
 * 11. Misc: company logo, category↔provider matrix.
 * 12. Last 3 days driven via the live `appRouter.createCaller()`
 *     critical-procedure path so the envelope plumbing is exercised
 *     end-to-end (idempotency_keys + fiscal_documents emission).
 *
 * Dates are anchored on `Date.now()` at seed start — re-running the
 * mega seed any future day produces a fresh 90-day window centered
 * on the new "today".
 *
 * @module db/seed-mega
 */

import { eq } from 'drizzle-orm';
import {
  customers as customersTable,
  products as productsTable,
  providers as providersTable,
  sites as sitesTable,
  unitXProduct,
  users as usersTable,
  vatRates as vatRatesTable,
} from '../schema.js';
import type { DatabaseInstance } from '../index.js';
import { createModuleLogger } from '../../logging/logger.js';
import { registerDevice as registerDeviceService } from '../../services/devices/devicesService.js';
import { seedHistoricalCash } from './historical-cash.js';
import { seedHistoricalSales } from './historical-sales.js';
import { seedHistoricalPurchases } from './historical-purchases.js';
import { seedHistoricalTransfers } from './historical-transfers.js';
import { seedHistoricalQuotations } from './historical-quotations.js';
import { seedHistoricalOrders } from './historical-orders.js';
import { seedHistoricalDrafts } from './historical-drafts.js';
import { seedHistoricalSync } from './historical-sync.js';
import { seedHistoricalAI } from './historical-ai.js';
import { seedHistoricalAuth } from './historical-auth.js';
import { seedHistoricalMisc } from './historical-misc.js';
import { seedRecentViaTrpc } from './recent-via-trpc.js';
import { makeSeedClock } from './time-helpers.js';
import { MEGA_TARGET, type MegaContext, type MegaCounts, type MegaProduct } from './types.js';

const log = createModuleLogger('seed-mega');

export interface SeedMegaInput {
  db: DatabaseInstance;
  tenantId: string;
  companyId: string;
  /** Admin user id for system-flavored events. */
  adminUserId: string;
}

export async function seedMegaData(input: SeedMegaInput): Promise<MegaCounts> {
  const { db, tenantId, companyId, adminUserId } = input;
  const clock = makeSeedClock();

  log.info({ tenantId, anchor: clock.nowIso }, 'mega seed: gathering foundation rows');

  // ----- Pull foundation rows -----
  const [
    tenantSites,
    tenantUsers,
    tenantProducts,
    tenantCustomers,
    tenantProviders,
    tenantVatRates,
    productUnitMap,
  ] = await Promise.all([
    db.select({ id: sitesTable.id, name: sitesTable.name }).from(sitesTable).where(eq(sitesTable.tenantId, tenantId)).all(),
    db.select({ id: usersTable.id, email: usersTable.email, name: usersTable.name, role: usersTable.role }).from(usersTable).where(eq(usersTable.tenantId, tenantId)).all(),
    db.select({
      id: productsTable.id,
      sku: productsTable.sku,
      cost: productsTable.cost,
      price: productsTable.price,
      taxRate: productsTable.taxRate,
      stock: productsTable.stock,
    }).from(productsTable).where(eq(productsTable.tenantId, tenantId)).all(),
    db.select({ id: customersTable.id, name: customersTable.name }).from(customersTable).where(eq(customersTable.tenantId, tenantId)).all(),
    db.select({ id: providersTable.id }).from(providersTable).where(eq(providersTable.tenantId, tenantId)).all(),
    db.select({ id: vatRatesTable.id, name: vatRatesTable.name, rate: vatRatesTable.rate }).from(vatRatesTable).where(eq(vatRatesTable.tenantId, tenantId)).all(),
    db.select({ productId: unitXProduct.productId, unitId: unitXProduct.unitId, isBase: unitXProduct.isBase }).from(unitXProduct).all(),
  ]);

  const baseUnitByProduct = new Map<string, string>();
  for (const row of productUnitMap) {
    if (row.isBase) baseUnitByProduct.set(row.productId, row.unitId);
  }

  const products: MegaProduct[] = tenantProducts
    .filter(p => baseUnitByProduct.has(p.id))
    .map(p => ({
      id: p.id,
      sku: p.sku,
      baseUnitId: baseUnitByProduct.get(p.id)!,
      cost: p.cost ?? 0,
      price: p.price ?? 0,
      taxRate: p.taxRate ?? 0,
      initialStock: p.stock ?? 0,
    }));

  const cashiers = tenantUsers.filter(u => u.role === 'cashier');
  const managers = tenantUsers.filter(u => u.role === 'manager');
  const defaultVat = tenantVatRates.find(v => v.name === 'IVA 19%') ?? tenantVatRates[0];

  const ctx: MegaContext = {
    db,
    clock,
    tenantId,
    companyId,
    adminUserId,
    sites: tenantSites,
    cashiers: cashiers.map(c => ({
      id: c.id,
      email: c.email,
      name: c.name,
      role: 'cashier',
    })),
    managers: managers.map(m => ({
      id: m.id,
      email: m.email,
      name: m.name,
      role: 'manager',
    })),
    products,
    customers: tenantCustomers,
    providerIds: tenantProviders.map(p => p.id),
    defaultVatRateId: defaultVat?.id ?? '',
    nowIso: clock.nowIso,
  };

  // ----- Run each historical layer -----
  log.info('mega seed: historical cash');
  const cashResult = await seedHistoricalCash(ctx, MEGA_TARGET);

  log.info('mega seed: historical sales');
  const salesResult = await seedHistoricalSales(ctx, MEGA_TARGET, cashResult.closed);

  log.info('mega seed: historical purchases');
  const purchasesResult = await seedHistoricalPurchases(ctx, MEGA_TARGET);

  log.info('mega seed: historical transfers');
  const transfersResult = await seedHistoricalTransfers(ctx, MEGA_TARGET);

  log.info('mega seed: historical quotations');
  const quotationsResult = await seedHistoricalQuotations(ctx, MEGA_TARGET);

  log.info('mega seed: historical orders');
  const ordersResult = await seedHistoricalOrders(ctx, MEGA_TARGET);

  log.info('mega seed: suspended drafts');
  const draftsResult = await seedHistoricalDrafts(ctx, MEGA_TARGET, cashResult.open);

  log.info('mega seed: sync queue + conflicts');
  const syncResult = await seedHistoricalSync(ctx, MEGA_TARGET);

  log.info('mega seed: AI audit + snoozes');
  const aiResult = await seedHistoricalAI(ctx, MEGA_TARGET);

  log.info('mega seed: login attempts');
  const authResult = await seedHistoricalAuth(ctx, MEGA_TARGET);

  log.info('mega seed: misc (logos + categoryXProvider)');
  const miscResult = await seedHistoricalMisc(ctx);

  // ----- Recent via tRPC envelope path -----
  log.info('mega seed: recent sales via tRPC envelope path');
  const recentDevice = await registerDeviceService(db, {
    tenantId,
    userId: adminUserId,
    kind: 'web',
    name: 'puntovivo-seed-mega-recent',
  });
  const recentResult = await seedRecentViaTrpc(ctx, recentDevice.deviceId, cashResult.open);

  const counts: MegaCounts = {
    historicalCashSessions: cashResult.closed.length + cashResult.open.length,
    historicalSales: salesResult.salesCount + recentResult.salesCreated,
    refunds: salesResult.refundsCount,
    voids: salesResult.voidsCount,
    suspendedDrafts: draftsResult.count,
    cashMovements: cashResult.cashMovementsCount,
    inventoryMovements:
      salesResult.inventoryMovementsCount +
      purchasesResult.inventoryMovementsCount +
      transfersResult.inventoryMovementsCount +
      draftsResult.inventoryMovementsCount,
    purchases: purchasesResult.purchasesCount,
    purchaseReturns: purchasesResult.returnsCount,
    transfers: transfersResult.count,
    quotations: quotationsResult.count,
    orders: ordersResult.count,
    auditLogs: salesResult.auditRowsCount,
    syncQueueRows: syncResult.syncQueueRows,
    syncConflicts: syncResult.syncConflictsRows,
    loginAttempts: authResult.count,
    aiAuditLog: aiResult.aiAuditCount,
    aiAnomalySnoozes: aiResult.snoozesCount,
    categoryXProvider: miscResult.categoryProviderLinksCount,
    logos: miscResult.logosCount,
  };

  log.info({ counts }, 'mega seed complete');
  return counts;
}
