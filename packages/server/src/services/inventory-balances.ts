/**
 * Service helpers for Phase 2 DB-101 / API-101 — per-site inventory balances.
 *
 * Thin re-export barrel. ENG-178 Slice 20 decomposed the original 553-LOC
 * service into per-concern modules under `inventory-balances/`; this file
 * keeps the public surface stable so every importer resolves through
 * `services/inventory-balances.js` unchanged.
 */
export type {
  InventoryBalanceListItem,
  InventoryBalancesSummary,
  InventoryDiscrepancyRow,
} from './inventory-balances/types.js';
export { getPrimarySiteId } from './inventory-balances/helpers.js';
export {
  ensureInventoryBalancesForSite,
  ensurePrimaryInventoryBalanceSnapshot,
} from './inventory-balances/seed.js';
export {
  applyInventoryBalanceDelta,
  syncProductStockFromBalances,
} from './inventory-balances/apply-delta.js';
export { reconcileProductStockFromBalances } from './inventory-balances/reconcile.js';
export {
  listInventoryBalancesBySite,
  listInventoryDiscrepancyCandidates,
  summarizeInventoryBalances,
} from './inventory-balances/queries.js';
