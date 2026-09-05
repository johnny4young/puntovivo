# 0018 — Exact lot procurement and inventory transformations

> Status: Accepted
> Date: 2026-09-01

## Context

A site balance proves only a scalar quantity. It cannot prove which physical
batch arrived from a supplier, which batch left one site, which batch reached
another site, or which inputs produced a transformed output. Updating the
balance while reconstructing lot identity later would break FEFO, returns,
recalls, expiry controls, costing, and exact reversal.

Hardware cuts, butcher yields, assemblies, portions, and prepared products also
share one inventory problem: consume actual inputs, record actual output and
waste, distribute the frozen input cost, and commit every effect or none. A
catalog template cannot provide that transaction boundary because it describes
an unsaved product rather than a physical operation.

## Decision

### Purchase and supplier-return provenance

- A direct purchase or purchase-order receipt for a lot-tracked product must
  provide concrete lot rows whose base quantities equal the received line. Lot
  number, expiry, quantity, and unit cost are frozen in `purchase_item_lots`;
  the corresponding site lot and aggregate balance update in the same command.
- Product tracking, unit equivalence, remaining order quantity, lot evidence,
  and stock snapshots are resolved after the `BEGIN IMMEDIATE` writer
  reservation. Catalog edits and competing receipts therefore cannot change a
  line's meaning between validation and persistence.
- A supplier return selects only frozen lots from the referenced purchase line.
  The sum cannot exceed either that provenance or current exact lot stock.
  `purchase_return_item_lots` freezes what was actually debited. The physical
  lot must still carry the receipt's frozen unit cost; a later different-cost
  receipt cannot be silently removed at the original supplier value while the
  remaining batch keeps a blended valuation.
- Voiding a purchase consumes the entire frozen lot provenance. Missing,
  incomplete, stale, renamed, re-dated, re-costed, expired, quarantined, or
  insufficient identity fails closed rather than falling back to an aggregate
  balance. A later receipt that blends a different cost into the same physical
  lot requires an explicit compensating workflow instead of erasing one layer.
- A supplier return is allowed to move a non-vendable lot out of inventory, but
  it still requires the current number, expiry, and unit cost to match the
  selected purchase receipt snapshot. A stable row ID cannot substitute for
  physical batch identity or valuation provenance.
- Replenishment remains a quantity-planning projection. A lot-tracked shortage
  may create a draft order because concrete identity does not exist until
  receipt; the receipt still cannot complete without a full allocation.
- Physical counts remain different: an aggregate observed quantity cannot
  reconstruct lot or serial identities, so those products stay excluded from
  the blind aggregate-count workflow.

### Physical-site authority and exact restoration

- `inventory_balances` is the physical authority for each tenant, site, and
  product. A missing site row means zero at that site. The tenant-wide rollup
  is valid for reporting and movement snapshots only; it must never seed a
  missing physical row because stock held at another site would be duplicated.
- Every exact-lot custody update in these purchase, transfer, transformation,
  sale, and return paths compares the quantity, unit cost, state, and nullable
  expiry that were read, then requires exactly one row to change. A concurrent
  or legacy identity drift fails closed rather than overwriting the newer
  physical state.
- A normalized partial return or full sale reversal restores the sale-time
  quantity at its frozen sale-time lot cost. If that physical batch received
  more units at another cost after the sale, restoration computes a weighted
  layer cost from the current units plus the returned units. Expiry and
  quarantine remain authoritative, and a missing lot blocks the reversal;
  returning quantity never recreates sellability or invents a replacement lot.
- Transfer arithmetic validates both request aggregation and every stored or
  derived site quantity as finite before persistence. SQLite REAL accepts
  non-finite values, so an overflow or corrupted balance must roll the command
  back with a stable domain error instead of committing unusable movements.

### Inter-site custody

- Shipping a transfer consumes exact source lots and freezes lot number,
  expiry, effective vendability status, quantity, and unit cost in
  `transfer_order_item_lots`.
- Duplicate transfer lines for one product collapse into one stock mutation;
  allocations that split the same source lot are summed by lot identity before
  exact consumption, so the aggregate contract does not manufacture a
  duplicate-lot error.
- An immediate transfer creates or merges the destination lot atomically. A
  deferred transfer keeps custody in transit until receipt, where every shipped
  lot must appear exactly once and received quantity cannot exceed shipped
  quantity. A discrepancy is explicit; it is never silently assigned to a
  different batch. Quantities below the supported operational precision are
  canonical zero, so persisted evidence never claims a positive receipt
  without a destination lot snapshot.
- Destination receipt preserves non-vendable state. Expired or quarantined
  source evidence cannot become active merely because it moved or merged. An
  existing destination batch must carry the same expiry, including the
  distinction between no expiry and a concrete calendar date.
- Exact void freezes the destination lot's previous and resulting quantity,
  cost, state, and the destination balance revision. It restores the prior
  layer only when identity, expiry, quantity, cost, and that monotonic revision
  are still current. A later quarantine or expiry follows the same physical
  units back to the source lot and remains on any residual destination layer;
  any intervening stock, identity, expiry, or cost change rejects reversal,
  including a value-preserving ABA stock sequence.
- When a deferred receipt records a shortage, void returns only the quantity
  that actually arrived. The missing quantity remains shrinkage; reversal never
  recreates units that were not available at the destination.
- Stock, lot, and serial tracking modes cannot change while that product has
  physical custody in transit. Receipt, supplier return, and void also require
  the mutable catalog mode to agree with the frozen line provenance; a
  mismatch fails closed instead of falling back to aggregate stock. Every
  transfer lifecycle command independently rejects stock mutation when the
  current product has become a service through corrupt or legacy state.
- Every transfer outbox row carries the committed header, item rows, exact lot
  snapshots, and serial bridges as one versioned aggregate. Remote or merged
  conflict resolution remains blocked until an inbound codec can apply the
  complete aggregate atomically; local outbound upload remains available.

### Recipes and executions

- A recipe is tenant owned and either global or site scoped. It defines one or
  more unique stock-product inputs and outputs in base quantities. Outputs have
  a positive cost-allocation weight and a role: primary, by-product, or remnant.
  Recipes use optimistic versions and may be deactivated without rewriting
  historical executions.
- Serialized products, services, and variant parents are not valid recipe
  identities. Serial transformations remain unsupported because a quantity
  alone cannot prove which serials were consumed or created.
- An execution must match every frozen recipe line exactly once. It consumes
  current site stock, requires exact sellable-lot allocations when applicable,
  creates a new identity for each lot-tracked output, and freezes actual input,
  output, input-lot number/expiry/status, output-lot identity, cost, role, note,
  actor, and waste evidence.
- Waste describes a subset of input already consumed. It is recorded per
  frozen input row and, for lot-tracked input, per consumed lot. It never posts
  a second stock debit.
- Total input cost is the sum of monetary input rows under the safe-cent
  rounding boundary.
  Lot-tracked inputs freeze the exact physical lot cost; ordinary stock inputs
  freeze the product's inventory-valuation basis (`initialCost`) rather than a
  potentially different merchandising cost field.
  Allocation uses integer cents and the largest fractional remainders in stable
  output order, so every share remains non-negative and total output cost
  equals total input cost even for many low-value outputs. Physical quantities
  retain their independent fractional precision. Transformation allocation and
  lot receipt/restoration also require a finite safe-integer cent
  representation before writing; arithmetic overflow or a value too large to
  preserve exact cents fails closed instead of relying on SQLite REAL, which
  accepts non-finite values.
- Each output freezes both product cost bases before and after posting. The
  ordinary `cost` and inventory-facing `initialCost` are weighted independently
  against the stock that already existed using the exact allocated amount,
  before the separate two-decimal unit-cost representation can introduce a
  residual. They then update together with the product sync revision. Inventory
  list, count, and KPI valuation therefore reflect transformed stock without
  collapsing two catalog fields that may legitimately differ.
- Execution, balances, lot rows, product costs, signed inventory movements,
  audit, sync outbox, canonical replay result, and idempotency completion commit
  in one `BEGIN IMMEDIATE` command.
- Recipe and execution outbox rows are aggregate payloads: they read the
  committed header and every normalized child back inside that transaction,
  including generated identities, resolved lot splits, frozen costs, waste,
  and resulting balance revision. Raw mutation input is never treated as the
  replication snapshot.
- Remote or merged apply of these two aggregate types remains blocked until an
  inbound codec can validate tenant ownership and commit header plus children
  atomically. This does not block outbound upload; it prevents a conflict
  choice from silently accepting an incomplete normalized aggregate.
- A completed execution is immutable. Void is a conservative exact reversal:
  every input lot must still match its frozen product, number, and expiry;
  output balance revision, both resulting product cost bases plus their
  monotonic sync revision, and output-lot identity, expiry, status, quantity,
  and cost must still equal the frozen resulting state. The revision closes
  value-preserving ABA changes.
  Otherwise it fails closed. A successful void removes untouched outputs,
  restores exact input lots and costs, writes compensating movements, and
  preserves the original snapshot plus actor and reason. Database checks also
  enforce header cost conservation, valid void metadata, and complete lot
  snapshot groups.

### Read and UI boundary

- Managers and administrators configure recipes, execute them, inspect exact
  frozen inputs/outputs/waste, and request a guarded void from Inventory.
- Purchase reads expose both the unreturned receipt entitlement and a separate
  returnable quantity at the receiving site. Ordinary items use current site
  stock, serialized items use eligible identities from that purchase, and lot
  items sum still-present frozen receipt batches only while their product,
  site, number, expiry, and rounded cost match the current physical row. Detail
  and return UI use the latter, so consumed, moved, blended, or identity-drifted
  stock is never presented as available merely because it has not already gone
  back to the supplier. This is a read-time
  projection, not a lock: the command re-reads provenance and stock under its
  writer reservation and remains authoritative under concurrent activity. The
  returnable line budget also caps its ordered lot options; status, tracking
  drift, or aggregate-balance divergence therefore cannot leave a positive lot
  allocation beside a zero-returnable parent line. The
  purchase-detail query is immediately stale rather than inheriting the global
  five-minute cache window, so reopening it after another inventory workflow
  performs a new read. Cached content and debit controls remain hidden while
  that read is in flight or when it fails. The live contract keeps an initial
  four-unit detail snapshot resident in the same SPA, consumes the batch in a
  transformation, and reopens it inside that global window; the only acceptable
  result is a fresh zero-unit projection with no return action.
- List reads are bounded and tenant/site scoped. Recipe listing loads headers,
  inputs, and outputs in three grouped queries rather than one query per recipe;
  name search plus an explicit `hasMore` signal prevents the bound from
  silently hiding a recipe in larger catalogs.
- Catalog search is server-backed so a recipe is not limited to the first UI
  page. Execution lot options come from current site lot reads, but the server
  independently revalidates every identity inside the write transaction.

## Consequences

- Purchase, transfer, and transformation evidence can reconcile physical batch
  identity with site and aggregate stock after reload.
- Draft planning does not invent future lots, while receipt cannot erase the
  distinction between planned quantity and physical identity.
- A transformed output carries a defensible frozen input cost without turning
  waste into double consumption, and the inventory valuation remains visible
  after reload instead of retaining the output product's pre-execution value.
- Exact reversals may be unavailable after ordinary downstream activity. The
  operator must use a later explicit compensating workflow rather than
  rewriting historical provenance.
- The engine is an operational inventory foundation, not manufacturing
  planning, forecasting, work-order scheduling, recipe nutrition, regulated
  pharmacy recall policy, or legal production certification.

## Alternatives rejected

- **Store only aggregate purchase or transfer quantity:** loses batch
  provenance and allows an unrelated lot to satisfy a later return or void.
- **Generate a synthetic lot automatically:** invents physical evidence that
  the operator never observed.
- **Let destination receipt reactivate every lot:** makes expiry or quarantine
  disappear merely because stock moved.
- **Implement cutting inside product templates:** cannot prove atomic inputs,
  outputs, waste, cost, or reversal.
- **Recalculate an old execution from the current recipe or catalog:** mutable
  configuration would rewrite historical evidence.
- **Permit best-effort transformation void:** partial reversal can duplicate
  stock or detach product cost from the output that established it.

## Verification evidence

- `packages/server/src/__tests__/lot-procurement-transfers.test.ts`
- `packages/server/src/__tests__/inventory-transformations.test.ts`
- `packages/server/src/__tests__/purchases.test.ts`
- `packages/server/src/__tests__/orders.test.ts`
- `packages/server/src/__tests__/migrations.test.ts`
- `packages/server/src/__tests__/migrations-parity.test.ts`
- `apps/web/src/features/inventory/InventoryTransformationsPanel.test.tsx`
- `apps/web/src/features/inventory/InventoryControlPanel.test.tsx`
- `apps/web/src/features/orders/OrderReceiveModal.test.tsx`
- `apps/web/src/features/purchases/PurchaseFinalizeModal.test.tsx`
- `apps/web/src/features/purchases/PurchaseReturnModal.test.tsx`
- `apps/web/src/features/purchases/PurchaseDetailsContent.test.tsx`
- `apps/web/src/features/purchases/PurchaseDetailsModal.test.tsx`
- `apps/web/src/features/inventory/InventoryTransferHistory.test.tsx`
- `apps/web/src/features/inventory/InventoryTransferReceiveModal.test.tsx`
- `e2e/web/inventory-transformations.spec.ts`
- `e2e/electron/inventory-transformation.spec.ts`
- migration `0056_mean_pandemic.sql`

This evidence proves the local software contracts. It does not certify a
physical scanner, scale, regulated pharmacy process, production line, or
country-specific legal requirement.
