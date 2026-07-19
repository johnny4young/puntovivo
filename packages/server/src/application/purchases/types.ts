/**
 * Purchase use-case types.
 *
 * ENG-178 — extracted from the former monolithic `trpc/routers/purchases.ts`
 * during the megafile decomposition. The purchase logic moved into this
 * `application/purchases/` layer (mirroring `application/sales/`), leaving the
 * router thin. Behavior is unchanged.
 *
 * @module application/purchases/types
 */
import type { DatabaseInstance } from '../../db/index.js';
import type { CreatePurchaseInput } from '../../trpc/schemas/purchases.js';

/**
 * Minimal structural subset of the tRPC `Context` that the purchase
 * use-cases consume — mirrors `application/sales`'s `CompleteSaleContext`
 * so the application layer does not depend on the tRPC context type.
 *
 * - `siteId` is nullable: a purchase tolerates a missing active site and
 *   falls back to the tenant's first active purchase sequential's site
 *   (see `getPurchaseSequentialContext` / `getPurchaseSiteContext`).
 * - `envelope` / `deviceId` are optional and structurally compatible with
 *   `enqueueSync`'s `EnqueueSyncContext`; the purchase procedures run on the
 *   plain manager/admin guards (no command-envelope middleware), so they are
 *   normally absent — `enqueueSync` reads them defensively.
 */
export interface PurchaseContext {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string | null;
  user: { id: string; role: string };
  envelope?: { operationId: string; idempotencyKey?: string } | null;
  deviceId?: string | null;
}

export type ResolvedPurchaseItem = {
  id: string;
  productId: string;
  quantity: number;
  unitId: string;
  unitEquivalence: number;
  costPerUnit: number;
  baseUnitCost: number;
  total: number;
  normalizedQuantity: number;
  tracksSerials: boolean;
  serialNumbers: string[];
};

export type ResolvedPurchaseReturnItem = {
  id: string;
  purchaseItemId: string;
  productId: string;
  quantity: number;
  unitId: string;
  unitEquivalence: number;
  costPerUnit: number;
  baseUnitCost: number;
  total: number;
  normalizedQuantity: number;
  tracksSerials: boolean;
  serialIds: string[];
};

export type PurchaseSequentialContext = {
  id: string;
  prefix: string;
  currentValue: number;
  siteId: string;
  siteName: string;
};

export type PurchaseSiteContext = {
  id: string;
  name: string;
};

export interface CreateOcrDraftPurchaseInput {
  providerId: string;
  items: CreatePurchaseInput['items'];
  notes?: string | null;
}

export type ResolvedOrderReceiptItem = ResolvedPurchaseItem & {
  sourceOrderItemId: string;
};
