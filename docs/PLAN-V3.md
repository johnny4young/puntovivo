# Puntovivo Plan V3 — World-Class LatAm POS Wave

> Status: tactical bridge between `PLAN.md` and `ROADMAP.md` for
> `ENG-103..ENG-165`.
> Created: May 20, 2026.
> Updated: May 20, 2026 (extension pass — added ENG-133..ENG-163;
> coverage-closure pass added ENG-164 hosted-SaaS substrate spike +
> ENG-165 rate-limiter; §14 enumerates externally-conditioned tickets).
> Inputs: `PLAN.md`, `PLAN-V2.md`, `MARKET-SEGMENTS.md`,
> `LONG-TERM-VISION.md`, `SELLABILITY.md`, `SALES-COCKPIT.md`,
> `UI-SURFACES.md`, `UI-REFRACTOR-V3.md`, `BACKLOG.md`,
> `WEBSITE-CAPABILITY-AUDIT.md`,
> the current `ROADMAP.md §3b` ticket pool, and competitor public
> documentation for Shopify POS, Square Retail, Lightspeed Retail,
> Toast, Odoo POS, Siigo, Alegra, Wompi, and WhatsApp Business
> Platform.

## 1. Executive Thesis

Puntovivo should not try to be another generic cloud POS. The winning
position is:

> The local-first, fiscal-native LatAm operating system for small and
> mid-market merchants that need to sell fast in-store, stay compliant,
> keep working during weak connectivity, reconcile money, and grow into
> WhatsApp, ecommerce, delivery, accounting, and vertical workflows
> without replacing the core POS.

That means "world-class" is not decorative UI or a massive ERP menu.
World-class is a property that the store can trust during the real
operating day:

- A cashier completes a sale under pressure without fighting focus,
  modals, scanner input, or layout shifts.
- Each role sees the fewest useful choices first, with expert controls
  available through workspaces, drawers, tabs, or command search instead
  of a permanent menu wall.
- The owner can prove what happened: fiscal document, payment, stock,
  cash drawer, staff identity, audit row, and export file all reconcile.
- A new store can launch from messy spreadsheets and existing balances,
  not from a perfect greenfield setup.
- The product adapts by module: minimarket, restaurant, pharmacy,
  service business, supermarket, and hardware store share foundations
  but do not expose irrelevant workflows.
- Partners can integrate through stable events and APIs instead of
  reading internal tables or forking the product.
- Operators stay safe: backups exist and are tested, updates roll back
  cleanly, sensitive data is governed by consent and retention, and the
  product reports its own health to support before the merchant has to
  ask.
- The product earns money for the team that builds it: subscription,
  trial, dunning, and license enforcement are part of the product, not
  a parallel spreadsheet that the operator runs by hand.

## 2. Market Objective

### Primary ICP

Puntovivo should first target Colombian and LatAm merchants with:

- 1-10 locations.
- Physical checkout as the daily center of gravity.
- Weak or inconsistent internet at least some of the time.
- Need for electronic invoicing / fiscal reporting.
- Heavy WhatsApp usage for receipts, quotes, reminders, and orders.
- Practical hardware: barcode scanner, thermal printer, cash drawer,
  customer display, payment terminal, scale, and kitchen display when
  relevant.
- Owners who care about cash control, inventory accuracy, supplier
  purchasing, and payment reconciliation more than abstract dashboards.

### Initial Wedge

The first commercial wedge is not every vertical. It is:

1. Retail/minimarket with fiscal, hardware, cash, inventory, and
   offline-first reliability.
2. Restaurant-lite and service-heavy flows where touch, KDS, tables,
   appointments, tips, commissions, and WhatsApp create a clear upgrade.
3. Regulated/dense verticals once shared primitives are mature:
   pharmacy, supermarket, and hardware stores.

### Explicit Non-Target For V3

- Enterprise ERP replacement for large national chains.
- Full hotel/property management.
- Fintech that holds merchant/customer funds.
- Cloud-only POS dependent on a central server for checkout.
- Marketplace seller suite that ignores in-store cashier operations.
- Native mobile apps before the web/Electron surfaces prove the
  workflow.

## 3. Competitive Benchmark Snapshot

Current market references show the table stakes:

| Competitor type | What they make normal | Implication for Puntovivo |
| --- | --- | --- |
| Shopify POS | Omnichannel selling, inventory across channels, staff, customers, reporting, payments, hardware. | Puntovivo needs omnichannel and inventory sync, but with LatAm fiscal and local-first checkout. |
| Square Retail | Integrated payments, inventory, purchase orders, customer directory, reports, loyalty, hardware. | Puntovivo needs a comparable operator experience plus better fiscal/audit and local hardware flexibility. |
| Lightspeed Retail | Multi-location stock, ecommerce, smart inventory, analytics, loyalty, staff, accounting integrations, hardware. | Puntovivo needs chain/HQ controls, purchasing depth, and accounting exports to compete upmarket. |
| Toast / restaurant POS | KDS, online ordering, loyalty, marketing, restaurant hardware, third-party delivery and kitchen routing. | Restaurant workflows must be operationally real: stations, timing, prep states, modifiers, split checks, tips, and delivery intake. |
| Odoo POS / ERP suites | POS tied to inventory, accounting, ecommerce, CRM, loyalty, employees, restaurant/self-ordering. | Puntovivo should not copy ERP complexity, but must integrate accounting/inventory enough that owners do not double-enter data. |
| Siigo / Alegra in Colombia | POS plus inventory, cash control, electronic invoicing, accounting ecosystem, DIAN compliance. | Colombia sellability requires fiscal trust, local accounting paths, and simple onboarding before advanced differentiators matter. |
| Wompi / local payment rails | Cards, PSE, Nequi, Bancolombia button, cash correspondents through API flows. | Payment rails need gross/net settlement, reconciliation, QR/wallet flows, and offline-risk boundaries. |
| WhatsApp Business Platform | Automated customer messaging, catalog, and service engagement. | WhatsApp should be treated as a commerce and service channel, not just a receipt-sending add-on. |

## 4. Must-Win Dimensions

| Dimension | World-class bar | Puntovivo differentiator |
| --- | --- | --- |
| Sellability | A real store can run a full day without developer help. | Readiness checklist, migration tools, live health, recovery flows, and hardware validation. |
| Checkout speed | Cashier can sell with scanner/keyboard/touch and minimal modal friction. | Local-first renderer, stable cart, command palette, preflight, quick-create, fast-register mode. |
| Fiscal and audit trust | Documents, receipts, XML, exports, and retries tell one coherent story. | Fiscal-native architecture, outbox recovery, semantic download contract, tenant-scoped audit. |
| Money trust | Drawer, tender, payment terminal, wallet, statement, fees, and bank settlement reconcile. | Payment outbox plus settlement ledger and Operations Center. |
| Inventory truth | Stock changes are explainable by sale, purchase, count, transfer, waste, lot, or correction. | Site-owned movements, stock counts, replenishment, vertical metadata, import validation. |
| LatAm channels | WhatsApp, accounting, ecommerce, delivery, local wallets, and marketplaces connect cleanly. | Provider abstraction around local rails instead of US-only payment assumptions. |
| Vertical depth | Restaurant, pharmacy, service, supermarket, and hardware features feel native when enabled. | Module activation with shared primitives and vertical-specific UI only when needed. |
| Owner control | Owners see exceptions, margin, cash, payments, stock, and staff performance without exporting spreadsheets. | BI control tower and task center focused on action, not vanity metrics. |
| Platform extensibility | Partners integrate without fragile database access. | Public events, webhooks, docs, sample app, idempotency, retry/dead-letter UX. |
| Supportability | Operators and support can diagnose problems remotely and safely. | Diagnostics, telemetry opt-in, version/update health, backup/restore, privacy controls. |
| **Performance** (extension) | The cashier never sees a perceivable freeze during a sale; the bundle ships under budget on legacy hardware. | Enforced perf budgets, p95 latency floors, bundle-size CI gates. |
| **Accessibility** (extension) | The product passes WCAG 2.2 AA and operates fully from the keyboard. | axe-core CI gate, keyboard-only smoke, contrast tokens, focus management. |
| **Operational identity** (extension) | A chain can map its corporate identity provider into the product without sharing passwords. | Enterprise SSO via Google / Microsoft / OIDC plus admin TOTP MFA. |
| **Update / release safety** (extension) | A release ships to one terminal, then to ten, then to a hundred, and rolls back automatically if telemetry trips. | Staged rollout + telemetry-driven rollback + per-tenant version pin. |
| **Production observability** (extension) | Support knows about a tenant's pain before the tenant reports it. | Sentry/OTEL pipeline, per-tenant error rate, trace correlation. |
| **Monetization plumbing** (extension) | A new merchant signs up, trials, pays, and renews entirely inside the product. | Subscription tiers, trial, dunning, license enforcement, grace, payment failure UX. |
| **Disaster recovery** (extension) | A store that loses its laptop can resume operations from a cloud snapshot within a working day. | Scheduled snapshots, signed cloud vault, automated restore drill, chaos game day. |
| **Compliance readiness** (extension) | The product can answer a PCI DSS / SOC 2 / ISO 27001 questionnaire from existing evidence. | Documented control set, evidence collection, residency policy, retention enforcement. |

## 5. Gap Analysis

The initial V3 draft (ENG-103..ENG-132) captured core UX, loyalty,
promotions, advanced product model, WhatsApp, ecommerce, logistics,
accounting, BI, KDS, public API, supportability, privacy, AI
automation, information architecture, screen simplification, and
vertical packs. The 2026-05-20 validation pass identified the
following extra themes that a world-class LatAm POS must own. Each is
promoted to a concrete ticket in §7:

1. **Performance budgets are not enforced.** The product can regress
   silently into a 3 MB bundle and a 600 ms p95 sale without anyone
   noticing. World-class POSes treat perf budgets as a CI gate. →
   `ENG-133`.
2. **Accessibility has no contract.** WCAG 2.2 AA is required for
   enterprise sales and for some LATAM accessibility laws (Ley 1346 in
   CO, NMX-R-050 in MX). Today no axe-core gate exists. → `ENG-134`.
3. **Production observability is missing.** ENG-128 ships local
   diagnostic bundles; the SaaS-side operator still needs a centralized
   error stream, OpenTelemetry traces, and per-tenant health. →
   `ENG-135`.
4. **Backup / restore tooling.** A real merchant must survive a stolen
   laptop. Today the operator backs up by copying SQLite files
   manually. → `ENG-136`.
5. **Auto-update + staged rollout.** Without `electron-updater`-style
   automatic delivery, every release blocks on the operator running an
   installer. Without staged rollout, a bad release reaches everybody
   at once. → `ENG-137`.
6. **Subscription / billing plumbing.** The product earns money. If we
   ship to merchants without a license enforcement story, we collect
   revenue on a spreadsheet. → `ENG-138`.
7. **Enterprise SSO + MFA.** Chains and pharmacies will not allow
   per-user passwords by 2027. Google Workspace, Microsoft Entra ID,
   and generic OIDC are table stakes. Admin TOTP MFA is overdue. →
   `ENG-139`.
8. **Shift management + LATAM labor.** "Clock-in/out baseline" inside
   ENG-106 is not enough. Schedules, breaks, overtime, and audit are
   the real ask. → `ENG-140`.
9. **Day-close comprehensive report.** Cash session close exists but
   merchants want one printable end-of-day pack with sales + cash +
   fiscal + commissions + tips + waste + variance + sign-off. →
   `ENG-141`.
10. **Loss-prevention rules are deterministic, not AI-only.** AI anomaly
    detection (ENG-032) catches statistical drift; merchants also want
    hard rules (max discount per cashier, max void per shift, dual
    approval over a threshold, after-hours alert). → `ENG-142`.
11. **In-transit transfers.** Today inventory transfers are
    one-shot. Chains move stock across days, and a partial receipt
    plus discrepancy resolution is non-negotiable. → `ENG-143`.
12. **WhatsApp inbound commerce.** ENG-112 covers outbound. World-class
    LATAM POS treats WA as a bidirectional channel: WA Business
    catalog sync, customer order intake, payment link. → `ENG-144`.
13. **Tip pooling.** ENG-117 mentions "tip compliance hooks" but the
    distribution math (by hours, by role, BOH tip-out) is a separate
    operator concern. → `ENG-145`.
14. **Recipe scaling + waste.** Bakeries, kitchens, and food trucks
    need batch scaling and waste recording. → `ENG-146`.
15. **Self-checkout + table QR ordering.** Customers expect to order
    from their phone or self-checkout for low-touch verticals. ENG-107
    covers the read-only display; this is the writeable lane. →
    `ENG-147`.
16. **Hardware compatibility matrix.** Today hardware support is
    aspirational. World-class POSes publish a certified hardware list
    and gate releases against it. → `ENG-148`.
17. **Shared peripheral resolver.** Multi-cashier stores share printers
    and drawers across registers. Today the hardware stack assumes one
    cashier per peripheral. → `ENG-149`.
18. **Universal print server.** Browser-only mode loses the ESC/POS
    path. A LAN-resident print bridge (WebUSB / WebSerial on the hub)
    unblocks tablet-only registers. → `ENG-150`.
19. **Chaos / DR game day.** Backup + restore is useless if it has
    never been tested under failure. → `ENG-151`.
20. **Data export portability.** Merchants must own their data. A full
    JSONL + Parquet export per tenant is the honest answer. → `ENG-152`.
21. **Customer cohort / LTV / RFM.** ENG-127 covers segmentation but
    not the retention math. → `ENG-153`.
22. **Receipt branding studio.** ENG-016 templates exist; per-channel
    (email vs WhatsApp vs print) branding does not. → `ENG-154`.
23. **Contextual help + in-product video.** A "Loom-like" tutorial
    library lowers the onboarding cliff faster than docs. → `ENG-155`.
24. **Multi-currency operations.** Tourist-zone tenants sell in USD and
    settle in COP. Today the tenant locale resolves one currency. →
    `ENG-156`.
25. **Public demo sandbox.** Marketing claims need a one-click hosted
    demo. → `ENG-157`.
26. **Tenant sandbox / clone.** Pilots experiment without risk by
    cloning their production tenant into a sandbox. → `ENG-158`.
27. **Data residency policy.** Banks, pharmacies, and government
    customers need an enforced "AI calls must not leave country X"
    contract. → `ENG-159`.
28. **Nómina Electrónica DIAN.** Colombia payroll fiscal is a major
    add-on for ICP merchants. Gated on the same DIAN PT contract as
    ENG-021. → `ENG-160`.
29. **pt-BR + NFe Brazil foundations.** "LATAM" without Brazil is
    incomplete. Locale parity is doable now; NFe stays gated. →
    `ENG-161`.
30. **Hosted micro-storefront.** A per-tenant
    `shop.puntovivo.app/<slug>` with catalog + WA ordering + payment
    link is a lower-effort wedge than the full ecommerce bridge. →
    `ENG-162`.
31. **Compliance readiness pack.** PCI DSS SAQ-A, SOC 2 Type 1, and
    ISO 27001 evidence collection. → `ENG-163`.
32. **Hosted SaaS substrate is undecided.** `ENG-157` (demo sandbox),
    `ENG-158` (tenant clone), `ENG-162` (hosted micro-storefront), and
    the cross-tenant aggregate slice of `ENG-138` (billing back-office)
    all implicitly require a hosted multi-tenant server runtime. Today
    Puntovivo is Electron + local SQLite; `STACK-EVOLUTION.md` Phase β
    mentions a central server as future. The data substrate
    (Postgres vs SQLite vs hybrid) is not decided. Same spike shape as
    `ENG-037` (libSQL/Turso → Defer). → `ENG-164` (spike).
33. **Rate limiter is a single global IP bucket.** Captured in
    `BACKLOG.md` as `[security][infra][trpc]`. `ENG-118` (public API)
    will hit this immediately — a partner integration on a shared NAT
    can DOS one tenant. → `ENG-165` (promoted from BACKLOG).

## 6. Validation Pass on the Original V3 Draft (ENG-103..ENG-132)

The 2026-05-20 review verified each of the original 30 tickets against
realizability, dependency closure, and competitive baseline. Findings:

### Sequencing dependencies that were under-specified

- **ENG-108 (loyalty + gift cards)** must follow **ENG-124 (settlement
  v2)** so gift-card liability reconciles to bank deposits.
- **ENG-113 (omnichannel bridge)** must follow **ENG-124** for the
  same reason — ecommerce-originated payments need the same
  reconciliation contract.
- **ENG-127 (CRM + campaigns)** must follow **ENG-129 (privacy + consent)**.
  Today the proposal sequences ENG-127 after ENG-112 but is silent on
  the consent prerequisite.
- **ENG-130 (AI automation)** depends on **ENG-133 (perf budgets)** so
  AI calls cannot regress the bundle.
- **ENG-131 (IA refactor)** must land before any vertical-pack UI
  (ENG-117, ENG-119..ENG-122) or those packs will require a second
  refactor.
- **ENG-132 (screen simplification)** depends on **ENG-131** to avoid
  double-touching screens.

### Acceptance criteria that need strengthening

- **ENG-103 (export contract)**: add explicit virus-scan hook stub for
  exports that arrive from customer uploads (purchase OCR, CSV
  import).
- **ENG-104 (guided setup)**: the readiness checklist must surface in
  the same attention queue as ENG-128 supportability — operators
  should not have two attention queues.
- **ENG-105 (cashier speed)**: `aria-keyshortcuts` must be set on the
  cashier shortcuts so the ENG-134 a11y certification can pass.
- **ENG-106 (PIN + approvals)**: explicit PIN-timeout re-entry policy
  and audit-row mandatory for every approval/rejection.
- **ENG-110 (variants/lots/BOM)**: migration safety for tenants that
  currently use the legacy single-SKU model — opt-in per product, no
  destructive defaults.
- **ENG-112 (WhatsApp outbound)**: must split between outbound (this
  ticket) and inbound commerce (now `ENG-144`).
- **ENG-115 (accounting)**: add a "dry run" mode that diffs against the
  accounting target without committing.
- **ENG-118 (public API)**: add an explicit API versioning policy
  (semver in URL or header) before publishing.
- **ENG-123 (launch migration)**: explicit "demo data" mode separate
  from "real data" mode so pilots do not accidentally commit fixture
  rows.
- **ENG-124 (settlement)**: explicit retry/back-off policy for failed
  payment intents.
- **ENG-125 (procurement)**: integrate with the existing ENG-094
  invoice OCR pipeline; the supplier-invoice matching path should not
  re-implement OCR.
- **ENG-128 (supportability)**: integrate with **ENG-135**
  observability (one pipe).
- **ENG-130 (AI automation)**: every suggestion must have a "safe
  degrade to deterministic flow" contract that is tested explicitly,
  not assumed.

### Tickets that are well-scoped as drafted

`ENG-107`, `ENG-109`, `ENG-111`, `ENG-114`, `ENG-116`, `ENG-117`,
`ENG-119`, `ENG-120`, `ENG-121`, `ENG-122`, `ENG-126`, `ENG-129`,
`ENG-131`, `ENG-132`. These ship as-is.

## 7. Ticket Detail (Original V3 + Extension)

| Ticket | Scope | Why it matters | Acceptance anchor |
| --- | --- | --- | --- |
| `ENG-103` | Audit-grade export and download contract. Centralize filename, extension, MIME, and Blob/download behavior for statements, reports, XML, CSV, Excel, PDF, and ZIP bundles. Add a virus-scan hook stub for customer-uploaded artifacts. | A POS that downloads UUID-like files without extensions feels unfinished and breaks back-office workflows. | Every exported artifact has a semantic filename, real extension, correct MIME, and a regression test. Statements use `statement-<provider>-<date-range>.<ext>`. |
| `ENG-104` | Guided store setup and readiness checklist. First-run wizard for locale, fiscal, sites, sequentials, peripherals, payments, modules, users, catalog import, seed/demo cleanup, role-based home, task center, and actionable empty states. Surfaces in the same attention queue as ENG-135 supportability. | The product cannot be world-class if onboarding depends on docs and hidden settings. | Admin sees a readiness score with blocking and optional steps; each CTA deep-links to the exact settings tab; completed state persists per tenant; users land on a role-appropriate home. |
| `ENG-105` | Sales Cockpit v2 speed pass. Keyboard map, command palette, stable cart, rapid cash checkout, payment drawer, customer attach, scanner-first focus, checkout preflight, quick-create, fast-register mode, undo/recovery, and `aria-keyshortcuts` declaration. | Checkout speed is the core daily value of a POS. Visual polish must serve scanning and repeated action. | Cashier can search, add, attach customer, take exact cash, print, recover from a reversible mistake, and start the next sale without using the mouse; desktop and tablet smokes prove no layout shifts. |
| `ENG-106` | Staff PIN mode and manager approvals. Fast cashier switch, clock-in/out baseline (full shift management lives in ENG-140), manager approval queue for credit override, void, discount, drawer open, refund, and credit-sale requests. Explicit PIN-timeout policy and per-approval audit row. | LatAm stores often share terminals. Accountability must be fast enough that operators use it. | Sensitive actions request manager PIN/approval, write audit rows with requester and approver, and do not expose manager sessions to the cashier. |
| `ENG-107` | Customer-facing display, kiosk/order status, and touch surface picker. Second-screen checkout display plus kiosk/read-only order status; `/touch` switches between catalog, voice, tables, and waiter/KDS view when modules are active. | Customer trust improves when totals and order state are visible before payment. Operators need discoverable surface switching. | Electron can open a second display; browser-only mode uses SSE; display shows cart lines, totals, customer name when allowed, and payment status without admin data exposure. |
| `ENG-108` | Loyalty, gift cards, and customer wallet. Points, rewards, stored credit, gift-card issuance/redemption, liability tracking, and balance history. Depends on ENG-124 settlement so gift-card liability reconciles to bank deposits. | Retention is table stakes against Square, Shopify, Loyverse, and local cloud systems. | Sales earn/redeem points or wallet balance; gift-card liability is auditable; refunds reverse benefits consistently. |
| `ENG-109` | Promotions and pricing engine. Customer groups, time windows, bundles, mix-and-match, happy hour, coupon codes, price lists, and priority/conflict rules. Every applied rule writes a snapshot row for audit. | Merchants need growth tooling without exporting to another app. | Checkout applies eligible promotions with an explanation per rule, snapshots applied discounts on sale/receipt/audit, and rejects ambiguous conflicts predictably. |
| `ENG-110` | Advanced product and inventory model. Variants, lots, expiry, serials, composite/BOM products, product station routing for KDS, catalog import mapping, and row-level validation. Opt-in per product — tenants on the legacy single-SKU model are not migrated destructively. | This unlocks pharmacy, supermarket, electronics, apparel, recipes, and dense catalogs without vertical-specific hacks. | Products opt into variant, lot, serial, expiry, composite, or station behavior independently; stock movements remain tenant/site scoped; import previews reject bad rows before persistence. |
| `ENG-111` | Replenishment, stock counts, and purchase planning. Cycle counts, variance resolution, reorder points, supplier lead times, suggested purchase orders, and low-stock forecasting. Hooks into ENG-130 AI demand forecasting when both ship. | World-class POS systems prevent stockouts instead of only recording them. | Admin can run a count, resolve variances with audit rows, and generate draft purchase orders from reorder rules and velocity. |
| `ENG-112` | WhatsApp **outbound** messaging: receipts, quotation PDF/link sharing, reminders, and post-sale messaging. Provider abstraction, templates, consent, receipt links, quotation PDF links or provider-supported attachments, quote links, payment reminders, and message log. Inbound commerce moves to `ENG-144`. | WhatsApp is the default customer channel for many LatAm merchants. | A sale receipt or quotation PDF/link can be sent by WhatsApp, consent/status is tracked, provider failures are visible, and templates ship in en/es neutral LatAm Spanish. |
| `ENG-113` | Omnichannel commerce bridge. Shopify, Tiendanube, WooCommerce, MercadoLibre, and VTEX catalog/order sync using public events and outboxes. Depends on ENG-124 for payment reconciliation. | LatAm merchants sell across marketplaces and social commerce; POS-only inventory becomes stale. | One connector syncs catalog and stock, ingests an order into Puntovivo, and preserves idempotency/audit/fiscal boundaries. |
| `ENG-114` | Delivery and logistics execution. Delivery notes, pick lists, packing slips, route assignment, proof of delivery, exceptions, and failed-delivery recovery with refund linkage. | Restaurants, pharmacies, hardware stores, and wholesalers need fulfillment, not just checkout. | A sale can become a delivery task, be picked/packed, assigned, closed with proof of delivery, or failed with reason and audit trail. |
| `ENG-115` | Accounting exports and reconciliation packs. Alegra, Siigo, World Office, and generic CSV journal exports. Dry-run mode that diffs against the target before committing. | Accounting integration is a buying criterion for Colombian and LatAm merchants. | Admin can export or push a period to an accounting target with idempotency, retry diagnostics, mapping errors, and no duplicate ledger entries. |
| `ENG-116` | Owner BI control tower and scheduled reports. Gross margin, sell-through, inventory valuation, cashier performance, payment reconciliation, anomalies, and Monday PDF/email reports. Cross-links to ENG-130 AI anomaly drill-down. | Owners need a decision cockpit, not only operational tables. | Dashboard filters by site, cashier, category, payment rail, customer segment, and date; scheduled reports generate PDF/email output and cite data freshness. |
| `ENG-117` | Restaurant KDS and service lifecycle v2. Product station routing, modifiers, prep thresholds, served state, waiter read-only view, append-items-mid-service, optional sound, split checks. Tip pooling distribution moves to `ENG-145`. | ENG-098 shipped KDS foundation; this makes it viable in a real kitchen and service handoff. | Items route by product station; cooks/waiters advance distinct states; appended items create delta KDS cards; sound is tenant-toggleable off by default. |
| `ENG-118` | Public API, webhook delivery worker, and integrator kit. Subscriber configuration UI, HTTP delivery worker, signing, retry/dead-letter UX, API docs with explicit semver, and sample app. | A best-in-LatAm POS needs partner extensibility for accountants, ecommerce agencies, hardware integrators, and vertical specialists. | Admin can register a webhook endpoint, receive signed events, inspect attempts, replay failures, and follow a stable API contract. |
| `ENG-119` | Services vertical: appointments, commissions, and customer asset history. | Salons, barber shops, repair shops, and garages sell time and expertise, not only inventory. | Appointment flows can be scheduled, started, completed, and invoiced; cart lines carry employee attribution; commissions appear in cash-session close; asset records remain scoped. |
| `ENG-120` | Pharmacy vertical: compliance metadata, generics, and controlled-sale capture. | Pharmacies need inventory safety and regulatory traceability at checkout. | Search surfaces active ingredient and generic alternatives; controlled products require prescription metadata; expiry/lot risk is visible before sale completion. |
| `ENG-121` | Supermarket vertical: scales, PLU barcodes, perishables, DSD, shrinkage, age restriction, and category tax rules. | Supermarkets need scanner/scale speed plus fiscal accuracy for weighed, restricted, and category-taxed products. | A scanned PLU or scale read creates the correct weighted cart line; tax breakdowns preserve category rules on receipt, fiscal payload, and audit. |
| `ENG-122` | Hardware-store vertical: fractional units, conversions, project kits, contractor context, internal barcode generation, technical specs, bulk pricing, and FTS5 search. | Ferreterias have dense catalogs, non-unit sales, kits, and contractor workflows that decide whether the POS can replace spreadsheets. | Cashier can sell by meter, box, roll, or kit; kit lines explode into editable components; dense search meets target latency on low-spec hardware. |
| `ENG-123` | Launch migration and data-quality workbench. Import products, stock, customers, suppliers, prices, credit balances, gift-card balances, opening cash, and fiscal profile data from CSV/Excel; preview, deduplicate, validate, and produce a launch report. Demo-data mode is explicitly distinct from real-data mode. | A real merchant never starts with clean data. Migration quality decides whether the first pilot day works. | Admin can run a dry-run import, fix row-level errors, commit a launch batch, see rollback guidance, and export a launch report with accepted/rejected counts. |
| `ENG-124` | Payment terminal, QR, wallet, and settlement v2. Productize payment intents, Wompi/PSE/Nequi/Bancolombia QR flows, semi-integrated terminal adapters where possible, statement imports, fees, withholding, GMF, gross/net settlement, unmatched-payment workflows, and explicit retry/back-off policy. | Money trust is a core POS promise; payment success must reconcile to bank settlement and accounting. | A card/QR/wallet payment can be initiated or recorded with provider reference; imported statements match to tenders; Operations shows unmatched, fee, tax, and settlement variance. |
| `ENG-125` | Procurement, receiving, supplier invoice, and landed-cost control. Purchase order lifecycle, receiving against PO, supplier invoice matching via the existing ENG-094 OCR pipeline, purchase returns, cost adjustments, and landed-cost allocation. | Inventory accuracy starts before the sale. Owners need margin truth from receiving, not only checkout. | Staff can receive goods against a PO, match supplier invoice lines, update inventory/cost, handle returns, and surface margin impact in BI. |
| `ENG-126` | Chain HQ and multi-location governance. Central catalog with local overrides, price books, site groups, role scopes, transfer approvals, consolidated reporting, and remote policy rollout. | Merchants that grow past one store need control without losing local flexibility. | HQ can publish catalog/pricing policy, sites can override allowed fields, transfers require approval where configured, and BI consolidates site performance. |
| `ENG-127` | Customer CRM, consent, segments, and campaigns. Customer timeline, consent records, segmentation, birthday/reactivation campaigns, NPS/feedback, coupon attribution, and unsubscribe handling. Depends on `ENG-129` (privacy/consent records). | Loyalty and WhatsApp need governed customer data, not one-off message sending. | Admin can segment customers, launch a compliant campaign, attribute redemptions, and prove consent/unsubscribe state per customer. |
| `ENG-128` | Supportability and remote operations readiness. Diagnostic bundles, telemetry opt-in, version/update health, feature flags, remote support checklist, and evidence redaction. Pairs with `ENG-135` for the centralized side. | A world-class POS is supportable when a store is busy and frustrated. | Support can receive a redacted diagnostic bundle, see version/module/device health, correlate errors to operations, and guide recovery without raw DB access. |
| `ENG-129` | Security, privacy, and data-retention pack. Role templates, permission audit, Habeas Data-style export/delete flows, retention policy, backup encryption/key handling, PII minimization, and audit-review screens. | LatAm expansion and customer trust require privacy/security controls before scale. | Admin can review permissions, export/delete eligible customer data, configure retention, verify backups are protected, and inspect sensitive audit events. |
| `ENG-130` | AI automation suite. Demand forecasting, replenishment suggestions, anomaly triage, support/setup assistant, receipt/invoice explanation, and operational task suggestions with auditability and budget limits. Explicit "safe degrade to deterministic flow" contract. | AI should reduce daily work and catch issues; it should not be a decorative chatbot. | AI suggestions cite source data, can be accepted/dismissed, write audit rows, respect tenant budgets, and degrade to deterministic flows when providers are unavailable. |
| `ENG-131` | Information architecture and navigation refactor. Role workspaces for Sell, Operate, Catalog, Inventory, Procurement, Customers, Finance, and Setup; Surface Switcher for touch/KDS/customer display/mobile waiter/restaurant routes; preserve direct URLs through deep links or redirects. **Must land before any new vertical UI work.** | Adding more features to the current sidebar would make the product feel like an ERP menu. A world-class POS hides irrelevant choices without hiding power. | Admin first-load sidebar shows no more than eight workspace entries; cashier sees only sell-focused routes; moved routes remain reachable through workspace subnav, command palette, or direct URL; desktop/tablet/mobile navigation smokes pass. |
| `ENG-132` | Screen simplification and progressive disclosure pass. Refactor Sales, Dashboard, Operations, Company/Setup, Products, Inventory, Orders/Purchases, Customers, Finance/Compliance, and surface launchers. | Efficiency comes from reducing decisions, not adding features. | `/sales` can complete a normal sale without desktop scroll at 1440x900 for common carts; mobile `/sales` keeps search/cart/payment persistent; Operations opens on an attention queue; Setup replaces the nine-tab flat strip with grouped readiness sections; key tables default to the smallest useful column set; EN/ES live smoke covers touched routes. |
| `ENG-133` | **Performance budgets + bundle-size + p95 latency CI gates.** Add Lighthouse-CI for the top user-facing routes, a per-route JS bundle-size budget enforced in `ci:web`, a tRPC p95 latency budget enforced in `ci:server`, and a memory ceiling for the Electron main + renderer process recorded by `ci:desktop`. A regression breaks the build. | Without an enforced perf budget the product silently degrades on the legacy Celeron AIO hardware that ICP merchants actually run. | Each enforced metric has a baseline + threshold in a `perf-budget.json`; CI fails the PR when any metric regresses; the Operations Center surfaces the latest measured baseline so operators can see the current value. |
| `ENG-134` | **Accessibility WCAG 2.2 AA conformance + axe-core CI gate.** Keyboard-only audit, screen-reader sweep, contrast tokens, focus management, axe-core on every component test, ARIA roles on icon-only buttons, accessible names for every dialog and dropdown, `aria-keyshortcuts` aligned with ENG-105. | Required for enterprise sales, for some LATAM accessibility laws, and for keyboard-first cashier operation. | axe-core runs on every component test and on the Playwright smoke for the top 10 routes; zero serious or critical violations on the AA ruleset; keyboard-only smoke covers `/sales` end-to-end. |
| `ENG-135` | **Production observability stack.** Sentry (or self-hosted GlitchTip) for the web + Electron main, OpenTelemetry tracing for tRPC, structured logs with tenant scope, per-tenant error rate dashboard. Telemetry is opt-in per tenant and inherits the redaction rules from ENG-128. | Support cannot do its job without a centralized error pipe across the tenant fleet. | A new error in `apps/web/**` lands in the support pipeline within one minute; trace IDs span renderer → main → server → DB; the operator can see error rate, latency p95, and crash-free sessions per tenant. |
| `ENG-136` | **Backup / restore tooling + cloud vault + scheduled snapshots.** Manual + cron-scheduled snapshots using SQLite `VACUUM INTO` to a per-tenant encrypted blob, optional upload to a configured S3-compatible vault, automated point-in-time restore drill, and operator-facing restore UI. | A merchant that loses its laptop must resume operations within a working day; that requires tested backups. | Admin can configure snapshot frequency + destination, see the last successful snapshot timestamp, trigger a manual snapshot, and run a restore drill that writes an audit row + reports diff vs current DB. |
| `ENG-137` | **Auto-update + staged rollout + rollback.** `electron-updater`-style automatic delivery, per-tenant version pinning, staged rollout (10% → 50% → 100%), telemetry-driven rollback hook, and "update health" surfacing in the supportability queue. | Without auto-update every release is a phone call. Without staged rollout every release is a single point of failure. | Admin can opt a tenant into a staged channel, the renderer reports the current version + last-update timestamp, and a release marked "rollback" reverts every terminal within one update cycle. |
| `ENG-138` | **Subscription / billing / license enforcement.** Plan tiers, trial period, dunning, license gate at module activation, grace-period mode (read-only access for N days after license expires), and integration with one local payment rail (Wompi recurring + Stripe). | The product earns money. The licensing story must be inside the product, not on a spreadsheet. | Admin can start a trial, convert to paid, fail a payment and enter grace, and recover by adding a new card; a tenant past grace cannot complete sales but can export data. |
| `ENG-139` | **Enterprise SSO + MFA.** Google Workspace, Microsoft Entra ID, generic OIDC, optional SAML 2.0, tenant-role mapping, audit trail, and admin TOTP MFA as the baseline second factor for username/password tenants. | Chains and pharmacies will not allow per-user passwords by 2027; admin MFA is overdue regardless. | Admin can connect a tenant to an IdP, map IdP groups to tenant roles, enforce MFA for admin actions, and recover lost MFA through a verified recovery flow with audit. |
| `ENG-140` | **Shift management + LATAM labor compliance.** Schedules, break tracking, overtime calculation per country (CO/MX/CL/PE/AR), attendance audit, integration with cash sessions, and a manager-facing schedule editor. Promotes the ENG-106 "clock-in/out baseline" stub into a full feature. | LATAM labor codes treat shift records as durable evidence. The product must produce them. | Admin can build a schedule, the cashier clocks in/out from the POS, overtime is calculated per the tenant's country rules, and a payroll export ships in CSV + the accounting target's format. |
| `ENG-141` | **Day-close comprehensive report + manager sign-off.** A printable end-of-day pack bundling sales, fiscal documents, cash variance, payment settlement, commissions, tips, waste, voids, refunds, AI anomaly summary, and manager signature line. Renders to PDF + WhatsApp link + email. | Every merchant wants one piece of paper per day that says "yesterday closed clean." Cash session close alone does not deliver that. | At day end the manager opens the report, reviews the bundled sections, signs off (electronic), and the resulting PDF is stored, emailed, and optionally pushed to accounting. |
| `ENG-142` | **Loss-prevention rules engine (deterministic).** Per-cashier maximum discount, max void/refund per shift, no-sale rule, after-hours sale rule, dual-approval thresholds, and configurable alerts. Complements `ENG-130` AI anomaly detection with hard rules that work offline. | Statistical anomaly detection catches drift; merchants also want hard guardrails that block-then-approve in real time. | Admin can configure per-role rules, the cashier sees the block + approval CTA at the moment of violation, and every rule trigger writes an audit row + optional WA push to the manager. |
| `ENG-143` | **In-transit transfer state + multi-day partial receipt.** Schema extension on `inventory_transfers` for `in_transit` and `partially_received` states, partial-receive line table, discrepancy resolution UI, and audit chain that spans the days a transfer is moving. | Chains move stock across days; partial receipt and discrepancy resolution are non-negotiable. | A transfer can leave site A on day 1, arrive on day 3 with five of ten cartons received, surface the gap, allow the receiver to record a discrepancy, and reconcile the audit chain when the rest arrives. |
| `ENG-144` | **WhatsApp inbound commerce.** WA Business Platform Cloud API integration for inbound: catalog sync (Puntovivo products → WA catalog), customer order intake via WA, drop into Puntovivo as a draft sale with payment-link tender, and order-status replies. | World-class LATAM POS treats WA as a bidirectional commerce channel, not just a receipt sender. | A customer can browse the tenant catalog inside WA, place an order, pay via a generated link, and the cashier sees the order arrive as a draft sale ready to fulfill. |
| `ENG-145` | **Tip pooling and distribution math.** Multiple pool types (per-shift, per-section), distribution rules (by hours, by role, by station), back-of-house tip-out, payout schedule, and cash-session integration. | Restaurants need tip distribution as a first-class operation, not a manager-runs-a-spreadsheet workflow. | Admin configures a pool, tips collected on sales flow into the pool, the distribution rule fires at shift close, employees see their share, and the cash session report shows the payout owed. |
| `ENG-146` | **Recipe scaling + batch production + waste tracking.** Scale a recipe by % or batch size, create batch production runs that consume BOM ingredients, record waste against recipes or raw inventory, and surface waste in `ENG-116` BI. | Bakeries, kitchens, food trucks, and pharmacies need batch production + waste truth, not only single-sale BOM consumption. | Admin can scale a recipe, run a batch that consumes the scaled ingredients, record waste with reason codes, and review waste cost in the BI control tower. |
| `ENG-147` | **Self-checkout + table QR ordering.** A customer-facing kiosk surface that lets the customer scan, add to cart, and pay (read-write extension of ENG-107's read-only display); a per-table QR code that opens a write-enabled mobile menu and drops the order into the POS as a draft sale. | Self-service is a major LATAM differentiator for cafés, food courts, pharmacies, and minimarkets where labor is scarce. | A customer can complete a self-checkout sale from the kiosk with payment-terminal or QR rail; a customer can scan a table QR, build an order on their phone, and the waiter sees it arrive in the POS. |
| `ENG-148` | **Hardware compatibility matrix + certification gate.** Publish a certified hardware list (scanners, printers, drawers, scales, payment terminals, customer displays) with a test plan per device; CI gate that runs the test plan on a known-good rig and blocks releases that regress a certified device. | World-class POSes publish what they support and gate releases against it. Today hardware support is aspirational. | A `docs/HARDWARE-COMPAT.md` matrix lists certified devices + status; `ci:desktop` runs a smoke test against a configurable rig; a certified-device regression breaks the build. |
| `ENG-149` | **Shared peripheral resolver.** LAN print queue + shared drawer resolver for multi-cashier stores: the hub coordinates printer + drawer access so two registers do not collide on the same physical device. | Tight stores share printers and drawers; today the hardware stack assumes one cashier per peripheral. | Two cashiers can complete sales in parallel on registers A + B with one shared thermal printer + one shared drawer; the hub serializes access and audit shows which register triggered each operation. |
| `ENG-150` | **Universal print server / browser-to-ESCPOS bridge.** A LAN-resident print bridge using WebUSB / WebSerial on the hub so a tablet-only register can print to ESC/POS without a local driver. | Tablet-only registers (the cheapest LATAM POS hardware) lose the ESC/POS path; this bridge restores it without installing a per-device driver. | A tablet in the same LAN as the hub can print a receipt to a hub-connected thermal printer; the bridge surfaces print queue status; offline + retry behavior matches the rest of the peripherals contract. |
| `ENG-151` | **Chaos / disaster-recovery game day + automated restore drill.** A scripted scenario library that simulates power loss, SQLite corruption, hub-client partition, payment provider 503, fiscal provider 500, and printer crash; the suite runs nightly in CI against a synthetic tenant; restore drills run weekly with audit. | Backup is useless if it has never been tested under failure. A real production POS must rehearse its disasters. | A nightly CI job runs the chaos suite against a synthetic tenant; the suite produces a pass/fail report + diagnostic bundle; a weekly restore drill verifies that `ENG-136` snapshots can be brought back within the documented RTO. |
| `ENG-152` | **Tenant data export portability.** Full per-tenant export to JSON Lines + Parquet covering every operational table (sales, payments, inventory, customers, audit, fiscal documents). Streaming export with progress; signed download URL with expiry. | Merchants must own their data. A full structured export is the honest answer to "what if I leave?" | Admin can request a full export, see progress, receive a signed download, and the export round-trips back via the launch migration importer (ENG-123) into a fresh tenant. |
| `ENG-153` | **Customer cohort + LTV + RFM analytics.** Cohort retention curves, customer lifetime value, RFM segmentation (Recency, Frequency, Monetary), and integration with `ENG-127` campaign targeting. | ENG-127 covers segmentation but not the retention math. Owners need cohort views to compete with Shopify Audiences and Square Loyalty. | Owner sees cohort retention by month / quarter / year; an RFM segment can be exported as a campaign audience in ENG-127; LTV is computed per customer with explicit time-window. |
| `ENG-154` | **Receipt branding studio + per-channel template renderer.** Extend the ENG-016 receipt template editor with per-channel variants (print 80mm, print 58mm, email, WhatsApp, PDF, customer display) and a visual branding studio with logo, colors, copy. | The same receipt rendered three ways feels broken; world-class POSes render once and deliver per channel. | Admin can edit one template and preview it in every channel; the renderer produces the right artifact for each channel; the audit shows which channel sent which receipt for which sale. |
| `ENG-155` | **Contextual help + in-product video library + product tours.** Embedded Loom-style video library, contextual help launcher per screen, guided product tours for first-run + module activation, and an indexed search across help content. | Onboarding videos lower the install-to-first-sale time faster than docs. World-class SaaS products ship a help library inside the app. | Every major screen has a contextual help affordance; clicking it opens a focused panel with the relevant video + doc snippet; the tour for first-run setup is mandatory before checkout works. |
| `ENG-156` | **Multi-currency operations.** Extend `tenant_locale_settings` with sell-currency + settle-currency, FX rate table sourced per tenant, dual-currency receipt display, and a settle-currency-aware accounting export. | Tourist-zone tenants sell in USD and settle in COP; today the locale resolves one currency. | A tenant can sell in USD, the cashier sees the COP-equivalent on the cart, the receipt shows both, the fiscal document uses the sell currency per local rules, and the accounting export uses the settle currency. |
| `ENG-157` | **Public demo sandbox + ephemeral tenant provisioning.** A marketing-site CTA spins up an ephemeral tenant with seeded retail + restaurant + pharmacy demo data, auto-expires after seven days, and never leaks across sessions. | World-class SaaS has a frictionless demo. A "request a demo" form loses to a "try it now" button. | A visitor clicks "Try a demo" on the future public site, lands in a populated tenant within 15 seconds, and the tenant disappears after the configured TTL with a one-line audit row. |
| `ENG-158` | **Tenant clone / sandbox for safe experimentation.** Copy a production tenant to a sandbox tenant (same DB instance, different `tenant_id`, no real PII), let the operator experiment with a configuration change or a vertical activation, and either promote the sandbox back or discard. | Pilots and chains experiment with new features without risk by cloning their production tenant into a sandbox. | Admin can clone tenant X to tenant X-sandbox, the clone preserves catalog + sites + users but obfuscates customer PII, changes in the sandbox can be diffed, and a destroy reverts everything within seconds. |
| `ENG-159` | **Data residency policy + per-tenant AI provider gating.** Per-tenant policy declaring "AI calls must use a provider in region X" or "AI is disabled in this tenant"; gracefully degrade to deterministic flows when the policy cannot be met. Pairs with `ENG-130` "safe degrade" contract. | Banks, pharmacies, and government merchants need an enforced data-residency contract. AI calls leaving the country is a deal-breaker for those segments. | Admin can declare a residency policy; an AI call that would violate it is blocked + logged + degraded; an audit screen shows the policy and the recent compliance log. |
| `ENG-160` | **Nómina Electrónica DIAN (Colombia payroll fiscal).** Generate, validate, transmit, and reconcile Nómina Electrónica documents per Resolución DIAN; integrate with `ENG-140` shift management for hours + overtime; gate on the same DIAN PT contract as `ENG-021`. **Status: Gated** — needs PT contract + credentials. | A LATAM POS that ships in Colombia but cannot emit Nómina Electrónica leaves a major customer ask unanswered. | When the gate clears, a tenant can generate a Nómina Electrónica document from a payroll period, transmit it, and reconcile the DIAN acknowledgment. |
| `ENG-161` | **pt-BR localization + NFe Brazil foundations.** Locale parity for `pt-BR` across every namespace (deliverable now), NFe / NFC-e foundations as schema + adapter seam (gated on a real Brazilian PT contract). **Status: Pending** for locale parity, **Gated** for NFe issuance. | "LATAM" without Brazil is incomplete. Locale parity is realizable today; NFe stays gated like Colombia DIAN. | `apps/web/src/i18n/locales/pt-BR/**.json` reaches parity with `en` + `es`; the NFe adapter seam compiles + tests; the gate documents what is missing to ship issuance. |
| `ENG-162` | **Hosted micro-storefront per tenant.** A per-tenant `shop.puntovivo.app/<slug>` route that shows the tenant catalog + customer ordering + WhatsApp handoff + payment link. Lower-effort wedge than the full omnichannel bridge (`ENG-113`). | A merchant who just wants "a link customers can buy from" gets it without the full ecommerce CMS. | A merchant activates the micro-storefront, picks the catalog visibility per product, the public URL renders the catalog, and a customer order arrives in the POS as a draft sale. |
| `ENG-163` | **Compliance readiness pack (PCI DSS SAQ-A, SOC 2 Type 1, ISO 27001 evidence).** Documented control set, evidence collection scripts, residency policy linkage (`ENG-159`), retention enforcement linkage (`ENG-129`), and a public trust portal stub. | Enterprise pilots ask for PCI / SOC 2 / ISO 27001 evidence before signing. We answer the question once and reuse the pack. | A `docs/COMPLIANCE.md` enumerates each control with evidence path; the evidence-collection script runs in CI; a trust-portal stub renders the latest pack. |
| `ENG-164` | **Spike: hosted SaaS deployment substrate (Postgres vs SQLite vs hybrid).** Decide the data substrate for the hosted SaaS deployment that `ENG-157`, `ENG-158`, `ENG-162`, and the cross-tenant aggregate slice of `ENG-138` implicitly require. Evaluate (a) SQLite-everywhere (better-sqlite3 or libSQL/Turso) — same engine local + cloud, simpler schema parity, weaker concurrent writers; (b) Postgres in cloud — mature multi-tenancy (RLS / schema-per-tenant / DB-per-tenant), better analytics, schema-drift risk + Drizzle multi-dialect cost; (c) hybrid — SQLite local-authoritative (ADR-0001 preserved) + Postgres mirror for hosted-only features fed via outbox replay. Output is `docs/SPIKE-HOSTED-DEPLOYMENT.md` with use-case matrix, tenant isolation pattern, schema parity strategy, multi-dialect cost, operational pricing, and test ergonomics. The recommendation can spawn implementation sub-tickets or land as Defer like `ENG-037`. **Blocks**: `ENG-157`, `ENG-158`, `ENG-162`, cross-tenant slice of `ENG-138`. Pairs with deferred `ENG-037`. | Without a deliberate substrate decision, hosted-SaaS tickets either ship with the wrong DB choice or get blocked on operational ambiguity. The spike forces the trade-off in writing. | A recommendation doc + spawned implementation tickets (or an explicit Defer note); the doc cites use-case matrix, tenant isolation pattern, schema parity strategy, multi-dialect cost, pricing, and test ergonomics. |
| `ENG-165` | **tRPC-aware rate limiting + per-tenant/site/user buckets.** Promote `BACKLOG.md` `[security][infra][trpc]` item. Replace the single global 100/min/IP Fastify rate limit with tRPC-aware buckets: keep strict auth buckets, add tenant/site/user-scoped buckets for sales mutations, separate read vs write traffic, separate public-API traffic (`ENG-118`), and keep env overrides per deployment. Rate-limit hits produce auditable events. Required prerequisite for `ENG-118` (public API). | The current global default is a useful safety net but throttles legitimate high-demand stores behind one NAT and offers no defense against an abusive public-API key. | Admin can configure per-bucket limits per env; sales mutations have their own bucket independent from auth attempts; public-API calls have a separate bucket; rate-limit hits produce auditable events. |

## 8. Cross-Cutting Efficiency UX

These requirements apply across tickets:

| Requirement | Ticket | Required behavior |
| --- | --- | --- |
| Global command palette | `ENG-105` | `Cmd/Ctrl+K` searches actions and destinations such as create product, open cash session, print last receipt, search customer, open payment reconciliation, diagnostics, and import workbench. |
| Role-based home | `ENG-104` | Cashier lands on sales, manager on operational attention, admin on readiness/BI depending on setup state and permissions. |
| Operational task center | `ENG-104` + `ENG-116` + `ENG-128` + `ENG-135` | One attention queue for fiscal pending, payments unmatched, hardware offline, stock low, cash sessions stale, KDS delayed, setup blockers, support issues, and observability alerts. |
| Checkout preflight | `ENG-105` | `/sales` surfaces cash-session, printer, fiscal, hub, internet, payment-terminal, payment rail, and sync blockers before final checkout. |
| Quick create in flow | `ENG-105` + `ENG-110` + `ENG-123` | Cashier/admin can create minimal product/customer/provider records without losing cart, purchase, or import context. |
| Catalog/import wizard | `ENG-104` + `ENG-110` + `ENG-123` | CSV/Excel import has column mapping, preview, dedupe, validation, row-level error export, and launch report. |
| Fast-register mode | `ENG-105` | A compact minimarket layout keeps scanner/search, cart, total, exact cash, payment terminal state, print, and next sale in one stable surface. |
| Actionable empty states | `ENG-104` | Empty screens provide a precise next action and deep link, not passive "no data" text. |
| Undo and recovery | `ENG-105` + `ENG-106` + `ENG-117` + `ENG-128` | Reversible actions expose undo/recall/approval/retry recovery with audit semantics when durable state changes. |
| Touch surface picker | `ENG-107` + `ENG-117` + `ENG-147` | `/touch` exposes catalog, voice, tables, KDS/waiter view, customer display, self-checkout, and kiosk/order status based on active modules. |
| Privacy by design | `ENG-127` + `ENG-129` + `ENG-159` | Customer messaging, campaigns, diagnostics, and AI suggestions never bypass consent, PII minimization, residency policy, or tenant scoping. |
| Workspace navigation | `ENG-131` | Sidebar entries represent jobs rather than tables: Sell, Operate, Catalog, Inventory, Procurement, Customers, Finance, Setup. Low-frequency routes move into workspace subnav or command palette. |
| Progressive disclosure | `ENG-132` | Every high-density screen shows one primary task first; secondary actions, history, diagnostics, exports, and expert settings move into drawers, tabs, More menus, or dedicated workspaces. |
| Performance budgets | `ENG-133` | Every user-facing route + every tRPC procedure has a budget enforced in CI. |
| Accessibility AA | `ENG-134` | Every component test runs axe-core; every Playwright smoke includes a keyboard-only path. |
| Observability | `ENG-135` | Every renderer + main + server error lands in the central pipeline; every operation produces a trace with tenant scope. |
| Update health | `ENG-128` + `ENG-137` | Every terminal reports its current version + last-update timestamp; staged rollout state is visible. |
| License gate | `ENG-138` | Every module activation passes through the license check; grace mode is explicit and reversible. |
| Backup signal | `ENG-136` + `ENG-151` | Every tenant shows a green "backup is fresh" badge; restore drills are auditable. |

## 9. Sequencing Rules

The list of tickets is large; the sequencing rules below resolve
collisions and keep dependencies honest.

1. **Do not skip sellability gates**. `SELLABILITY.md` remains the
   go/no-go reference. Fiscal provider, hardware validation, payment
   terminal policy, backup/restore, and recovery must be honest before
   public claims.
2. **Foundation rails land first**. `ENG-103`, `ENG-104`, `ENG-105`,
   `ENG-106`, `ENG-123`, `ENG-128`, `ENG-129`, `ENG-131`, `ENG-133`,
   `ENG-134`, `ENG-135`, `ENG-136` form the bedrock. Nothing public
   ships until these are at least Partial.
3. **Simplify before widening the menu**: `ENG-131` and the first
   `ENG-132` slices land before large UI-heavy work in `ENG-110`,
   `ENG-123`, `ENG-124`, `ENG-125`, or any vertical pack adds more
   surfaces.
4. **Money before growth**: close `ENG-124` (settlement v2) before
   making strong claims about ecommerce, wallet, loyalty, or
   accounting.
5. **Product model before verticals**: `ENG-110`, `ENG-111`, `ENG-125`
   precede `ENG-117`, `ENG-119`, `ENG-120`, `ENG-121`, `ENG-122`,
   `ENG-145`, `ENG-146`.
6. **Privacy before campaigns**: `ENG-129` precedes `ENG-127` and
   `ENG-159`.
7. **WhatsApp outbound before inbound**: `ENG-112` precedes
   `ENG-144`.
8. **Accounting before advanced BI when accountants are part of the
   sale**: `ENG-115` can precede `ENG-116` for Colombia pilots.
9. **API after first-party proof**: `ENG-118` should follow at least
   one real connector path so the contract reflects actual integration
   pressure.
10. **Chain/HQ only after single-store reliability**: `ENG-126` should
    not outrun single-store operations, backup, recovery, and sync
    truth.
11. **AI is last-mile leverage**: `ENG-130` automates proven
    deterministic workflows; it must not hide missing core product
    logic.
12. **Auto-update needs observability**: `ENG-137` ships after
    `ENG-135` so a bad release has a rollback signal.
13. **Subscription needs backup**: `ENG-138` ships after `ENG-136` so
    a tenant in grace mode can still export its data.
14. **Hardware certification gates releases**: `ENG-148` becomes a
    hard gate for any release that claims certified-hardware support.
15. **Compliance readiness aggregates** `ENG-129`, `ENG-159`, and
    `ENG-163` into a single answerable pack for enterprise pilots.
16. **Hosted-SaaS substrate before hosted-SaaS tickets**: `ENG-164`
    spike lands before `ENG-157`, `ENG-158`, `ENG-162`, and the
    cross-tenant slice of `ENG-138`. The spike outcome may add new
    implementation tickets (`ENG-164a`, etc.) or land as Defer.
17. **Rate limiter before public API**: `ENG-165` lands before
    `ENG-118` so partner integrations on shared NAT cannot DOS a
    tenant.

## 10. Flat Priority List

This list replaces the H0..H4 horizons. Tickets are ranked top-down by
"must land sooner" given the sequencing rules above. The list is the
canonical reading order for sprint planning.

| # | Ticket | Status | Why this position |
| --- | --- | --- | --- |
| 1 | `ENG-103` | Pending | Document trust gate — fastest visible improvement. |
| 2 | `ENG-104` | Pending | Onboarding is the longest install-to-first-sale path. |
| 3 | `ENG-133` | Pending | Perf budget rails before adding more code. |
| 4 | `ENG-134` | Pending | Accessibility rail before adding more components. |
| 5 | `ENG-135` | Partial | Observability engine + opt-in shipped 2026-05-20; Sentry / GlitchTip adapter follow-up. |
| 6 | `ENG-105` | Partial | Slice A (command palette + canonical shortcut map + aria-keyshortcuts hookup) shipped 2026-05-20; remaining slices (preflight, quick-create, fast-register, undo, ...) ride ENG-105b.. follow-ups. |
| 7 | `ENG-131` | Pending | IA refactor before adding new screens. |
| 8 | `ENG-106` | Pending | Staff accountability before opening more sites. |
| 9 | `ENG-123` | Pending | Launch migration before public pilot. |
| 10 | `ENG-128` | Pending | Supportability before public pilot. |
| 11 | `ENG-129` | Pending | Privacy before campaigns + CRM. |
| 12 | `ENG-136` | Pending | Backups before any data-loss risk. |
| 13 | `ENG-132` | Pending | Screen simplification after IA refactor. |
| 14 | `ENG-137` | Pending | Auto-update with rollback before broad distribution. |
| 15 | `ENG-141` | Pending | Day-close report — daily operator need. |
| 16 | `ENG-140` | Pending | Shift management — daily operator need. |
| 17 | `ENG-142` | Pending | Loss-prevention rules — daily operator need. |
| 18 | `ENG-110` | Pending | Catalog model before verticals. |
| 19 | `ENG-111` | Pending | Replenishment before stockout pain. |
| 20 | `ENG-125` | Pending | Procurement before margin truth claims. |
| 21 | `ENG-124` | Pending | Settlement before omnichannel + loyalty. |
| 22 | `ENG-143` | Pending | In-transit transfers before chain HQ. |
| 23 | `ENG-148` | Pending | Hardware compatibility matrix before scaling pilots. |
| 24 | `ENG-108` | Pending | Loyalty + wallet — retention table stakes. |
| 25 | `ENG-109` | Pending | Promotions engine — revenue growth. |
| 26 | `ENG-107` | Pending | Customer display + touch surface picker. |
| 27 | `ENG-149` | Pending | Shared peripheral resolver — multi-cashier stores. |
| 28 | `ENG-150` | Pending | Universal print server — tablet-only registers. |
| 29 | `ENG-112` | Pending | WhatsApp outbound — LATAM channel. |
| 30 | `ENG-144` | Pending | WhatsApp inbound commerce. |
| 31 | `ENG-115` | Pending | Accounting export — Colombia buying criterion. |
| 32 | `ENG-113` | Pending | Omnichannel bridge after settlement. |
| 33 | `ENG-114` | Pending | Delivery + logistics. |
| 34 | `ENG-127` | Pending | CRM + campaigns after consent + WhatsApp. |
| 35 | `ENG-153` | Pending | Cohort + LTV + RFM after CRM data. |
| 36 | `ENG-116` | Pending | Owner BI control tower. |
| 37 | `ENG-154` | Pending | Receipt branding studio. |
| 38 | `ENG-164` | Pending | Spike: hosted SaaS substrate (Postgres vs SQLite vs hybrid). Blocks `ENG-157`, `ENG-158`, `ENG-162`, cross-tenant slice of `ENG-138`. |
| 39 | `ENG-138` | Pending | Subscription / billing — monetization plumbing. License enforcement is local; cross-tenant aggregates depend on the `ENG-164` outcome. |
| 40 | `ENG-155` | Pending | Contextual help + in-product video. |
| 41 | `ENG-117` | Pending | KDS + service v2 — restaurant depth. |
| 42 | `ENG-145` | Pending | Tip pooling — restaurant depth. |
| 43 | `ENG-146` | Pending | Recipe scaling + waste — restaurant + bakery depth. |
| 44 | `ENG-147` | Pending | Self-checkout + table QR ordering. |
| 45 | `ENG-119` | Pending | Services vertical. |
| 46 | `ENG-120` | Pending | Pharmacy vertical. |
| 47 | `ENG-121` | Pending | Supermarket vertical. |
| 48 | `ENG-122` | Pending | Hardware-store vertical. |
| 49 | `ENG-165` | Pending | tRPC-aware rate limiting — prerequisite for `ENG-118`. |
| 50 | `ENG-118` | Pending | Public API + webhook delivery. |
| 51 | `ENG-126` | Pending | Chain HQ + multi-location governance. |
| 52 | `ENG-130` | Pending | AI automation suite. |
| 53 | `ENG-139` | Pending | Enterprise SSO + MFA. |
| 54 | `ENG-151` | Pending | Chaos + DR game day. |
| 55 | `ENG-152` | Pending | Data export portability. |
| 56 | `ENG-156` | Pending | Multi-currency operations. |
| 57 | `ENG-157` | Blocked by `ENG-164` | Public demo sandbox. |
| 58 | `ENG-158` | Blocked by `ENG-164` | Tenant clone / sandbox. |
| 59 | `ENG-159` | Pending | Data residency + AI policy. |
| 60 | `ENG-162` | Blocked by `ENG-164` | Hosted micro-storefront per tenant. |
| 61 | `ENG-163` | Pending | Compliance readiness pack. |
| 62 | `ENG-160` | Gated | Nómina Electrónica DIAN. |
| 63 | `ENG-161` | Pending (locale) / Gated (NFe) | pt-BR + NFe Brazil foundations. |

## 11. Non-Goals

- No cloud-primary database rewrite in this wave. ADR-0001 still holds.
- No decorative "premium" redesign. Premium means faster, clearer, more
  reliable, easier to operate, and easier to support.
- No new native mobile app before the web/Electron surfaces prove the
  workflow.
- No payment/fiscal provider claim without credentials, sandbox proof,
  and a reconciliation story.
- No public website claim may move from roadmap to supported unless the
  runtime behavior and live smoke exist in the product.
- No vertical module should leak UI or tables into tenants that do not
  use it.
- No fintech that holds merchant funds. Payment intents transit
  to providers; settlement is reconciled but never custodial.
- No AI that bypasses tenant budget, residency policy, or consent.
- No release ships without observability, performance budget pass, and
  axe-core pass once those rails are live.

## 12. Validation Standard

Every Plan V3 ticket follows the repo gates:

- `ci:server` for server/schema/tRPC changes.
- `ci:web` for React, routing, i18n, and user-facing copy.
- `ci:desktop` for Electron main/preload or local hardware boundaries.
- Live browser smoke for every user-facing route touched.
- EN and ES smoke when visible copy changes (pt-BR when `ENG-161`
  locale parity is in flight).
- Neutral Latin American Spanish in all `es` copy.
- ROADMAP, SPRINT-PLAN, and the relevant specialty doc updated in the
  same change.
- External provider claims backed by current official docs or explicit
  "requires contract/credentials" gates.
- Once `ENG-133` ships: every PR runs the perf budget check.
- Once `ENG-134` ships: every PR runs axe-core on touched components.
- Once `ENG-135` ships: every release reports observability health
  before the rollout is widened.

## 13. Change Log

- **2026-05-20** — Created (ENG-103..ENG-132).
- **2026-05-20** — Extension pass: validated the original draft,
  promoted 31 new themes to ENG-133..ENG-163, replaced H0..H4 horizons
  with the flat priority list in §10, strengthened sequencing in §9,
  and added the "extension" dimensions to §4.
- **2026-05-20** — Coverage closure pass: added `ENG-164` (hosted
  SaaS substrate spike — Postgres vs SQLite vs hybrid) blocking
  `ENG-157/158/162` and the cross-tenant slice of `ENG-138`; added
  `ENG-165` (tRPC-aware rate limiter, promoted from BACKLOG) as the
  prerequisite for `ENG-118`; added §14 enumerating externally
  conditioned tickets; resequenced §10 to reflect the blocks.

## 14. Externally-Conditioned Tickets

These tickets are software-realizable but depend on a credential,
contract, hardware lab, or browser support that the operator must
arrange before implementation. None of them are "Gated" in the
ROADMAP-status sense (the gate is a process, not a product
ambiguity), but the operator should know what to gather first so the
sprint does not stall.

| Ticket | External condition |
| --- | --- |
| `ENG-112` | Meta Business Platform Cloud API verification for the WhatsApp outbound provider. Phone number + business verification + template approval flow. |
| `ENG-113` | Per-marketplace partner account or API token: Shopify Partner App, Tiendanube App, WooCommerce REST key, MercadoLibre developer account, VTEX app + appKey. |
| `ENG-121` | Real serial/USB scale hardware in the lab for the weighted-product smoke test (shares hardware lab with `ENG-060..ENG-062`). |
| `ENG-124` | Per-rail sandbox credentials: Wompi merchant + secret, PSE bank credentials, Nequi merchant, Bancolombia QR endpoint. Production cutover needs separate prod credentials. |
| `ENG-138` | Stripe merchant account for the non-CO subscription rail, Wompi recurring contract for the CO rail. License enforcement is local; only payment collection needs the merchant accounts. |
| `ENG-139` | Google Cloud OAuth client + Microsoft Entra ID app registration (tenant admin consent flow). Generic OIDC needs the customer's IdP metadata. SAML 2.0 needs the customer's IdP certificate. |
| `ENG-144` | Same Meta Business verification as `ENG-112`, plus WhatsApp Catalog approval (a separate Meta product) and payment-link rail credentials from `ENG-124`. |
| `ENG-148` | Hardware lab access (printer, drawer, scanner, scale, customer display, payment terminal). Shares the lab with `ENG-060..ENG-062` and `ENG-121`. |
| `ENG-149` | Depends on `ENG-071..ENG-075` Authority Node Hub being shipped (already in plan v2 wave). |
| `ENG-150` | WebUSB / WebSerial browser support — Chrome, Edge, Opera. Safari does not support either; tablet registers must run a supported browser. |
| `ENG-157`, `ENG-158`, `ENG-162` | Hosted SaaS deployment, blocked by `ENG-164` spike outcome. The substrate decision drives every downstream constraint (managed Postgres pricing, libSQL hosting, hybrid mirror cost). |
| `ENG-160` | DIAN PT contract + Nómina-specific certificate + numbering resolution. Same gate shape as `ENG-021`. (Status: `Gated`.) |
| `ENG-161` (NFe slice) | Brazilian PT contract + certificate. Same gate shape as `ENG-021`. (Status: `Gated` for fiscal slice only; locale slice is `Pending`.) |

Cross-cutting note: the `ENG-164` spike output may add or remove
constraints from this list. Revisit after the spike closes.
