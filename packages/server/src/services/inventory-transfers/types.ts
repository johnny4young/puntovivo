/**
 * Inventory-transfer public types.
 *
 * extracted verbatim from the former flat
 * `services/inventory-transfers.ts` during the megafile decomposition.
 * Pure type declarations (no runtime imports beyond the shared
 * `TransferOrderStatus` enum), so every other module in the package can
 * depend on this leaf without a cycle.
 *
 * @module services/inventory-transfers/types
 */
import type { TransferOrderStatus } from '../../db/schema.js';
import type { EnqueueSyncContext } from '../sync/enqueue.js';

export interface TransferItemInput {
  productId: string;
  quantity: number;
  serialIds?: readonly string[] | undefined;
}

export interface CreateTransferArgs {
  tenantId: string;
  fromSiteId: string;
  toSiteId: string;
  items: readonly TransferItemInput[];
  notes?: string | null;
  createdBy: string;
  /**
   * When true, the transfer is persisted with status `in_transit`: origin
   * is debited but destination is NOT credited yet. Call `receiveInventoryTransfer`
   * later to flip the transfer to `completed` and credit the destination.
   * Defaults to false (immediate completion — legacy step-1 behaviour).
   */
  defer?: boolean;
  syncContext?: EnqueueSyncContext | undefined;
}

export interface CreatedTransfer {
  id: string;
  status: TransferOrderStatus;
  fromSiteId: string;
  toSiteId: string;
  notes: string | null;
  createdAt: string;
  createdBy: string;
  items: Array<{
    id: string;
    productId: string;
    productName: string;
    productSku: string;
    quantity: number;
  }>;
}

export interface VoidTransferArgs {
  tenantId: string;
  transferId: string;
  reason?: string | null;
  voidedBy: string;
  syncContext?: EnqueueSyncContext | undefined;
}

export interface VoidedTransfer {
  id: string;
  status: TransferOrderStatus;
  fromSiteId: string;
  toSiteId: string;
  voidedAt: string;
  voidedBy: string;
  reversedItems: Array<{ productId: string; quantity: number }>;
}

export interface ReceiveTransferLine {
  /** `transfer_order_items.id` of the line being received. */
  itemId: string;
  receivedQuantity: number;
}

export interface ReceiveTransferArgs {
  tenantId: string;
  transferId: string;
  receivedBy: string;
  /**
   * . Optional per-line received quantities keyed by
   * `transfer_order_items.id`. When omitted or empty, every line is credited
   * at its shipped quantity (legacy one-click receive behaviour). When
   * supplied, unknown ids or `received > shipped` are rejected.
   */
  // explicit `| undefined` on Zod-optional fields.
  lines?: readonly ReceiveTransferLine[] | undefined;
  /** Optional receiver-side note captured when variance is present. */
  discrepancyNotes?: string | null | undefined;
  syncContext?: EnqueueSyncContext | undefined;
}

export interface ReceivedTransfer {
  id: string;
  status: TransferOrderStatus;
  fromSiteId: string;
  toSiteId: string;
  receivedAt: string;
  receivedBy: string;
  /**
   * `quantity` here is the received quantity — the amount credited to the
   * destination. Callers that need the shipped quantity should read it from
   * `transfers.getById`.
   */
  receivedItems: Array<{ productId: string; quantity: number }>;
  /** True when any line's received quantity diverged from the shipped one. */
  hasDiscrepancy: boolean;
  discrepancyNotes: string | null;
}

export interface TransferHistoryEntry {
  id: string;
  status: TransferOrderStatus;
  fromSiteId: string;
  fromSiteName: string;
  toSiteId: string;
  toSiteName: string;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  receivedAt: string | null;
  receivedBy: string | null;
  itemCount: number;
  totalQuantity: number;
  /**
   * . True when any line's received quantity diverges from the
   * shipped quantity. Null-safe against legacy rows (received_quantity is
   * null until the line is actually received).
   */
  hasDiscrepancy: boolean;
  discrepancyNotes: string | null;
}

export interface TransferDetailLine {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  /** . Null until the transfer is received. */
  receivedQuantity: number | null;
  tracksSerials: boolean;
  serials: Array<{ id: string; serialNumber: string }>;
}

export interface TransferDetail {
  id: string;
  status: TransferOrderStatus;
  fromSiteId: string;
  fromSiteName: string;
  toSiteId: string;
  toSiteName: string;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  receivedAt: string | null;
  receivedBy: string | null;
  updatedAt: string;
  items: TransferDetailLine[];
  /** . */
  hasDiscrepancy: boolean;
  discrepancyNotes: string | null;
}
