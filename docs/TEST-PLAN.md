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
  - `npm run dev:web`
  - `npm run dev:server`
- `ELEC`
  - `npm run dev`
- Shutdown:
  - `npm run dev:stop`

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
| ⬜ | PURCHASE-01 | BOTH | manager | Create manual purchase | Purchase appears and stock increases |
| ✅ | PURCHASE-02 | BOTH | manager | Create purchase from order | Link order to purchase created |
| ✅ | PURCHASE-03 | BOTH | manager | View purchase details | Details render correctly |
| ⬜ | PURCHASE-04 | BOTH | admin | Void purchase | Status changes and stock reverses |
| ⬜ | PURCHASE-05 | BOTH | admin | Partial return purchase | Stock decreases partially |
| ✅ | PURCHASE-06 | BOTH | admin | Full return purchase | Final status correct |
| ⬜ | PURCHASE-07 | BOTH | manager | Search or filter history | Results correct |
| ⬜ | PURCHASE-08 | BOTH | manager | Export purchases | Export action starts successfully |

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
