# Migration Plan: yojob (WinForms) to open_yojob (Electron + React + Fastify)

> **Generated:** March 31, 2026
> **Updated with repo annotations:** April 7, 2026
> **Source:** `yojob` -- .NET WinForms + DevExpress + SQLite + EF6 + MEF plugins
> **Target:** `open_yojob` -- Electron 41 + React 19 + Fastify 5 + Drizzle ORM + SQLite
> **Estimated effort:** 12--19 weeks (solo developer)

> **Current repo status:** This document remains the original migration roadmap, but the repository
> has already completed Phases 0-5 and a substantial part of Phase 6. Use
> `docs/IMPLEMENTATION_STATUS.md` as the status source of truth when this plan conflicts with the
> current codebase.

---

## Table of Contents

1. [Source Architecture Summary](#1-source-architecture-summary)
2. [Target Architecture Summary](#2-target-architecture-summary)
3. [Gap Analysis](#3-gap-analysis)
4. [Known Bugs to Fix (Not Replicate)](#4-known-bugs-to-fix-not-replicate)
5. [Phase 0 -- Foundation & Schema Alignment](#phase-0--foundation--schema-alignment)
6. [Phase 1 -- Administration Module](#phase-1--administration-module)
7. [Phase 2 -- Product Management & Pricing Engine](#phase-2--product-management--pricing-engine)
8. [Phase 3 -- Inventory Module](#phase-3--inventory-module)
9. [Phase 4 -- POS / Sales Module](#phase-4--pos--sales-module)
10. [Phase 5 -- Purchases Module](#phase-5--purchases-module)
11. [Phase 6 -- Reporting, Printing & Polish](#phase-6--reporting-printing--polish)
12. [Cross-Reference: WinForms File to Target Location](#cross-reference-winforms-file-to-target-location)
13. [Appendix: WinForms Database Tables](#appendix-winforms-database-tables)

---

## 1. Source Architecture Summary

### Projects (6 C# projects in `yojob.sln`)

| Project               | Role             | Key Files                                                                                                                                   |
| --------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `yojob`               | Shell / MDI host | `FormPrincipal.cs` (ribbon, MEF loader, login)                                                                                              |
| `yojob.lib`           | Shared library   | 63 DAO entities, 99 DB static classes, `Utilidades.cs`, `DataNavigatorThink.cs`, `ProductosSearch.cs`, auth classes                         |
| `yojob.administrador` | Admin plugin     | `Productos.cs`, `Clientes.cs`, `Proveedores.cs`, `Categorias.cs`, `Empresas.cs`, `IVAs.cs`, `Consecutivos.cs`, `Unidades.cs`, `Usuarios.cs` |
| `yojob.ventas`        | Sales plugin     | `Ventas.cs` (POS), `RegistraVenta.cs` (payment dialog), `reportTiraVenta.cs` (receipt), `DetallesVentas.cs`                                 |
| `yojob.compras`       | Purchases plugin | `Compras.cs`, `DetallesCompras.cs`                                                                                                          |
| `yojob.inventarios`   | Inventory plugin | `InventarioInicial.cs`, `ConsultaExistencia.cs`                                                                                             |

### Key Architectural Patterns

- **MEF plugin system:** Each module DLL exports `IUserForm` and dynamically registers ribbon menu items in `FormPrincipal`
- **DataNavigatorThink:** Custom CRUD state machine control (`Nuevo/Editar/Guardar/Cancelar/Eliminar`) used by all admin forms
- **Dual data access:** EF6 (`dbEntities` context) coexists with manual static methods (`DB.Product.Insert()`, `DB.Sale.GetById()`, etc.)
- **Auth:** Custom `GenericPrincipalIthink`/`GenericIdentityIthink` stored on `Thread.CurrentPrincipal`. Roles: `admin`, `vendedor`
- **No service layer:** All business logic lives in form code-behind
- **No async:** Entirely synchronous, single-threaded WinForms

### Critical Business Logic

#### VAT Extraction (Colombian model)

Prices stored in DB are **VAT-inclusive**. Tax is extracted at sale time:

```
basePrice = totalPrice / (1 + vatRate)
vatAmount = totalPrice - basePrice
```

#### 3-Tier Pricing Engine (Productos.cs)

Products have 3 sale prices calculated from cost:

- **Percentage mode:** `salePrice = cost + (cost * marginPercent / 100)`
- **Amount mode:** `salePrice = cost + fixedMarginAmount`, then derive percent
- Each tier (price1, price2, price3) is independently configurable

#### Stock with Unit Equivalence

Products can have multiple units of measure. Stock is normalized to the base unit using an `equivalencia` (equivalence) factor:

```
normalizedQty = quantity * unitEquivalence
```

#### Sequential Invoice Numbering

Per-site, per-document-type sequential numbers stored in `consecutivos` table. Incremented atomically on each sale/purchase.

---

## 2. Target Architecture Summary

### Current State (what already exists)

```
open_yojob/
  apps/
    desktop/          # Electron 41 + electron-forge (working shell)
    web/              # React 19 + Vite + TailwindCSS 4
      src/
        features/
          auth/       # LoginPage, AuthProvider, ProtectedRoute, role access (working)
          tenant/     # TenantProvider + site selection (working)
          dashboard/  # DashboardPage (live data)
          products/   # ProductsPage (live CRUD + pricing tiers)
          customers/  # CustomersPage (live CRUD)
          providers/  # ProvidersPage (live CRUD)
          units/      # UnitsPage (live CRUD)
          vat-rates/  # VatRatesPage (live CRUD)
          company/    # CompanyPage (live CRUD)
          sites/      # SitesPage (live CRUD)
          sequentials/ # SequentialsPage (live CRUD)
          users/      # UsersPage (live CRUD)
          sales/      # SalesPage (POS checkout + history)
          purchases/  # PurchasesPage (purchase intake + history)
          inventory/  # InventoryPage (stock, movements, initial inventory)
        components/
          layout/     # MainLayout, Sidebar
          tables/     # DataTable + export actions
        lib/          # tRPC client configuration
  packages/
    server/           # Fastify 5 + Drizzle ORM + better-sqlite3
      src/
        db/
          schema.ts   # Expanded business schema
          index.ts    # DB init with raw SQL DDL
          seed.ts     # Seed data
        trpc/         # Primary application API layer
          routers/    # Auth, dashboard, admin, products, inventory, sales, purchases, sync
        realtime/     # SSE realtime + sync queue status
```

### Tech Stack

| Layer         | Technology                                  |
| ------------- | ------------------------------------------- |
| Desktop shell | Electron 41 + electron-forge                |
| Frontend      | React 19, Vite, TailwindCSS 4, React Router |
| API           | Fastify 5, tRPC (primary transport)         |
| ORM           | Drizzle ORM                                 |
| Database      | better-sqlite3 (SQLite)                     |
| Auth          | argon2 (hashing) + JWT                      |
| Sync          | SSE realtime + local sync queue             |

---

## 3. Gap Analysis

### Schema: Missing Tables (~25)

The WinForms app has ~63 entity classes. The target currently has 7 domain tables. The following tables need to be added:

| Priority | Table                   | WinForms Source                                           | Purpose                                          |
| -------- | ----------------------- | --------------------------------------------------------- | ------------------------------------------------ |
| P0       | `providers`             | `DAO/proveedor.cs`, `DB/Proveedor.cs`                     | Supplier management                              |
| P0       | `units`                 | `DAO/unidad.cs`, `DB/Unidad.cs`                           | Units of measure (kg, lb, unit, box...)          |
| P0       | `unit_x_product`        | `DAO/unidadxproducto.cs`, `DB/UnidadXProducto.cs`         | Product-unit association with equivalence factor |
| P0       | `vat_rates`             | `DAO/iva.cs`, `DB/IVA.cs`                                 | Tax rates (0%, 5%, 19% etc.)                     |
| P0       | `companies`             | `DAO/empresa.cs`, `DB/Empresa.cs`                         | Company/business entity                          |
| P0       | `sites`                 | `DAO/sede.cs`, `DB/Sede.cs`                               | Physical store locations                         |
| P0       | `sequentials`           | `DAO/consecutivo.cs`, `DB/Consecutivo.cs`                 | Auto-increment invoice/document numbers per site |
| P1       | `purchases`             | `DAO/compra.cs`, `DB/Compra.cs`                           | Purchase headers                                 |
| P1       | `purchase_items`        | `DAO/compradetalle.cs`, `DB/CompraDetalle.cs`             | Purchase line items                              |
| P1       | `initial_inventory`     | `DAO/inventarioinicial.cs`, `DB/InventarioInicial.cs`     | Initial/physical inventory entries               |
| P1       | `locations`             | `DAO/ubicacion.cs`, `DB/Ubicacion.cs`                     | Warehouse locations                              |
| P1       | `location_x_site`       | `DAO/ubicacionxsede.cs`, `DB/UbicacionXSede.cs`           | Location-site association                        |
| P1       | `product_x_provider`    | `DAO/productoxproveedor.cs`, `DB/ProductoXProveedor.cs`   | Product-provider association                     |
| P2       | `orders`                | `DAO/pedido.cs`, `DB/Pedido.cs`                           | Purchase orders                                  |
| P2       | `order_items`           | `DAO/pedidodetalle.cs`, `DB/PedidoDetalle.cs`             | Purchase order line items                        |
| P2       | `category_x_provider`   | `DAO/categoriaxproveedor.cs`, `DB/CategoriaXProveedor.cs` | Category-provider association                    |
| P2       | `cities`                | `DAO/ciudad.cs`, `DB/Ciudad.cs`                           | City catalog                                     |
| P2       | `departments`           | `DAO/departamento.cs`, `DB/Departamento.cs`               | Department/state catalog                         |
| P2       | `identification_types`  | `DAO/tipoidentificacion.cs`, `DB/TipoIdentificacion.cs`   | ID type catalog (CC, NIT, etc.)                  |
| P2       | `person_types`          | `DAO/tipopersona.cs`, `DB/TipoPersona.cs`                 | Person type catalog (natural, juridica)          |
| P2       | `regime_types`          | `DAO/tiporegimen.cs`, `DB/TipoRegimen.cs`                 | Tax regime catalog                               |
| P2       | `commercial_activities` | `DAO/actividadcomercial.cs`, `DB/ActividadComercial.cs`   | CIIU activity codes                              |
| P2       | `client_types`          | `DAO/tipocliente.cs`, `DB/TipoCliente.cs`                 | Client classification                            |
| P3       | `logos`                 | `DAO/logo.cs`, `DB/Logo.cs`                               | Company logos                                    |
| P3       | `sale_returns`          | N/A (not in WinForms)                                     | Future: credit notes                             |
| P3       | `purchase_returns`      | N/A (not in WinForms)                                     | Future: purchase returns                         |

### Products Table: Missing Columns

The current `products` table needs additional columns to support the WinForms pricing engine:

```
price2, price3              -- 3-tier pricing
marginPercent1/2/3          -- margin percentages
marginAmount1/2/3           -- margin fixed amounts
vatRateId                   -- FK to vat_rates (replaces flat taxRate)
providerId                  -- FK to providers (primary supplier)
locationId                  -- FK to locations (warehouse position)
initialCost                 -- cost at initial inventory time
```

### Sale Items Table: Missing Columns

```
unitId                      -- FK to units (which unit was used for this line)
unitEquivalence             -- conversion factor to base unit
costAtSale                  -- snapshot of cost at sale time
```

### Frontend: Core Pages Are Live

The major feature pages are no longer mock screens. Dashboard, products, customers, administration,
inventory, sales, and purchases are wired to live tRPC procedures.

### Business Logic: Major Flows Implemented Server-Side

The remaining gaps are mainly polish and edge-case hardening, not absence of core business logic.
The following items are already implemented in the current repo:

- VAT extraction logic
- 3-tier pricing calculation
- Stock validation with unit equivalence
- Sequential number generation
- Sale finalization (transactional)
- Purchase finalization (transactional)
- Initial/physical inventory processing

---

## 4. Known Bugs to Fix (Not Replicate)

These bugs exist in the WinForms codebase and must be **fixed** in the migration, not carried over:

| #   | Bug                                               | WinForms Location                        | Severity | Fix                                                                                                                        |
| --- | ------------------------------------------------- | ---------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1   | **SQL injection** in `Sale.TotalDiario()`         | `yojob.lib/DB/Sale.cs`                   | Critical | Use parameterized queries (Drizzle handles this)                                                                           |
| 2   | **Plain text passwords**                          | `yojob.lib/DB/Usuario.cs`                | Critical | Already fixed -- target uses argon2 hashing                                                                                |
| 3   | **Field mapping error** in Client insert          | `yojob.lib/DB/Client.cs`                 | High     | `tipoIdentificacion` mapped to wrong column; fix in schema                                                                 |
| 4   | **Wrong table** in `LocationXSite.Delete()`       | `yojob.lib/DB/UbicacionXSede.cs`         | High     | Deletes from wrong table; use correct FK cascade                                                                           |
| 5   | **Quantity doubling** in initial inventory        | `yojob.inventarios/InventarioInicial.cs` | High     | `existencia += cantidad` then saves `cantidad` to `existencia` field, losing the addition. Fix: save the accumulated value |
| 6   | **No transaction safety** on cascading operations | `yojob.administrador/Productos.cs`       | Medium   | Delete-and-reinsert of unit/provider associations not wrapped in transaction. Use Drizzle transactions                     |
| 7   | **Field mapping error** in UnitXProduct           | `yojob.lib/DB/UnidadXProducto.cs`        | Medium   | Fields swapped in insert; fix column order                                                                                 |
| 8   | **Race condition** on sequential numbers          | `yojob.lib/DB/Consecutivo.cs`            | Medium   | Read-increment-write not atomic. Use `UPDATE ... SET value = value + 1 RETURNING`                                          |
| 9   | **No input validation** on numeric fields         | Multiple forms                           | Low      | Add Zod schemas on all API inputs                                                                                          |
| 10  | **Hard-coded VAT rate** in some calculations      | `yojob.ventas/Ventas.cs`                 | Low      | Always look up from `vat_rates` table                                                                                      |

---

## Phase 0 -- Foundation & Schema Alignment

**Goal:** Add missing tables, align schema with WinForms data model, wire existing pages to live API.
**Effort:** 2--3 weeks

### 0.1 Schema Extension

Add the following to `packages/server/src/db/schema.ts`:

**P0 tables (required for all subsequent phases):**

- `providers` -- id, tenantId, name, taxId, phone, email, address, cityId, contactName, isActive, timestamps
- `units` -- id, tenantId, name, abbreviation, isActive, timestamps
- `unit_x_product` -- id, productId, unitId, equivalence (real), price (real), isBase (boolean)
- `vat_rates` -- id, tenantId, name, rate (real), isActive, timestamps
- `companies` -- id, tenantId, name, taxId, address, phone, email, logoUrl, timestamps
- `sites` -- id, tenantId, companyId (FK), name, address, phone, isActive, timestamps
- `sequentials` -- id, tenantId, siteId (FK), documentType (enum: sale, purchase, order), prefix, currentValue (integer), timestamps

**Products table modifications:**

- Add columns: `price2`, `price3`, `marginPercent1`, `marginPercent2`, `marginPercent3`, `marginAmount1`, `marginAmount2`, `marginAmount3`, `vatRateId` (FK), `providerId` (FK), `locationId`, `initialCost`
- Rename `price` to `price1` for clarity

**Sale items table modifications:**

- Add columns: `unitId` (FK), `unitEquivalence` (real), `costAtSale` (real)

### 0.2 Wire Existing Pages to Live API

Status in current repo: complete for the primary feature set.

This was an original migration task. In the current repo, these pages are already connected to live
tRPC procedures:

| Page          | Hook           | API Endpoint                               | Work Needed                        |
| ------------- | -------------- | ------------------------------------------ | ---------------------------------- |
| ProductsPage  | tRPC query/mutation flows | `products.*` and related lookups  | Implemented |
| CustomersPage | tRPC query/mutation flows | `customers.*`                     | Implemented |
| SalesPage     | tRPC query/mutation flows | `sales.*`                         | Implemented |
| InventoryPage | tRPC query/mutation flows | `inventory.*`                     | Implemented |
| DashboardPage | tRPC query flow           | `dashboard.summary`               | Implemented |

### 0.3 Site/Company Selector

Add a site selector to the app header or tenant context. The WinForms app uses `Utilidades.sede()` to get the active site. In the target:

- Store selected site ID in `TenantProvider` context or local storage
- Pass `siteId` as a query parameter or header on all API calls
- Sequential numbers and stock queries are site-scoped

### 0.4 Seed Data

Update `packages/server/src/db/seed.ts` to populate:

- Default company and site
- Default VAT rates (0%, 5%, 19% for Colombia)
- Default units (Unidad, Kilogramo, Libra, Caja, Docena)
- Default sequentials (sale starting at 1, purchase starting at 1)

### Deliverables

- [ ] All P0 tables added to Drizzle schema with relations
- [ ] Raw SQL DDL in `db/index.ts` updated to match
- [ ] Seed data for default records
- [x] Existing pages wired to live API (no more sample data)
- [ ] Site selector in header
- [ ] All existing tests still pass

---

## Phase 1 -- Administration Module

**Goal:** Implement CRUD for all administration entities that support the business modules.
**Effort:** 2--3 weeks
**WinForms source:** `yojob.administrador/` (9 forms)
**Current repo status:** Implemented

### 1.1 Provider Management

| Layer  | WinForms Source    | Target Location                                                   |
| ------ | ------------------ | ----------------------------------------------------------------- |
| UI     | `Proveedores.cs`   | `apps/web/src/features/providers/ProvidersPage.tsx`               |
| API    | `DB/Proveedor.cs`  | `packages/server/src/trpc/routers/providers.ts`                   |
| Schema | `DAO/proveedor.cs` | `packages/server/src/db/schema.ts` (providers table)              |

**Form fields:** name, taxId, phone, email, address, city (lookup), contactName
**DataNavigatorThink states:** New / Edit / Save / Cancel / Delete -- map to standard CRUD buttons

### 1.2 VAT Rate Management

| Layer  | WinForms Source | Target Location                                   |
| ------ | --------------- | ------------------------------------------------- |
| UI     | `IVAs.cs`       | `apps/web/src/features/vat-rates/VatRatesPage.tsx` |
| API    | `DB/IVA.cs`     | `packages/server/src/trpc/routers/vatRates.ts`     |
| Schema | `DAO/iva.cs`    | `vat_rates` table                                  |

**Form fields:** name, rate (percentage as decimal)

### 1.3 Unit of Measure Management

| Layer  | WinForms Source | Target Location                                |
| ------ | --------------- | ---------------------------------------------- |
| UI     | `Unidades.cs`   | `apps/web/src/features/settings/UnitsPage.tsx` |
| API    | `DB/Unidad.cs`  | Generic CRUD                                   |
| Schema | `DAO/unidad.cs` | `units` table                                  |

**Form fields:** name, abbreviation

### 1.4 Category Management

Already partially implemented. Enhance:

- Add parent-child hierarchy display (tree view or indented list)
- Add provider association (`category_x_provider` table, Phase P2)

### 1.5 Company & Site Management

| Layer  | WinForms Source                 | Target Location                                  |
| ------ | ------------------------------- | ------------------------------------------------ |
| UI     | `Empresas.cs`                   | `apps/web/src/features/settings/CompanyPage.tsx` |
| API    | `DB/Empresa.cs`, `DB/Sede.cs`   | Dedicated route or generic CRUD                  |
| Schema | `DAO/empresa.cs`, `DAO/sede.cs` | `companies`, `sites` tables                      |

**Logic:** Company is a single record (the business). Sites are child records (physical locations). The site selector from Phase 0 reads from this table.

### 1.6 Sequential Number Configuration

| Layer  | WinForms Source      | Target Location                                         |
| ------ | -------------------- | ------------------------------------------------------- |
| UI     | `Consecutivos.cs`    | `apps/web/src/features/settings/SequentialsPage.tsx`    |
| API    | `DB/Consecutivo.cs`  | Dedicated route (not generic -- needs atomic increment) |
| Schema | `DAO/consecutivo.cs` | `sequentials` table                                     |

**Logic:** Admin can set the starting number and prefix for each document type per site. The actual increment happens atomically during sale/purchase finalization (Phase 4/5).

### 1.7 Client/Customer Enhancement

Already partially implemented (`customers` table exists). Enhance:

- Add fields: `identificationTypeId`, `personTypeId`, `regimeTypeId`, `clientTypeId` (all FK to catalog tables)
- These catalog tables are P2 priority -- add them here if time permits, or use simple text fields initially

### 1.8 User Management

| Layer  | WinForms Source | Target Location                                |
| ------ | --------------- | ---------------------------------------------- |
| UI     | `Usuarios.cs`   | `apps/web/src/features/users/UsersPage.tsx`    |
| API    | `DB/Usuario.cs` | `packages/server/src/trpc/routers/users.ts`    |
| Schema | `users` table   | Already exists                                 |

**Logic:** Admin can create/deactivate users, assign roles. Password reset. Registration route already exists but needs admin-only guard.

### Deliverables

- [x] Provider CRUD (page + API)
- [x] VAT rate CRUD (page + API)
- [x] Unit CRUD (page + API)
- [x] Category enhancement (tree view)
- [x] Company/Site management (page + API)
- [x] Sequential configuration (page + API)
- [x] Customer fields enhancement
- [x] User management (admin-only page)
- [x] Navigation updated with new menu items

---

## Phase 2 -- Product Management & Pricing Engine

**Goal:** Full product management with multi-unit support and the 3-tier pricing engine.
**Effort:** 2--3 weeks
**WinForms source:** `yojob.administrador/Productos.cs` (492 lines), `yojob.lib/ProductosSearch.cs`
**Current repo status:** Implemented

### 2.1 Product Form

The WinForms product form is the most complex admin screen. It has:

**Tab 1 -- General Info:**

- Name, SKU/barcode, description
- Category (lookup), Provider (lookup), VAT rate (lookup)
- Location (lookup)
- Active/inactive toggle

**Tab 2 -- Pricing (the 3-tier engine):**

- Cost (input)
- For each tier (price1, price2, price3):
  - Margin percentage (input) -- calculates: `price = cost + (cost * margin% / 100)`
  - Margin amount (input) -- calculates: `price = cost + marginAmount`
  - Sale price (computed, but also editable to reverse-calculate margin)
- Changing cost recalculates all three prices
- Changing margin% recalculates price and marginAmount
- Changing marginAmount recalculates price and margin%
- Changing price recalculates margin% and marginAmount

**Tab 3 -- Units:**

- Table of unit associations (from `unit_x_product`)
- Each row: unit (lookup), equivalence factor, price for this unit
- One unit must be marked as base (equivalence = 1)
- Add/remove unit associations

**Tab 4 -- Providers:**

- Table of provider associations (from `product_x_provider`)
- Add/remove providers

### 2.2 Pricing Engine Service

Create `packages/server/src/services/pricing.ts`:

```typescript
interface PricingInput {
  cost: number;
  marginPercent?: number;
  marginAmount?: number;
  price?: number;
}

interface PricingResult {
  price: number;
  marginPercent: number;
  marginAmount: number;
}

// Given any two of (cost + one of margin%/amount/price), calculate the third
function calculatePricing(input: PricingInput): PricingResult { ... }
```

This runs **client-side** for instant feedback in the form, and is **validated server-side** on save.

### 2.3 Product Search Dialog

The WinForms `ProductosSearch.cs` is a modal dialog used by Sales and Purchases to search and select products. In React:

- Create `apps/web/src/components/dialogs/ProductSearchDialog.tsx`
- Searchable table with columns: SKU, name, stock, price, unit
- Filter by category, provider
- Returns selected product + unit + price to the caller
- Used by POS (Phase 4) and Purchases (Phase 5)

### 2.4 Product API Enhancements

The generic CRUD is not enough for products. Create dedicated routes:

- `GET /api/products` -- list with joins (category name, provider name, VAT rate, units)
- `GET /api/products/:id` -- full detail with all associations
- `POST /api/products` -- create with pricing + unit associations (transactional)
- `PUT /api/products/:id` -- update with cascading association updates (transactional)
- `DELETE /api/products/:id` -- soft delete (set isActive = false)
- `GET /api/products/search?q=` -- fast search by name/SKU/barcode for POS

### Deliverables

- [ ] Product form with tabs (general, pricing, units, providers)
- [ ] 3-tier pricing engine (client + server validation)
- [ ] Unit association management (add/remove with equivalence)
- [ ] Provider association management
- [ ] Product search dialog (reusable component)
- [ ] Dedicated product API routes with transactional saves
- [ ] Product search API endpoint for POS

---

## Phase 3 -- Inventory Module

**Goal:** Initial inventory entry, physical inventory adjustment, and stock query view.
**Effort:** 1--2 weeks
**WinForms source:** `yojob.inventarios/InventarioInicial.cs`, `yojob.inventarios/ConsultaExistencia.cs`
**Current repo status:** Implemented

### 3.1 Initial Inventory Entry

| Layer  | WinForms Source                          | Target Location                                            |
| ------ | ---------------------------------------- | ---------------------------------------------------------- |
| UI     | `InventarioInicial.cs`                   | `apps/web/src/features/inventory/InventoryPage.tsx` + `InventoryEntryModal.tsx` |
| API    | `DB/InventarioInicial.cs`, `DB/Stock.cs` | `packages/server/src/trpc/routers/inventory.ts`            |
| Schema | `DAO/inventarioinicial.cs`               | `initial_inventory` table                                  |

**Two modes (from WinForms):**

1. **Initial inventory (accumulate):** Add quantity to existing stock. Used when first setting up or receiving miscellaneous stock.
2. **Physical inventory (replace):** Set stock to the counted quantity. Used for periodic physical counts.

**Form fields:** Product (search dialog), unit (lookup from product's units), quantity, cost, site

**Server-side logic:**

```
POST /api/inventory/initial
  1. Validate product exists and is active
  2. Normalize quantity: normalizedQty = quantity * unitEquivalence
  3. If mode == "initial":  newStock = currentStock + normalizedQty
     If mode == "physical": newStock = normalizedQty
  4. Update products.stock = newStock
  5. Insert initial_inventory record
  6. Insert inventory_movement record (type: "adjustment")
  7. All in a transaction
```

**Bug fix:** The WinForms code has a quantity doubling bug (Bug #5). The target implementation must correctly accumulate: `newStock = currentStock + normalizedQty`, then persist `newStock` (not `normalizedQty`).

### 3.2 Stock Query View

| Layer | WinForms Source         | Target Location                                      |
| ----- | ----------------------- | ---------------------------------------------------- |
| UI    | `ConsultaExistencia.cs` | `apps/web/src/features/inventory/InventoryPage.tsx` |
| API   | `DB/Stock.cs`           | `packages/server/src/trpc/routers/inventory.ts`     |

**Read-only view** showing:

- Product name, SKU, category
- Current stock (in base unit)
- Initial inventory cost
- Inventory valuation (stock \* initialCost)
- Total valuation at bottom

**API endpoint:**

```
GET /api/inventory/stock?siteId=...&categoryId=...
  Returns cross-join of products with their stock, cost, and valuation
```

### 3.3 Enhance Existing Inventory Page

The current `InventoryPage.tsx` shows inventory movements. Keep this as-is but wire to live data. Add navigation tabs:

- **Movements** (existing page, wired to API)
- **Initial Inventory** (new, 3.1)
- **Stock Query** (new, 3.2)

### Deliverables

- [ ] `initial_inventory` table in schema
- [ ] Initial inventory entry page with product search
- [ ] Physical inventory mode
- [ ] Stock query view with valuation
- [ ] Inventory movements wired to live API
- [ ] Unit equivalence normalization working
- [ ] Bug #5 (quantity doubling) verified fixed

---

## Phase 4 -- POS / Sales Module

**Goal:** Full point-of-sale with cart, VAT extraction, payment dialog, receipt generation, and keyboard shortcuts.
**Effort:** 3--4 weeks (highest complexity)
**WinForms source:** `yojob.ventas/Ventas.cs` (536 lines), `RegistraVenta.cs`, `reportTiraVenta.cs`
**Current repo status:** Implemented

### 4.1 POS Cart State

Create `apps/web/src/features/pos/` with:

**State management** (React context or Zustand):

```typescript
interface CartItem {
  productId: string;
  productName: string;
  unitId: string;
  unitName: string;
  unitEquivalence: number;
  quantity: number;
  unitPrice: number; // VAT-inclusive price
  vatRate: number; // e.g., 0.19
  basePrice: number; // computed: unitPrice / (1 + vatRate)
  vatAmount: number; // computed: unitPrice - basePrice
  lineTotal: number; // computed: quantity * unitPrice
  lineVat: number; // computed: quantity * vatAmount
  lineBase: number; // computed: quantity * basePrice
}

interface CartState {
  items: CartItem[];
  customerId: string | null;
  siteId: string;
  subtotal: number; // sum of lineBase
  totalVat: number; // sum of lineVat
  total: number; // sum of lineTotal
}
```

### 4.2 POS Page Layout

| WinForms Element                 | React Target                                   |
| -------------------------------- | ---------------------------------------------- |
| `gridVentas` (XtraGrid)          | Cart table component                           |
| `txtCodigoVenta` (barcode input) | Barcode/SKU input with autofocus               |
| `lueProductoVenta` (LookUpEdit)  | Product search (inline autocomplete or dialog) |
| `spnCantidadVenta` (SpinEdit)    | Quantity input                                 |
| `txtPrecioVenta` (read-only)     | Price display (from selected product + unit)   |
| Bottom totals panel              | Subtotal / VAT / Total display                 |
| `btnRegistrarVenta` button       | "Charge" button -> opens payment dialog        |

**Layout:** Two-column layout

- Left: Cart table (70% width)
- Right: Product search + add controls (30% width)
- Bottom: Totals bar + action buttons

### 4.3 Adding Items to Cart

Flow (from WinForms `Ventas.cs`):

1. User scans barcode or searches product
2. System finds product, loads default unit and price
3. User adjusts quantity (default 1)
4. On add:
   a. Check if product already in cart (same product + same unit) -> increment quantity
   b. Validate stock: `currentStock >= requestedQty * unitEquivalence`
   c. Calculate VAT extraction: `basePrice = price / (1 + vatRate)`
   d. Add to cart, recalculate totals
5. User can edit quantity or remove items from cart

### 4.4 Payment Dialog

| WinForms Source    | Target                                        |
| ------------------ | --------------------------------------------- |
| `RegistraVenta.cs` | `apps/web/src/features/pos/PaymentDialog.tsx` |

**Modal dialog showing:**

- Total amount
- Payment method selector (cash, card, transfer, credit)
- Amount received (for cash -- calculate change)
- Customer selector (optional)
- Notes field
- "Confirm" button

### 4.5 Sale Finalization Endpoint

**This is the most critical endpoint in the system.** Must be fully transactional.

Current implementation lives in `packages/server/src/trpc/routers/sales.ts`:

```
POST /api/sales/finalize
Body: { items: CartItem[], customerId?, paymentMethod, amountReceived, siteId, notes? }

Transaction:
  1. Validate all items exist and are active
  2. For each item, validate stock >= quantity * unitEquivalence
  3. Get next sequential number: UPDATE sequentials SET currentValue = currentValue + 1
     WHERE siteId = ? AND documentType = 'sale' RETURNING currentValue
  4. Create sale record with saleNumber = prefix + sequential
  5. For each item:
     a. Insert sale_item with unitPrice, vatRate, taxAmount, total, costAtSale, unitId, unitEquivalence
     b. Decrement product stock: UPDATE products SET stock = stock - (quantity * unitEquivalence)
     c. Insert inventory_movement (type: 'sale', quantity: negative)
  6. Return { saleId, saleNumber, total, change }
```

**Error handling:**

- Insufficient stock -> return 409 with product name and available stock
- Sequential number conflict -> retry once
- Any failure -> full rollback

### 4.6 Keyboard Shortcuts

Map WinForms shortcuts to web equivalents:

| WinForms Key       | Action                    | React Implementation                 |
| ------------------ | ------------------------- | ------------------------------------ |
| F1                 | Save/finalize sale        | `useHotkeys('f1', finalize)`         |
| F5                 | Open product search       | `useHotkeys('f5', openSearch)`       |
| Alt+P              | Focus product field       | `useHotkeys('alt+p', focusProduct)`  |
| Alt+C              | Focus quantity field      | `useHotkeys('alt+c', focusQuantity)` |
| Alt+U              | Focus unit field          | `useHotkeys('alt+u', focusUnit)`     |
| Alt+D              | Focus discount field      | `useHotkeys('alt+d', focusDiscount)` |
| Delete             | Remove selected cart item | `useHotkeys('delete', removeItem)`   |
| Enter (in barcode) | Add scanned item to cart  | Form submit handler                  |

### 4.7 Receipt Generation

| WinForms Source                    | Target         |
| ---------------------------------- | -------------- |
| `reportTiraVenta.cs` (XtraReports) | PDF generation |

**Two approaches (choose one):**

1. **Server-side PDF:** Use `@react-pdf/renderer` or `pdfmake` on the server to generate receipt PDF, return as blob
2. **Client-side print:** Generate HTML receipt layout, use `window.print()` or Electron's `webContents.print()`

Receipt content (from WinForms report):

- Company name, address, phone, tax ID
- Site name
- Invoice number, date/time
- Customer name (if set)
- Line items: qty, product, unit price, total
- Subtotal, VAT breakdown, total
- Payment method, amount received, change
- Footer text

### 4.8 Sales History / Detail View

| WinForms Source     | Target                                                |
| ------------------- | ----------------------------------------------------- |
| `DetallesVentas.cs` | `apps/web/src/features/sales/SalesPage.tsx` (enhance) |

- List of completed sales with filters (date range, customer, payment method)
- Click to view detail: sale header + line items
- Void/cancel sale (admin only) -- reverses stock

### Deliverables

- [ ] POS page with cart state management
- [ ] Product search integration (barcode + search dialog)
- [ ] Cart item management (add, edit qty, remove)
- [ ] VAT extraction calculation (Colombian model)
- [ ] Stock validation with unit equivalence
- [ ] Payment dialog (cash/card/transfer/credit)
- [ ] Sale finalization endpoint (fully transactional)
- [ ] Sequential number generation (atomic)
- [ ] Receipt PDF/print generation
- [ ] Keyboard shortcuts
- [ ] Sales history with detail view
- [ ] Sale void/cancel with stock reversal

---

## Phase 5 -- Purchases Module

**Goal:** Purchase entry with stock increment, purchase history.
**Effort:** 1--2 weeks
**WinForms source:** `yojob.compras/Compras.cs`, `DetallesCompras.cs`
**Current repo status:** Implemented

### 5.1 Purchase Entry

| Layer  | WinForms Source                         | Target Location                                    |
| ------ | --------------------------------------- | -------------------------------------------------- |
| UI     | `Compras.cs`                            | `apps/web/src/features/purchases/PurchasesPage.tsx` |
| API    | `DB/Compra.cs`, `DB/CompraDetalle.cs`   | `packages/server/src/trpc/routers/purchases.ts`     |
| Schema | `DAO/compra.cs`, `DAO/compradetalle.cs` | `purchases`, `purchase_items` tables               |

**Simpler than sales:**

- Provider selector (required)
- Cart of items (product search + quantity + unit)
- No pricing in cart (purchases record cost, not sale price)
- Cost per unit can be entered to update product cost
- Site selector

### 5.2 Purchase Finalization Endpoint

```
POST /api/purchases/finalize
Body: { providerId, items: [...], siteId, notes? }

Transaction:
  1. Get next sequential for documentType = 'purchase'
  2. Create purchase record
  3. For each item:
     a. Insert purchase_item
     b. Increment product stock: UPDATE products SET stock = stock + (quantity * unitEquivalence)
     c. Optionally update product cost if costPerUnit provided
     d. Insert inventory_movement (type: 'purchase', quantity: positive)
  4. Return { purchaseId, purchaseNumber }
```

### 5.3 Purchase History

- List with filters (date range, provider)
- Detail view with line items
- Void/cancel (admin only, reverses stock)

### Deliverables

- [ ] `purchases` and `purchase_items` tables in schema
- [ ] Purchase entry page with provider selector and cart
- [ ] Purchase finalization endpoint (transactional)
- [ ] Purchase history with detail view
- [ ] Stock increment on purchase
- [ ] Cost update from purchase

---

## Phase 6 -- Reporting, Printing & Polish

**Goal:** Dashboard with live data, receipt printing, exports, role-based UI, polish.
**Effort:** 2--3 weeks
**Current repo status:** Partially implemented

### 6.1 Dashboard with Live Data

Status in current repo: implemented through `dashboard.summary`.

This was the original target. In the current repo, the dashboard aggregates now come from
`dashboard.summary` rather than standalone REST report endpoints:

| Metric                  | API Endpoint                     | WinForms Source                          |
| ----------------------- | -------------------------------- | ---------------------------------------- |
| Today's sales total     | `GET /api/reports/daily-sales`   | `Sale.TotalDiario()` (fix SQL injection) |
| Sales count today       | Same endpoint                    | `Sale.TotalDiario()`                     |
| Low stock alerts        | `GET /api/reports/low-stock`     | Compare `stock` vs `minStock`            |
| Top products (week)     | `GET /api/reports/top-products`  | New (not in WinForms)                    |
| Revenue chart (30 days) | `GET /api/reports/revenue-chart` | New                                      |

### 6.2 Receipt Printing via Electron

Status in current repo: implemented via Electron IPC with browser fallback.

For the desktop app (Electron), use IPC to print receipts to thermal printers:

```typescript
// main process (Electron)
ipcMain.handle('print-receipt', async (event, receiptHtml) => {
  const printWindow = new BrowserWindow({ show: false });
  printWindow.loadURL(`data:text/html,${encodeURIComponent(receiptHtml)}`);
  printWindow.webContents.on('did-finish-load', () => {
    printWindow.webContents.print({ silent: true, printBackground: true });
  });
});
```

For the web app, use `window.print()` with a print-specific CSS stylesheet.

### 6.3 Export to Excel/PDF

Status in current repo: implemented for the main products, sales, purchases, and inventory views.

- Add export buttons to all list views (products, sales, purchases, inventory)
- Use `xlsx` library for Excel export
- Use `@react-pdf/renderer` or `jspdf` for PDF export

### 6.4 Role-Based UI

Status in current repo: implemented in both route guards/menu visibility and server middleware.

Map WinForms roles to target:

| WinForms Role | Target Role | Access                              |
| ------------- | ----------- | ----------------------------------- |
| `admin`       | `admin`     | Full access to all modules          |
| `vendedor`    | `cashier`   | POS only, no admin/inventory        |
| N/A           | `manager`   | POS + inventory + reports, no admin |

Implement:

- Route guards based on `user.role` from auth context
- Sidebar menu items filtered by role
- API middleware to enforce role-based access on sensitive endpoints

### 6.5 UI/UX Polish

- Loading states (skeleton screens)
- Error boundaries with retry
- Toast notifications for CRUD operations
- Confirmation dialogs for destructive actions
- Responsive layout for tablet use
- Dark mode toggle (settings)
- Keyboard navigation in tables

### 6.6 Electron-Specific Features

- Auto-updater (present in current Electron main process)
- System tray icon
- Offline detection banner
- Local database backup/restore
- Print settings configuration

### Deliverables

- [x] Dashboard with live aggregation data
- [x] Receipt printing (Electron IPC + web fallback)
- [x] Excel/PDF export on the main operational list views
- [x] Role-based route guards and menu filtering
- [x] API role enforcement middleware
- [ ] Loading states and error boundaries
- [ ] Toast notifications
- [x] Auto-updater setup
- [ ] Offline detection banner

---

## Cross-Reference: WinForms File to Target Location

### yojob (Shell)

| WinForms File      | Purpose                             | Target Equivalent                                 |
| ------------------ | ----------------------------------- | ------------------------------------------------- |
| `FormPrincipal.cs` | MDI host, ribbon, MEF loader, login | `MainLayout.tsx` + `App.tsx` + `AuthProvider.tsx` |

### yojob.lib (Shared Library)

| WinForms File               | Purpose                      | Target Equivalent                                  |
| --------------------------- | ---------------------------- | -------------------------------------------------- |
| `DB/Product.cs`             | Product data access          | `trpc/routers/products.ts`                         |
| `DB/Sale.cs`                | Sale data access             | `trpc/routers/sales.ts`                            |
| `DB/Compra.cs`              | Purchase data access         | `trpc/routers/purchases.ts`                        |
| `DB/CompraDetalle.cs`       | Purchase item data access    | `trpc/routers/purchases.ts`                        |
| `DB/Stock.cs`               | Stock queries                | `trpc/routers/inventory.ts`                        |
| `DB/Client.cs`              | Client data access           | `trpc/routers/customers.ts`                        |
| `DB/Proveedor.cs`           | Provider data access         | `trpc/routers/providers.ts`                        |
| `DB/IVA.cs`                 | VAT rate data access         | `trpc/routers/vatRates.ts`                         |
| `DB/Unidad.cs`              | Unit data access             | `trpc/routers/units.ts`                            |
| `DB/UnidadXProducto.cs`     | Unit-product association     | `trpc/routers/products.ts`                         |
| `DB/ProductoXProveedor.cs`  | Product-provider association | `trpc/routers/products.ts`                         |
| `DB/Empresa.cs`             | Company data access          | `trpc/routers/companies.ts`                        |
| `DB/Sede.cs`                | Site data access             | `trpc/routers/sites.ts`                            |
| `DB/Consecutivo.cs`         | Sequential numbers           | `trpc/routers/sales.ts`, `trpc/routers/purchases.ts` |
| `DB/InventarioInicial.cs`   | Initial inventory            | `trpc/routers/inventory.ts`                        |
| `DB/Usuario.cs`             | User data access             | `trpc/routers/users.ts`                            |
| `DB/Categoria.cs`           | Category data access         | `trpc/routers/categories.ts`                       |
| `dbEntities.cs`             | EF6 context                  | `db/schema.ts` + Drizzle ORM                       |
| `Utilidades.cs`             | Utilities (auth, GUID, MDI)  | Various: `AuthProvider.tsx`, `crypto.randomUUID()` |
| `DataNavigatorThink.cs`     | CRUD state machine           | Standard form state (React `useState`)             |
| `ProductosSearch.cs`        | Product search dialog        | `components/dialogs/ProductSearchDialog.tsx`       |
| `GenericPrincipalIthink.cs` | Auth principal               | `AuthProvider.tsx` + JWT payload                   |
| `GenericIdentityIthink.cs`  | Auth identity                | `AuthProvider.tsx` + JWT payload                   |
| `IUserForm.cs`              | Plugin interface             | React Router routes (no plugin system needed)      |

### yojob.administrador (Admin Plugin)

| WinForms File     | Purpose                  | Target Equivalent                                                |
| ----------------- | ------------------------ | ---------------------------------------------------------------- |
| `Productos.cs`    | Product management form  | `features/products/ProductsPage.tsx` (enhanced)                  |
| `Clientes.cs`     | Client management form   | `features/customers/CustomersPage.tsx` (enhanced)                |
| `Proveedores.cs`  | Provider management form | `features/providers/ProvidersPage.tsx` (new)                     |
| `Categorias.cs`   | Category CRUD            | `features/categories/CategoriesPage.tsx` (implemented)           |
| `Empresas.cs`     | Company/site management  | `features/company/CompanyPage.tsx` (implemented)                 |
| `IVAs.cs`         | VAT rate management      | `features/vat-rates/VatRatesPage.tsx` (implemented)              |
| `Consecutivos.cs` | Sequential config        | `features/sequentials/SequentialsPage.tsx` (implemented)         |
| `Unidades.cs`     | Unit management          | `features/units/UnitsPage.tsx` (implemented)                     |
| `Usuarios.cs`     | User management          | `features/users/UsersPage.tsx` (implemented)                     |

### yojob.ventas (Sales Plugin)

| WinForms File        | Purpose             | Target Equivalent                         |
| -------------------- | ------------------- | ----------------------------------------- |
| `Ventas.cs`          | POS / point-of-sale | `features/pos/PosPage.tsx` (new)          |
| `RegistraVenta.cs`   | Payment dialog      | `features/pos/PaymentDialog.tsx` (new)    |
| `reportTiraVenta.cs` | Receipt report      | `features/pos/ReceiptTemplate.tsx` (new)  |
| `DetallesVentas.cs`  | Sales detail report | `features/sales/SalesPage.tsx` (enhanced) |

### yojob.compras (Purchases Plugin)

| WinForms File        | Purpose                | Target Equivalent                                  |
| -------------------- | ---------------------- | -------------------------------------------------- |
| `Compras.cs`         | Purchase entry         | `features/purchases/PurchasePage.tsx` (new)        |
| `DetallesCompras.cs` | Purchase detail report | `features/purchases/PurchaseHistoryPage.tsx` (new) |

### yojob.inventarios (Inventory Plugin)

| WinForms File           | Purpose                 | Target Equivalent                                   |
| ----------------------- | ----------------------- | --------------------------------------------------- |
| `InventarioInicial.cs`  | Initial inventory entry | `features/inventory/InitialInventoryPage.tsx` (new) |
| `ConsultaExistencia.cs` | Stock query view        | `features/inventory/StockQueryPage.tsx` (new)       |

---

## Appendix: WinForms Database Tables

Complete list of entity classes from `yojob.lib/DAO/` mapped to target table names:

| #   | WinForms Entity (DAO) | WinForms Table        | Target Table            | Phase |
| --- | --------------------- | --------------------- | ----------------------- | ----- |
| 1   | `empresa`             | `empresa`             | `companies`             | P0    |
| 2   | `sede`                | `sede`                | `sites`                 | P0    |
| 3   | `consecutivo`         | `consecutivo`         | `sequentials`           | P0    |
| 4   | `iva`                 | `iva`                 | `vat_rates`             | P0    |
| 5   | `unidad`              | `unidad`              | `units`                 | P0    |
| 6   | `unidadxproducto`     | `unidadxproducto`     | `unit_x_product`        | P0    |
| 7   | `proveedor`           | `proveedor`           | `providers`             | P0    |
| 8   | `producto`            | `producto`            | `products` (extend)     | P0    |
| 9   | `categoria`           | `categoria`           | `categories` (exists)   | --    |
| 10  | `usuario`             | `usuario`             | `users` (exists)        | --    |
| 11  | `cliente`             | `cliente`             | `customers` (extend)    | P1    |
| 12  | `productoxproveedor`  | `productoxproveedor`  | `product_x_provider`    | P1    |
| 13  | `inventarioinicial`   | `inventarioinicial`   | `initial_inventory`     | P3    |
| 14  | `venta`               | `venta`               | `sales` (exists)        | P4    |
| 15  | `ventadetalle`        | `ventadetalle`        | `sale_items` (extend)   | P4    |
| 16  | `compra`              | `compra`              | `purchases`             | P5    |
| 17  | `compradetalle`       | `compradetalle`       | `purchase_items`        | P5    |
| 18  | `pedido`              | `pedido`              | `orders`                | P2    |
| 19  | `pedidodetalle`       | `pedidodetalle`       | `order_items`           | P2    |
| 20  | `ubicacion`           | `ubicacion`           | `locations`             | P1    |
| 21  | `ubicacionxsede`      | `ubicacionxsede`      | `location_x_site`       | P1    |
| 22  | `categoriaxproveedor` | `categoriaxproveedor` | `category_x_provider`   | P2    |
| 23  | `ciudad`              | `ciudad`              | `cities`                | P2    |
| 24  | `departamento`        | `departamento`        | `departments`           | P2    |
| 25  | `tipoidentificacion`  | `tipoidentificacion`  | `identification_types`  | P2    |
| 26  | `tipopersona`         | `tipopersona`         | `person_types`          | P2    |
| 27  | `tiporegimen`         | `tiporegimen`         | `regime_types`          | P2    |
| 28  | `actividadcomercial`  | `actividadcomercial`  | `commercial_activities` | P2    |
| 29  | `tipocliente`         | `tipocliente`         | `client_types`          | P2    |
| 30  | `logo`                | `logo`                | `logos`                 | P3    |

---

## Summary Timeline

| Phase       | Description                   | Effort           | Depends On  |
| ----------- | ----------------------------- | ---------------- | ----------- |
| **Phase 0** | Foundation & Schema Alignment | 2--3 weeks       | --          |
| **Phase 1** | Administration Module         | 2--3 weeks       | Phase 0     |
| **Phase 2** | Product Management & Pricing  | 2--3 weeks       | Phase 1     |
| **Phase 3** | Inventory Module              | 1--2 weeks       | Phase 2     |
| **Phase 4** | POS / Sales Module            | 3--4 weeks       | Phase 2     |
| **Phase 5** | Purchases Module              | 1--2 weeks       | Phase 2     |
| **Phase 6** | Reporting, Printing & Polish  | 2--3 weeks       | Phases 3--5 |
|             | **Total**                     | **12--19 weeks** |             |

Phases 3, 4, and 5 can run in parallel after Phase 2 is complete, potentially reducing the calendar time to ~10 weeks.
