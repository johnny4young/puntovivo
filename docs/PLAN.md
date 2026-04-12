# Open Yojob Strategic Plan and Technical Roadmap

> Updated: April 11, 2026
> Purpose: strategic product analysis plus technical roadmap for turning Open Yojob into a stronger POS, logistics, and multi-topology platform
> Inputs: repository scan, current architecture docs, official product and platform documentation, fiscal references, and logistics/fulfillment workflow references

## 1. Executive Summary

Open Yojob already has a credible operational core:

- multi-tenant POS foundation
- desktop-first/offline-capable runtime
- embedded Fastify + tRPC backend
- products, pricing, units, providers, customers, VAT, locations, sites, and users
- sales, refunds, voids, purchases, purchase orders, partial receiving, and purchase returns
- inventory movements, initial inventory, adjustments, and dashboard reporting
- sync center, backup/restore, receipt printing, and desktop operations

The app is no longer missing “basic POS.” The biggest gaps are now:

- outbound logistics and transport execution
- warehouse/site-owned inventory and transfer flows
- fulfillment tracking and delivery proof
- quotation-to-order and richer product handling
- loyalty/promotions and omnichannel
- fiscal localization and accounting depth
- a future-ready hybrid data topology for local SQLite plus remote source-of-truth infrastructure

## 2. Current Support For Transport, Product Handling, Tracking, and Logistics

### 2.1 What the current system can already support

The existing repo already gives a usable base for logistics-adjacent work:

- `sites` provide a branch/store abstraction
- `locations` provide finer-grained placement metadata
- `orders` already support supplier-side ordering and partial receiving
- `purchases` already record inbound stock entry
- `inventoryMovements` already provide a movement ledger
- `products` already support barcode, units, provider, category, VAT, and location assignment
- `sequentials` already provide document numbering by site
- `syncQueue` and desktop offline tooling already give a starting point for async/offline delivery updates

This means inbound logistics is partially modeled.
What is still weak is outbound logistics and transport execution.

### 2.2 What is missing

Open Yojob does not yet have first-class support for:

- pick list generation
- packing slips and package-level tracking
- delivery note / dispatch note workflows
- shipment records
- carrier/transporter assignment
- route planning and stop sequencing
- proof of delivery
- customer-facing tracking links and ETA updates
- delivery exception handling
- transfer orders between sites/warehouses
- drop-ship or cross-dock flows
- freight and landed logistics cost allocation
- vehicle/driver assignment and dispatch control

## 3. Market Comparison: Logistics and Transport Features

### 3.1 ERP and commerce platforms

Across ERPNext, Odoo, Zoho Inventory, and Dynamics-style commerce systems, the logistics pattern is consistent:

- sales or orders create fulfillment demand
- pick lists allocate stock
- packing splits the shipment into packages
- shipment records track carrier, AWB/tracking number, and status
- delivery notes represent outbound stock movement
- proof of delivery closes the operational loop
- exceptions trigger returns, re-delivery, or support workflows

Operational references:

- ERPNext documents `Delivery Note`, `Pick List`, `Shipment`, `Delivery Trip`, and `Packing Slip`
- Odoo documents shipping carriers, transfers, routes, and barcode-based delivery processing
- Zoho Inventory emphasizes shipment labels, carrier integration, order fulfillment, and multi-channel order handling

### 3.2 Last-mile and transport platforms

Platforms focused on final-mile delivery such as Bringg, Shipday, and similar dispatch tools differentiate through:

- route optimization
- live GPS tracking
- ETA recalculation
- driver apps
- customer notifications
- proof of delivery via photo/signature/barcode
- SLA and exception visibility

These are especially relevant if Open Yojob wants to serve:

- stores with own delivery fleet
- food and restaurant models
- local retail with same-day delivery
- service companies that schedule on-site visits

## 4. Product and Logistics Gap Matrix

| Capability cluster | Market expectation | Current repo status | Gap level |
| --- | --- | --- | --- |
| Inbound logistics | PO, receipt, returns | Implemented | Low |
| Site/warehouse inventory ownership | balances by site/bin/location | Partial | Critical |
| Internal transfers | request, ship, receive, in-transit | Missing | Critical |
| Pick/pack/ship | pick list, packing slip, delivery note | Missing | Critical |
| Carrier and transport data | carrier, guide/AWB, driver, vehicle | Missing | High |
| Delivery tracking | ETA, tracking number, shipment status | Missing | High |
| Proof of delivery | signature, photo, scan, note | Missing | High |
| Customer notifications | pickup/delivery status messages | Missing | High |
| Delivery exceptions | failed stop, partial delivery, reattempt | Missing | High |
| Freight and logistics costing | freight charge, landed cost, margin impact | Partial | High |
| Product handling depth | variants, kits, lots, serials, expiry | Missing | High |
| Omnichannel fulfillment | pickup, delivery, ship-from-store | Missing | Critical |

## 5. Recommended Logistics Model For Open Yojob

The cleanest path is to treat logistics as a document-driven extension of the existing sales and inventory model.

### 5.1 New operational documents

Recommended new outbound/internal documents:

- `fulfillment_orders`
- `pick_lists`
- `packing_slips`
- `shipments`
- `delivery_notes`
- `transfer_orders`
- `proof_of_delivery`
- `delivery_exceptions`

### 5.2 Suggested lifecycle

For customer fulfillment:

1. sale, quotation conversion, or external order creates fulfillment demand
2. fulfillment order reserves and allocates stock
3. pick list tells staff what to pick
4. packing slip groups items into packages
5. shipment assigns carrier/driver/vehicle and tracking data
6. delivery note posts outbound inventory movement
7. proof of delivery closes the delivery or creates an exception

For internal logistics:

1. transfer order requests movement between sites/warehouses
2. origin site ships stock and creates in-transit movement
3. destination site receives stock
4. discrepancies create transfer exception records

## 6. Product Handling Enhancements Needed For Logistics

To support broader retail, warehousing, transport, and services, products need richer handling metadata:

- variants matrix: size, color, model
- bundles/kits
- recipes/BOM for restaurant or production-light use cases
- serial numbers
- batches/lots
- expiry dates
- weight and dimensions
- shipping class / hazard / handling rules
- lead time and reorder policy
- package unit hierarchy

Current repo fit:

- units already exist and are useful
- barcode already exists
- provider/category/location already exist
- stock and movement ledgers already exist

Current repo limitations:

- no variant model
- no serial/lot/expiry enforcement
- no packaging model
- no weight/dimension-driven shipping logic

## 7. Hybrid Data Architecture: SQLite Local + Remote Source of Truth

### 7.1 What the user wants

Target shape:

- local SQLite continues to exist for offline work on device
- canonical truth lives remotely
- remote truth may be SQLite-based or PostgreSQL-based
- the app should still work without connection and sync later

This is a valid and strong product direction.

### 7.2 What the current code supports well

The current repo already has some enabling pieces:

- clear application API boundary through tRPC
- sync queue and conflict tables
- browser IndexedDB and desktop local DB support
- tenant/site request context
- domain routers that centralize business logic
- Drizzle ORM, which supports multiple SQL dialects in general

These are good foundations for a hybrid architecture.

### 7.3 What currently blocks dual-database support

The current implementation is still strongly SQLite-specific:

- schema uses `sqlite-core` and `sqliteTable`
- DB bootstrap uses `better-sqlite3`
- DB type is `BetterSQLite3Database<typeof schema>`
- startup schema sync is large raw SQLite DDL
- SQLite pragmas such as WAL and foreign keys are used directly
- desktop main-process code and docs assume local SQLite internals
- sync semantics are app-level, but the remote source-of-truth contract is not yet formalized

Conclusion:

- SQLite local is production-compatible today
- PostgreSQL support is not just a connection-string change
- a portability layer is needed before true SQLite/PostgreSQL compatibility exists

## 8. Viable Architecture Options

### Option A: Remote SQLite as source of truth, local SQLite on device

Examples and ideas:

- single-writer remote SQLite
- replicated SQLite with something in the LiteFS family
- per-tenant or per-site SQLite databases behind an application server

Pros:

- smallest conceptual gap from the current codebase
- reuses SQLite semantics everywhere
- easiest near-term migration from current repo

Cons:

- not ideal for higher write concurrency from many distributed clients
- cross-node coordination still needs careful operational design
- some distributed SQLite tooling has important operational caveats

Best fit:

- near-term hosted desktop/offline product
- moderate scale
- strong preference for simple operational model

### Option B: PostgreSQL as source of truth, local SQLite cache/store on clients

Examples and ideas:

- Postgres server plus local SQLite app database
- sync engine patterns similar to Electric or PowerSync style architecture
- app writes locally, uploads through queue, resolves conflicts server-side

Pros:

- strongest long-term client-server architecture
- better concurrency and centralized control
- easier analytics, integrations, and enterprise hosting
- most natural fit for remote multi-user truth

Cons:

- biggest architectural change from current repo
- requires dialect abstraction and sync contract redesign
- decimals, booleans, timestamps, and ids need careful normalization across Postgres and SQLite

Best fit:

- long-term SaaS or multi-branch managed platform
- stronger omnichannel and integration roadmap
- higher concurrency and centralized reporting needs

### Option C: Dual-engine repository layer

Pattern:

- local desktop/server standalone runtime can use SQLite
- remote deployment can use PostgreSQL
- business logic is moved behind repository interfaces
- sync/event pipeline becomes engine-neutral

Pros:

- incremental migration path
- lets the same app run in both standalone and server modes
- avoids hard forking the product

Cons:

- more engineering work up front
- all migrations, tests, and edge cases become two-dialect concerns
- raw SQL and dialect-specific assumptions must be reduced sharply

Recommendation:

- use Option C as the code architecture goal
- ship Option A or Option B as the runtime topology depending on hosting strategy

## 9. Recommended Data Strategy

Recommended target architecture for Open Yojob:

### Near term

- keep SQLite local for desktop/offline
- formalize remote sync API and conflict policy
- remove direct business logic dependence on `better-sqlite3` APIs
- introduce a database capability layer that can target SQLite now and PostgreSQL later

### Mid term

- support PostgreSQL as remote source of truth
- keep local SQLite as offline working set
- move sync from “pending CRUD queue” toward “operation/event contract with server acknowledgements”

### Long term

- support deployment modes:
  - standalone local-first SQLite
  - managed remote SQLite topology for simpler hosted editions
  - PostgreSQL-backed client-server topology for larger installations

## 10. Technical Roadmap By Phase

This roadmap is deliberately technical.
Each phase includes concrete tracks for DB, tRPC, UI, and tests.

### Phase 0: Architecture Foundation

Goal:
- prepare the codebase for logistics expansion and dual-database compatibility

DB tickets:

- `DB-001` Introduce dialect-neutral schema conventions
- `DB-002` Replace raw schema bootstrap with versioned Drizzle migrations
- `DB-003` Define money, quantity, and timestamp normalization rules

tRPC tickets:

- `API-001` Introduce repository/service boundaries for core domains
- `API-002` Separate persistence concerns from router procedures
- `API-003` Define sync acknowledgement contract

UI tickets:

- `UI-001` Add system diagnostics page for runtime topology
- `UI-002` Add admin-facing sync topology indicators

Test tickets:

- `TEST-001` Add persistence contract tests reusable across dialects
- `TEST-002` Add schema migration smoke tests
- `TEST-003` Add sync contract tests for accepted/conflicted/rejected flows

### Phase 1: Site-Owned Inventory and Transfer Logistics

Goal:
- make stock physically believable across sites and warehouses

DB tickets:

- `DB-101` Create `inventory_balances` by product/site/location
- `DB-102` Create `transfer_orders` and `transfer_order_items`
- `DB-103` Create `transfer_shipments` and `transfer_receipts`
- `DB-104` Migrate existing tenant-wide stock to default site-owned balances

tRPC tickets:

- `API-101` Add `inventory.listBalancesBySite`
- `API-102` Add `transfers.create`, `transfers.ship`, `transfers.receive`, `transfers.void`
- `API-103` Update sales/purchases/order receiving to read/write site balances

UI tickets:

- `UI-101` Inventory page: add site/location balance tabs
- `UI-102` New Transfer Orders module
- `UI-103` Transfer receive modal with discrepancy reporting

Test tickets:

- `TEST-101` Sales decrement the active site only
- `TEST-102` Purchase receipts increment the target site only
- `TEST-103` Transfer shipment creates in-transit state without double counting
- `TEST-104` Transfer receipt resolves in-transit quantities correctly

### Phase 2: Outbound Logistics Documents

Goal:
- support pick/pack/ship as first-class warehouse/store operations

DB tickets:

- `DB-201` Create `fulfillment_orders` and `fulfillment_order_items`
- `DB-202` Create `pick_lists`
- `DB-203` Create `packing_slips` and package tables
- `DB-204` Create `delivery_notes`

tRPC tickets:

- `API-201` Add fulfillment allocation procedures
- `API-202` Add pick list generation and completion procedures
- `API-203` Add packing slip procedures
- `API-204` Add delivery note validation that posts outbound inventory movement

UI tickets:

- `UI-201` Fulfillment workbench for ready-to-pick orders
- `UI-202` Pick list detail page optimized for barcode workflow
- `UI-203` Packing UI with package counts, weights, and notes
- `UI-204` Delivery note printable/exportable document

Test tickets:

- `TEST-201` Pick generation respects available balances
- `TEST-202` Delivery note posts the correct stock movement
- `TEST-203` Partial shipment remains fulfillable for remaining quantities

### Phase 3: Transport Execution and Tracking

Goal:
- support dispatch, transport, and delivery follow-through

DB tickets:

- `DB-301` Create `shipments`, `shipment_stops`, `drivers`, `vehicles`, and `carriers`
- `DB-302` Create `proof_of_delivery`
- `DB-303` Create `delivery_exceptions`

tRPC tickets:

- `API-301` Add dispatch procedures for assigning carrier/driver/vehicle
- `API-302` Add shipment status transitions and ETA updates
- `API-303` Add proof-of-delivery mutation with photo/signature/scan metadata
- `API-304` Add exception procedures: failed attempt, damaged goods, partial delivery, reschedule

UI tickets:

- `UI-301` Dispatch board with shipment queue and assignment actions
- `UI-302` Shipment detail page with timeline and status changes
- `UI-303` Driver/mobile-oriented proof-of-delivery screen
- `UI-304` Customer tracking view or tokenized tracking page stub

Test tickets:

- `TEST-301` Status progression validation
- `TEST-302` Proof of delivery closes shipment correctly
- `TEST-303` Exception handling keeps stock/accountability consistent

### Phase 4: Product Handling and Advanced Inventory

Goal:
- support more product categories and operational complexity

DB tickets:

- `DB-401` Create `product_variants`
- `DB-402` Create `serial_numbers`
- `DB-403` Create `batches` and `batch_balances`
- `DB-404` Create `bundle_components` and `recipes`
- `DB-405` Add product weight/dimension/shipping metadata

tRPC tickets:

- `API-401` Variant-aware product search and sale lines
- `API-402` Serial/batch assignment for receipt, sale, transfer, and return
- `API-403` Expiry-aware allocation helpers
- `API-404` Bundle explosion and recipe consumption services

UI tickets:

- `UI-401` Product form: variants and shipping metadata
- `UI-402` Receiving and sales dialogs: serial/batch selector
- `UI-403` Expiry alerts and near-expiry dashboard widgets

Test tickets:

- `TEST-401` Serialized products require exact serial capture
- `TEST-402` Batch FEFO allocation uses earliest-expiry stock
- `TEST-403` Bundles decrement the right components

### Phase 5: Commercial Expansion

Goal:
- improve conversion, retention, and omnichannel readiness

DB tickets:

- `DB-501` Create `quotations` and `quotation_items`
- `DB-502` Create `promotion_rules`
- `DB-503` Create `loyalty_accounts`, `loyalty_transactions`, `gift_cards`, and `store_credits`
- `DB-504` Extend order/fulfillment records for sales channel and delivery mode

tRPC tickets:

- `API-501` Quotation CRUD and convert-to-sale/order
- `API-502` Promotion engine and coupon application
- `API-503` Loyalty earn/redeem and gift card operations
- `API-504` Omnichannel fulfillment procedures for pickup and delivery

UI tickets:

- `UI-501` Quotations module
- `UI-502` Checkout promotion and loyalty controls
- `UI-503` Gift card and store credit balance surfaces
- `UI-504` Omnichannel order queue with pickup/delivery states

Test tickets:

- `TEST-501` Quote conversion preserves prices and taxes
- `TEST-502` Promotion precedence and stacking rules
- `TEST-503` Refunds reverse points or restore credit correctly

### Phase 6: Hybrid Database Runtime

Goal:
- allow SQLite local runtime plus PostgreSQL-compatible remote truth

DB tickets:

- `DB-601` Introduce a dialect abstraction package
- `DB-602` Port schema definitions or derive dialect-specific schema modules
- `DB-603` Create Postgres migration path and bootstrap tooling
- `DB-604` Define upload queue / operation log schema independent of local storage engine

tRPC tickets:

- `API-601` Move core services to repository interfaces
- `API-602` Add remote sync/apply endpoints for operation batches
- `API-603` Add remote conflict response model with field/entity/version context
- `API-604` Add server capability negotiation

UI tickets:

- `UI-601` Admin settings for remote authority configuration
- `UI-602` Improved sync center with upstream status, queue policy, and topology mode
- `UI-603` Conflict resolution UI with richer entity diffing

Test tickets:

- `TEST-601` Run contract suite against SQLite and PostgreSQL
- `TEST-602` Offline write then reconnect replay scenarios
- `TEST-603` Multi-client conflict scenarios

### Phase 7: Fiscal, Accounting, and Integration Layer

Goal:
- make the platform market-ready for broader deployment

DB tickets:

- `DB-701` Create `fiscal_documents`, `fiscal_events`, `customer_tax_profiles`
- `DB-702` Create `supplier_invoices`, `purchase_requests`, `supplier_quotes`, `landed_cost_allocations`
- `DB-703` Create `audit_logs`, `approval_policies`, `approval_events`, `api_keys`, `webhooks`

tRPC tickets:

- `API-701` Fiscal adapter service contract
- `API-702` Colombia-first fiscal issuance workflow
- `API-703` Procurement approvals and landed cost services
- `API-704` Webhooks and integration event delivery

UI tickets:

- `UI-701` Fiscal document status views
- `UI-702` Approval inbox
- `UI-703` Integration and webhook admin screens

Test tickets:

- `TEST-701` Fiscal adapter fixture tests
- `TEST-702` Approval threshold tests
- `TEST-703` Webhook signing and retry tests

## 11. Recommended Implementation Order

If the team wants the highest practical return:

1. Phase 0 architecture foundation
2. Phase 1 site-owned inventory and transfers
3. Phase 2 outbound logistics documents
4. Phase 3 transport execution and tracking
5. Phase 6 hybrid database runtime foundation
6. Phase 4 advanced product handling
7. Phase 5 commercial expansion
8. Phase 7 fiscal/accounting/integration depth

Why this order:

- logistics without believable stock ownership is dangerous
- hybrid runtime without repository boundaries will create expensive rewrites
- transport and tracking become much easier once fulfillment documents exist

## 12. Immediate Documentation Updates Needed

These docs should exist after the first implementation phases:

- `docs/INVENTORY_OWNERSHIP_MODEL.md`
- `docs/FULFILLMENT_AND_LOGISTICS_MODEL.md`
- `docs/HYBRID_DATA_TOPOLOGY.md`
- `docs/CASH_OPERATIONS_RUNBOOK.md`
- `docs/FISCAL_ARCHITECTURE.md`
- `docs/INTEGRATION_STRATEGY.md`
- `docs/DOMAIN_GLOSSARY.md`

## 13. Sources

Market and operational product references:

- [Square Retail POS](https://squareup.com/us/en/point-of-sale/retail)
- [Shopify POS](https://www.shopify.com/pos)
- [Lightspeed Retail POS](https://www.lightspeedhq.com/pos/retail/)
- [Toast POS](https://pos.toasttab.com/)
- [Loyverse POS](https://loyverse.com/)
- [Loyverse Advanced Inventory](https://loyverse.com/advanced-inventory)
- [Loyverse Loyalty Program](https://loyverse.com/loyalty-program)
- [Siigo POS](https://www.siigo.com/sistema-pos/)
- [Alegra POS overview](https://www.alegra.com/rdominicana/pos)
- [ERPNext Delivery Note](https://docs.frappe.io/erpnext/user/manual/en/delivery-note)
- [ERPNext Pick List](https://docs.frappe.io/erpnext/user/manual/en/pick-list)
- [ERPNext Shipment](https://docs.frappe.io/erpnext/v13/user/manual/en/stock/shipment)
- [ERPNext Delivery Trip](https://docs.frappe.io/erpnext/user/manual/en/delivery-trip)
- [ERPNext Packing Slip](https://docs.frappe.io/erpnext/user/manual/en/packing-slip)
- [Odoo third-party shipper](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/shipping_receiving/setup_configuration/third_party_shipper.html)
- [Odoo barcode receipts and deliveries](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/barcode/operations/receipts_deliveries.html)
- [Odoo routes and push/pull rules](https://www.odoo.com/documentation/19.0/fr/applications/inventory_and_mrp/inventory/shipping_receiving/daily_operations/use_routes.html)
- [Zoho Inventory course outline](https://www.zoho.com/sites/zweb/images/spark/productagendas/zoho_inventory_updated.pdf)
- [Bringg real-time delivery tracking](https://www.bringg.com/resources/real-time-delivery-tracking)
- [Shipday routing](https://www.shipday.com/route-planning)

Data topology and database references:

- [SQLite: Appropriate Uses For SQLite](https://www.sqlite.org/whentouse.html)
- [SQLite as an application file format](https://www.sqlite.org/appfileformat.html)
- [Drizzle ORM overview](https://orm.drizzle.team/docs/overview)
- [LiteFS overview](https://fly.io/docs/litefs/)
- [How LiteFS works](https://fly.io/docs/litefs/how-it-works)
- [PowerSync types and Postgres mapping](https://docs.powersync.com/usage/sync-rules/types)
- [PowerSync local-first overview via Supabase](https://supabase.com/partners/powersync)
- [Electric Postgres Sync](https://electric-sql.com/product/electric)

Compliance references:

- [DIAN Resolución 165 de 2023](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0165_2023.htm)
- [DIAN documento equivalente POS electrónico](https://www.dian.gov.co/Prensa/Paginas/NG-Comunicado-de-prensa-009-22-01-2024.aspx)
- [Stripe Tax overview](https://docs.stripe.com/tax)
- [Spain VERI*FACTU overview](https://sede.agenciatributaria.gob.es/static_files/Sede/Biblioteca/Folleto/VERIFACTU/Folleto_VERIFACTU_en_gb.pdf)
