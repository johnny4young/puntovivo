# tRPC Architecture

> Updated: April 15, 2026

## Summary

Puntovivo is a tRPC-first application.
The canonical application API is:

- `/api/trpc`

Two non-tRPC endpoints still exist intentionally:

- `/api/health` for compatibility checks
- `/api/realtime/*` for SSE

## Backend Request Flow

1. The client calls a query or mutation through the tRPC React client or the shared vanilla client.
2. Requests are batched over HTTP to `/api/trpc`.
3. Fastify builds a tRPC context with:
   - DB handle
   - authenticated user, if present
   - tenant ID
   - current site ID from `x-site-id`
4. Middleware applies:
   - auth requirements
   - tenant isolation
   - role guards
5. Routers validate inputs with Zod and run Drizzle queries or transactions.
6. TanStack Query handles caching and invalidation in the renderer.

## Client Configuration

The web client is configured in:
[trpc.ts](/Users/johnny4young/Personal/github/puntovivo/apps/web/src/lib/trpc.ts)

Current request headers:

- `Authorization: Bearer <accessToken>` when logged in
- `x-site-id: <siteId>` when a site is selected
- `x-csrf-token: <csrfToken>` on cookie-backed unsafe auth flows such as refresh/logout

Session model:

- the web client keeps the short-lived access token in memory only
- session continuity comes from a rotated `httpOnly` refresh cookie
- `health.check` can mint the readable CSRF cookie needed before calling cookie-backed unsafe auth procedures
- password changes and admin password resets revoke older tokens through a per-user session version check
- token validation also rejects stale `role`/`email` claims and tenants that are no longer active

## Current Router Surface

Current root router modules:

- `health`
- `auth`
- `companies`
- `countries`
- `identificationTypes`
- `personTypes`
- `regimeTypes`
- `clientTypes`
- `commercialActivities`
- `dashboard`
- `departments`
- `cities`
- `logos`
- `providers`
- `sequentials`
- `units`
- `vatRates`
- `categories`
- `products`
- `orders`
- `customers`
- `purchases`
- `sales`
- `cashSessions`
- `inventory`
- `locations`
- `sites`
- `sync`
- `transfers`
- `users`

Source:
[router.ts](/Users/johnny4young/Personal/github/puntovivo/packages/server/src/trpc/router.ts)

## Why tRPC Matters in This Repo

- frontend and backend share end-to-end types through `AppRouter`
- business logic for sales, purchases, inventory, orders, and sync lives server-side
- the old app-style REST client layers are no longer the primary application path
- role enforcement is centralized in middleware instead of spread across screens

## Cash Sessions Router

`cashSessions` is the Phase 1 cash-management surface. It exposes:

- `registerAssignments` — active-site register templates for POS assignment, including occupancy metadata for registers already opened by another cashier
- `getActive` — returns the current cashier's open session for the active site, or `null`
- `listRecent` — last 20 sessions for the tenant (any site)
- `open` — opens a session after validating the opening float matches the denomination count
- `close` — closes the session in blind mode (expected balance stays hidden until count submission) and writes `actualCount`, `overShort`, and `closedAt`
- `movements` — paginated timeline of cash movements for a session (cashier sees own; admin/manager sees any session in the active site)
- `report` — active-site cash management report with active sessions, recent closures, and over/short summary (cashier sees own sessions only; admin/manager see site-wide data)
- `recordMovement` — manual paid-in / paid-out / skim / replenishment entries with an audit note

Automatic movements:

- `sales.create` writes a `sale` cash movement against the cashier's active session when the sale is paid in cash
- `sales.returnSale` writes a `refund` cash movement against the refunding cashier's active session
- `sales.void` writes a `refund` cash movement against the ORIGINAL sale's session ONLY if that session is still open; voids that target a closed session leave the finalized over/short untouched

Every movement updates `cash_sessions.expected_balance` inside the same transaction via a signed delta derived from `CASH_MOVEMENT_POSITIVE_TYPES` / `CASH_MOVEMENT_NEGATIVE_TYPES` in `services/cash-session.ts`.

`registerAssignments` bootstraps standardized denomination templates from `denomination_templates` for the active site, backfills missing register templates from historical sessions, and lets the POS preload the opening dialog with the register's standard float breakdown.

## Inventory Router — Per-Site Balances

`inventory.listBalancesBySite` is the Phase 2 site-owned inventory read
(DB-101 / API-101). It returns on-hand / reserved / available per product for
a specific site plus a summary (totals + low-stock count).

The `inventory_balances` table is **authoritative** from Phase 2 step 1
onward. `ensureInventoryBalancesForSite` is a seed-only helper:

- The earliest-created active site per tenant is the **primary site** and
  receives current `products.stock` as its initial `on_hand`.
- Every other active site seeds at `on_hand = 0`.
- New products added after the initial seed create zero-rows on the next read.
- **Existing balance rows are never re-synced** — writes (transfers, future
  sale/purchase integrations) are the only source of truth.

Seeding reads and inserts run inside a single better-sqlite3 transaction so the
"which site is primary" check is consistent with the inserts. The unique index
`(tenant_id, site_id, product_id)` combined with `ON CONFLICT DO NOTHING`
makes repeated reads idempotent.

## Transfers Router

`transfers.create` is the first Phase 2 write path that mutates
`inventory_balances` (DB-102 / API-102 step 1). It atomically:

1. Validates origin and destination sites belong to the tenant and are active.
2. Collapses duplicate product lines by summing quantities.
3. Lazily seeds missing origin/destination balance rows using the same
   primary-site migration rules as `inventory.listBalancesBySite`, then reads
   each origin balance and rejects with `TRANSFER_INSUFFICIENT_STOCK` if
   `on_hand < qty`.
4. Decrements origin and increments destination for every line.
5. Writes a `transfer_orders` row (status `completed`) plus one
   `transfer_order_items` row per product.

Step 1 collapses `create` + `ship` + `receive` into a single mutation when
`defer` is false (the default). Step 2 adds `transfers.void`:

- Reads the transfer row (with tenant guard) and rejects with
  `TRANSFER_NOT_FOUND` / `TRANSFER_ALREADY_VOID` when appropriate.
- **Pre-validates destination stock for every line before mutating any row**
  so a missing balance produces `TRANSFER_VOID_INSUFFICIENT_STOCK` without
  corrupting partial state (only runs for `completed` transfers — an
  `in_transit` transfer never credited the destination, so there is nothing
  to reverse on that side).
- Decrements destination (when the transfer was `completed`) and re-credits
  origin (seeding the origin row if it was removed in the meantime).
- Flips `transfer_orders.status` to `void` and appends `[VOID] <reason>` to
  the notes.

Step 3 adds deferred receive:

- `transfers.create({ defer: true })` persists the transfer as `in_transit`.
  Origin is debited immediately (the stock has physically left the source
  shelf) but the destination is NOT credited.
- `transfers.receive({ transferId })` flips the transfer to `completed`,
  credits the destination, and stamps `receivedAt` / `receivedBy`. Rejects
  with `TRANSFER_NOT_IN_TRANSIT` when the transfer is in any other status.
- Every balance-mutating path calls `syncProductStockFromBalances` so the
  step-4 invariant (`products.stock == Σ(balances)`) holds through the
  entire in-transit window.

An explicit `draft` state without any balance movement remains deferred.

UI-103 extends `transfers.receive` with a per-line variance contract:

- `receiveTransferInput` widens to `{ transferId, lines?: [{ itemId,
  receivedQuantity }], discrepancyNotes? }`. When `lines` is omitted or
  empty, every line is credited at the shipped quantity (legacy one-click
  behaviour). When supplied, each entry addresses a `transfer_order_items.id`
  and must satisfy `0 <= receivedQuantity <= shipped`.
- `received > shipped` raises `TRANSFER_RECEIVED_EXCEEDS_SHIPPED` — accepting
  would create stock from nothing. Unknown or duplicated `itemId`s raise
  `TRANSFER_RECEIVE_LINE_MISMATCH`.
- The service writes the per-line amount to `transfer_order_items.received_quantity`
  (previously null for in-flight rows), credits the destination with exactly
  that amount, and stamps `transfer_orders.discrepancy_notes` with the
  trimmed receiver note (null when empty). The origin was already debited by
  the **shipped** quantity at create time, so any `shipped - received` delta
  drops out of `Σ(balances)` as intentional shrinkage — `products.stock`
  auto-follows via `syncProductStockFromBalances`.
- `transfers.void` reads `receivedQuantity ?? quantity` for the destination
  debit: legacy rows and unchanged receipts reverse exactly as before, while
  partial-receipt voids debit destination by the received amount and credit
  origin by the shipped amount (net: tenant stock restored to the pre-transfer
  state).
- `transfers.list` and `transfers.getById` surface `hasDiscrepancy` plus
  `discrepancyNotes`; `getById` also exposes `receivedQuantity` per line for
  the detail drawer's Received/Variance columns.

`transfers.list` returns a reverse-chronological page of recent transfer
history with origin/destination site names and item aggregates.
`transfers.getById` returns the full detail of a single transfer — including
joined product names/SKUs per line item — for the read-only detail drawer in
the By Site tab.

## Sales ↔ Inventory Balances (Phase 2 API-103)

As of Phase 2 step 3, the sales flow writes through to `inventory_balances`
alongside the legacy `products.stock` update:

- `sales.create` debits the cashier's active cash-session site
  (`cashSessions.siteId`) by the normalized sold quantity. This avoids
  mis-posting stock when the sale sequential falls back to another site's
  numbering configuration.
- `sales.create` now validates availability against that same site's
  `inventory_balances.on_hand`, not tenant-wide `products.stock`, so a
  secondary site cannot sell stock it never received.
- `sales.returnSale` and `sales.void` credit back the **original** sale's
  site, resolved via `cashSessions.siteId` — not `ctx.siteId`, because the
  refund/void may be performed at a different register.
- Legacy sales without a cash session silently no-op (the helper is a
  no-op when `siteId` is null), preserving backwards compatibility.

The helper `applyInventoryBalanceDelta` takes an optional
`initialOnHandIfMissing` to seed a missing row from the caller's pre-delta
snapshot — required when the same transaction also mutates `products.stock`,
because the default fallback would read the post-mutation value and produce
a double-count.

The next API-103 step wires purchases/order receiving into the same model:

- `purchases.create` credits the operator's current site balance. If the
  purchase sequential falls back to another site's numbering config, the
  document number may come from that fallback sequential, but the stock lands
  in the operator's actual site.
- `purchases.createFromOrder` credits the order's site balance, not the
  fallback purchase-sequential site.
- `purchases.returnPurchase` and `purchases.void` debit the original purchase
  site and reject when that site no longer has enough stock, even if
  tenant-wide `products.stock` is still sufficient elsewhere.

The web mutations that create, receive, return, or void purchases now also
invalidate `inventory.listBalancesBySite`, so the Inventory → By Site tab
stays fresh without a hard reload.

### Admin inventory tools (API-103 step 3)

`inventory.adjustStock` and `inventory.recordEntry` are the last
stock-mutation paths wired into `inventory_balances`:

- `inventory.adjustStock` accepts an optional `siteId` input and resolves the
  target site via `input.siteId ?? ctx.siteId ?? getPrimarySiteId()`. The
  per-site delta is `input.newStock - product.stock`. When the resolved site
  is non-primary, `ensurePrimaryInventoryBalanceSnapshot` first seeds the
  primary's row with the pre-adjustment aggregate so a later first read of
  the primary still reflects the prior tenant stock. The helper short-circuits
  when the delta is zero.
- `inventory.recordEntry` uses `ctx.siteId` (the same value it already
  persists on `initial_inventory.siteId`). `mode: 'initial'` credits the site
  by `normalizedQuantity`; `mode: 'physical'` sets the site to the counted
  absolute via `delta = newStock - product.stock`.

The helper `getPrimarySiteId(tx, tenantId)` is the shared primary-site
resolver used by every balance-aware service (balances, transfers,
adjustments). It lives in `services/inventory-balances.ts`.

### Phase 2 API-103 step 4 — `products.stock` derived cache

Step 4 closes the drift window. `applyInventoryBalanceDelta` now ends with a
call to `syncProductStockFromBalances(tx, { tenantId, productId })` that
recomputes `products.stock` as Σ(`inventory_balances.on_hand`) across all
sites for the product. The invariant is now:

> `products.stock` == Σ(`inventory_balances.on_hand`) per product, always, at
> commit boundaries.

Historical drift from pre-step-2 data is healed with the new admin
mutation `inventory.reconcileBalances`, which walks every product in the
tenant and re-runs the recompute inside a single transaction. Use it after
migrations or data imports; regular operation never needs it.

## Split Payments (Phase 2 Tier-2 step 5)

`sales.create` now accepts an optional `payments` array to record a
single sale settled with multiple tenders (e.g. partial cash + partial card).
The persistence model:

- A new `sale_payments` table holds one row per tender (method, amount,
  optional reference). The table is tenant-scoped, cascades on sale delete,
  and participates in the same sync fields (`syncStatus`, `syncVersion`) as
  the rest of the sales surface.
- `sales.create` normalizes both input modes into a single write loop via
  `resolveSalePayments`:
  - Multi-tender: validates `Σ(amount) ≈ total` within a cent of tolerance
    (`PAYMENT_SUM_EPSILON = 0.005`) and throws
    `SALE_PAYMENTS_SUM_MISMATCH` on violation.
  - Legacy single-tender: synthesizes one row capped at the sale total
    (cash overage is change, not a persisted tender).
- Split sales are always persisted as `paid`. `getPaymentStatus` is
  short-circuited when `isSplit: true` — this guard precedes the credit
  check so the invariant survives any future expansion of
  `splitPaymentMethodEnum`.
- The legacy `sales.paymentMethod` column is echoed with the **dominant**
  tender (largest amount, ties broken in favor of the first-supplied entry)
  so older screens and reports keep rendering sensibly without having to
  join `sale_payments`.
- Cash-session accounting derives from the sum of **cash-method** tenders
  only when split; the transfer/card/other portions do not hit the cash
  session's expected balance.
- `splitPaymentMethodEnum` excludes `credit` by construction. Credit sales
  stay on the legacy single-tender path until Phase 5 adds on-account
  balances and abonos.

Frontend: `SalePaymentModal` offers a "Split payment across tenders"
affordance that seeds one row and lets the cashier add/remove tenders. The
Confirm button is gated by `Σ(tenders) ≈ total` and
`tendersAreAllPositive`. Amount inputs use `setValueAs` (not
`valueAsNumber: true`) to return 0 on cleared fields — the documented
react-hook-form workaround for the `useFieldArray` + `NaN` edge case.
`getCheckoutPaymentState` owns the single "is this a split?" decision: it
derives the legacy triplet (`paymentMethod`/`paymentStatus`/
`amountReceived`) plus a normalized `payments` array (or `undefined` on
the legacy path) for `SalesPage` to forward verbatim.

Read-side surfaces: `sales.getById` includes the ordered `payments` array
on every sale record (single-tender sales have one row; split sales have
N≥2). `SaleDetailsContent` renders a "Payments" section with a method /
reference / amount table only when `hasSplitPayments(sale)` (i.e.
`payments.length > 1`) — single-row sales stay on the existing Payment
tile to avoid one-row noise. The receipt HTML (`receiptPrinter.ts`,
shared by the web print-window path and the Electron print bridge) adds
a `<section class="tenders">` with the same three columns under the
Totals section when the sale is split; blank references render as an
em-dash. The receipt text is intentionally English-only today (matching
the rest of the file); when the receipt path gets localized, the TSX
`details.payments*` keys in `sales.json` are the canonical translations
to reuse.

## Quotations Router (Phase 5 / Tier-2 #6 step 1)

`quotations.create` persists a non-binding pre-sale document. Inventory is
NOT touched at create time — `inventory_balances` and `products.stock` only
move once a quotation is converted into a sale (deferred to a later slice).

Per-line totals follow the same gross-priced model as `sales`: the `unitPrice`
input is treated as the customer-facing amount per unit, the per-line discount
is applied first, and the line tax is then extracted from the post-discount
total using the per-line `taxRate` (with the product VAT as the fallback when
zero). Header totals are the column-wise sums and the cache row stores
`subtotal` (tax-exclusive base) + `taxAmount` + `discountAmount` + `total`
(gross). Document numbers come from the `sequentials` table under document
type `quotation`; the seed and `seed.ts` ensure a `COT-` prefixed sequential
exists for every site (idempotent on every server boot).

Status transitions are enforced server-side via `ALLOWED_TRANSITIONS`:

```
draft     → sent | rejected | expired
sent      → accepted | rejected | expired
accepted  → expired | converted
rejected  → (terminal)
expired   → (terminal)
converted → (terminal — operator marked the quote as closed after the sale
             was completed through the regular POS; no inventory side
             effects, the sale itself is the authoritative record)
```

`quotations.updateStatus` rejects any transition outside this map with
`QUOTATION_INVALID_STATUS_TRANSITION` and stamps `statusChangedAt`/`statusChangedBy`.
`quotations.delete` is restricted to drafts (`QUOTATION_DELETE_NOT_DRAFT`); the
items table cascades on delete via the FK `ON DELETE CASCADE` constraint.

Every write-path procedure (`updateStatus`, `delete`) scopes BOTH the
validation `SELECT` and the subsequent write to `(id, tenantId)` so a caller
holding a known quotation id from a different tenant hits `QUOTATION_NOT_FOUND`
instead of being able to mutate it. The same guard extends to the sequential
resolver (`sequentials.tenantId` + `sites.tenantId` both filtered) so even the
fallback number-assignment path cannot cross tenant boundaries. Cross-tenant
regression tests cover both `updateStatus` and `delete`.

`quotations.list` returns reverse-chronological entries with item counts and
joined customer/site names, supports optional `status` and `customerId`
filters, and is bounded by a `limit ≤ 200` (default 50). `quotations.getById`
returns the full header + per-line detail and resolves both the creator and
the latest status-change actor user names for the drawer's audit panel.

## Audit Logs Router (Phase 8 / Tier-2 #8)

Every sensitive operation (void, delete, convert) persists one row in
`audit_logs` via a transactional `writeAuditLog` helper in
`services/audit-logs.ts`. The writer MUST be called inside the caller's
transaction so the audit and the audited action share an atomic boundary —
if the operation rolls back, so does its audit row. A regression test in
`__tests__/audit-logs.test.ts` pins this invariant (delete-non-draft
rolls back, no orphan audit row survives).

Wire-ups in this slice:

```
transfers.void          → action "transfer.void"           resourceType "transfer_order"
quotations.delete       → action "quotation.delete"        resourceType "quotation"
quotations.updateStatus → action "quotation.convert"       resourceType "quotation"
(only when nextStatus === "converted"; intermediate draft→sent→accepted
transitions are NOT audited — the viewer cares about outcomes, not workflow)
sales.void              → action "sale.void"               resourceType "sale"
sales.returnSale        → action "sale.return"             resourceType "sale"
cashSessions.close      → action "cash_session.close"      resourceType "cash_session"
inventory.adjustStock   → action "inventory.adjust_stock"  resourceType "product"
(skipped when delta === 0; the movement/sync rows above the audit call
still land unconditionally — pre-existing behaviour, documented inline
for the next cleanup pass)
purchases.void          → action "purchase.void"           resourceType "purchase"
users.create            → action "user.create"             resourceType "user"
(password hash is NEVER included in before/after; only email, name, role,
isActive land on the audit row)
users.update            → action "user.update"             resourceType "user"
(emits only when role or isActive changes; name/email-only edits do not
pollute the audit timeline; the before/after snapshots carry only the
fields that actually transitioned)
sales.create            → action "sale.price_override"     resourceType "sale"
(one audit row per sale summarizing every line whose unitPrice deviated
from unit_x_product.price beyond a cent of tolerance; skipped entirely
when no override happened)
```

The row carries a `before` / `after` JSON snapshot plus free-form
`metadata` (e.g. the void reason). New auditable operations can be added
by calling `writeAuditLog` from those services — there is no schema
migration and no enum to extend at the DB layer; the TypeScript literal
unions in `db/schema.ts` (`auditLogActionEnum`, `auditLogResourceTypeEnum`)
are the single source of truth for allowed values.

`auditLogs.list` is the read surface, gated behind `adminProcedure`.
Supports filters (action, resourceType, resourceId, actorId, createdAfter,
createdBefore) and is bounded by `limit ≤ 500` (default 100). The `users`
join is tenant-guarded (`AND users.tenantId = $tenantId`) so a hypothetical
cross-tenant actorId cannot leak the sibling tenant's actor name or email
through the viewer — a regression test pins this behaviour by manually
inserting a foreign-actor audit row and asserting the join collapses
`actorName` / `actorEmail` to null.

## Schema migrations (ENG-002)

The database schema is defined in Drizzle (`packages/server/src/db/schema.ts`)
and mirrored in a legacy `runSchemaSync()` raw-DDL bootstrap for historical
reasons. As of ENG-002 step 1, **versioned Drizzle migrations are the
canonical path** for every new schema change:

1. Edit `schema.ts` (add a column, widen a type, etc.).
2. From `packages/server`, run `npm run db:generate`. This calls
   `drizzle-kit generate`, diffs the schema against `meta/_snapshot.json`,
   and emits a new SQL file under `src/db/migrations/` with a matching
   journal entry.
3. Inspect and commit the generated `.sql` file + updated `meta/` files.
4. On the next server boot, `initDatabase()` runs the migrator before any
   router work. Fresh installs apply every migration top-to-bottom;
   existing installs only apply what they have not already seen.

Adoption shim: installs that predate ENG-002 still carry the schema from
`runSchemaSync()` and have no `__drizzle_migrations` table. On first boot
against this codebase, `ensureMigrationBaseline()` detects a populated
DB (any user-defined table other than `__drizzle_migrations`) and pre-
seeds the baseline row with the exact `(hash, created_at)` Drizzle would
write. That short-circuits the migrator's baseline re-run so it does not
collide with the existing tables.

`runSchemaSync()` is retained for one more release cycle as a belt-and-
suspenders no-op: its `CREATE TABLE IF NOT EXISTS` blocks are idempotent,
so running it after the migrator costs nothing on an already-migrated DB.
A follow-up ticket removes it once every deployed install has exercised
the shim.

Timestamp defaults: the schema keeps timestamp columns on a dynamic SQL
default (`datetime('now')`) so the generated baseline does not freeze the
wall-clock time of `drizzle-kit generate`. Drizzle inserts still attach an
ISO timestamp in application code via `$defaultFn(() => new Date().toISOString())`,
which preserves the existing runtime shape while keeping migration output
stable.

Build/runtime note: `packages/server` now copies `src/db/migrations/**/*`
into `dist/db/migrations` during `npm run build`. The embedded Electron
backend imports the compiled server package, so the migrator must resolve
real SQL and `meta/_journal.json` files from `dist/`, not only from `src/`.

PostgreSQL parity: the migrator today runs SQLite-only SQL. Adopting
PostgreSQL requires either parallel dialect-specific migration folders or
the repository-interface abstraction tracked under ENG-010.

Electron packaging gap (ENG-002 follow-up): the current Vite main config
bundles `@puntovivo/server` into `.vite/build/*.cjs` at package time, but
the raw `.sql` migration files are NOT included in the packaged asar.
`initDatabase()` therefore guards `drizzleMigrate()` with an `existsSync`
check on `meta/_journal.json`; if the folder is missing it logs a
warning and falls back to `runSchemaSync()` so the app still boots.
Wiring migrations into the Electron bundle (as an `extraResource` in
`forge.config.ts` plus an explicit `migrationsFolder` override passed to
`initDatabase()` from `apps/desktop/src/main/index.ts`) is tracked as
ENG-002 step 2 and must land before `runSchemaSync()` can be retired.

## Current Exceptions and Boundaries

- `/api/health` remains for compatibility and smoke checks
- SSE remains a Fastify plugin, not a tRPC concern
- desktop offline support also uses a preload bridge for allowlisted local DB and sync actions
- some browser-only utilities still use the `vanillaClient` outside React components

## Reference Files

- Server entry:
  [index.ts](/Users/johnny4young/Personal/github/puntovivo/packages/server/src/index.ts)
- Root router:
  [router.ts](/Users/johnny4young/Personal/github/puntovivo/packages/server/src/trpc/router.ts)
- Context:
  [context.ts](/Users/johnny4young/Personal/github/puntovivo/packages/server/src/trpc/context.ts)
- Middleware:
  [middleware](/Users/johnny4young/Personal/github/puntovivo/packages/server/src/trpc/middleware)
- Client:
  [trpc.ts](/Users/johnny4young/Personal/github/puntovivo/apps/web/src/lib/trpc.ts)
