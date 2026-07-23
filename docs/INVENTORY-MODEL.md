# Inventory & Units Model — target design and phased migration

Status: living design doc (updated 2026-07-20). The units foundation, stock
authority, packaging barcodes, lots, FEFO consumption, realized COGS, serial
logistics, and variant matrices are shipped. Location/bin-level stock remains
future work. This document records the additive path used to reach the current
model without a big-bang migration.

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
   auditable COGS provenance (which lots, what quantity, what cost). A shortfall
   (lots under-count the balance that already gated the sale) is logged, not
   thrown, so the register never blocks. The full-sale reversals
   (`returnSale` / `voidSale` / `discardDraft`) call `restoreLotsForSale`, which
   credits the exact consumed lots back (reactivating depleted ones) and clears
   the provenance. `sale_items.costAtSale` is intentionally left as the
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
