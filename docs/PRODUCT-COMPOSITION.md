# Product Composition (BOM / recipes / modifiers)

> Status: **Stub — design document, not yet implemented.**
> Phase 6a of the April 2026 plan. Enables both retail combos and
> restaurant recipes.
> Created: April 21, 2026.

## Goal

A product can be **simple** (sells itself, decrements its own stock) or
**composite** (sells a fixed recipe of other products, decrementing
ingredient stock at sale time). The composite's price is independent of
the sum of its ingredients — the operator sets it.

This covers:

- Restaurant dishes ("arroz con pollo" = 200g rice + 250g chicken + 1 egg)
- Retail combos / bundles ("3x2 shampoo")
- Kits / gift boxes
- Simple promotions ("comic + coffee" for a price)

## Schema additions

```sql
-- Discriminator on products (non-breaking: default 'simple')
ALTER TABLE products ADD COLUMN kind TEXT NOT NULL DEFAULT 'simple'
  CHECK (kind IN ('simple', 'composite'));

-- New: a recipe is N rows in product_recipes, one per ingredient
CREATE TABLE product_recipes (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  ingredient_product_id TEXT NOT NULL REFERENCES products(id),
  quantity REAL NOT NULL,
  unit_id TEXT REFERENCES units(id),
  is_optional INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  PRIMARY KEY (product_id, ingredient_product_id)
);

-- Modifiers (sin cebolla, término medio, extra queso)
CREATE TABLE product_modifier_groups (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  min_selection INTEGER NOT NULL DEFAULT 0,
  max_selection INTEGER NOT NULL DEFAULT 1,
  required INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE product_modifiers (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES product_modifier_groups(id),
  name TEXT NOT NULL,
  price_delta REAL NOT NULL DEFAULT 0
);
CREATE TABLE product_modifier_links (
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES product_modifier_groups(id),
  PRIMARY KEY (product_id, group_id)
);
CREATE TABLE sale_item_modifiers (
  sale_item_id TEXT NOT NULL REFERENCES sale_items(id) ON DELETE CASCADE,
  modifier_id TEXT NOT NULL REFERENCES product_modifiers(id),
  price_delta REAL NOT NULL,
  PRIMARY KEY (sale_item_id, modifier_id)
);
```

## Key behaviors

### Selling a composite

At `sales.complete`, the service walks each composite line and emits
**one `inventory_movements` row per ingredient** inside the same SQLite
transaction. The composite itself does NOT decrement a stock row — its
stock is derived.

### Derived stock

`products.stock` for a composite is **not stored**. The service
computes on read:

```
stock(composite) = min_i(
  floor( stock(ingredient_i) / quantity_i )
) for non-optional ingredients
```

Exposed via a service helper, never written to the table.

### Voids

Voiding a sale reverses ingredient movements in lockstep, exactly the
way simple-product voids work today. Invariant maintained:
`products.stock = Σ(inventory_balances)` for simple products.

### Recipe edits

Editing a recipe does NOT affect past sales — each `inventory_movements`
row is anchored to its originating `saleId`. The recipe change only
applies to sales after the save.

### Cycle detection

A composite cannot have itself (directly or transitively) as an
ingredient. The service runs DFS at save time and rejects cycles.
Depth > 3 is rejected as a code smell.

### Cost and margin

Cost = Σ(ingredient cost × quantity), computed on demand for reports.
The composite's `cost` column on `products` is a convenience snapshot
updated when the recipe is saved; reports prefer the on-demand
calculation.

## Services (planned)

```
packages/server/src/services/product-composition.ts
  saveRecipe(productId, lines)
  explodeRecipe(productId, saleQuantity): { inventoryMovements[] }
  deriveCompositeStock(productId): number
  validateNoCycles(productId, lines): void  // throws TRPCError on cycle
```

Wire-up inside:

- `sales.complete` — calls `explodeRecipe` for each composite line, emits movements
- `sales.void` — reverses ingredient movements
- `products.getById` — returns `derivedStock` field for composites
- `products.list` — returns `derivedStock` when `kind = 'composite'`

## UI

- Tab "Receta" in `ProductFormModal` — visible only when `kind === 'composite'`
- Ingredient autocomplete (filtered to simple products of same tenant)
- "Test explosion" button: simulates 1-unit sale and shows the impact
  per ingredient (useful before saving)
- "Costo total" and "Stock derivado" computed in real time

## Testing plan

- Selling a composite decrements every non-optional ingredient
- Voiding reverses ingredients
- Optional ingredient out of stock doesn't block composite sale
- Cycle rejected at save time
- Depth > 3 rejected
- Edit recipe, sell again → new ingredients used; past sale untouched
- Modifier price_delta applied correctly to sale_items total
- Derived stock = min floor over non-optional ingredients

## Out of scope (v1)

- Variable recipes (different recipes for different sites)
- Yield factors (a 10kg bag of flour yields 12 loaves on a good day,
  10 on a humid day) — future
- Composite-of-composites with dynamic explosion depth > 3 — forbidden
  on purpose
- Time-windowed recipes ("holiday menu") — future
