/**
 * Shared types passed across the MEGA seed helpers.
 *
 * The orchestrator (`index.ts`) gathers the foundation rows from the
 * default seed (tenant, sites, users, products, customers) and hands
 * them to each helper as a `MegaContext`. Helpers then bulk-insert
 * historical / extra data without re-querying the foundation.
 *
 * @module db/seed-mega/types
 */

import type { DatabaseInstance } from '../index.js';
import type { SeedClock } from './time-helpers.js';

export interface MegaUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'cashier' | 'viewer';
}

export interface MegaSite {
  id: string;
  name: string;
}

export interface MegaProduct {
  id: string;
  sku: string;
  baseUnitId: string;
  cost: number;
  price: number;
  taxRate: number;
  initialStock: number;
}

export interface MegaCustomer {
  id: string;
  name: string;
}

export interface MegaContext {
  db: DatabaseInstance;
  clock: SeedClock;
  tenantId: string;
  companyId: string;
  /** Admin-role user id; used as fallback actor for system-flavored events. */
  adminUserId: string;
  /** Active sites (3 in MEGA preset). */
  sites: MegaSite[];
  /** Cashier users available for distribution across sites. */
  cashiers: MegaUser[];
  /** Manager users (used for refunds + voids). */
  managers: MegaUser[];
  /** Inventory-eligible products (initialStock > 0 in foundation). */
  products: MegaProduct[];
  /** Customers excluding walk-in (which is null at the table level). */
  customers: MegaCustomer[];
  /** Provider ids for purchase / supplier flows. */
  providerIds: string[];
  /** Active VAT rate (most common 19%). */
  defaultVatRateId: string;
  /** ISO timestamp at seed start — the "now" anchor. */
  nowIso: string;
}

export interface MegaTarget {
  historicalDays: number;
  salesPerActiveDay: number;
  cashierActivityRate: number;
  refundRate: number;
  voidRate: number;
  suspendedDrafts: number;
  purchasesPerSitePerWeek: number;
  transfersPerWeek: number;
  quotationsPerWeek: number;
  stockAdjustmentsPerWeek: number;
  cashMovementsPerSession: number;
  ordersPending: number;
  ordersCompleted: number;
  syncConflictsUnresolved: number;
  syncConflictsResolved: number;
  syncOutboxPending: number;
  loginAttemptsFailed: number;
  loginAttemptsSuccess: number;
  aiAuditLogEntries: number;
  aiAnomalySnoozes: number;
  productsTarget: number;
  customersTarget: number;
  categoriesTarget: number;
  providersTarget: number;
  sitesTarget: number;
  cashiersTarget: number;
  managersTarget: number;
}

/** Single source of truth for MEGA volume. Tweak here, regenerate. */
export const MEGA_TARGET: MegaTarget = {
  // Histórico — relative to seed clock
  historicalDays: 95,
  salesPerActiveDay: 6,
  cashierActivityRate: 0.7,
  refundRate: 0.1,
  voidRate: 0.05,
  suspendedDrafts: 12,

  // Flow secundario per-week
  purchasesPerSitePerWeek: 1.5,
  transfersPerWeek: 2,
  quotationsPerWeek: 4,
  stockAdjustmentsPerWeek: 1,
  cashMovementsPerSession: 1.5,

  // Lista plana de extras
  ordersPending: 8,
  ordersCompleted: 4,
  syncConflictsUnresolved: 2,
  syncConflictsResolved: 2,
  syncOutboxPending: 5,
  loginAttemptsFailed: 5,
  loginAttemptsSuccess: 3,
  aiAuditLogEntries: 12,
  aiAnomalySnoozes: 3,

  // Estructura
  productsTarget: 150,
  customersTarget: 80,
  categoriesTarget: 12,
  providersTarget: 15,
  sitesTarget: 3,
  cashiersTarget: 5,
  managersTarget: 2,
};

export interface MegaCounts {
  historicalCashSessions: number;
  historicalSales: number;
  refunds: number;
  voids: number;
  suspendedDrafts: number;
  cashMovements: number;
  inventoryMovements: number;
  purchases: number;
  purchaseReturns: number;
  transfers: number;
  quotations: number;
  orders: number;
  auditLogs: number;
  syncOutboxRows: number;
  syncConflicts: number;
  loginAttempts: number;
  aiAuditLog: number;
  aiAnomalySnoozes: number;
  categoryXProvider: number;
  logos: number;
}
