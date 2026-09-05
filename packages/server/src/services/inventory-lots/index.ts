/**
 * Inventory lots service (Auditoría 2026-07 — lots, expiry & costing).
 * Public surface barrel.
 *
 * @module services/inventory-lots
 */

export {
  orderLotsFefo,
  selectLotsFefo,
  weightedAverageUnitCost,
  type SelectableLot,
  type LotAllocation,
  type FefoSelection,
} from './select-fefo.js';
export { receiveInventoryLot, type ReceiveLotInput, type ReceiveLotResult } from './receive.js';
export type { InventoryLotStatus } from './receive.js';
export {
  assertLotTrackingMatchesProvenance,
  calculateRestoredInventoryLotState,
  consumeExactInventoryLots,
  restoreExactInventoryLot,
  type ExactLotAllocationInput,
  type ExactLotConsumption,
} from './exact.js';
export {
  listLotsForProduct,
  listExpiringLots,
  type LotRow,
  type ListedLotRow,
  type ExpiringLotRow,
} from './queries.js';
export {
  consumeLotsForSaleLine,
  isLotExpiredAt,
  restoreLotsForSale,
  type ConsumeLotsForSaleLineInput,
  type ConsumeLotsResult,
  type RestoreLotsForSaleInput,
} from './consume-for-sale.js';
export {
  enqueueInventoryLotUpdatesForSale,
  enqueueInventoryLotUpdatesForSaleInTransaction,
  enqueueInventoryLotSnapshotsInTransaction,
} from './enqueue-updates.js';
