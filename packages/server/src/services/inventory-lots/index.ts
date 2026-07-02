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
export {
  receiveInventoryLot,
  type ReceiveLotInput,
  type ReceiveLotResult,
} from './receive.js';
export {
  listLotsForProduct,
  listExpiringLots,
  type LotRow,
  type ExpiringLotRow,
} from './queries.js';
