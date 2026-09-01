# Inventory & Units Model — target design and phased migration

Status: living design doc (updated 2026-08-31). The units foundation, stock
authority, packaging barcodes, lots, FEFO consumption, realized COGS, serial
logistics, variant matrices, blind physical counts, and operator-approved
replenishment drafts are shipped. Location/bin-level stock remains future work.
This document records the additive path used to reach the current model without
a big-bang migration.

## Why this exists

For a LatAm retail POS the units-of-measure and stock model is the make-or-
break substrate: weighed produce, fractional hardware (2.5 m cable), packaging
hierarchies (unit → pack → case), lot/expiry for food & pharma, and — the
production gate — a standardized unit code on every fiscal e-invoice line.

## What the model looks like today (baseline)

- `units` — tenant-scoped, `name` + `abbreviation` (+ current columns below).
- `unit_x_product` — per-product unit assignment carrying `equivalence`
  (factor to the product's own base unit), `price`, `isBase`, and a packaging
  barcode.
- `inventory_balances` (site, product → `onHand`/`reserved`) is the sole
  stock authority. `product_stock_totals` is its trigger-maintained read model;
  the legacy `products.stock` column no longer exists.
- `products.tracks_stock` (default true) opts a product OUT of inventory
  entirely — a service item (labor, delivery, a haircut). A service owns no
  balance rows, is skipped by the site seeder, is refused by every balance
  writer (`assertServiceStockMutationAllowed` at the `applyInventoryBalanceDelta`
  boundary), and is excluded from stock listings and low-stock alerts. Sale
  lines snapshot the flag in `sale_items.tracks_stock_snapshot` so a reversal
  credits exactly what its sale debited even if the product was converted
  since. Reporting queries that join `inventory_balances` therefore see only
  inventory-bearing products; revenue reporting must read `sale_items`.
  Launch import/export carries this flag explicitly while blank legacy imports
  retain the physical-product default. Inventory, purchase and order pickers
  request only stock-tracked rows, and both direct purchases and inventory
  orders reject a service before writing their header or lines. Sales and
  general catalog search intentionally continue to return services.
- Transaction lines (`sale_items`, `purchase_items`, `order_items`,
  `transfer_order_items`) snapshot `unitId` + `unitEquivalence` + `quantity`
  (in the chosen unit) + `normalizedQuantity` (base units). Inventory moves in
  `normalizedQuantity`.
- `products.sellByFraction` + `fractionStep` + `fractionMinimum` for weighed
  sales; `products.barcode` remains the base-unit barcode.
- `products.cost` single mutable field; `sale_items.costAtSale` snapshots it.
- `products.tracksSerials` gates per-unit serial receipt, site ownership,
  transfer, sale, return, warranty, and lookup history.

### Genuine strengths (keep these invariants)

1. **Factor snapshotting on lines** — changing a product's unit factor never
   rewrites history. Non-negotiable; every new write path must preserve it.
2. **Explicit `normalizedQuantity`** — inventory math keys off one base-unit
   number, not a live re-derivation.
3. **Fractional stock with guardrails** — `real` stock + fraction policy.

## Target model

```
unit_dimension  (mass|volume|length|area|count|time|other)
      │  canonical reference: mass→gram, volume→ml, length→m, area→m², count→unit
      ▼
units ── dimension, standard_code (UN/ECE Rec 20), reference_factor ──▶ fiscal unitCode
      │
      ▼
unit_x_product ── equivalence (→ product base), price, isBase, barcode (per pack level)
      │
      ▼
inventory_balances (authoritative)  ── site, product, [location], onHand, reserved
      │                                    └─ lot dimension (Phase C): lot_no, expiry, cost_layer
      ▼
cost layers (Phase C: FIFO / weighted-average) ──▶ auditable COGS
```

## current — units foundation (SHIPPED)

Additive, zero-rewrite. Migration `0003_unit_dimension_standard_code`.

- `units.dimension` — physical quantity (enum, nullable).
- `units.standard_code` — UN/ECE Rec 20 code (`KGM`, `LTR`, `MTR`, `GRM`,
  `C62`/`H87` for piece…). **The fiscal hook**: LatAm e-invoicing (Colombian
  DIAN UBL) requires a standardized `unitCode` per line; a free-form tenant
  abbreviation cannot map to it reliably.
- `units.reference_factor` — multiplier into the dimension's reference unit
  (`KGM`=1000, `GRM`=1). Enables dimension-wide conversion later without
  per-product factors; null keeps the legacy per-product path.
- `services/units/unit-standards.ts` — catalog mapping common LatAm units →
  (dimension, code, factor); `resolveUnitStandardCode()` is what the future
  DIAN adapter consumes instead of guessing from the unit name (the existing
  CL pack's `mapUnitToUnmdItem` string-matching is the anti-pattern this
  replaces); `dimensionsAreCoherent()` flags nonsensical unit sets.
- `units.create` backfills all three from the catalog when omitted, so a plain
  "KG" lands fiscal-ready. Explicit input always wins.

## Phase B — stock authority + packaging barcodes (SHIPPED)

1. **Barcode per packaging level (DONE).** `unit_x_product.barcode` (additive,
   migration `0004_unit_x_product_barcode`) lets each packaging level carry its
   own scannable code. `products.lookupByBarcode` now falls back to a
   packaging-barcode match after the base-product miss and returns
   `resolvedUnitId` / `resolvedUnitPrice`; the POS scanner selects that unit so
   scanning a _case_ adds `equivalence` base units at the case price.
   `products.barcode` stays the base-unit code for back-compat.
2. **Stock authority — single source of truth (DONE).** The denormalized
   `products.stock` column has been **removed** (migration
   `0007_drop_products_stock`, which first backfills a primary-site
   `inventory_balances` row from any product's stock so no data is lost, then
   drops the column). `inventory_balances.on_hand` (per-site) is now the sole
   source of truth; the tenant-wide total is derived as `Σ(on_hand)` on read via
   `services/inventory-balances/derive.ts` (`productStockTotalSql` for select
   projections, `getProductStockTotal`/`getProductStockTotals` for write paths).
   Product reads still expose a numeric `stock` field (now derived), so the API
   shape is unchanged. Every former `products.stock` write is gone; the sale
   stock check already keyed off `inventory_balances`. Because drift is now
   structurally impossible, `reconcileProductStockFromBalances` and the
   discrepancy report are retained but no-op / always-empty. The derived total
   is materialized in `product_stock_totals` (tenant, product →
   total) is maintained exclusively by the SQLite triggers of migration `0008`
   (insert/update-of-on_hand/delete on `inventory_balances`), so `derive.ts`
   reads an O(1) PK point-lookup instead of re-summing balances per product.
   Triggers were chosen over app-side write-through because transfers and the
   seed helpers write `on_hand` outside `applyInventoryBalanceDelta` (plus ~60
   test fixtures): the storage layer owns the invariant for every writer.
   Parity is pinned by `inventory-stock-rollup.test.ts`.
3. **Location/bin grain (STAGED)** — `inventory_balances` still reserves a slot
   for location-level granularity (per its own doc comment); unstarted.

## Retail stock control (SHIPPED)

1. **Blind physical counts.** `inventory_count_sessions` owns one site-scoped
   workflow and `inventory_count_lines` freezes the base unit, exact signed book
   on-hand, balance revision, and unit cost when it opens. A signed opening
   value allows the workflow to repair a historical negative balance; the
   physical quantity entered by the operator remains non-negative and is
   normalized to `0.001`. The counting read exposes names and entered
   quantities but redacts expected stock, discrepancy, and cost until submit.
   Sessions and lines use optimistic versions, and only one unfinished count may
   include the same product at the same site.
2. **Fail-closed approval.** Submit calculates the frozen variance; approval
   acquires the SQLite writer reservation and requires every current site
   balance and monotonic balance revision to equal their opening snapshots. It
   also requires the original active base-unit identity and stock policy. Any
   intervening sale, return, receipt, transfer, adjustment, or catalog identity
   change makes the operator restart rather than silently rebasing the count,
   even when intervening stock movements net to zero. Approval writes a
   `physical` inventory entry for every
   line and an adjustment movement only for non-zero discrepancies, with the
   balance, audit, sync intent, idempotency result, and status transition in one
   transaction. Rejecting a submitted count never changes stock.
3. **Identity boundary.** The aggregate workflow accepts standard products and
   sellable variant children. Services, variant parents, lot-tracked products,
   and serial-tracked products are excluded because a total alone cannot prove
   which lot or physical identity exists. Lot- and serial-aware counting remains
   a separate future slice rather than inferred evidence.
4. **Suggested replenishment.** The site projection computes
   `available = max(on_hand - reserved, 0)` and adds the unreceived base-unit
   quantity from draft, submitted, and partially received purchase orders. A
   product below `min_stock` receives a suggested quantity, but the manager must
   choose a supplier and create a draft. The draft has no stock or supplier-
   payable effect, cannot be received, and can be discarded safely; explicit
   submission activates the existing receipt path. Lot-tracked products remain
   visible as blocked until lot-aware purchase receipt ships. Puntovivo does not
   order or forecast demand automatically.

## Phase C — lots, expiry, costing, and serial logistics (SHIPPED)

1. **Lot/batch + expiry (DONE, foundation).** `inventory_lots` (site, product,
   lot_no, expiry, on_hand, unit_cost, status) + `products.tracks_lots` opt-in;
   migration `0005_inventory_lots`. Quantities/cost are per base unit, so a lot's
   on-hand is directly comparable to an `inventory_balances` on-hand.
   - `services/inventory-lots/select-fefo.ts` — pure, exhaustively-tested FEFO
     allocation: orders lots by expiry (nulls last) then receipt, draws down in
     order, and because each lot carries its own `unit_cost` the allocation IS
     the COGS layer — `totalCost` is the exact cost of goods sold, plus a
     `weightedAverageUnitCost` for the blended-cost entry.
   - `receiveInventoryLot` upserts a batch (increment + weighted-average cost on
     re-receipt of the same lot).
   - `inventoryLots` router: `receive` (manager/admin), `list` (FEFO-ordered),
     `expiring` (expiry-alert scan within a day window).
   - Sync contract: `inventory_lots` registered as a `manual`-policy entity.
2. **Costing method (DONE at the engine level).** FEFO consumption yields
   auditable FIFO-by-expiry COGS from real cost layers rather than a single
   mutable `products.cost`. The blended-cost helper covers the weighted-average
   reporting case.
3. **Sale-path auto-consumption (DONE).** Behind `products.tracks_lots`,
   `runFreshSale` (the single stock-debit point — it handles direct sales AND
   draft creation) FEFO-consumes the product's lots inside the sale
   transaction: decrements each lot, marks it depleted at zero, and writes one
   `sale_item_lots` row per lot drawn (migration `0006_sale_item_lots`) — the
   auditable COGS provenance (which lots, what quantity, what cost). Only active,
   unexpired lots are sellable. A shortfall against the aggregate balance aborts
   the whole sale transaction with `LOT_STOCK_INCONSISTENT`; committing stock
   without complete lot provenance would make FEFO, returns and COGS
   untrustworthy. A normalized completed-sale return credits only the selected
   quantity to the exact frozen lot rows and retains its own immutable return
   provenance; successive partial returns cannot exceed the original
   allocation. Full void/draft-discard reversals call `restoreLotsForSale`,
   which credits every consumed lot and clears the abandoned sale provenance.
   Quantity restoration never releases a quarantined or expired lot; only a
   still-valid depleted lot becomes active again. `sale_items.costAtSale` is intentionally left as the
   `product.cost` snapshot for now — the precise per-lot COGS lives in
   `sale_item_lots`, so margin reporting can adopt it without any regression to
   the existing cost field.
4. **Serial numbers and logistics (DONE).** `product_serials` records the
   tenant, product, current site, status, acquisition cost, receipt, sale,
   return, and warranty evidence for each physical unit. Purchase receipt,
   exact inter-site transfer, checkout selection, reversals, and warranty
   lookup preserve tenant/site ownership and append durable serial history.
   `sale_item_serials` keeps prior sale associations even when a returned unit
   becomes sellable again.

Margin/COGS reporting over `sale_item_lots` is also shipped. The
`reports.profit.margin` procedure + the admin Profitability page
(`/profitability`) surface realized gross margin over a date range, sourcing
COGS from the per-lot ledger for lot-tracked lines and the `cost_at_sale`
snapshot otherwise. Everything else stays product-gated (which vertical needs
lots for the pilot?), each its own slice.

## Migration principles (how we avoid a big-bang)

- **Additive first**: new nullable columns + new tables; never a destructive
  ALTER on a hot table. Every phase's migration must apply cleanly on a
  populated 1.x DB.
- **Snapshot invariants hold**: transaction lines keep freezing unit factors
  and costs at write time.
- **Backfill, don't block**: enrichment (dimension/code) is best-effort; a null
  never breaks a write.
- **One phase per PR**, each green across `ci:server` + `ci:web` +
  `ci:desktop`, so a regression is bisectable to a single phase.
