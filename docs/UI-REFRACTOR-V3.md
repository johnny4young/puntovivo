# UI Refactor V3 - Simpler, Faster Operator Workspaces

> Status: planning proposal for the World-Class LatAm POS wave.
> Created: May 20, 2026.
> Evidence: live desktop and mobile smoke against the local dev seed
> (`admin@localhost`, 1440x960 and 390x844) plus route/code review.
> Related tickets: `ENG-131`, `ENG-132`.

## 1. Goal

Puntovivo should feel powerful without forcing every user to see every
capability at once. The next UI refactor should reduce visible choices
per screen, make the next action obvious, and keep expert controls close
but secondary.

The goal is not a decorative redesign. It is an information architecture
and workflow refactor that makes a busy cashier, manager, owner, and
admin faster.

## 2. Live Audit Findings

The current app already has strong primitives: role gates, module gates,
 tabs, route-level surfaces, shared tables, and local-first POS
behavior. The friction is that many screens expose operational,
historical, diagnostic, and setup decisions at the same time.

| Area | Current observation | Refactor direction |
| --- | --- | --- |
| Sidebar | Admin first load shows 13 route links before opening Setup; Setup hides another large configuration set behind one disclosure. | Replace route inventory with 6-8 role workspaces. Move low-frequency entities into workspace subnav, tabs, or command palette. |
| Header | Search, status, language, site, notifications, and user controls compete on every route. | Make header an action bar: command search, active site, alerts. Fold language and low-frequency controls into user/settings menus. |
| Dashboard | Live audit showed 23 visible card-like surfaces and 2.47 viewport scroll ratio at desktop. | Split role home from owner analytics. Default home should show "needs attention" and the next 3 actions, not every metric. |
| Sales | Desktop audit showed 34 visible buttons, 16 card-like surfaces, one history table, and 14.3 viewport scroll ratio. Mobile audit showed 34 visible buttons and 16.62 viewport scroll ratio. | Make `/sales` a cashier lane: product input, cart, total, payment, blocking preflight. Move cash management, history, and KPIs to drawers/tabs/workspaces. |
| Operations | Eight flat tabs: Sync, Fiscal, Devices, Cash, Payments, Inventory, Diagnostics, Authority. | Default to an attention queue. Group expert tabs under Money, Stock, Devices/Sync, Fiscal, Support. Hide quiet panels until they have issues. |
| Company | Nine flat tabs: General, Locale, Data, Device, AI, Fiscal, Payments, Modules, Restaurant. | Convert to a Setup workspace with a readiness checklist and grouped sections: Business, Fiscal, Payments, Hardware/Receipts, Data/Migration, Modules/AI, Team/Security. |
| Catalog setup | Products, categories, providers, locations, units, VAT rates, customer catalogs, and geography are separate route entries. | Create a Catalog workspace with a left subnav or tabs. Keep Products as default; secondary catalogs live inside it. |
| Inventory | Four tabs plus summary cards and action buttons appear together. | Default to Stock. Move movements/counts/transfers/balances/replenishment into task-focused tabs. Filters belong in the toolbar or drawer. |
| Orders and Purchases | Both pages repeat the same "current cart + finalize + history" shape. | Merge into a Procurement workspace with Request, Receive, Supplier invoices, Returns, and History views. |
| Customers | Directory, fiscal identity fields, credit ledger, future loyalty/CRM, and consent are starting to share one table surface. | Keep Directory first. Use customer detail drawers/tabs for Account, Loyalty/Wallet, Consent, Campaigns, and History. |
| Fiscal, audit, peripherals | Standalone nav entries are useful to admins but noisy for daily operators. | Move under Finance/Compliance, Support, or Setup Hardware; keep command-palette access for experts. |

## 3. Target Navigation Model

The sidebar should describe jobs, not database tables. Recommended
expanded admin sidebar:

| Workspace | Default route | Contains |
| --- | --- | --- |
| Sell | `/sales` | Cashier lane, fast register, suspended sales drawer, payment drawer. |
| Operate | `/operations` | Attention queue, sync/fiscal/device/payment/cash/inventory health. |
| Catalog | `/catalog` | Products, categories, providers, locations, units, VAT, customer catalogs, geography. |
| Inventory | `/inventory` | Stock, counts, movements, transfers, replenishment, balances. |
| Procurement | `/procurement` | Purchase orders, receiving, purchases, supplier invoices, returns, landed costs. |
| Customers | `/customers` | Directory, account ledger, loyalty/wallet, consent, campaigns. |
| Finance | `/finance` | Sales history, fiscal documents/reports, payments, cash close review, accounting exports, audit. |
| Setup | `/setup` | Readiness checklist, company, sites, users, modules, hardware, receipts, AI, data/import. |

Module-specific surfaces should not permanently expand the main nav.
`/touch`, `/kds`, customer display, mobile waiter, and restaurant tables
belong in a Surface Switcher launched from Sell/Restaurant/Setup, plus
direct URLs for kiosk devices.

## 4. Screen-Level Refactor

### Sales

Keep visible on the default POS lane:

- Product/barcode input with scanner focus.
- Current cart.
- Total due and payment CTA.
- Compact preflight chip for site, cash session, printer, fiscal, hub,
  and payment rail blockers.
- Small suspended-sales indicator.

Move out of the default lane:

- Sales history -> Finance > Sales or a right drawer.
- Cash management timeline and close/open workflows -> Finance/Cash or
  a cash-session drawer.
- Daily KPIs -> role home / owner BI.
- Shortcut documentation -> help popover, not permanent page content.
- Product suggestions -> render only when backed by real suggestions.

Acceptance target: a cashier can complete the normal sale without
scrolling on desktop, and mobile/tablet shows a bottom checkout bar with
search/cart/payment as the only persistent actions.

### Operations

Default tab becomes "Needs attention":

- Fiscal retries pending.
- Payment unmatched/settlement variance.
- Hardware offline or outbox failures.
- Sync conflicts/dead letters.
- Stale cash sessions.
- Inventory drift or low-stock action.
- Support diagnostic warnings.

Quiet categories collapse into "All signals" or expert group tabs. A
store with no problems should see a short healthy state and the next
useful maintenance action, not eight empty panels.

### Company / Setup

Replace the flat tab strip with a setup dashboard:

- Readiness score and blockers first.
- Business profile, sites, users.
- Locale and fiscal per country.
- Payments and settlement.
- Hardware, peripherals, receipts, customer display.
- Data import, backup, sync, migration.
- Modules, AI, restaurant options.
- Security, roles, retention.

Each section should have one primary CTA and a completion state. Deep
links preserve existing URLs where practical, but users should not need
to remember `?tab=device` or `?tab=modules`.

### Catalog

Products remain the default. Secondary catalogs move into subnav:

- Products.
- Categories.
- Providers.
- Locations.
- Units.
- Taxes/VAT.
- Customer catalogs.
- Geography.

The product table should default to operational columns only: product,
stock, price, status, and primary action. Provider, location, tier
prices, similarity, embeddings, and advanced tax data move to column
chooser, row detail drawer, or Advanced/AI panel.

### Inventory

Default view should answer "what needs action now?":

- Stock health.
- Low stock / reorder.
- Counts.
- Transfers.
- Movements.
- Balances by site.

Summary cards become compact metrics or collapsible sections. Filters
and exports live in the table toolbar.

### Procurement

Merge Orders and Purchases into one workspace:

- Request draft.
- Orders pending receipt.
- Receiving.
- Supplier invoice/OCR.
- Purchases history.
- Returns and landed cost.

This removes duplicated cart/finalize/history patterns and gives staff a
single mental model for supplier flow.

### Customers

Keep the list simple and push detail into a drawer:

- Directory list with search and primary "Create customer".
- Detail drawer tabs: Profile, Account ledger, Loyalty/Wallet, Consent,
  Campaigns, History.
- Credit and statement actions live inside Account, not as competing row
  buttons without context.

### Finance and Compliance

Create one place for back-office trust:

- Sales history and receipt reprint.
- Cash sessions and close review.
- Payments and settlement.
- Fiscal documents and reports.
- Accounting exports.
- Audit log.

This workspace should serve owners/accountants, not cashiers.

## 5. Interaction Rules

1. Each screen gets one primary action in the header. Secondary actions
   go into a More menu, toolbar, or detail drawer.
2. If a route has more than six tabs, split it into a workspace with
   grouped sections or a subnav.
3. If a panel is only useful when there is an issue, it appears in the
   attention queue or behind "All signals".
4. DataTable defaults show the columns required for the primary job.
   Export, print, and column controls move into a single table actions
   menu unless the screen is explicitly a reporting surface.
5. Empty states must say the next action and deep-link to it.
6. Setup pages should show completion state and dependencies.
7. Kiosk/surface routes stay full-screen and route-owned; they should
   not inherit the desktop sidebar.
8. Power-user access comes through command palette and deep links, not
   through a permanently expanded menu.

## 6. Ticket Plan

### ENG-131 - Information architecture and navigation refactor

Scope:

- Introduce role workspaces: Sell, Operate, Catalog, Inventory,
  Procurement, Customers, Finance, Setup.
- Replace direct sidebar entries for low-frequency setup/catalog/report
  routes with workspace subnav or command-palette access.
- Add a Surface Switcher for touch, KDS, customer display, mobile
  waiter, restaurant tables, and voice/table modes.
- Preserve existing direct URLs with redirects or deep-link adapters.
- Define mobile navigation behavior for the workspace model.

Acceptance:

- Admin first-load sidebar shows no more than eight workspace entries
  plus a setup/discover affordance.
- Cashier role sees only the sell-focused workspace and allowed
  surfaces.
- Every moved route remains reachable through workspace subnav,
  command palette, or direct URL.
- Browser smoke covers desktop, tablet, and mobile navigation.

Status: Slice A shipped 2026-05-20. The workspace data model lives
at `apps/web/src/components/layout/workspaces.ts` and the sidebar
renders the 8 workspaces with WAI-ARIA disclosure widgets +
per-workspace `localStorage` collapse persistence. Routes did NOT
move, so every existing deep link still resolves through the
unchanged `App.tsx` router. Remaining slices: Surface Switcher
launcher, new workspace shell routes `/catalog` / `/procurement` /
`/finance` with landing subnav, redirects from legacy child routes
to the new workspace landing pages, mobile workspace nav redesign,
Dashboard fold decision.

### ENG-132 - Screen simplification and progressive disclosure pass

Scope:

- Refactor Sales, Dashboard, Operations, Company/Setup, Products,
  Inventory, Orders/Purchases, Customers, Finance/Compliance, and
  surface launchers around primary task first.
- Move histories, diagnostics, exports, expert settings, and secondary
  actions into tabs, drawers, More menus, or separate workspaces.
- Add measurable density targets for key routes.

Acceptance:

- `/sales` default lane completes a normal sale without desktop scroll
  at 1440x900 when the cart has common line counts.
- Mobile `/sales` keeps search/cart/payment as persistent actions and
  moves history/cash diagnostics out of the first flow.
- `/operations` opens on an attention queue and hides quiet expert
  panels behind grouped sections.
- Setup has grouped readiness sections instead of a nine-tab flat strip.
- Products and inventory tables default to the smallest useful column
  set and expose advanced data through details/column chooser.
- EN/ES copy and live browser smoke cover every touched route.

## 7. Sequencing

Recommended order:

1. Execute `ENG-131` before adding more top-level feature routes.
2. Execute the Sales, Operations, Setup, and Catalog slices of `ENG-132`
   before heavy `ENG-110`, `ENG-123`, `ENG-124`, or `ENG-125` UI work.
3. Keep `ENG-105` focused on cashier speed; let `ENG-132` own the
   broader screen cleanup and progressive disclosure across modules.
4. Treat future vertical work as module-specific surfaces inside the new
   IA, not new permanent sidebar sections.

## 8. Validation Matrix

Minimum validation for implementation:

| Area | Proof |
| --- | --- |
| Navigation | Role-based route matrix, direct-URL redirects, command palette reachability. |
| Sales | Desktop and mobile smoke with add product, charge, suspend/resume, cash-session blocker. |
| Operations | Attention queue with empty/healthy and issue states. |
| Setup | Deep links from readiness cards to exact section and back. |
| Tables | Column defaults, More menu, export/print reachability. |
| i18n | EN and ES neutral LatAm copy parity. |
| Accessibility | Tab semantics, drawer focus trap, keyboard shortcuts, 44px touch targets where applicable. |
