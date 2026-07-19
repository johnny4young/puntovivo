/**
 * Inventory transfers — multi-site stock read service and shared types.
 *
 * ENG-178 decomposed the former flat module. ENG-206 promoted the three
 * write orchestrators into `application/inventory/`; this service boundary
 * now exposes only transfer read models and shared public types.
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
