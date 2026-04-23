# Puntovivo Test Plan

Execution matrix for manual validation and later automation with Playwright Web and Playwright Electron.

## Conventions

- Runner:
  - `WEB` = browser app with standalone backend
  - `ELEC` = Electron desktop app
  - `BOTH` = run in both environments
- Status:
  - `⬜` Pending
  - `✅` Passed
  - `❌` Failed
  - `⏸` Partially executed, environment-specific, or blocked after one runner
- Roles:
  - `admin`
  - `manager`
  - `cashier`
  - `viewer`

## Preconditions

- Development admin credentials:
  - Email: `admin@localhost`
  - Password: `Admin123!Dev`
- Base data should exist for stable execution:
  - 1 company
  - 2 active sites
  - 3 sequentials: `sale`, `purchase`, `order`
  - VAT rates
  - units
  - countries, departments, cities
  - locations
  - categories
  - providers
  - customers
  - products
- Additional users should exist for:
  - `manager`
  - `cashier`
  - `viewer`

## Environment Matrix

- `WEB`
  - recommended: `npm run dev:web-stack`
  - or run separately:
    - `npm run dev:web`
    - `npm run dev:server`
- `ELEC`
  - `npm run dev:desktop`
- Shutdown:
  - `npm run dev:stop`

## Automated Web Smoke

- Command:
  - `npm run test:e2e:web`
- Runtime:
  - starts or reuses the standalone backend on `127.0.0.1:8090`
  - starts or reuses the Vite web app on `http://localhost:3000`
  - installs the repo-local Playwright Chromium binary into `.playwright-browsers/` when it is missing
- Baseline prepared automatically before tests:
  - dedicated E2E users:
    - `e2e.admin@local.test`
    - `e2e.manager@local.test`
    - `e2e.cashier@local.test`
    - `e2e.viewer@local.test`
  - password for every E2E user:
    - `PuntovivoE2E!123`
  - ensures at least 2 active sites by creating `E2E Branch Site` only when the tenant has fewer than 2 active sites
- Current automated coverage:
  - admin navigation across every real sidebar module in web
  - manager / cashier / viewer route gating
  - spanish shell localization
  - tablet-width responsive shell smoke
  - transaction-level business flows with DB-backed assertions:
    - cashier completes a sale and cannot refund / void it
    - manager refunds a completed sale and stock is restored in both aggregate and by-site inventory, plus a `sale.return` audit row is confirmed
    - admin voids a completed sale and stock is restored in both aggregate and by-site inventory, plus a `sale.void` audit row is confirmed
    - manager adjusts stock and the aggregate stock, by-site balance, and `inventory.adjust_stock` audit row stay synchronized
- Isolation rule:
  - smoke tests remain read-only after the baseline setup
  - business-flow tests create their own unique users, products, and open cash sessions per run so they can execute in parallel without depending on execution order

## Execution Snapshot - 2026-04-12

- Fully validated:
  - `AUTH-01`
  - `COMPANY-05`
  - `COMPANY-11`
  - `COMPANY-12`
  - `COMPANY-13`
  - `SITES-01`
  - `SITES-02`
  - `SEQ-01`
  - `USERS-01`
  - `USERS-02`
  - `USERS-03`
  - `PROVIDER-01`
  - `CAT-01`
  - `LOC-01`
  - `CUST-01`
  - `PROD-01`
  - `PROD-02`
  - `INV-01`
  - `INV-02`
  - `SALES-01`
  - `SALES-02`
  - `SALES-03`
  - `SALES-08`
  - `SALES-11`
  - `SALES-12`
  - `SALES-14`
  - `SALES-15`
  - `SALES-18`
  - `ORDER-01`
  - `ORDER-02`
  - `ORDER-05`
  - `PURCHASE-02`
  - `PURCHASE-03`
  - `PURCHASE-06`
  - `DESK-01`
  - `DESK-02`
  - `DESK-08`
- Partially executed:
  - `AUTH-02` to `AUTH-09`
  - `SHELL-01` to `SHELL-03`
  - `SHELL-09`
  - `DASH-01` to `DASH-05`
  - `COMPANY-02`
  - `COMPANY-04`
  - `COMPANY-10`
- Electron desktop continuation completed on 2026-04-10:
  - `AUTH-02`
  - `AUTH-03`
  - `AUTH-04`
  - `AUTH-05`
  - `AUTH-06`
  - `AUTH-07`
  - `AUTH-08`
  - `AUTH-09`
  - `AUTH-10` (`ELEC` completed; `WEB` still pending)
  - `SHELL-01`
  - `SHELL-02`
  - `SHELL-03`
  - `SHELL-04` (`ELEC` completed; `WEB` still pending)
  - `SHELL-05` (`ELEC` completed; `WEB` still pending)
  - `SHELL-06` (`ELEC` completed; `WEB` still pending)
  - `SHELL-09`
  - `DASH-01`
  - `DASH-02`
  - `DASH-03`
  - `DASH-04`
  - `DASH-05`
  - `DASH-06` (`ELEC` completed; `WEB` still pending)
- Additional Electron desktop validation completed on 2026-04-10:
  - `SHELL-07`
  - `SHELL-08`
- Electron setup data created during continuation:
  - Additional active site: `North Site`
  - Additional users for role validation:
    - `manager@local.test`
    - `cashier@local.test`
    - `viewer@local.test`
- Issues fixed during continuation:
  - Electron main-process renderer log listener updated to the non-deprecated `console-message` event shape.
  - Responsive shell overflow fixed in the shared web layout after `SHELL-09` failed in Electron tablet/mobile widths.
- Issues fixed during additional desktop validation:
  - Desktop sync bridge updated to accept the full set of queued entity types used by the embedded backend, fixing repeated `Unsupported sync entity type: purchases` failures during queue processing.
  - Desktop startup no longer opens DevTools by default in development; opt-in now requires `PUNTOVIVO_OPEN_DEVTOOLS=true`.
  - `useOfflineSync` now polls desktop sync status while Electron is active so the offline banner reflects queued changes created after connectivity drops.
- Electron evidence root:
  - `output/playwright/`
- Electron blocked / still pending after continuation:
  - `DASH-07` still needs a deterministic desktop-specific error-state validation path.
- Current data caveat:
  - Browser `WEB` validations later in the run used the standalone server DB.
  - Earlier Electron validations used the desktop embedded DB.
  - Do not rerun passed IDs above unless the corresponding DB is intentionally reset.

## Execution Snapshot - 2026-04-12

- Newly validated via Playwright Web (standalone backend):
  - `SALES-14` — Void sale: VTA-000001 voided, status changed to `voided`, stock for "Arroz Diana 500g" restored to 50 (confirmed in catalog dialog)
  - `SALES-15` — Refund sale: VTA-000002 refunded, status changed to `refunded`, stock restored (server-side return confirmed)
- Server-side integration tests added:
  - `packages/server/src/__tests__/sales.test.ts` — new test: per-line discount percentage applies correctly to subtotal and VAT extraction (discount=10% on 19% VAT product)
  - `packages/server/src/__tests__/server.test.ts` — new file: HTTP-level regression tests covering tRPC batch URL routing (`maxParamLength: 1024` fix), health endpoint, and CSRF protection
- All server tests: 141 passed (23 test files)

---

## AUTH / SESSION

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | AUTH-01 | BOTH | admin | Valid login | Redirect succeeds and session is created |
| ✅ | AUTH-02 | BOTH | admin | Invalid login | Error message shown and session not created |
| ✅ | AUTH-03 | BOTH | admin | Logout | Returns to login and session is cleared |
| ✅ | AUTH-04 | BOTH | cashier | Cashier login | Redirect to `/sales` |
| ✅ | AUTH-05 | BOTH | manager | Manager login | Redirect to `/dashboard` |
| ✅ | AUTH-06 | BOTH | viewer | Viewer login | Allowed route or blocked route matches role rules |
| ✅ | AUTH-07 | BOTH | cashier | Access admin route directly | Route blocked |
| ✅ | AUTH-08 | BOTH | manager | Access admin-only pages | Route blocked |
| ✅ | AUTH-09 | BOTH | admin | Refresh with active session | Session persists |
| ⏸ | AUTH-10 | BOTH | admin | Change site from header | `ELEC` passed. Current site changes and UI reflects it. `WEB` still pending |

---

## SHELL / LAYOUT / NAVIGATION

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | SHELL-01 | BOTH | admin | Sidebar expand/collapse | Width changes and labels hide/show correctly |
| ✅ | SHELL-02 | BOTH | admin | Mobile sidebar drawer | Opens, closes, overlay dismisses |
| ✅ | SHELL-03 | BOTH | admin | Active menu highlighting | Current route is highlighted |
| ⏸ | SHELL-04 | BOTH | admin | Header user menu | `ELEC` passed. Opens and logout action is present. `WEB` still pending |
| ⏸ | SHELL-05 | BOTH | admin | Site selector | `ELEC` passed. Sites list loads and selection works. `WEB` still pending |
| ⏸ | SHELL-06 | BOTH | admin | Header connectivity indicator | `ELEC` passed. Online/offline badge reflects state. `WEB` still pending |
| ✅ | SHELL-07 | ELEC | admin | Offline banner with queued changes | Banner content and retry visibility are correct |
| ✅ | SHELL-08 | ELEC | admin | Theme persistence | Theme remains after restart |
| ✅ | SHELL-09 | BOTH | admin | Responsive shell | No broken layout in desktop/tablet/mobile widths |

---

## DASHBOARD

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | DASH-01 | BOTH | admin | Load dashboard | No crash, all panels render |
| ✅ | DASH-02 | BOTH | admin | Revenue and order metrics | Numbers visible and formatted |
| ✅ | DASH-03 | BOTH | admin | Latest receipts panel | Recent sales list renders |
| ✅ | DASH-04 | BOTH | admin | Top products panel | Ranking renders |
| ✅ | DASH-05 | BOTH | admin | Low stock panel | Low stock items visible |
| ⏸ | DASH-06 | BOTH | admin | Loading state | `ELEC` passed. Skeleton or loader shown appropriately. `WEB` still pending |
| ⬜ | DASH-07 | BOTH | admin | Error state and retry | Error UI visible and retry works |

---

## COMPANY

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | COMPANY-01 | BOTH | admin | Open Company page | Company form and cards render |
| ⏸ | COMPANY-02 | BOTH | admin | Save company changes | Persisted values reload correctly |
| ⬜ | COMPANY-03 | BOTH | admin | Invalid company email | Inline validation shown |
| ⏸ | COMPANY-04 | BOTH | admin | Logo library create/select | Active logo changes successfully |
| ✅ | COMPANY-05 | ELEC | admin | Sync snapshot pull | Snapshot refreshes |
| ⬜ | COMPANY-06 | ELEC | admin | Process sync queue | Queue count changes as expected |
| ⬜ | COMPANY-07 | ELEC | admin | Resolve conflict local wins | Conflict resolves |
| ⬜ | COMPANY-08 | ELEC | admin | Resolve conflict remote wins | Conflict resolves |
| ⬜ | COMPANY-09 | ELEC | admin | Resolve conflict merged | Merged resolution succeeds |
| ⏸ | COMPANY-10 | ELEC | admin | Auto-update check | Status updates without error |
| ✅ | COMPANY-11 | ELEC | admin | Theme settings save | Setting persists |
| ✅ | COMPANY-12 | ELEC | admin | Tray settings save | Setting persists |
| ✅ | COMPANY-13 | ELEC | admin | Print settings save | Setting persists |
| ⬜ | COMPANY-14 | ELEC | admin | Backup DB | Backup action succeeds |
| ⬜ | COMPANY-15 | ELEC | admin | Restore DB | Restore confirm flow succeeds |

---

## SITES

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | SITES-01 | BOTH | admin | List sites | Table, search, counts visible |
| ✅ | SITES-02 | BOTH | admin | Create site | New site appears |
| ⬜ | SITES-03 | BOTH | admin | Edit site | Changes persist |
| ⬜ | SITES-04 | BOTH | admin | Activate or deactivate site | Status changes visibly |
| ⬜ | SITES-05 | BOTH | admin | Assign locations to site | Assignments persist |

---

## SEQUENTIALS

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | SEQ-01 | BOTH | admin | List sequentials | Rows load correctly |
| ⬜ | SEQ-02 | BOTH | admin | Edit prefix | Saved value persists |
| ⬜ | SEQ-03 | BOTH | admin | Edit current value | Saved value persists |
| ⬜ | SEQ-04 | BOTH | admin | Validate per site/document scope | Scope remains correct |

---

## GEOGRAPHY

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | GEO-01 | BOTH | admin | Create country | Row appears |
| ⬜ | GEO-02 | BOTH | admin | Edit country | Changes persist |
| ⬜ | GEO-03 | BOTH | admin | Delete country with no dependencies | Delete succeeds |
| ✅ | GEO-04 | BOTH | admin | Create department under country | Link is preserved |
| ⬜ | GEO-05 | BOTH | admin | Edit department | Changes persist |
| ⬜ | GEO-06 | BOTH | admin | Delete department with no dependencies | Delete succeeds |
| ✅ | GEO-07 | BOTH | admin | Create city under department | Link is preserved |
| ⬜ | GEO-08 | BOTH | admin | Edit city | Changes persist |
| ⬜ | GEO-09 | BOTH | admin | Delete city with no dependencies | Delete succeeds |
| ⬜ | GEO-10 | BOTH | admin | Prevent deleting parent with children | Proper validation shown |

---

## CUSTOMER CATALOGS

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ⬜ | CCAT-01 | BOTH | admin | CRUD identification types | Works end-to-end |
| ⬜ | CCAT-02 | BOTH | admin | CRUD person types | Works end-to-end |
| ⬜ | CCAT-03 | BOTH | admin | CRUD regime types | Works end-to-end |
| ⬜ | CCAT-04 | BOTH | admin | CRUD client types | Works end-to-end |
| ⬜ | CCAT-05 | BOTH | admin | CRUD commercial activities | Works end-to-end |

---

## UNITS / VAT RATES

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ⬜ | UNITS-01 | BOTH | admin | Create unit | Unit appears |
| ⬜ | UNITS-02 | BOTH | admin | Edit unit | Change persists |
| ⬜ | UNITS-03 | BOTH | admin | Delete unit | Delete flow works |
| ⬜ | UNITS-04 | BOTH | admin | Duplicate abbreviation validation | Validation blocks invalid save |
| ⬜ | VAT-01 | BOTH | admin | Create VAT rate | Rate appears |
| ⬜ | VAT-02 | BOTH | admin | Edit VAT rate | Change persists |
| ⬜ | VAT-03 | BOTH | admin | Delete VAT rate | Delete flow works |
| ⬜ | VAT-04 | BOTH | admin | Numeric rate validation | Validation blocks invalid save |

---

## USERS

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | USERS-01 | BOTH | admin | Create manager user | User appears |
| ✅ | USERS-02 | BOTH | admin | Create cashier user | User appears |
| ✅ | USERS-03 | BOTH | admin | Create viewer user | User appears |
| ⬜ | USERS-04 | BOTH | admin | Edit user | Change persists |
| ⬜ | USERS-05 | BOTH | admin | Reset password | Password reset succeeds |
| ⬜ | USERS-06 | BOTH | admin | Activate or deactivate user | Status changes visibly |

---

## PROVIDERS

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | PROVIDER-01 | BOTH | admin | Create provider | Provider appears |
| ⬜ | PROVIDER-02 | BOTH | admin | Edit provider | Change persists |
| ⬜ | PROVIDER-03 | BOTH | admin | Delete provider | Delete flow works |
| ⬜ | PROVIDER-04 | BOTH | admin | Assign city | City, department, country context visible |
| ⬜ | PROVIDER-05 | BOTH | admin | Assign categories | Assignments persist |
| ⬜ | PROVIDER-06 | BOTH | admin | Search or filter providers | Results match input |

---

## CATEGORIES

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | CAT-01 | BOTH | admin | Create category | Category appears |
| ⬜ | CAT-02 | BOTH | admin | Edit category | Change persists |
| ⬜ | CAT-03 | BOTH | admin | Delete category with no dependencies | Delete succeeds |
| ⬜ | CAT-04 | BOTH | admin | Parent-child assignment | Tree relationship visible |
| ⬜ | CAT-05 | BOTH | admin | Prevent self-parent | Validation blocks save |
| ⬜ | CAT-06 | BOTH | admin | Prevent cycle | Validation blocks save |
| ⬜ | CAT-07 | BOTH | admin | Prevent delete with dependencies | Validation blocks delete |

---

## LOCATIONS

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | LOC-01 | BOTH | admin | Create location | Location appears |
| ⬜ | LOC-02 | BOTH | admin | Edit location | Change persists |
| ⬜ | LOC-03 | BOTH | admin | Delete location | Delete succeeds if valid |
| ⬜ | LOC-04 | BOTH | admin | Search or filter locations | Results match input |

---

## CUSTOMERS

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | CUST-01 | BOTH | manager | Create customer | Customer appears |
| ⬜ | CUST-02 | BOTH | manager | Edit customer | Change persists |
| ⬜ | CUST-03 | BOTH | manager | Delete customer | Delete flow works |
| ⬜ | CUST-04 | BOTH | manager | Classification selects | Catalog values load and save |
| ⬜ | CUST-05 | BOTH | manager | Search or filter customers | Results match input |
| ⬜ | CUST-06 | BOTH | manager | Active or inactive customer handling | State visible and respected |

---

## PRODUCTS

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | PROD-01 | BOTH | manager | Create product | Product appears |
| ✅ | PROD-02 | BOTH | manager | Edit product | Change persists |
| ⬜ | PROD-03 | BOTH | manager | Delete product | Delete flow works |
| ⬜ | PROD-04 | BOTH | manager | SKU uniqueness validation | Duplicate blocked |
| ⬜ | PROD-05 | BOTH | manager | Barcode usage | Search or field works |
| ⬜ | PROD-06 | BOTH | manager | Category, provider, VAT, location links | Relations saved correctly |
| ⬜ | PROD-07 | BOTH | manager | Unit equivalences | Unit grid persists |
| ⬜ | PROD-08 | BOTH | manager | Price levels and margins | Values remain consistent |
| ⬜ | PROD-09 | BOTH | manager | Search or filter products | Results match input |
| ⬜ | PROD-10 | BOTH | manager | Export products | Export action starts successfully |

---

## INVENTORY

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | INV-01 | BOTH | manager | Open stock view | Table loads |
| ✅ | INV-02 | BOTH | manager | Open movements view | Table loads |
| ⬜ | INV-03 | BOTH | manager | Open initial inventory view | Table loads |
| ⬜ | INV-04 | BOTH | manager | Filter by category | Results change correctly |
| ⬜ | INV-05 | BOTH | manager | Filter low stock | Results change correctly |
| ⬜ | INV-06 | BOTH | manager | Stock adjustment | Stock updates correctly |
| ⬜ | INV-07 | BOTH | manager | Initial inventory entry | Stock updates correctly |
| ⬜ | INV-08 | BOTH | manager | Physical count replace mode | Final stock correct |
| ⬜ | INV-09 | BOTH | manager | Physical count accumulate mode | Final stock correct |
| ⬜ | INV-10 | BOTH | manager | Export inventory | Export action starts successfully |
| ✅ | INV-11 | BOTH | manager | Open "By site" tab in Inventory with a fresh tenant | Primary site rows mirror current product stock; secondary sites start at zero |
| ✅ | INV-12 | BOTH | manager | Switch site in balances panel and re-read | No duplicate balance rows created; summary totals recompute for the selected site |
| ⬜ | INV-13 | BOTH | manager | Add a new product after balances were first loaded | Next balances read shows the product with `onHand=0` on non-primary sites |
| ✅ | INV-14 | BOTH | manager | Transfer stock from primary to secondary site | Origin balance decreases, destination balance increases by the same quantity; `transfer_orders` row persisted |
| ✅ | INV-15 | BOTH | manager | Attempt transfer with quantity exceeding origin on-hand | Mutation rejected; balances unchanged |
| ⬜ | INV-16 | BOTH | manager | Transfer button with only one active site | Button is disabled with an explanatory tooltip |
| ✅ | INV-17 | BOTH | manager | Void a completed transfer | Destination balance decrements, origin balance re-increments; status flips to Voided; notes carry `[VOID] …` |
| ✅ | INV-18 | BOTH | manager | Attempt to void after destination stock was consumed | Rejected with "destination site does not have enough stock" message; balances untouched |
| ✅ | INV-19 | BOTH | manager | Attempt to void a transfer that is already voided | Rejected with "already voided" message; no second mutation runs |
| ⬜ | INV-20 | BOTH | manager | Void action requires confirmation modal | Button opens the modal; cancel aborts without mutation |
| ✅ | INV-21 | BOTH | cashier | Complete a sale | Site balance for the cashier's active site decrements by the sold quantity (visible in By Site tab) |
| ✅ | INV-22 | BOTH | manager | Refund a completed sale | Original site's balance increments back by the same quantity |
| ✅ | INV-23 | BOTH | admin | Void a completed sale | Original site's balance increments back (not the voiding admin's active site) |
| ✅ | INV-24 | BOTH | manager | Sale site balance stays in lockstep with products.stock after a completed sale | Both values decrement by the same amount |
| ✅ | INV-25 | BOTH | manager | Complete a sale on a site that falls back to another site's sequential | The sold quantity decrements the cash-session site balance, not the fallback sequential's site |
| ✅ | INV-26 | BOTH | cashier | Attempt a sale on a secondary site that never received the product | Rejected with insufficient stock for the active site; tenant-wide stock remains unchanged |
| ✅ | INV-27 | BOTH | manager | Register a purchase on a site that falls back to another site's purchase sequential | The purchase balance credits the operator's current site, not the fallback sequential's site |
| ✅ | INV-28 | BOTH | manager | Receive a purchase order on a site that falls back to another site's purchase sequential | The receipt credits the order's site balance, not the fallback sequential's site |
| ✅ | INV-29 | BOTH | manager | Return a purchase after that site's stock was consumed elsewhere | Rejected with a purchase-site stock error; no balance reversal is posted |
| ✅ | INV-30 | BOTH | admin | Void a purchase after that site's stock was consumed elsewhere | Rejected with a purchase-site stock error; no balance reversal is posted |
| ✅ | INV-31 | BOTH | manager | Adjust stock upward with ctx.siteId set | Primary-site balance credits to match new target value |
| ✅ | INV-32 | BOTH | manager | Adjust stock downward | Primary-site balance debits to new target value |
| ✅ | INV-33 | BOTH | manager | Adjust stock at a non-primary site via explicit siteId input | Non-primary balance reflects delta; primary row is snapshot with pre-adjustment aggregate |
| ✅ | INV-34 | BOTH | manager | Adjust stock with no ctx.siteId nor input.siteId | Falls back to primary site; primary balance reflects new value |
| ✅ | INV-35 | BOTH | manager | Adjust stock where newStock equals current stock | Delta 0 short-circuits; balance row untouched (updatedAt unchanged) |
| ✅ | INV-36 | BOTH | manager | Record initial inventory entry with ctx.siteId | Site balance credits by normalizedQuantity |
| ✅ | INV-37 | BOTH | manager | Record physical inventory count | Site balance resets to absolute normalizedQuantity |
| ✅ | INV-38 | BOTH | manager | Attempt recordEntry with quantity 0 | Rejected by Zod validation layer |
| ✅ | INV-39 | BOTH | manager | Adjust stock at primary site and inspect products.stock | `products.stock` equals Σ(site balances) after the adjustment |
| ✅ | INV-40 | BOTH | manager | Adjust stock at non-primary site and inspect products.stock | `products.stock` equals Σ(site balances) after the adjustment (primary snapshot + non-primary delta) |
| ✅ | INV-41 | BOTH | admin | Manually introduce drift and run `inventory.reconcileBalances` | `products.stock` is healed to Σ(site balances); reconciliation covers every product in the tenant |
| ✅ | INV-42 | BOTH | admin | Reconcile a product that has no balance rows | `products.stock` is reset to 0 |
| ✅ | INV-43 | BOTH | manager | Create a deferred transfer via the modal's "Ship now, receive later" checkbox | Transfer appears in history with `In transit` badge and a Receive button; origin balance decremented, destination unchanged |
| ✅ | INV-44 | BOTH | manager | Click Receive on an in_transit transfer | Destination balance increments; status flips to Completed; Receive button disappears |
| ✅ | INV-45 | BOTH | manager | Void an in_transit transfer | Origin re-credited; destination untouched; status flips to Voided |
| ✅ | INV-46 | BOTH | manager | Attempt to receive a transfer that is already completed | Rejected with "only transfers currently in transit can be received"; balances unchanged |
| ✅ | INV-47 | BOTH | manager | Click Details on a transfer history row | Modal opens showing line items (product + SKU + quantity), created timestamp, and received timestamp (or "Pending receipt") |
| ✅ | INV-48 | BOTH | manager | Open Details on a voided in-transit transfer | Modal renders with the Voided badge and the [VOID] note appended |
| ✅ | INV-49 | BOTH | manager | Request Details for a transfer that no longer exists | Modal shows translated "Transfer not found" error; no crash |
| ✅ | INV-50 | BOTH | manager | Receive an in_transit transfer with quantities matching shipped | Legacy payload shape on the wire; every `received_quantity` persisted equal to shipped; no Discrepancy badge in history |
| ✅ | INV-51 | BOTH | manager | Receive an in_transit transfer, lower one line's received qty, add a discrepancy note | Destination credited only the received amount; `Σ(balances)` reflects shrinkage; history row and detail drawer show Discrepancy badge + note |
| ✅ | INV-52 | BOTH | manager | Attempt to receive with a received qty greater than shipped | Confirm button disabled with inline error; server rejects with `TRANSFER_RECEIVED_EXCEEDS_SHIPPED` if bypassed; transfer stays `in_transit` |
| ✅ | INV-53 | BOTH | manager | Void a partial-receipt transfer | Destination debited by received qty, origin credited by shipped qty; tenant stock restored to pre-transfer state |

---

## SALES / POS

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | SALES-01 | BOTH | cashier | Open sales screen | POS shell renders |
| ✅ | SALES-02 | BOTH | cashier | Quick search input | Query updates and submit works |
| ✅ | SALES-03 | BOTH | cashier | Add product to cart | Line item appears |
| ⬜ | SALES-04 | BOTH | cashier | Change quantity | Totals update |
| ⬜ | SALES-05 | BOTH | cashier | Change discount | Totals update |
| ⬜ | SALES-06 | BOTH | cashier | Remove line | Cart updates |
| ⬜ | SALES-07 | BOTH | cashier | Clear cart | Cart empties |
| ✅ | SALES-08 | BOTH | cashier | Charge cash sale | Sale completes |
| ⬜ | SALES-09 | BOTH | cashier | Charge partial payment sale | Payment status becomes partial |
| ⬜ | SALES-10 | BOTH | cashier | Charge credit sale | Payment status becomes pending |
| ✅ | SALES-11 | BOTH | cashier | Change calculation | Correct amount shown |
| ✅ | SALES-12 | BOTH | cashier | Sale details modal | Details render correctly |
| ⬜ | SALES-13 | ELEC | cashier | Print receipt | Print action completes or opens fallback |
| ✅ | SALES-14 | BOTH | admin | Void sale | Status changes and stock reverses |
| ✅ | SALES-15 | BOTH | admin | Refund sale | Refund recorded and stock restored |
| ⬜ | SALES-16 | BOTH | cashier | Search sales history | Filter works |
| ⬜ | SALES-17 | BOTH | cashier | Keyboard shortcuts | Shortcuts trigger expected actions |
| ✅ | SALES-18 | BOTH | cashier | Mobile or tablet sales layout | Checkout remains usable |
| ✅ | SALES-19 | BOTH | cashier | Charge split payment sale | Sale completes only when tender amounts sum to the total |
| ✅ | SALES-20 | BOTH | cashier | Open split payment mode | Credit is not offered as a split tender; credit sales remain on the single-tender pending flow |
| ✅ | SALES-21 | BOTH | cashier | Split payment cash-session accounting | Only the cash-method tender portion hits the expected balance; card/transfer/other tenders do not |
| ✅ | SALES-22 | BOTH | cashier | View split payment sale details | Details modal renders a Payments section with one row per tender (method, reference, amount); single-tender sales hide the section |
| ✅ | SALES-23 | BOTH | cashier | Print receipt for split payment sale | Receipt includes a Tenders section listing each method and amount; a blank reference renders as an em-dash; single-tender receipts skip the section |

---

## CASH SESSIONS

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | CASH-01 | BOTH | cashier | Sales desk with no open session | Primary CTA shows "Open cash session" and charge is blocked |
| ✅ | CASH-02 | BOTH | cashier | Open cash session with mismatched float | Submit disabled, mismatch banner visible |
| ✅ | CASH-03 | BOTH | cashier | Open cash session with balanced denomination count | Session created; header and side panel switch to "Charge sale" |
| ✅ | CASH-04 | BOTH | cashier | Charge cash sale into active session | `sale` cash movement recorded; expected balance incremented |
| ✅ | CASH-05 | BOTH | cashier | Record manual paid-in / paid-out / skim / replenishment | Timeline shows signed amount; expected balance updates |
| ✅ | CASH-06 | BOTH | cashier | Record movement with empty note | Client validation blocks submit |
| ✅ | CASH-07 | BOTH | cashier | Close session (blind) with matching count | Session transitions to `closed`; toast reports balanced/over/short |
| ✅ | CASH-08 | BOTH | cashier | Close session with mismatched count | Submit disabled, mismatch banner visible |
| ✅ | CASH-09 | BOTH | cashier | Expected balance hidden in active card | Only opening metadata and blind close hint are shown |
| ✅ | CASH-10 | BOTH | manager | Refund cash sale | `refund` cash movement recorded against refunding cashier's active session |
| ✅ | CASH-11 | BOTH | admin | Void sale whose session is still open | Original session is decremented via `refund` movement |
| ✅ | CASH-12 | BOTH | admin | Void sale whose session is already closed | Sale voided, stock restored, closed session untouched |
| ✅ | CASH-13 | BOTH | admin | Cash management dashboard with active session + discrepant closure | Report shows active register, closure alert, and net over/short summary |
| ✅ | CASH-14 | BOTH | cashier | Cash management dashboard while another cashier owns the open register | Report hides the other cashier session and shows only the current cashier scope |
| ✅ | CASH-15 | BOTH | cashier | POS with register assignments available before opening | Checkout header/sidebar preselect an available register and keep occupied drawers disabled |
| ✅ | CASH-16 | BOTH | cashier | Open session from an assigned register template | Opening dialog preloads register name, opening float, and denomination breakdown from the selected assignment |

---

## ORDERS

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | ORDER-01 | BOTH | manager | Create order | Order appears with valid sequential |
| ✅ | ORDER-02 | BOTH | manager | View order details | Details render correctly |
| ⬜ | ORDER-03 | BOTH | manager | Void order | Status becomes voided |
| ⬜ | ORDER-04 | BOTH | manager | Partial receive order | Pending quantities correct |
| ✅ | ORDER-05 | BOTH | manager | Full receive order | Status becomes received |
| ⬜ | ORDER-06 | BOTH | manager | Search or filter history | Results correct |

---

## PURCHASES

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | PURCHASE-01 | BOTH | manager | Create manual purchase | Purchase appears and stock increases |
| ✅ | PURCHASE-02 | BOTH | manager | Create purchase from order | Link order to purchase created |
| ✅ | PURCHASE-03 | BOTH | manager | View purchase details | Details render correctly |
| ✅ | PURCHASE-04 | BOTH | admin | Void purchase | Status changes and stock reverses |
| ✅ | PURCHASE-05 | BOTH | admin | Partial return purchase | Stock decreases partially |
| ✅ | PURCHASE-06 | BOTH | admin | Full return purchase | Final status correct |
| ⬜ | PURCHASE-07 | BOTH | manager | Search or filter history | Results correct |
| ⬜ | PURCHASE-08 | BOTH | manager | Export purchases | Export action starts successfully |

---

## QUOTATIONS

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | QUOT-01 | BOTH | manager | Open the Quotations page | Page loads with header, empty state, and New quotation button |
| ✅ | QUOT-02 | BOTH | manager | Create a draft quotation with one product line | Modal closes; row appears in history with status Draft and the next sequential number (COT-XXXXXX) |
| ✅ | QUOT-03 | BOTH | manager | Create a quotation with no customer (walk-in) | Customer column reads "Walk-in" placeholder |
| ✅ | QUOT-04 | BOTH | manager | Create a quotation with a per-line discount | Line total reflects discount, header subtotal/discount/total match the per-line math |
| ✅ | QUOT-05 | BOTH | manager | Create a quotation with a per-line tax rate | Header tax = sum(line tax extracted from gross), totals add up |
| ✅ | QUOT-06 | BOTH | manager | Create a quotation with a product whose VAT comes from `vatRateId` | Per-line tax rate omitted falls back to the product's VAT |
| ✅ | QUOT-07 | BOTH | manager | Set a Valid until date | Stored as ISO datetime; renders the date in the history table |
| ✅ | QUOT-08 | BOTH | manager | Send a draft quotation | Status flips to Sent; Delete action disappears; Accept/Reject/Expire actions appear |
| ✅ | QUOT-09 | BOTH | manager | Accept a sent quotation | Status flips to Accepted; only Expire action remains |
| ✅ | QUOT-10 | BOTH | manager | Reject a draft quotation | Status flips to Rejected; row enters terminal state with no transition actions |
| ✅ | QUOT-11 | BOTH | manager | Try to transition rejected → accepted via API | Server rejects with `QUOTATION_INVALID_STATUS_TRANSITION` |
| ✅ | QUOT-12 | BOTH | manager | Delete a draft | Confirmation modal opens; on confirm row is removed and items cascade-deleted |
| ✅ | QUOT-13 | BOTH | manager | Try to delete a non-draft | Action button is hidden; direct API call rejects with `QUOTATION_DELETE_NOT_DRAFT` |
| ✅ | QUOT-14 | BOTH | manager | Open Details on a quotation | Drawer renders header, totals, line items, status timeline (creator + status-change actor) |
| ✅ | QUOT-15 | BOTH | manager | Verify inventory unchanged after creating a quotation | `products.stock` and `inventory_balances.on_hand` are identical before and after |
| ✅ | QUOT-16 | BOTH | manager | Filter list by status (server-side `status` query param) | Only matching rows returned |
| ✅ | QUOT-17 | BOTH | manager | Click Print in the Details drawer | Printable HTML opens in a Blob-URL popup (web) or prints via the Electron bridge; header, meta, line items, totals, and validity all render |
| ✅ | QUOT-18 | BOTH | manager | Click Export → CSV / Excel / PDF above the history table | File downloads with ten columns: Number, Created At, Customer, Site, Items, Subtotal, VAT, Total, Valid Until, Status |
| ✅ | QUOT-19 | BOTH | manager | On an accepted quote, click Mark as converted | Status flips to Converted (terminal); Expire action disappears; only Details remains |
| ✅ | QUOT-20 | BOTH | manager | Attempt `draft → converted` transition via API | Server rejects with `QUOTATION_INVALID_STATUS_TRANSITION` — only `accepted` can convert |

---

## AUDIT TRAIL (Phase 8 / Tier-2 #8)

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | AUDIT-01 | BOTH | admin | Open /audit-logs with no events | Empty state renders with explanatory copy |
| ✅ | AUDIT-02 | BOTH | admin | Void a completed transfer, reload /audit-logs | A `transfer.void` row appears with actor name+email, resource id, and reason in summary |
| ✅ | AUDIT-03 | BOTH | admin | Delete a draft quotation | A `quotation.delete` row appears with quotation number in summary (snapshot preserved via `before`) |
| ✅ | AUDIT-04 | BOTH | admin | Walk a quote draft→sent→accepted→converted | Only ONE audit row lands — the `quotation.convert` terminal transition; intermediate transitions are not audited |
| ✅ | AUDIT-05 | BOTH | admin | Filter by action=`transfer.void` on a page with mixed events | Only transfer voids show; empty state renders when filter has no matches |
| ✅ | AUDIT-06 | BOTH | admin | Filter by resource type=`quotation` | Only quotation events show |
| ✅ | AUDIT-07 | BOTH | admin | Use the From/To date range | Events outside the range are excluded; local-time start/end-of-day anchored |
| ✅ | AUDIT-08 | BOTH | admin | Click Export → CSV / Excel / PDF | File downloads with Timestamp, Actor, Action, Resource type, Resource id, Metadata |
| ✅ | AUDIT-09 | BOTH | manager | Try to hit /audit-logs as non-admin | Route guarded by `adminOnlyRoles` — redirect; direct tRPC call returns FORBIDDEN |
| ✅ | AUDIT-10 | BOTH | admin | Attempt a sensitive action that rolls back (e.g. delete a non-draft quotation) | No audit row is persisted — the audit write is inside the same transaction as the action |
| ✅ | AUDIT-11 | BOTH | admin | Void a completed sale, reload /audit-logs | A `sale.void` row appears; summary shows the sale number and optional reason; metadata carries the reversed cash-session id when the original session is still open |
| ✅ | AUDIT-12 | BOTH | admin | Refund a sale, reload /audit-logs | A `sale.return` row appears; summary shows `Refunded $X.XX`; `after` payload carries `refundId` so it joins back to `sale_returns` |
| ✅ | AUDIT-13 | BOTH | admin | Close a cash session, reload /audit-logs | A `cash_session.close` row appears; summary shows the signed over/short amount |
| ✅ | AUDIT-14 | BOTH | admin | Adjust a product's stock, reload /audit-logs | An `inventory.adjust_stock` row appears; summary shows `{before} → {after} ({±delta})`; metadata includes resolved siteId and movementId |
| ✅ | AUDIT-15 | BOTH | admin | Submit an adjust-stock call with newStock === current stock | No audit row is written (no-op short-circuit); movement/sync rows still land — pre-existing behaviour, intentional for this slice |
| ✅ | AUDIT-16 | BOTH | admin | Try to void an already-voided sale | Second attempt rejects; exactly one audit row exists for the original successful void — rollback invariant holds on the new surfaces too |
| ✅ | AUDIT-17 | BOTH | admin | Void a completed purchase | A `purchase.void` row appears; summary shows purchase number plus reason; metadata carries the destination siteId |
| ✅ | AUDIT-18 | BOTH | admin | Create a new user | A `user.create` row appears; summary shows email and role; the password hash is absent from the audit payload |
| ✅ | AUDIT-19 | BOTH | admin | Rename an existing user (no role / isActive change) | No audit row is written — name/email edits are bookkeeping, not a security event |
| ✅ | AUDIT-20 | BOTH | admin | Promote a user's role and then disable them | Two `user.update` rows appear; each carries only the field that actually transitioned in its before/after snapshot |
| ✅ | AUDIT-21 | BOTH | cashier | Sell a product at a price that differs from the catalog | One `sale.price_override` row appears per sale, summarizing all overridden lines; selling at the catalog price writes no audit row |

---

## DESKTOP / WORKSTATION

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ✅ | DESK-01 | ELEC | admin | Full app boot | Web, Electron, and embedded server boot without crash |
| ✅ | DESK-02 | ELEC | admin | Close and relaunch | App relaunches cleanly |
| ⬜ | DESK-03 | ELEC | admin | Backup and restore | Data recovery succeeds |
| ⬜ | DESK-04 | ELEC | admin | Theme persistence after restart | Theme remains applied |
| ⬜ | DESK-05 | ELEC | admin | Tray and close-to-tray | Window behavior is correct |
| ⬜ | DESK-06 | ELEC | admin | Offline mode and queue | Banner and sync center reflect state |
| ⬜ | DESK-07 | ELEC | admin | Receipt print settings | Behavior respects configuration |
| ✅ | DESK-08 | ELEC | admin | Auto-update status panel | UI loads without handler errors |

---

## CROSS-MODULE FLOWS

| Status | ID | Runner | Role | Flow | Expected validation |
|---|---|---|---|---|---|
| ⬜ | XMOD-01 | BOTH | admin | Provider to Product to Order to Purchase | Relationships remain consistent |
| ⬜ | XMOD-02 | BOTH | admin | Purchase to Inventory to Sale | Stock changes correctly across flow |
| ⬜ | XMOD-03 | BOTH | admin | Sale refund or void to Dashboard | KPIs exclude reversals correctly |
| ⬜ | XMOD-04 | BOTH | admin | Switch site then transact | Sequentials remain site-scoped |
| ⬜ | XMOD-05 | ELEC | admin | Sync conflict end-to-end | Snapshot and resolution remain consistent |
| ⬜ | XMOD-06 | BOTH | admin | Sidebar visibility versus route access | Menu visibility matches route guard rules |

---

## Execution Log Template

| Status | ID | Environment | Evidence | Notes |
|---|---|---|---|---|
| ✅ | AUTH-02 | ELEC | `output/playwright/auth-02-invalid-login-elec.png` | Invalid login stayed on `/login` and showed `Email or password is incorrect` |
| ✅ | AUTH-03 | ELEC | `output/playwright/auth-03-logout-elec.png` | Logout returned to `/login` |
| ✅ | AUTH-04 | ELEC | `output/playwright/auth-04-cashier-login-elec.png` | Cashier redirected to `/sales` |
| ✅ | AUTH-05 | ELEC | `output/playwright/auth-05-manager-login-elec.png` | Manager redirected to `/dashboard` |
| ✅ | AUTH-06 | ELEC | `output/playwright/auth-06-viewer-login-elec.png` | Viewer redirected to `/dashboard` |
| ✅ | AUTH-07 | ELEC | `output/playwright/auth-07-cashier-blocked-elec.png` | Cashier direct access to `/company` redirected to `/sales` |
| ✅ | AUTH-08 | ELEC | `output/playwright/auth-08-manager-blocked-elec.png` | Manager direct access to `/company` redirected to `/dashboard` |
| ✅ | AUTH-09 | ELEC | `output/playwright/auth-09-session-refresh-elec.png` | Session persisted on reload after rerun with a stable authenticated state |
| ✅ | AUTH-10 | ELEC | `output/playwright/shell-05-site-selector-elec.png` | Header site selector changed from `Main Site` to `North Site` |
| ✅ | SHELL-01 | ELEC | `output/playwright/shell-01-collapse-elec.png` | Sidebar width changed from `296px` to `104px`; labels hidden in collapsed state |
| ✅ | SHELL-02 | ELEC | `output/playwright/shell-02-mobile-drawer-elec.png` | Drawer opened and overlay click dismissed it |
| ✅ | SHELL-03 | ELEC | `output/playwright/shell-03-active-menu-elec.png` | `Sites` nav link exposed `aria-current=page` on active route |
| ✅ | SHELL-04 | ELEC | `output/playwright/shell-04-user-menu-elec.png` | User menu opened and exposed `Sign out` |
| ✅ | SHELL-05 | ELEC | `output/playwright/shell-05-site-selector-elec.png` | Site selector loaded both active sites and applied the new selection |
| ✅ | SHELL-06 | ELEC | `output/playwright/shell-06-connectivity-elec.png` | Header badge switched between `Offline` and `Online` |
| ✅ | SHELL-09 | ELEC | `output/playwright/shell-09-responsive-elec-fixed.png` | Tablet/mobile horizontal overflow fixed and revalidated |
| ✅ | DASH-01 | ELEC | `output/playwright/dash-01-dashboard-load-elec.png` | Dashboard loaded without crash and all main panels rendered |
| ✅ | DASH-02 | ELEC | `output/playwright/dash-02-metrics-elec.png` | Revenue/order metrics visible and formatted |
| ✅ | DASH-03 | ELEC | `output/playwright/dash-03-recent-sales-elec.png` | Latest receipts panel rendered |
| ✅ | DASH-04 | ELEC | `output/playwright/dash-04-top-products-elec.png` | Top products ranking rendered |
| ✅ | DASH-05 | ELEC | `output/playwright/dash-05-low-stock-elec.png` | Low-stock panel rendered |
| ✅ | DASH-06 | ELEC | `output/playwright/dash-06-loading-elec.png` | Delayed renderer fetch showed dashboard loading skeleton |
| ⬜ | DASH-07 | ELEC | `output/playwright/dash-07-error-elec.png` | Attempted renderer-side failure injection did not surface the query error state; keep pending |
| ✅ | SALES-14 | WEB | (Playwright snapshot) | VTA-000001 voided via history dialog; status column shows `voided`; stock for "Arroz Diana 500g" confirmed restored to 50 in catalog |
| ✅ | SALES-15 | WEB | (Playwright snapshot) | VTA-000002 refunded via history dialog; status column shows `refunded`; stock confirmed restored server-side |

---

## Suggested Automation Split

### Playwright Web batch

- `AUTH-*`
- `SHELL-*` except Electron-only cases
- `DASH-*`
- Setup and admin CRUD except desktop-only cards
- `CUST-*`
- `PROD-*`
- `INV-*`
- `SALES-*` except print or Electron-only cases
- `ORDER-*`
- `PURCHASE-*`

### Playwright Electron batch

- `DESK-*`
- `COMPANY-05` through `COMPANY-15`
- `SHELL-07`
- `SHELL-08`
- `SALES-13`
- `XMOD-05`

### Hybrid or manual-assisted

- Backup and restore file dialogs
- Printing hardware verification
- Auto-update install and restart behavior
- OS tray behavior across actual minimize and close patterns

---

## Planned Coverage — Future Modules (April 2026 plan)

The following test IDs are **pre-reserved** for modules in design (see
[ROADMAP.md](./ROADMAP.md) §0 and the design stubs). Each ID becomes a
concrete test case when the corresponding feature ships. This block
exists so feature PRs can check off the cases already named.

### Fiscal Compliance (DIAN) — FISCAL-01 through FISCAL-15

Covers Phase 11 ([FISCAL-INTEGRATION.md](./FISCAL-INTEGRATION.md)).

- FISCAL-01 Certificate upload and activation round-trip
- FISCAL-02 Numbering resolution registration + expiry warning
- FISCAL-03 Issue DEE for a completed sale → CUFE stored, XML archived
- FISCAL-04 CUFE SHA-384 matches DIAN canonical vectors
- FISCAL-05 UBL 2.1 XML passes DIAN XSD validation
- FISCAL-06 Issue Factura Electrónica (FEV) for a B2B sale with NIT
- FISCAL-07 Issue Nota Crédito electronic on sale refund, referencing original CUFE
- FISCAL-08 Reissue fails with clear error when resolution range exhausted
- FISCAL-09 Contingency mode: network down → queue → re-send on reconnect
- FISCAL-10 Adapter swap (Facture ↔ HKA) produces equivalent CUFE
- FISCAL-11 Resolution expiry alert shows in dashboard 30/15/7 days before
- FISCAL-12 Cross-tenant: fiscal documents of tenant A never visible to B
- FISCAL-13 Print representation includes CUFE, QR, and all DIAN mandatory fields
- FISCAL-14 XML retention: ≥5-year file exists and is retrievable
- FISCAL-15 Audit trail: every issue / reissue / void recorded in `audit_logs`

### POS Hardware — HW-01 through HW-10

Covers Phase 12 ([HARDWARE-POS.md](./HARDWARE-POS.md)).

- HW-01 ESC/POS driver: print a sale receipt to 58mm and 80mm paper
- HW-02 ESC/POS driver: paper cut after print
- HW-03 Cash drawer opens when ESC/POS driver issues the drawer-kick
- HW-04 System driver fallback prints when ESC/POS not configured
- HW-05 Barcode scanner: valid EAN-13 scan adds product to cart
- HW-06 Barcode scanner: invalid EAN-13 checksum rejected with message
- HW-07 Barcode scanner: price-embedded code (prefix 20-29) parses weight and price
- HW-08 Payment terminal adapter (Bold mock): charge → success → authCode persisted
- HW-09 Payment terminal adapter: decline handled, sale stays unpaid
- HW-10 Peripheral config page: test buttons report status per device

### Product Composition — COMP-01 through COMP-12

Covers Phase 6a ([PRODUCT-COMPOSITION.md](./PRODUCT-COMPOSITION.md)).

- COMP-01 Simple product unchanged by migration (backwards-compatible)
- COMP-02 Composite product: selling 1 unit decrements each ingredient
- COMP-03 Composite with optional ingredient: out-of-stock optional doesn't block sale
- COMP-04 Composite stock derived correctly as `min(floor(stock_i / qty_i))`
- COMP-05 Void reverses all ingredient movements in lockstep
- COMP-06 Recipe cycle detected at save time → rejected
- COMP-07 Recipe depth > 3 rejected
- COMP-08 Modifier `price_delta` reflected in sale line total and totals block
- COMP-09 Recipe edit after sale does not alter past inventory movements
- COMP-10 Cross-tenant: tenant A cannot reference tenant B's ingredient
- COMP-11 Cost recomputes on recipe save; report shows margin
- COMP-12 UI "test explosion" simulates and shows impact before save

### Restaurant Lifecycle / KDS — KDS-01 through KDS-15

Covers Phase 6b ([RESTAURANT-LIFECYCLE.md](./RESTAURANT-LIFECYCLE.md)).

- KDS-01 Open table session with covers, waiter recorded
- KDS-02 Fire order: items with `requires_preparation` → one ticket per station
- KDS-03 Fire order: non-preparation items skip tickets and stay served
- KDS-04 KDS page shows queued tickets sorted by `queued_at`
- KDS-05 Advance ticket: `queued → preparing → ready → served`
- KDS-06 SSE delivers state change to waiter POS within 500ms
- KDS-07 Station token auth gates KDS page; invalid token → 403
- KDS-08 Cannot close table session while tickets still queued/preparing
- KDS-09 Split check: session splits into N sales, totals match original
- KDS-10 Void sale item after `ready` requires elevated role + reason
- KDS-11 Kitchen printer auto-fires when ticket enters `queued`
- KDS-12 Printer failure does not block KDS; ticket remains queued on KDS
- KDS-13 Course ordering (priority) renders in kitchen in correct sequence
- KDS-14 Cross-tenant: station of tenant A never shows tickets of tenant B
- KDS-15 Closing session after all tickets served preserves totals invariant

### UI Surfaces — UI-SURF-01 through UI-SURF-08

Covers Phase 6c ([UI-SURFACES.md](./UI-SURFACES.md)).

- UI-SURF-01 POS Desktop unchanged on pointer:fine + hover-capable
- UI-SURF-02 POS Touch layout active under pointer:coarse media query
- UI-SURF-03 POS Touch tile size ≥44px; on-screen keypad triggers on numeric fields
- UI-SURF-04 Customer display window opens on second monitor (Electron)
- UI-SURF-05 Customer display reflects cart updates < 200ms
- UI-SURF-06 KDS on LAN: Raspberry Pi Chromium kiosk loads via 0.0.0.0:8090
- UI-SURF-07 Mobile waiter layout renders portrait on 10" tablet viewport
- UI-SURF-08 Bundle splitting: KDS-only browser never downloads POS desktop chunk

### Receipt Templates — TEMPL-01 through TEMPL-08

Iter 2 (April 22, 2026) shipped the editor + renderer ([RECEIPT-TEMPLATES.md](./RECEIPT-TEMPLATES.md)).

- TEMPL-01 ✅ Create template with every atomic block → saves and round-trips (`receipt-templates.test.ts → renders all atomic blocks for a 4-item sale with split tenders`)
- TEMPL-02 ✅ Preview renders mock sale data live within ~200ms of edit (debounced, server-rendered through `renderPreview` tRPC procedure; smoke check during Iter 2 verified iframe srcdoc updates, and follow-up regression coverage fixes the locale-sensitive labels passed from web i18n)
- TEMPL-03 ✅ Zod rejects unknown variable (outside `company|sale|item|fiscal|tender` namespaces) (`receipt-templates.test.ts → ReceiptLayout Zod schema rejects a variable referencing an unknown namespace`)
- TEMPL-04 ✅ Zod rejects template with > 50 blocks (`receipt-templates.test.ts → ReceiptLayout Zod schema rejects a layout with more than 50 blocks`)
- TEMPL-05 ✅ Security: `<script>` and `javascript:` inside a text/qr block appear escaped or rejected (`receipt-templates.test.ts → escapes HTML special characters injected via tenant data`, `escapes HTML special characters in literal template text`, `rejects a qr.source with a javascript: scheme`)
- TEMPL-06 ⏳ Test-print delivers rendered HTML to configured printer — deferred to Iter 4 (requires `EscPosPrinterAdapter` + physical hardware; today's path uses `webContents.print()` against the system default)
- TEMPL-07 ✅ Set as default: the partial unique index + `setDefaultReceiptTemplate` transaction guarantee one default per `(tenant, kind)` (`receipt-templates.test.ts → setDefault flips atomically — the prior default becomes false`)
- TEMPL-08 ✅ Duplicate template preserves layout and creates independent row (`receipt-templates.test.ts → duplicate creates a non-default copy with " (copy)" suffix`)

### Park-and-Resume Sales (M2 improvement) — PARK-01 through PARK-06

- PARK-01 ✅ Suspend active cart → slot it into suspended list with timestamp and summary (`sales-park-and-reprint.test.ts → stamps suspension columns, writes a sale.park audit row, and is idempotent`)
- PARK-02 ✅ Resume restores items, discounts, customer, and notes exactly (`sales-park-and-reprint.test.ts → lets the owning cashier resume and clears suspension state`)
- PARK-03 ✅ Two cashiers cannot resume the same suspended sale (lock) (`sales-park-and-reprint.test.ts → blocks a different cashier from resuming and lets manager override`)
- PARK-04 ✅ Suspend fires an audit entry (always written — free-form enum, optional tenant flag reserved for a future mute) (`sales-park-and-reprint.test.ts → writes a sale.park audit row`)
- PARK-05 ⏳ Ctrl+P suspends; Ctrl+R opens the resume panel; shortcuts ignored in input focus — deferred to ENG-018b (requires the Ctrl-guard lift in `useSalesKeyboardShortcuts.ts:48`)
- PARK-06 ⏳ Close cash session with outstanding suspended sales → prompt to resolve — deferred to ENG-018b (UI-side prompt in the close modal)

### Receipt Reprint (ENG-019) — REPRINT-01 through REPRINT-05

- REPRINT-01 ✅ `sales.getForReprint` increments the reprint counter, stamps `lastReprintedAt` / `lastReprintedBy`, and emits a `sale.reprint` audit row (`sales-park-and-reprint.test.ts → increments reprintCount, stamps timestamps, and writes an audit row`)
- REPRINT-02 ✅ Draft sales cannot be reprinted (`sales-park-and-reprint.test.ts → rejects drafts`)
- REPRINT-03 ✅ Cashier can only reprint sales from their active cash session; manager/admin overrides (`sales-park-and-reprint.test.ts → blocks cashier from reprinting another cashier active-session sale, but manager can`)
- REPRINT-04 ✅ Cross-tenant isolation: tenant B's admin cannot reprint tenant A's sale (`sales-park-and-reprint.test.ts → is cross-tenant isolated`)
- REPRINT-05 ⏳ Ctrl+Shift+P reprints the selected history row — deferred to ENG-018b (shares the Ctrl-guard lift)

### Audit Trail Extensions — AUDIT-22 through AUDIT-30

- AUDIT-22 `sale.void` recorded with actor + metadata.reason
- AUDIT-23 `sale.returnSale` (refund) recorded with items returned
- AUDIT-24 `cashSessions.close` recorded with over/short amount
- AUDIT-25 `inventory.adjustStock` (non-zero delta) recorded with reason
- AUDIT-26 `price.override` recorded when cashier overrides a line price
- AUDIT-27 `purchases.void` recorded
- AUDIT-28 `user.disable` recorded
- AUDIT-29 `fiscal.reissue` recorded
- AUDIT-30 Cross-tenant: actor from tenant B never leaks into tenant A's audit
  list (regression test for the reviewer-found JOIN fix of April 2026)
