/**
 * Inventory tRPC Router
 *
 * Inventory movement tracking and stock management with tenant isolation.
 *
 * Procedures:
 * - inventory.listEntries     (tenant) - List initial/physical inventory entries
 * - inventory.listMovements   (tenant) - List inventory movements
 * - inventory.listStock       (tenant) - List stock balances + valuation summary
 * - inventory.getMovement     (tenant) - Get a single movement
 * - inventory.recordEntry     (tenant) - Record an initial/physical entry + update stock (transaction)
 * - inventory.createMovement  (tenant) - Create movement + update product stock (transaction)
 * - inventory.adjustStock     (tenant, admin) - Set absolute stock level
 * - inventory.listBalancesBySite (tenant) - Per-site on-hand balances
 * - inventory.productStock    (tenant) - Get current stock for a product
 * - inventory.reconcileBalances (tenant, admin) - Recompute products.stock from balances
 *
 * ENG-178 — decomposed into per-concern record modules (queries / mutations) +
 * a `helpers.ts` leaf. This barrel re-assembles the flat router so every path
 * (`inventory.listEntries` … `inventory.reconcileBalances`) is preserved.
 *
 * @module trpc/routers/inventory
 */
import { router } from '../../init.js';
import { inventoryQueryProcedures } from './queries.js';
import { inventoryMutationProcedures } from './mutations.js';

export const inventoryRouter = router({
  ...inventoryQueryProcedures,
  ...inventoryMutationProcedures,
});
