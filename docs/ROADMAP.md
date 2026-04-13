# Puntovivo Roadmap

> Updated: April 13, 2026
> Single source of truth for project status, priorities, and actionable work plan.
> Replaces: `IMPLEMENTATION_STATUS.md`, `OPEN_BACKLOG.md`, `MIGRATION_PLAN.md`
> Strategic reference: see [PLAN.md](./PLAN.md) for competitive analysis, academic frameworks, and detailed technical designs.

---

## 1. Current State — What's Done

The application is past early migration. The core POS surface is live and operational.

### Completed Phases

| Phase | Scope | Status |
| --- | --- | --- |
| Phase 0 | Foundation, schema, transport baseline | **Complete** |
| Phase 1 | Administration and master catalogs | **Complete** |
| Phase 2 | Product management and pricing | **Complete** |
| Phase 3 | Inventory | **Complete** |
| Phase 4 | Sales / POS | **Complete** |
| Phase 5 | Procurement | **Complete** |
| Phase 6 | Reporting, sync, desktop ops, UX polish | **Advanced** |

### Implemented Surface

**Backend tRPC routers**: auth, companies, countries, identificationTypes, personTypes, regimeTypes, clientTypes, commercialActivities, dashboard, departments, cities, logos, providers, sequentials, units, vatRates, categories, products, orders, customers, purchases, sales, inventory, locations, sites, sync, users

**Web route modules**: Dashboard, Company, Sites, Sequentials, Locations, Customer Catalogs, Geography, Providers, Categories, Units, VAT Rates, Products, Orders, Purchases, Customers, Sales, Inventory, Users

**Desktop features**: embedded backend lifecycle, receipt printing, backup/restore, tray/theme/update settings, sync status and trigger APIs, offline DB bridge

### Unique Differentiators

- True offline-first with local SQLite
- Desktop-native Electron (no competitor offers this)
- Open source, no subscription fees, self-hosted
- Colombian/LatAm focus
- tRPC-first transport with type safety end-to-end

---

## 2. What to Build Next — Priority Order

This is the recommended implementation sequence. Each item links to its detailed phase below.

### Tier 1: Deployment Blockers (must ship before pilots)

| # | Item | Why | Phase |
| --- | --- | --- | --- |
| 1 | **i18n foundation** (es-CO/es/en) | English-only UI blocks LatAm deployment. Every new feature adds more hardcoded strings. | Pre-Phase 1 |
| 2 | **Integer → real migration** for stock/quantity | Blocks ferreterías (2.5m cable) and supermarkets (0.75kg produce). #1 schema blocker. | Phase 1 |
| 3 | **Cash management and shift control** | Every competitor has this. No cash session = no accountability = no LatAm retail adoption. | Phase 1 |

### Tier 2: Core Commercial Gaps (competitive table stakes)

| # | Item | Why | Phase |
| --- | --- | --- | --- |
| 4 | Site-owned inventory + transfers | Stock must belong to a site, not the tenant. Transfer workflows need in-transit state. | Phase 2 |
| 5 | Split payments / multi-tender | Basic expectation: pay partially with cash and card. | Phase 5 |
| 6 | Quotations / estimates | B2B, ferreterías, service businesses all need pre-sale conversion. | Phase 5 |
| 7 | Credit sales (ventas a crédito) | Deeply embedded LatAm practice — installments, abonos, contractor accounts. | Phase 5 Ext |
| 8 | Audit trail for sensitive actions | Required for operational trust — void, refund, price override, user change. | Phase 8 |

### Tier 3: Market Differentiation

| # | Item | Why | Phase |
| --- | --- | --- | --- |
| 9 | Outbound logistics (pick/pack/ship) | Needed for any store with delivery. | Phase 3 |
| 10 | Promotions / loyalty / gift cards | Behind mainstream POS expectations. | Phase 7 |
| 11 | Colombia DIAN fiscal compliance | DEE + factura electrónica mandatory. Siigo/Alegra own this today. | Phase 11 |
| 12 | Country-parametrizable fiscal rules | Current Colombia-hardcoded logic blocks any non-CO deployment. | Phase 11 Ext |

### Tier 4: Vertical Expansion (after platform is solid)

| # | Item | Phase |
| --- | --- | --- |
| 13 | Multi-vertical module activation system | Phase 0 Foundation |
| 14 | Product variants, serial/lot/batch/expiry | Phase 6 |
| 15 | Restaurant module (tables, KDS, modifiers, tips) | Phase 12 |
| 16 | Pharmacy module (Rx, controlled substances, INVIMA) | Phase 13 |
| 17 | Supermarket module (scales, PLU, perishables) | Phase 14 |
| 18 | Ferretería module (unit conversion, project quoting) | Phase 15 |

### Tier 5: Platform Maturity

| # | Item | Phase |
| --- | --- | --- |
| 19 | Advanced reporting / BI (GMROI, ABC, CLV) | Phase 9 |
| 20 | Hybrid SQLite + PostgreSQL data topology | Phase 10 |
| 21 | Public API, webhooks, integration ecosystem | Phase 11 |
| 22 | Employee shifts, commissions, time tracking | Phase 8 |
| 23 | Transport execution (dispatch, tracking, POD) | Phase 4 |

---

## 3. Open Technical Risks

### Platform Foundation

- **`stock` and `quantity` are `integer` in schema** — must migrate to `real` across all tables. This is the #1 technical blocker for ferreterías and supermarkets.
- **Fiscal rules are Colombia-hardcoded** — IVA rates, INC, propina (Ley 1935/2018), DIAN endpoints, fiscal regime codes are constants. Must become profile-driven before non-CO deployment.
- **No module activation system** — prerequisite for multi-vertical support.
- **Credit sales (ventas a crédito) missing** — no installment schedules, no abono posting, no configurable credit settings per tenant/company/site.

### Sync and Offline

- No formal hybrid data topology contract for local SQLite + remote authority.
- Persistence is tightly coupled to SQLite-specific Drizzle and `better-sqlite3`.
- Remote replication story is underspecified.
- Sync observability is shallow — needs richer audit/log surfaces.

### Security

- Electron window still runs with `sandbox: false`.
- Sensitive admin actions lack full audit trail.

### Testing

- Desktop features lean heavily on unit/type checks and manual verification.
- Little true E2E coverage across renderer + embedded backend + Electron bridge.

### Performance and UX

- Responsive/mobile refinement is weaker in admin/maintenance screens.
- Not every screen uses the same feedback quality level yet.

---

## 4. i18n Plan — Pre-Phase 1

**Stack**: `i18next` + `react-i18next`
**Fallback chain**: `es-CO` → `es` → `en`
**Namespace splitting**: per feature area (common, sales, inventory, etc.)

**Why first**: English-only UI is a deployment blocker for LatAm. Every new phase adds more hardcoded strings. Foundation (~5 days) should land before cash management UI.

**Scope**: ~126 component files, ~300+ labels, ~137 toasts, ~187 form fields to extract.

---

## 5. Technical Roadmap by Phase

Each phase includes DB, tRPC, UI, and Test tickets.

### Phase 0: Architecture Foundation and Multi-Vertical Module System

**Goal**: Prepare codebase for logistics, dual-database compatibility, multi-vertical modules, and compound tax.

**DB tickets**:
- `DB-001` Dialect-neutral schema conventions
- `DB-002` Replace raw schema bootstrap with versioned Drizzle migrations
- `DB-003` Money, quantity, and timestamp normalization rules
- `DB-004` Add `vertical` column to `sites` (enum: retail, supermarket, pharmacy, ferreteria, restaurant, etc.)
- `DB-005` Add `metadata` JSON column to `products` for vertical-specific attributes
- `DB-006` Add `settings` JSON column to `sites` for capabilities map
- `DB-007` Create `tax_groups` table (compound tax scenarios + mutual exclusivity)
- `DB-008` Create `tax_group_items` table (tax_type, rate, calculation_base, exclusive_with)
- `DB-009` Link products to tax_groups instead of single VAT rate

**tRPC tickets**:
- `API-001` Repository/service boundaries for core domains
- `API-002` Separate persistence concerns from router procedures
- `API-003` Sync acknowledgement contract
- `API-004` Module registry service: resolve site vertical → compute `SiteCapabilities`
- `API-005` Compound tax calculation engine
- `API-006` Module-conditional tRPC router composition

**UI tickets**:
- `UI-001` System diagnostics page for runtime topology
- `UI-002` Admin-facing sync topology indicators
- `UI-003` Vertical/module activation settings page with setup wizard
- `UI-004` `SiteCapabilities` React Context provider
- `UI-005` Capability-filtered sidebar navigation
- `UI-006` Checkout compound tax display (IVA, INC, impuesto saludable lines)

**Test tickets**:
- `TEST-001` Persistence contract tests reusable across dialects
- `TEST-002` Schema migration smoke tests
- `TEST-003` Sync contract tests
- `TEST-004` Compound tax: IVA 19% + INC 8% on same receipt
- `TEST-005` SiteCapabilities computed correctly per vertical
- `TEST-006` Module-conditional sidebar rendering

### Phase 1: Cash Management, Shift Control, and Fractional Quantity

**Goal**: Most critical missing commercial feature for LatAm retail + unblock fractional quantity sales.

**DB tickets**:
- `DB-050` **CRITICAL**: Convert `stock`/`quantity` from `integer` to `real` across ALL tables. Add `sell_by_fraction`, `fraction_step`, `fraction_minimum` flags.
- `DB-051` Create `cash_sessions` (register, cashier, site, opening_float, denominations, expected_balance, actual_count, over_short, status, timestamps)
- `DB-052` Create `cash_movements` (session_id, type [sale, refund, paid_in, paid_out, skim, replenishment], amount, reference, note)
- `DB-053` Create `denomination_templates` for standardized float breakdowns

**tRPC tickets**:
- `API-051` `cashSessions.open` with denomination counting and float validation
- `API-052` `cashSessions.close` with blind close support
- `API-053` `cashSessions.movements` for paid-in, paid-out, skim, replenishment
- `API-054` `cashSessions.report` with over/short history per cashier
- `API-055` Update `sales.create`/`sales.refund` to require active cash session

**UI tickets**:
- `UI-051` Cash session open dialog with denomination counting grid
- `UI-052` Cash session close dialog with blind close mode
- `UI-053` Cash session summary with movement timeline
- `UI-054` Cash management dashboard: active sessions, over/short trends
- `UI-055` Register assignment in POS checkout header

**Test tickets**:
- `TEST-051` Opening cash denomination count matches float
- `TEST-052` Sale increments session expected balance
- `TEST-053` Refund decrements session expected balance
- `TEST-054` Blind close hides expected amount until count submitted
- `TEST-055` Over/short calculation accuracy

### Phase 2: Site-Owned Inventory and Transfer Logistics

**Goal**: Make stock physically believable across sites and warehouses.

**DB tickets**:
- `DB-101` Create `inventory_balances` by product/site/location
- `DB-102` Create `transfer_orders` and `transfer_order_items`
- `DB-103` Create `transfer_shipments` and `transfer_receipts`
- `DB-104` Migrate tenant-wide stock to default site-owned balances

**tRPC tickets**:
- `API-101` `inventory.listBalancesBySite`
- `API-102` `transfers.create`, `.ship`, `.receive`, `.void`
- `API-103` Update sales/purchases/orders to read/write site balances

**UI tickets**:
- `UI-101` Inventory page: site/location balance tabs
- `UI-102` Transfer Orders module
- `UI-103` Transfer receive modal with discrepancy reporting

**Test tickets**:
- `TEST-101` Sales decrement active site only
- `TEST-102` Purchase receipts increment target site only
- `TEST-103` Transfer shipment creates in-transit without double counting
- `TEST-104` Transfer receipt resolves in-transit correctly

### Phase 3: Outbound Logistics Documents

**Goal**: Pick/pack/ship as first-class warehouse/store operations.

**DB**: `fulfillment_orders`, `pick_lists`, `packing_slips`, `delivery_notes`
**tRPC**: Fulfillment allocation, pick list generation/completion, packing slip, delivery note validation
**UI**: Fulfillment workbench, pick list barcode workflow, packing UI, delivery note printable
**Tests**: Pick respects balances, delivery note posts correct movement, partial shipment remains fulfillable

### Phase 4: Transport Execution and Tracking

**Goal**: Dispatch, transport, and delivery follow-through.

**DB**: `shipments`, `shipment_stops`, `drivers`, `vehicles`, `carriers`, `proof_of_delivery`, `delivery_exceptions`
**tRPC**: Dispatch assignment, shipment status transitions, POD mutation, exception handling
**UI**: Dispatch board, shipment timeline, driver POD screen, customer tracking stub
**Tests**: Status progression, POD closes shipment, exception consistency

### Phase 5: Payment Depth, Quotations, Layaway, and Credit Sales

**Goal**: Complex payment scenarios, pre-sale conversion, and LatAm credit practices.

**DB**: `quotations`, `sale_payments` (multi-tender), `customer_credit_accounts`, `gift_cards`, `store_credits`, `layaway_orders`, `special_orders`, `service_tickets`, company fiscal regime fields, `company_credit_settings`, `credit_sales`, `credit_installments`, `credit_payments` (abonos)
**tRPC**: Quotation CRUD/conversion, split payment processing, on-account sales, gift card/store credit, layaway/apartado workflow, special orders, service tickets, credit sale creation with installment schedule, abono posting, overdue scan, aging report
**UI**: Quotations module, multi-tender checkout dialog, credit account management, layaway management, credit sale checkout flow, abono screen, credit portfolio
**Tests**: Quote conversion preserves prices, split payment sum validation, credit limit enforcement, layaway inventory reservation, installment schedule accuracy, abono distribution to oldest installments

### Phase 6: Product Handling and Advanced Inventory

**Goal**: Broader product categories and operational complexity.

**DB**: `product_variants`, `serial_numbers`, `batches`/`batch_balances`, `bundle_components`/`recipes`, product weight/dimensions/shipping/reorder fields
**tRPC**: Variant-aware search, serial/batch assignment, FEFO allocation, bundle explosion, reorder alerts, ABC analysis, inventory aging, GMROI, cycle counting
**UI**: Variant matrix builder, serial/batch selector, expiry dashboard, bundle/recipe management, reorder dashboard, ABC view, aging heatmap, cycle count worksheet
**Tests**: Serialized capture, batch FEFO, bundle component decrement, reorder trigger, ABC distribution

### Phase 7: Loyalty, Promotions, and Commercial Expansion

**Goal**: Conversion, retention, omnichannel readiness.

**DB**: `promotion_rules`, `coupons`, `loyalty_accounts`, `loyalty_transactions`, `loyalty_tiers`, order channel/delivery mode
**tRPC**: Promotion engine (evaluate cart, apply best/stackable discounts), coupon validation, loyalty earn/redeem, points expiry, omnichannel fulfillment
**UI**: Promotion rule builder, coupon management, checkout auto-promotion, loyalty display/redeem, customer loyalty profile, omnichannel order queue
**Tests**: BOGO logic, promotion stacking, coupon single-use, loyalty refund reversal, tier upgrade

### Phase 8: Employee Management and Audit Trail

**Goal**: Employee lifecycle and operational accountability.

**DB**: `employee_shifts`, `employee_commissions`, `commission_rules`, `audit_logs`, `approval_policies`, `approval_events`
**tRPC**: Shift clock in/out, commission calc/clawback, audit log recording, approval workflows, employee performance metrics
**UI**: Shift management, commission config/reports, audit log viewer, approval inbox, employee dashboard
**Tests**: Clock timestamps, commission clawback on return, audit before/after state, approval blocking

### Phase 9: Advanced Reporting and BI

**Goal**: Actionable insights beyond basic views.

**DB**: `daily_sales_summary`, `daily_inventory_snapshot`, `customer_cohorts`
**tRPC**: Sales/Inventory/Customer/Employee KPIs, exception alerts, drill-down API, scheduled report export
**UI**: Executive dashboard with sparklines, operational dashboard, inventory intelligence, customer insights, exception alerts, drill-down navigation, report builder
**Tests**: Summary aggregation accuracy, GMROI formula, comp sales exclusions

### Phase 10: Hybrid Database Runtime

**Goal**: SQLite local + PostgreSQL-compatible remote truth.

**Recommended stack**: PowerSync for sync layer. Dual schema from shared types (near-term). PGlite evaluation for long-term.

**DB**: Dialect abstraction package, dual `sqliteTable`/`pgTable` variants, Postgres migration/bootstrap, operation log schema, boolean/timestamp/JSON/UUID normalization
**tRPC**: Repository interfaces for either dialect, remote sync/apply endpoints, conflict response model, capability negotiation
**UI**: Remote authority config, improved sync center, richer conflict resolution
**Tests**: Full contract suite against SQLite and Postgres, offline-then-reconnect replay, multi-client conflict scenarios

### Phase 11: Fiscal, Accounting, and Integration Layer

**Goal**: Market readiness for broader deployment, Colombia DIAN compliance first.

**Colombia DIAN**: DEE (mandatory since May-July 2024), Factura Electrónica (UBL 2.1), Nota Crédito/Débito, CUFE/CUDE (SHA-384), XAdES-EPES digital signature, SOAP web service, numbering range management, contingency mode.

**DB**: `fiscal_documents`, `fiscal_numbering_ranges`, `fiscal_certificates`, `credit_notes`/`debit_notes`, `fiscal_contingency_log`, `supplier_invoices`, `api_keys`, `webhooks`, `currency_rates`, `country_fiscal_profiles`, `company_fiscal_overrides`
**tRPC**: Fiscal adapter interface, Colombia DIAN adapter (UBL 2.1 XML), CUFE/CUDE service, XAdES-EPES signing, DIAN SOAP client, numbering range management, contingency mode, credit/debit note lifecycle, profile-driven tax engine, tip rules refactor, fiscal adapter factory, public API, webhooks, accounting events
**UI**: Fiscal document views, numbering range management, certificate management, DIAN habilitación wizard, contingency indicator, multi-currency settings, integration/webhook admin, API key management
**Tests**: CUFE/CUDE SHA-384 vs DIAN vectors, UBL XSD validation, XAdES-EPES validity, contingency activation, webhook signing, multi-currency accuracy

### Phase 12: Restaurant and Service Verticals

**Goal**: Restaurant, food service, and appointment-based businesses.

**Prerequisites**: Phase 0 (modules)

**DB**: `tables`, `table_sessions`, `kitchen_orders`, `product_modifiers`/`modifier_groups`, `appointments`, `tip_records`
**tRPC**: Table management (assign/transfer/merge/split), kitchen order routing, course firing, modifier application, split check, tip management (Ley 1935/2018), appointments, auto-86ing, daypart menus, combo engine, kitchen printer routing
**UI**: Floor plan editor, table status grid, KDS with timers, modifier selection, split check dialog, tip consent dialog, appointment calendar, combo builder
**Tests**: Table-sale link, kitchen status transitions, split check math, tip pool distribution, appointment conflict detection, daypart activation, combo pricing

### Phase 13: Pharmacy Vertical

**Prerequisites**: Phase 0, Phase 6 (lot/batch/expiry), Phase 11 (fiscal)

**DB**: `prescriptions`, `prescription_items`, `dispensation_records`, `controlled_substance_ledger`, `fne_reports`, `rips_records`, pharmacy product fields (INVIMA, controlled_schedule, INN/DCI, storage), `eps_contracts`, `equivalence_groups`
**tRPC**: Prescription CRUD with validity/partial dispensing, controlled substance ledger, FNE/RIPS/SISMED reports, regulated price ceiling enforcement, generic substitution, patient medication history, INVIMA recall processing
**Tests**: Controlled substance requires valid Rx, partial dispensing tracking, FNE ledger balance, expired Rx blocking, regulated price ceiling, RIPS format

### Phase 14: Supermarket Vertical

**Prerequisites**: Phase 0, Phase 1 (fractional qty), Phase 6 (lot/batch/expiry), Phase 7 (promotions)

**DB**: `scale_configurations`, `plu_codes`, supermarket `departments`, `shrinkage_records`, `dsd_receiving`, `vendor_promotions`, supermarket product fields
**tRPC**: Scale reading service, variable-weight barcode parsing, age restriction enforcement, department P&L, shrinkage tracking, DSD receiving, automated near-expiry markdowns, impuesto saludable
**Tests**: Variable-weight barcode decode, age restriction blocking, department shrinkage totals, impuesto saludable rates

### Phase 15: Ferretería Vertical

**Prerequisites**: Phase 0, Phase 1 (fractional qty), Phase 5 (quotations, credit)

**DB**: `product_sale_units` (multi-unit with conversion), `service_charges`, `project_templates`, FTS5 virtual table for product search
**tRPC**: Multi-unit sale with conversion, in-house barcode generation, project template management, service charges, partial-use returns, FTS5 search, bulk pricing auto-application
**Tests**: Unit conversion accuracy, barcode generation, template explosion, partial-use return

---

## 6. Competitive Context (Summary)

### What Puntovivo Has That Others Don't

| Capability | Puntovivo | Square | Shopify | Lightspeed | Odoo |
| --- | --- | --- | --- | --- | --- |
| True offline mode | **Strong** | Limited | Limited | No | No |
| Desktop native | **Yes (unique)** | No | No | No | No |
| Open source | **Yes** | No | No | No | Community |
| No subscription | **Yes** | No | No | No | No |
| Self-hosted | **Yes** | No | No | No | Yes |

### Biggest Competitive Gaps

| Gap | vs Colombia (Siigo/Alegra) | vs Global (Square/Shopify) | vs Open Source (Odoo/ERPNext) |
| --- | --- | --- | --- |
| Cash management | **Critical** | **Critical** | **Critical** |
| Fiscal compliance (DIAN) | **Critical** | N/A | Moderate |
| Split payments | High | **Critical** | High |
| Loyalty/promotions | Moderate | **Critical** | High |
| Credit sales (ventas a crédito) | **Critical** | N/A | Moderate |
| Omnichannel | Moderate | **Critical** | Moderate |
| Product variants | High | High | **Critical** |
| Lot/batch/expiry | N/A for retail | Low | **Critical** |
| Advanced reporting | Moderate | High | High |
| Public API/webhooks | High | **Critical** | High |

For detailed competitive capability matrices, payment ecosystem, hardware integration, LatAm integrations, multi-vertical readiness, and Colombian tax compliance status, see [PLAN.md](./PLAN.md) §6.3–6.8.

---

## 7. Reference Architecture Notes (summaries — full designs in PLAN.md)

### Credit Sales (Ventas a Crédito) Design

See Phase 5 Extension for full data model. Key concepts:
- **Cuotas**: Installment schedule generated at time of credit sale
- **Abonos**: Partial payments posted against oldest pending installments
- **Configuration**: per tenant → company → site (most specific wins)
- **Colombian legal**: Credit sales must generate Factura Electrónica (not DEE). Interest bounded by Superfinanciera usury rate.

### Country-Parametrizable Fiscal Rules Design

See Phase 11 Extension. Key architecture:
- `country_fiscal_profiles` table with JSON columns for tax, tip, e-invoicing, withholding, regime config
- `company_fiscal_overrides` for deviations from country defaults
- Fiscal adapter factory: `getFiscalAdapter(profile.adapter)` selects runtime adapter
- Tax engine becomes pure function: `computeTax(lineItems, profile)`
- Colombia behavior preserved as "CO" profile with zero behavior change

### Hybrid Data Architecture

Recommended: PowerSync for sync layer + dual schema from shared types (near-term).
- **Near term**: Keep SQLite local, formalize sync API, remove direct `better-sqlite3` dependency
- **Mid term**: PostgreSQL as remote truth, SQLite as offline working set
- **Long term**: Support standalone SQLite, managed remote SQLite, and PostgreSQL-backed topologies

### Multi-Vertical Module Architecture

Pattern: Configuration-driven module activation (not separate apps).
- `vertical` field on sites selects the active module
- JSON `metadata` on products stores vertical-specific attributes
- `SiteCapabilities` React Context drives conditional rendering
- Each module exports tRPC router + schema + capabilities declaration
- Checkout pipeline is configurable per vertical

---

## 8. Migration History

The migration from WinForms to Electron + React + Fastify is **functionally complete**.

**What was migrated**: desktop shell, embedded backend, tRPC transport, admin/catalog/product/pricing/inventory/sales/procurement/dashboard/export/reporting modules.

**What the current repo added beyond the original plan**: geography hierarchy, customer classification, locations, provider categories, orders with receive-into-purchase, tenant logo library, sale refunds, desktop backup/restore/tray/theme/update/print, merged sync conflict resolution.

When legacy references conflict with current repo: trust `apps/` and `packages/server/` code first, then this document.
