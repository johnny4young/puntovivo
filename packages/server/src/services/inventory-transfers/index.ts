/**
 * Inventory transfers — multi-site stock movement service.
 *
 * ENG-178 — this barrel preserves the public surface of the former flat
 * `services/inventory-transfers.ts` (1146 LOC), decomposed into per-concern
 * modules during the megafile wave. Behavior is unchanged; only the file
 * layout moved. The sole importer (`trpc/routers/transfers.ts`) keeps
 * importing the five operations from here.
 *
 * Phase 2 DB-102 / API-102 — a transfer atomically decreases
 * `inventory_balances.on_hand` at the origin site and increases it at the
 * destination for one or more products, persisting an audit row in
 * `transfer_orders` (+ line items). Lifecycle: `in_transit` (deferred,
 * origin debited only) → `completed` (destination credited at receive) or
 * `void` (fully reversed). `inventory_balances` is the single source of
 * truth; the tenant-wide total is derived as Σ(balances) on read.
 *
 * @module services/inventory-transfers
 */
export { createInventoryTransfer } from './create.js';
export { voidInventoryTransfer } from './voidTransfer.js';
export { receiveInventoryTransfer } from './receive.js';
export { getInventoryTransferById, listRecentTransfers } from './queries.js';
export type {
  CreatedTransfer,
  CreateTransferArgs,
  ReceivedTransfer,
  ReceiveTransferArgs,
  ReceiveTransferLine,
  TransferDetail,
  TransferDetailLine,
  TransferHistoryEntry,
  TransferItemInput,
  VoidedTransfer,
  VoidTransferArgs,
} from './types.js';
