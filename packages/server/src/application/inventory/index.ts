/** Inventory stock mutation use-case boundary. */
export { adjustInventoryStock } from './adjustInventoryStock.js';
export { createInventoryMovement } from './createInventoryMovement.js';
export { createInventoryTransfer } from './createInventoryTransfer.js';
export { receiveInventoryTransfer } from './receiveInventoryTransfer.js';
export { recordInventoryEntry } from './recordInventoryEntry.js';
export { voidInventoryTransfer } from './voidInventoryTransfer.js';
export type { CriticalInventoryContext, InventoryContext, InventoryLogger } from './types.js';
