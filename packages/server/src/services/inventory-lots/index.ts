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
export {
  listLotsForProduct,
  listExpiringLots,
  type LotRow,
  type ExpiringLotRow,
} from './queries.js';
export {
  consumeLotsForSaleLine,
  restoreLotsForSale,
  type ConsumeLotsForSaleLineInput,
  type ConsumeLotsResult,
  type RestoreLotsForSaleInput,
} from './consume-for-sale.js';
export { enqueueInventoryLotUpdatesForSale } from './enqueue-updates.js';
