# Puntovivo — Sprint Plan

> Tactical execution plan for the next implementation slices.
> `ROADMAP.md` remains the canonical ENG ticket list; this file only keeps
> the active sequence, commit shape, and verification checklist. Historical
> shipped detail lives in [ARCHIVED.md](./ARCHIVED.md).

Updated: 2026-06-01.

## Current Focus

Run one ticket at a time. The first line of a shipping turn is:

```text
Executing <ENG-NNN> — <one-liner>
```

The current focus wave is the product-truth and retail-scope reset, now continuing into the
`ENG-132` list-screen simplification track (smallest useful column set + secondary-into-drawer,
one screen per commit):

| Order | Ticket    | Status  | Intent                                                    | Required proof                                                                                                                                       |
| ----- | --------- | ------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `ENG-182` | Shipped | Product doctrine and README truth reset.                  | README, SELLABILITY, ROADMAP §0, docs index, and command docs agree on pnpm 11, Node 24, local-first retail scope, and demo/pilot/production status. |
| 1a    | `ENG-182a` | Shipped | Token-budget cleanup + dead-code hygiene.                 | ROADMAP / BACKLOG / ARCHIVED are compact without losing non-shipped tickets; confirmed-zero-import code/deps are removed; ci + live smoke are green. |
| 2     | `ENG-183` | Shipped | Retail Ring-1 scope gate and module exposure cleanup.     | Fresh retail tenant hides non-core surfaces unless profile/module enables them; tests prove no route/sidebar/palette leaks.                          |
| 3     | `ENG-184` | Shipped | Colombia retail readiness profile and checkout preflight. | `/company` + `/sales` surface fiscal/hardware/sync/payment as optional reminders (never blockers); basic CO DIAN config card ships; en/es + recovery CTAs proven.          |
| 4     | `ENG-185` | Shipped | Fiscal adapter truth guard.                               | Unsupported countries fail with a typed error; mock/draft packs are labelled Demo/Draft across cards, document views, and diagnostics; e-invoicing stays optional.   |
| 5     | `ENG-186` | Shipped | Ring-1 screen focus pass (re-scoped: `/sales` sellability slice). | `/sales` completes the common sale without desktop scroll at 1440x900 (cart + checkout scroll internally); History + Suspended behind a reusable Drawer; live smoke desktop + mobile, en/es. Operations + Setup slices split to `ENG-187`. |
| 6     | `ENG-187` | Shipped | Ring-1 screen focus pass — Operations needs-attention (re-scoped: `/operations` slice). | `/operations` defaults to a Needs-attention queue (server aggregation of retryable sync/fiscal/hardware/payment failures, each row deep-links to its panel) + tested all-clear state; live smoke en/es covered the failure row + CTA. Setup/`/company` restructure split to `ENG-188`. |
| 7     | `ENG-188` | Shipped | Ring-1 screen focus pass remainder (Setup/`/company` readiness-hub restructure). | **Shipped** (web-only): the flat 10-pill `segmented-control` in `CompanyPage` became a grouped Setup nav — readiness pinned as the admin landing, the other 9 tabs demoted into three labeled groups (Negocio / Facturación y pagos / Sistema), modeled as a navigation (`role="group"` + `aria-current`, panel `role="region"`). The `?tab=` deep-link contract is preserved, so the readiness CTAs / GlobalStatusStrip / AuthProvider keep working. `ci:web` green; live `/company` smoke en/es. Closes the screen-focus wave. |
| 8     | `ENG-132a` | Shipped | Screen simplification — Products list (first `ENG-132` list-screen slice). | `/products` table trimmed to the smallest useful column set (name+SKU / category / tier-1 / stock / status); provider, location and tier-2/3 prices moved into a row-detail `ProductDetailsDrawer` (additive Details eye action + edit hand-off). ENG-134f keyboard edit + CSV/XLSX export parity preserved. `ci:web` green; live `/products` smoke en/es. Remaining `ENG-132` screens (one per commit): Inventory, Orders, Purchases, Quotations, Customers, Finance. |
| 9     | `ENG-132b` | Shipped | Screen simplification — Customers list (`ENG-132` list-screen slice). | `/customers` table trimmed to name(+identification) / status / actions; email, phone, type and location moved into a row-detail `CustomerDetailsDrawer` (additive Details eye action + ungated edit hand-off mirroring the row). ENG-134f keyboard edit + ledger/delete gating preserved. Added the FIRST tests for the customers folder (drawer + page). `ci:web` green; live `/customers` smoke en/es. Remaining `ENG-132` screens: Inventory, Orders, Purchases, Quotations, Finance. |
| 10    | `ENG-132c` | Shipped | Screen simplification — Inventory Stock tab (`ENG-132` list-screen slice). | Stock table trimmed to name(+sku/category) / stock / status / actions; min stock, sell price, valuation and updated date moved into a new `InventoryStockDetailsDrawer` (additive Details eye action + canManage-gated Adjust hand-off to the existing adjustment modal). Scope = Stock tab only (Movements/Entries/Balances untouched). Added drawer test + a pure-function column-set test (exported `getStockColumns`). `ci:web` green; live `/inventory` Stock smoke en/es. Remaining `ENG-132` screens: Inventory Movements/Entries, Orders, Purchases, Quotations, Finance. |
| 11    | `ENG-132d` | Shipped | Screen simplification — Quotations list (`ENG-132` list-screen slice). | Quotations history table trimmed to number / customer / total / status / actions; site, items, valid-until and created-at lean on the EXISTING View → `QuotationDetailsModal` (no new drawer — it already has one). The modal already showed valid-until / created-at / line items; Site added to it (web-only, payload already carries `siteName`). Added `quotations:details.site` + a column-set test assertion. `ci:web` green; live `/quotations` smoke en/es. Remaining `ENG-132` screens: Orders, Purchases, Inventory Movements/Entries, Finance. |
| 12    | `ENG-132e` | Shipped | Screen simplification — Orders list (`ENG-132` list-screen slice). | Orders history table trimmed to order # / provider / status / total / actions; date, site and receipts lean on the EXISTING View → `OrderDetailsModal` (no new drawer — it already shows created / site / staged-delivery + receipts list). No new i18n key and no server change (cleanest 132 slice); Status badge keeps receiving progress legible on the list. Dropped the unused `formatDateTime` import; updated `OrdersHistoryTable.test.tsx` (receipt-progress moved to the modal) + added a column-set assertion. `ci:web` green; live `/orders` smoke en/es. Remaining `ENG-132` screens: Purchases, Inventory Movements/Entries, Finance. |

## Recommended Sequence

1. The retail screen-focus wave is **closed**: `ENG-182..ENG-188` all shipped — `/sales` sellability
   under `ENG-186`, `/operations` needs-attention under `ENG-187`, and the `/company` Setup grouped-nav
   restructure under `ENG-188`. The active track is now the **`ENG-132` list-screen simplification**
   (smallest useful column set + secondary detail into a drawer, one screen per commit): Products
   (`ENG-132a`), Customers (`ENG-132b`), Inventory Stock (`ENG-132c`), Quotations
   (`ENG-132d`), and Orders (`ENG-132e`) shipped; remaining Purchases, Inventory Movements/Entries, Finance.
2. Resume the other pending Plan v3 tickets from [PLAN-V3.md](./PLAN-V3.md) once the `ENG-132`
   list-screen pass is far enough along (or in parallel for non-UI rails like `ENG-133` / `ENG-135`).
3. Keep gated tickets parked until their gate clears:
   `ENG-021`, `ENG-022`, `ENG-023`, `ENG-059`, `ENG-063`, `ENG-160`, and the
   Brazil NFe slice of `ENG-161`.
4. Run `ENG-164` before hosted-only work (`ENG-157`, `ENG-158`, `ENG-162`) or
   the cross-tenant aggregate slice of `ENG-138`.
5. Run `ENG-165` before `ENG-118` public API exposure.

## Ticket Execution Shape

For each ticket:

1. Read `ROADMAP.md §3b` for the ticket row and acceptance criteria.
2. Read the specialty docs named by the row.
3. Keep edits scoped to the ticket plus collateral fixes needed for truth.
4. Update docs in the same commit when behavior, commands, gates, or product
   claims change.
5. Move long shipped-history detail to [ARCHIVED.md](./ARCHIVED.md) instead of
   extending active planning files.

## Verification Matrix

| Touched area                           | Required command                              |
| -------------------------------------- | --------------------------------------------- |
| Web React/TypeScript                   | `pnpm run ci:web`                             |
| Server/Node/tRPC/DB                    | `pnpm run ci:server`                          |
| Electron main process                  | `pnpm run ci:desktop`                         |
| Web E2E, login, sales, inventory flows | `pnpm run test:e2e:web`                       |
| Electron bootstrap or E2E              | `pnpm run test:e2e:electron`                  |
| Docs-only cleanup                      | `git diff --check` plus link/claim inspection |

Any user-facing UI change also needs live browser or Electron smoke. Tests do
not replace the smoke.

## Closing A Ticket

When a ticket closes:

1. Change its `ROADMAP.md §3b` status to `Shipped`.
2. Append a concise `Shipped:` summary to the scope cell.
3. Capture follow-ups in `BACKLOG.md` or ask the operator before stopping.
4. If the closeout gets long, move detail to `ARCHIVED.md` and leave a link.
5. Keep the commit message conventional and scoped, with no AI co-author
   trailer.
