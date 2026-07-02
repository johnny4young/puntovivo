# Inventory & Units Model — target design and phased migration

Status: living design doc (Auditoría 2026-07). Phase A shipped; B and C are
staged. This is the world-class target for the units/inventory core and the
low-risk, additive path to get there without a big-bang migration.

## Why this exists

For a LatAm retail POS the units-of-measure and stock model is the make-or-
break substrate: weighed produce, fractional hardware (2.5 m cable), packaging
hierarchies (unit → pack → case), lot/expiry for food & pharma, and — the
production gate — a standardized unit code on every fiscal e-invoice line.

## What the model looks like today (baseline)

- `units` — tenant-scoped, `name` + `abbreviation` (+ Phase A columns below).
- `unit_x_product` — per-product unit assignment carrying `equivalence`
  (factor to the product's own base unit), `price`, `isBase`.
- `products.stock` (legacy denormalized real) **and** `inventory_balances`
  (site, product → `onHand`/`reserved`) — two stock representations.
- Transaction lines (`sale_items`, `purchase_items`, `order_items`,
  `transfer_order_items`) snapshot `unitId` + `unitEquivalence` + `quantity`
  (in the chosen unit) + `normalizedQuantity` (base units). Inventory moves in
  `normalizedQuantity`.
- `products.sellByFraction` + `fractionStep` + `fractionMinimum` for weighed
  sales; `products.barcode` (single column).
- `products.cost` single mutable field; `sale_items.costAtSale` snapshots it.

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

## Phase A — units foundation (SHIPPED)

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

## Phase B — stock authority + packaging barcodes (STAGED)

1. **Barcode per packaging level.** Move the scannable code to
   `unit_x_product.barcode` (additive) so scanning a *case* barcode adds N base
   units. `products.barcode` stays as the base-unit code for back-compat.
2. **`inventory_balances` as the single source of truth.** Today
   `products.stock` and `inventory_balances` both exist; the write paths keep
   both in step, but two representations is a drift hazard. Make balances
   authoritative and treat `products.stock` as a derived cache (or drop reads
   of it), with a reconciliation pass. This touches the sale/purchase/return/
   void/transfer write paths, so it lands behind tests that assert
   ledger↔balance equality.
3. **Location/bin grain** — `inventory_balances` already reserves a slot for
   location-level granularity (per its own doc comment).

## Phase C — lots, expiry & costing (STAGED, product-gated)

1. **Lot/batch + expiry.** A lot dimension on stock (`inventory_lots`:
   product, site, lot_no, expiry, on_hand, unit_cost) unlocks FEFO
   (first-expired-first-out) picking, expiry alerts, recalls, and pharma/INVIMA
   compliance. Sale lines optionally reference the consumed lot(s).
2. **Serial numbers** — per-unit serials for warranty (electronics, tools).
3. **Costing method** — explicit FIFO / weighted-average cost layers so COGS
   and margin are auditable, not a single mutable `products.cost`. Required for
   trustworthy fiscal profit reporting.

These are product decisions (which method? do we need lots now for the pilot
vertical?), so each starts as its own design slice, not speculative schema.

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
