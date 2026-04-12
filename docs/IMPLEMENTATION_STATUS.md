# Implementation Status

> Updated: April 12, 2026
> Source of truth: repository scan of `apps/web`, `apps/desktop`, and `packages/server`, plus competitive analysis of 23+ POS systems and academic/industry framework review

## Executive Summary

The project is no longer in early migration. The application already runs with a broad live surface:

- tRPC-first transport is established and active.
- Core administration, catalog, product, inventory, sales, orders, and purchases flows are implemented.
- Desktop operations now include backup/restore, receipt printing, tray/theme/update settings, and sync controls.
- The remaining work is mostly hardening, deeper operational flows, performance, and edge-case coverage.

After the April 12, 2026 deep competitive analysis and academic framework review, the status should now be read this way:

- the app already has a strong operational POS core for catalog, stock, purchases, sales, and desktop/offline workflows
- the biggest competitive gaps are not basic CRUD; they are cash control, multi-location inventory ownership, loyalty/promotions, omnichannel fulfillment, fiscal localization, accounting follow-through, and integration readiness
- logistics, transport execution, and hybrid local/remote data topology are now also first-order design gaps, not secondary refinements
- payment depth (split payments, gift cards, store credit, installments, on-account) is a significant gap vs every major competitor
- employee management (shifts, commissions, time tracking) is expected by mid-tier competitors and above
- advanced reporting/BI (GMROI, ABC analysis, cohort analysis, CLV) separates basic POS from business-grade platforms
- restaurant/service verticals (tables, KDS, modifiers, appointments) are optional but dramatically expand addressable market
- relative to Colombia-first competitors (Siigo, Alegra, Treinta), the most visible missing pieces are cash opening/closing, stronger fiscal/electronic document coverage, and deeper accounting adjacency
- relative to US/EU/global leaders (Square, Shopify, Lightspeed, Toast), the biggest gaps are omnichannel, loyalty/gift cards, advanced inventory intelligence, transfer workflows, payment depth, and extensibility
- relative to open-source competitors (Odoo, ERPNext), the biggest gaps are full ERP depth (accounting, procurement workflows, logistics documents), but Puntovivo has advantages in offline-first, desktop-native, and developer experience
- Puntovivo's unique differentiators remain: true offline-first, desktop-native Electron, open source, no subscription fees, self-hosted, and Colombian/LatAm focus

## Phase Status

| Phase | Scope | Status | Notes |
| --- | --- | --- | --- |
| Phase 0 | Foundation, schema, transport baseline | Complete | Multi-tenant schema, embedded backend, site context, and tRPC-first transport are in place. |
| Phase 1 | Administration and master catalogs | Complete | Company, sites, sequentials, users, providers, units, VAT, categories, customer catalogs, geography, locations, and logo library are implemented. |
| Phase 2 | Product management and pricing | Complete | Multi-tier pricing, product units, provider/location/VAT assignments, export support, and validated CRUD are live. |
| Phase 3 | Inventory | Complete | Stock view, movement history, adjustments, initial inventory, physical count, and low-stock reporting are implemented. |
| Phase 4 | Sales / POS | Complete | Checkout, receipt printing, responsive/mobile layout, keyboard shortcuts, void, refund, and history/detail flows are implemented. |
| Phase 5 | Procurement | Complete | Orders, partial order receiving into purchases, stock intake, supplier-side purchase returns, cost updates, and purchase void workflows are implemented. |
| Phase 6 | Reporting, sync, desktop operations, UX polish | Advanced / In progress | Dashboard reporting, exports, sync center, role guards, loading/error states, toasts, theme/tray/update settings, backup/restore, and offline UX are implemented. Remaining work is consolidated in `docs/OPEN_BACKLOG.md`. |

## Implemented Application Surface

### Backend

Current tRPC routers:

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
- `inventory`
- `locations`
- `sites`
- `sync`
- `users`

Source:
[router.ts](/Users/johnny4young/Personal/github/puntovivo/packages/server/src/trpc/router.ts)

### Web

Current route modules:

- Dashboard
- Company
- Sites
- Sequentials
- Locations
- Customer Catalogs
- Geography
- Providers
- Categories
- Units
- VAT Rates
- Products
- Orders
- Purchases
- Customers
- Sales
- Inventory
- Users

Source:
[App.tsx](/Users/johnny4young/Personal/github/puntovivo/apps/web/src/App.tsx)

### Desktop

Current desktop-only operational features:

- embedded backend lifecycle
- receipt printing bridge
- receipt print settings
- database backup and restore
- tray enablement and close-to-tray behavior
- persisted theme preference
- auto-update status, manual check, and install action
- tenant-aware sync status and trigger APIs
- allowlisted local DB bridge for desktop offline data access

## Notable Recently Landed Work

- country/department/city catalogs with provider integration
- customer commercial activity catalog
- provider category assignments
- tenant logo library with active company logo selection
- sale refunds via `sale_returns`
- revenue KPI exclusion for refunded sales
- sale detail refund UI and status display
- sync center snapshot-based UI and merged conflict resolution
- desktop backup, restore, update, tray, theme, and print settings
- purchase return history and quick-return actions from the purchases workflow
- route-level lazy loading for major web modules to reduce the initial renderer bundle
- export library splitting so Excel/PDF tooling loads on demand without tripping the previous Vite chunk warning
- sync center retry/failure metrics and oldest-queued visibility for faster operator triage
- order history receipt progress, quick receive actions, and staged-delivery guidance in order details
- purchase history return audit metadata in list/export flows, including returned amount, latest return note, and latest return actor

## Current Risks and Open Areas

The biggest remaining work is no longer CRUD coverage. It is concentrated in:

- deeper inventory modeling by site/location
- cashier shift and cash drawer control
- quotations, reservations, and quote-to-order flows
- promotions, loyalty, gift cards, and store credit
- omnichannel orders, pickup, and ship-from-store workflows
- country-specific fiscal localization, especially Colombia electronic POS / invoicing requirements
- multi-currency and locale-ready transaction modeling
- advanced procurement controls: RFQ, approvals, landed cost, invoice matching
- serial/lot/batch/expiry controls and more advanced item modeling
- richer replenishment, forecast, and inventory intelligence
- remote sync strategy hardening beyond the current retry/failure observability
- procurement edge cases beyond the live purchase-return flow, staged-delivery visibility, and basic return audit metadata with actor visibility
- desktop security hardening and operational verification
- ongoing performance cleanup and bundle hygiene
- deferred database runtime migration from `better-sqlite3` to `node:sqlite` once `node:sqlite` is no longer marked as `release candidate`
- broader integration/E2E coverage
- split payments, installments, on-account, and layaway payment models
- employee shift management, commissions, and time tracking
- restaurant/food service features (tables, KDS, modifiers, tips)
- service business features (appointments, scheduling)
- advanced reporting and BI (GMROI, ABC, CLV, cohort analysis)
- public API, webhooks, and integration ecosystem
- multi-currency support
- hybrid SQLite + PostgreSQL data topology

## Competitive Capability Matrix

### Core POS Operations

| Capability | Square | Shopify | Lightspeed | Toast | Loyverse | Odoo | ERPNext | Siigo | Repo status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Checkout / POS transaction | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Implemented** |
| Void / cancel transaction | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Implemented** |
| Refunds / returns | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Implemented** |
| Receipt printing | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Implemented** |
| Digital receipts (email/SMS) | Yes | Yes | Yes | Yes | No | Yes | No | Yes | Missing |
| Offline mode | Limited | Limited | No | No | Yes | No | Yes | No | **Implemented (strong)** |
| Desktop native app | No | No | No | No | No | No | No | No | **Implemented (unique)** |
| Open source | No | No | No | No | No | Community | Yes | No | **Yes (unique)** |
| Mobile-responsive POS | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | **Implemented** |
| Keyboard shortcuts | Yes | Yes | Yes | No | No | Yes | No | No | **Implemented** |
| Barcode scanning | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Implemented** |
| Custom sale / open price | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Missing |
| Kiosk / self-service mode | Yes | No | No | Yes | No | Yes | No | No | Missing |

### Payment Methods

| Capability | Square | Shopify | Lightspeed | Toast | Loyverse | Odoo | ERPNext | Siigo | Repo status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cash payment | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Implemented** |
| Card payment | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Implemented** (basic) |
| Split payments / multi-tender | Yes | Yes | Yes | Yes | No | Yes | Yes | No | Missing |
| Partial payments / layaway | No | Yes | Yes | No | No | Yes | Yes | No | Missing |
| Installment payments | Yes | No | No | No | No | Yes | No | No | Missing |
| On-account / credit sales | No | No | Yes | No | No | Yes | Yes | Yes | Missing |
| Gift card payment | Yes | Yes | Yes | Yes | No | Yes | No | No | Missing |
| Store credit payment | Yes | Yes | Yes | No | No | Yes | No | No | Missing |
| Tips / gratuity | Yes | Yes | Yes | Yes | No | Yes | No | No | Missing |
| Deposits / prepayments | No | Yes | Yes | No | No | Yes | Yes | No | Missing |
| Custom payment types | Yes | Yes | Yes | No | No | Yes | Yes | No | Missing |

### Cash Management

| Capability | Square | Shopify | Lightspeed | Toast | Loyverse | Odoo | ERPNext | Siigo | Repo status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Cash drawer sessions | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Missing |
| Opening float / count | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Missing |
| Blind close | Yes | Yes | Yes | Yes | No | No | No | No | Missing |
| Denomination counting | Yes | No | Yes | Yes | No | No | No | No | Missing |
| Paid-in / paid-out | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Missing |
| Cash skim / drop | Yes | No | Yes | Yes | No | No | No | No | Missing |
| Over/short tracking | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Missing |
| Shift reports (X/Z reports) | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Missing |
| Multi-register per store | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Missing |

### Inventory Management

| Capability | Square | Shopify | Lightspeed | Toast | Loyverse | Odoo | ERPNext | Siigo | Repo status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Stock tracking | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Implemented** |
| Movement history | Limited | Yes | Yes | No | Yes | Yes | Yes | No | **Implemented** |
| Adjustments | Yes | Yes | Yes | No | Yes | Yes | Yes | Yes | **Implemented** |
| Physical count / stock take | Yes | Yes | Yes | No | Yes | Yes | Yes | No | **Implemented** |
| Low stock alerts | Yes | Yes | Yes | No | Yes | Yes | Yes | No | **Implemented** |
| Multi-location balances | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Partial |
| Inter-store transfers | No | Yes | Yes | No | Yes | Yes | Yes | No | Missing |
| In-transit inventory state | No | Yes | Yes | No | No | Yes | Yes | No | Missing |
| Product variants (size/color) | Yes | Yes | Yes | Yes | No | Yes | Yes | No | Missing |
| Serial number tracking | No | No | Yes | No | No | Yes | Yes | No | Missing |
| Batch / lot tracking | No | No | No | No | No | Yes | Yes | No | Missing |
| Expiry date tracking | No | No | No | No | No | Yes | Yes | No | Missing |
| Bundles / kits / combos | No | Yes | Yes | No | No | Yes | Yes | No | Missing |
| Recipes / BOM | No | No | No | Yes | No | Yes | Yes | No | Missing |
| Weight / dimensions | No | Yes | Yes | No | No | Yes | Yes | No | Missing |
| Reorder points / auto PO | Yes | Yes | Yes | No | Yes | Yes | Yes | No | Missing |
| ABC analysis | No | No | No | No | No | No | Yes | No | Missing |
| GMROI / sell-through | No | No | Yes | No | No | Yes | Yes | No | Missing |
| Demand forecasting | No | Yes | No | No | No | Yes | Yes | No | Missing |
| Cycle counting | No | No | Yes | No | No | Yes | Yes | No | Missing |
| Dead stock / aging | No | No | Yes | No | No | Yes | Yes | No | Missing |
| Inventory costing method | No | WAC | WAC/FIFO | No | No | All | All | WAC | Missing |

### Procurement

| Capability | Square | Shopify | Lightspeed | Toast | Loyverse | Odoo | ERPNext | Siigo | Repo status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Purchase orders | Yes | Yes | Yes | No | Yes | Yes | Yes | Yes | **Implemented** |
| Partial receiving | No | Yes | Yes | No | No | Yes | Yes | No | **Implemented** |
| Purchase returns | No | No | Yes | No | No | Yes | Yes | No | **Implemented** |
| Supplier management | Yes | Yes | Yes | No | Yes | Yes | Yes | Yes | **Implemented** |
| RFQ / supplier quotes | No | No | No | No | No | Yes | Yes | No | Missing |
| 3-way match (PO/receipt/invoice) | No | No | No | No | No | Yes | Yes | No | Missing |
| Landed cost | No | No | Yes | No | No | Yes | Yes | No | Missing |
| Blanket / framework orders | No | No | No | No | No | Yes | Yes | No | Missing |
| Vendor rating / scorecard | No | No | No | No | No | Yes | Yes | No | Missing |
| Purchase approval workflows | No | No | No | No | No | Yes | Yes | No | Missing |

### Customer Management and Loyalty

| Capability | Square | Shopify | Lightspeed | Toast | Loyverse | Odoo | ERPNext | Siigo | Repo status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Customer database | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Implemented** |
| Purchase history per customer | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | **Implemented** |
| Customer groups / segments | Yes | Yes | Yes | No | No | Yes | Yes | No | Partial |
| Loyalty program (points) | Yes | Apps | Yes | No | Paid | Yes | Yes | No | Missing |
| Loyalty tiers | Yes | Apps | Yes | No | No | Yes | No | No | Missing |
| Gift cards | Yes | Yes | Yes | Yes | No | Yes | No | No | Missing |
| Store credit | Yes | Yes | Yes | No | No | Yes | No | No | Missing |
| Coupons / promo codes | Yes | Yes | Yes | Yes | No | Yes | Yes | No | Missing |
| Promotions engine | Yes | Yes | Yes | Yes | No | Yes | Yes | No | Missing |
| Customer-specific pricing | No | No | Yes | No | No | Yes | Yes | No | Missing |
| Marketing / email campaigns | Yes | Yes | Yes | No | No | Yes | No | No | Missing |
| Customer credit accounts | No | No | Yes | No | No | Yes | Yes | Yes | Missing |

### Quotations and Pre-Sale

| Capability | Square | Shopify | Lightspeed | Toast | Loyverse | Odoo | ERPNext | Siigo | Repo status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Quotations / estimates | No | No | Yes | No | No | Yes | Yes | Yes | Missing |
| Quote versioning | No | No | No | No | No | Yes | Yes | No | Missing |
| Quote-to-order conversion | No | No | Yes | No | No | Yes | Yes | Yes | Missing |
| Quote validity / expiry | No | No | Yes | No | No | Yes | Yes | No | Missing |
| Margin analysis on quotes | No | No | No | No | No | Yes | Yes | No | Missing |
| Sales pipeline tracking | No | No | No | No | No | Yes | Yes | No | Missing |
| Win/loss tracking | No | No | No | No | No | Yes | Yes | No | Missing |

### Employee Management

| Capability | Square | Shopify | Lightspeed | Toast | Loyverse | Odoo | ERPNext | Siigo | Repo status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Role-based permissions | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Implemented** |
| PIN-based POS login | Yes | Yes | Yes | Yes | Yes | Yes | No | No | Missing |
| Time clock / shift tracking | Yes | No | Yes | Yes | Yes | Yes | No | No | Missing |
| Shift scheduling | Yes | No | Yes | Yes | No | Yes | No | No | Missing |
| Commission tracking | No | No | Yes | No | No | Yes | No | No | Missing |
| Sales per employee | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Missing |
| Break tracking | Yes | No | Yes | Yes | No | Yes | No | No | Missing |
| Overtime calculation | Yes | No | Yes | Yes | No | Yes | No | No | Missing |

### Logistics and Fulfillment

| Capability | Square | Shopify | Lightspeed | Toast | Loyverse | Odoo | ERPNext | Siigo | Repo status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pick list generation | No | Yes | No | No | No | Yes | Yes | No | Missing |
| Packing slips | No | Yes | No | No | No | Yes | Yes | No | Missing |
| Delivery notes | No | Yes | No | No | No | Yes | Yes | No | Missing |
| Shipment tracking | No | Yes | No | No | No | Yes | Yes | No | Missing |
| Carrier integration | No | Yes | No | No | No | Yes | Yes | No | Missing |
| Proof of delivery | No | No | No | Yes | No | Yes | Yes | No | Missing |
| Driver/vehicle dispatch | No | No | No | Yes | No | Yes | Yes | No | Missing |
| Route optimization | No | No | No | No | No | No | No | No | Missing |
| Customer tracking link | No | Yes | No | Yes | No | No | No | No | Missing |
| Delivery exceptions | No | No | No | Yes | No | Yes | Yes | No | Missing |
| BOPIS (buy online, pick up in store) | Yes | Yes | No | No | No | Yes | No | No | Missing |
| Ship-from-store | Yes | Yes | No | No | No | Yes | No | No | Missing |
| Local delivery | Yes | Yes | No | Yes | No | Yes | No | No | Missing |
| Drop-ship | No | Yes | No | No | No | Yes | Yes | No | Missing |

### Restaurant / Food Service

| Capability | Square | Shopify | Lightspeed | Toast | Loyverse | Odoo | ERPNext | Siigo | Repo status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Table management | Yes | No | Yes | Yes | No | Yes | No | No | Missing |
| Floor plan editor | Yes | No | Yes | Yes | No | Yes | No | No | Missing |
| Kitchen Display (KDS) | Yes | No | No | Yes | No | Yes | No | No | Missing |
| Course firing | Yes | No | No | Yes | No | Yes | No | No | Missing |
| Modifier groups | Yes | No | Yes | Yes | No | Yes | No | No | Missing |
| Split checks | Yes | No | Yes | Yes | No | Yes | No | No | Missing |
| Tip management | Yes | No | Yes | Yes | No | Yes | No | No | Missing |
| Auto-86ing | Yes | No | No | Yes | No | No | No | No | Missing |
| QR code ordering | Yes | No | No | Yes | No | Yes | No | No | Missing |
| Recipe costing | No | No | No | Yes | No | Yes | Yes | No | Missing |
| Menu engineering | No | No | No | Yes | No | No | No | No | Missing |

### Reporting and Analytics

| Capability | Square | Shopify | Lightspeed | Toast | Loyverse | Odoo | ERPNext | Siigo | Repo status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sales reports | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Implemented** (basic) |
| Revenue dashboard | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Implemented** |
| Inventory reports | Yes | Yes | Yes | No | Yes | Yes | Yes | No | **Implemented** (basic) |
| Hourly sales curve | Yes | Yes | Yes | Yes | No | Yes | No | No | Missing |
| Avg transaction value (ATV) | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Missing |
| Items per transaction | Yes | Yes | Yes | Yes | No | Yes | Yes | No | Missing |
| Sales by employee | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Missing |
| Sales by category | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Partial |
| Profit margin reports | Yes | Yes | Yes | No | No | Yes | Yes | No | Missing |
| Customer insights / CLV | Yes | Yes | Yes | No | No | Yes | Yes | No | Missing |
| Custom report builder | No | Yes (Plus) | Yes | No | No | Yes | Yes | No | Missing |
| Scheduled/email reports | Yes | Yes | Yes | Yes | No | Yes | Yes | No | Missing |
| Comparison periods | Yes | Yes | Yes | Yes | No | Yes | Yes | No | Missing |
| Drill-down capability | Yes | Yes | Yes | Yes | No | Yes | Yes | No | Missing |
| Real-time dashboard | Yes | Yes | Yes | Yes | No | Yes | No | No | Partial |
| Exception alerts | No | No | No | No | No | Yes | Yes | No | Missing |
| Tax reports | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Missing |

### Tax and Fiscal Compliance

| Capability | Square | Shopify | Lightspeed | Toast | Loyverse | Odoo | ERPNext | Siigo | Repo status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tax rate configuration | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Implemented** |
| Multi-tax / compound tax | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | Missing |
| Tax groups | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | Missing |
| Tax-exempt customers | Yes | Yes | Yes | No | No | Yes | Yes | Yes | Missing |
| Tax reports | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Missing |
| Electronic invoicing (Colombia) | No | No | No | No | No | Community | Community | **Yes** | Missing |
| Documento equivalente POS | No | No | No | No | No | No | No | **Yes** | Missing |
| Credit notes (formal) | No | Yes | Yes | No | No | Yes | Yes | Yes | Missing |
| Debit notes | No | No | No | No | No | Yes | Yes | Yes | Missing |
| Multi-country fiscal adapters | No | No | No | No | No | Yes (70+) | Yes (40+) | Limited | Missing |

### Multi-Store and Enterprise

| Capability | Square | Shopify | Lightspeed | Toast | Loyverse | Odoo | ERPNext | Siigo | Repo status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Multi-store support | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Implemented** (sites) |
| Store hierarchy | No | No | No | No | No | Yes | Yes | No | Missing |
| Consolidated reporting | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Missing |
| Location-specific pricing | Yes | Yes | Yes | Yes | No | Yes | Yes | No | Missing |
| Price books / price lists | No | No | Yes | No | No | Yes | Yes | No | Missing |
| Price effective dates | No | No | Yes | No | No | Yes | Yes | No | Missing |
| Multi-currency | No | Yes | Yes | No | No | Yes | Yes | No | Missing |
| Store benchmarking | Yes | Yes | Yes | Yes | No | Yes | Yes | No | Missing |

### Integration and Extensibility

| Capability | Square | Shopify | Lightspeed | Toast | Loyverse | Odoo | ERPNext | Siigo | Repo status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Public REST/GraphQL API | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Limited | Missing |
| Webhooks | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Missing |
| API keys / OAuth | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Missing |
| Accounting integration | Apps | Apps | Built-in | Apps | Apps | Built-in | Built-in | Built-in | Missing |
| E-commerce integration | Yes | Built-in | Yes | Yes | No | Built-in | Yes | No | Missing |
| App marketplace / plugins | 500+ | 8000+ | Yes | 200+ | No | 40000+ | Yes | No | Missing |
| Import/export (CSV/Excel) | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Implemented** |
| Hardware integration (scales, etc) | Yes | Yes | Yes | Yes | No | Yes | Yes | No | Missing |

### Hybrid Database / Data Architecture

| Capability | Repo status | Notes |
| --- | --- | --- |
| SQLite local storage | **Implemented** | Core of desktop runtime via better-sqlite3 + Drizzle ORM |
| Offline-first transactions | **Implemented** | Sales, inventory, and sync queue work offline |
| Sync queue and conflict resolution | **Implemented** | App-level sync with conflict tables and retry metrics |
| PostgreSQL remote support | Missing | Schema is SQLite-specific (sqliteTable, SQLite DDL) |
| Dialect abstraction layer | Missing | Business logic directly depends on better-sqlite3 APIs |
| Operation-based sync protocol | Missing | Current sync is CRUD-queue; no formal operation log |
| Remote authority contract | Missing | No defined server-side sync acceptance/rejection model |
| Multi-client conflict resolution | Partial | Basic conflict UI exists; field-level merge does not |
| Connection state management | Partial | Sync center shows status; automatic reconnect is basic |

### Colombia Payment Ecosystem

| Capability | Market Standard | Repo status | Notes |
| --- | --- | --- | --- |
| Cash payment | Universal | **Implemented** | Core tender type |
| Card payment (basic record) | Universal | **Implemented** | Records card payment, no terminal integration |
| Payment gateway integration (Wompi/ePayco) | Siigo, Alegra, Bold | Missing | No gateway API integration |
| PSE bank transfer | Required for Colombian e-commerce | Missing | Via Wompi or ePayco API |
| Nequi digital wallet | Rapidly growing (18M+ users) | Missing | Via Wompi API |
| Daviplata digital wallet | 16M+ users | Missing | Via ePayco or PayU API |
| Bancolombia QR payment | Growing in-store usage | Missing | Via Wompi API |
| Efecty / Baloto cash network | Common for offline payment | Missing | Via ePayco/PayU, reference code flow |
| Payment terminal integration | Bold, MercadoPago Point, SumUp | Missing | Semi-integrated or cloud-integrated model |
| Split payments / multi-tender | 7/8 major competitors | Missing | Required for cash + card combos |
| Installments (cuotas) | Common in Colombia (3, 6, 12 cuotas) | Missing | Via payment gateway |
| Payment reconciliation | Required for accounting | Missing | Gross vs net, withholding, GMF |

### POS Hardware Integration

| Capability | Industry Standard | Repo status | Notes |
| --- | --- | --- | --- |
| Thermal receipt printing | ESC/POS protocol (Epson, Star, etc.) | **Implemented** | Via desktop bridge. Extension possible. |
| Network/TCP printing | Port 9100, shared printers | Partial | Desktop bridge supports USB; network TBD |
| USB barcode scanner (keyboard wedge) | HID emulation, "just works" | **Implemented** | Product search field captures scan input |
| Camera-based barcode scanning | zxing-wasm, quagga2 | Missing | For mobile/tablet POS |
| Cash drawer control | ESC/POS pulse via printer | Missing | Requires cash session model first |
| Weighing scale integration | Serial or USB HID (Toledo, CAS) | Missing | For products sold by weight |
| Label printer (barcode labels) | ZPL (Zebra), TSPL | Missing | For product labeling and shelf tags |
| Payment terminal integration | Semi-integrated or cloud-integrated | Missing | MercadoPago Point, SumUp as candidates |
| Customer-facing display | Second screen showing cart | Missing | For transparency and advertising |

### LatAm Integration Ecosystem

| Capability | API Available | Node.js Ready | Repo status | Priority |
| --- | --- | --- | --- | --- |
| WhatsApp receipt/notification delivery | Yes (Cloud API) | Yes (official + community SDK) | Missing | P0 — $0.0008/msg, 90%+ penetration |
| Alegra accounting sync | Yes (REST API) | Yes | Missing | P1 |
| Siigo accounting sync | Yes (REST API) | Yes | Missing | P1 |
| Shopify inventory/order sync | Yes (GraphQL Admin API) | Yes (official TS SDK) | Missing | P1 |
| WooCommerce inventory/order sync | Yes (REST API v3) | Yes (official npm) | Missing | P1 |
| MercadoLibre listing/order sync | Yes (REST, OAuth 2.0) | Yes (official npm) | Missing | P1 |
| Rappi order intake | Yes (REST, requires approval) | Yes | Missing | P2 |
| Uber Eats order intake | Yes (REST + webhooks) | Yes | Missing | P2 |
| iFood/Domicilios.com order intake | Yes (REST, event-driven) | Yes | Missing | P2 |
| PedidosYa order intake | Yes (REST) | Yes | Missing | P2 |
| DIAN RUT validation | Via third-party (Apitude) | Yes | Missing | P3 |
| Cédula identity verification | Via third-party (Verifik) | Yes | Missing | P3 |

## Detailed Gap Analysis: What Every Phase Adds

### Implemented (Competitive Parity Already Achieved)

These areas match or exceed the basics of most competitors:

- Product catalog with multi-tier pricing, units, categories, VAT rates
- Sales checkout with receipts, voids, refunds, keyboard shortcuts, mobile layout
- Purchase orders with partial receiving and supplier returns
- Inventory with movements, adjustments, initial inventory, physical counts, low stock
- Multi-tenant with company, sites, locations, users, roles
- Desktop operations: backup, restore, print settings, tray, theme, auto-update
- Offline-first with sync queue, conflict detection, retry metrics
- CSV/Excel/PDF exports

### Missing — Ranked by Competitive Urgency

| Priority | Feature Area | # Competitors that have it | Impact |
| --- | --- | --- | --- |
| **Critical** | Cash management (sessions, close, over/short) | 8/8 major competitors | Cannot operate retail without it in LatAm |
| **Critical** | Split payments / multi-tender | 7/8 major competitors | Basic checkout expectation |
| **Critical** | Electronic invoicing (Colombia DIAN) | Required by law | Legal compliance gap |
| **Critical** | Site-owned inventory + transfers | 6/8 major competitors | Blocks multi-store operations |
| **High** | Gift cards + store credit | 6/8 major competitors | Revenue and retention driver |
| **High** | Loyalty program | 6/8 major competitors | Customer retention expectation |
| **High** | Quotations / estimates | 4/8 major, all ERPs | Required for B2B |
| **High** | Product variants | 6/8 major competitors | Required for fashion, apparel, etc |
| **High** | Promotions / coupons engine | 7/8 major competitors | Marketing and conversion |
| **High** | Employee time tracking / shifts | 5/8 major competitors | Labor management |
| **High** | Public API + webhooks | 7/8 major competitors | Integration ecosystem |
| **High** | Pick/pack/ship logistics | 4/8 major, all ERPs | Fulfillment capability |
| **Moderate** | Serial/lot/batch tracking | 3/8 major, all ERPs | Required for regulated industries |
| **Moderate** | Multi-currency | 4/8 major competitors | International operations |
| **Moderate** | Advanced reporting (GMROI, CLV, ABC) | 4/8 major competitors | Manager decision support |
| **Moderate** | Landed cost tracking | 2/8 major, all ERPs | Import/distribution businesses |
| **Moderate** | Restaurant features (KDS, tables) | 3/8 major competitors | Expands addressable market |
| **Moderate** | Credit notes (formal accounting) | 4/8 major competitors | Accounting completeness |
| **Moderate** | Commission tracking | 2/8 major competitors | Sales team management |
| **High** | WhatsApp receipt/notification delivery | N/A (90%+ penetration in Colombia) | Direct revenue impact, $0.0008/msg |
| **High** | Payment gateway integration (Wompi/ePayco) | Required for Colombian market | Enables PSE, Nequi, Efecty |
| **High** | Accounting integration (Siigo/Alegra) | Required for Colombian businesses | Avoids double data entry |
| **Moderate** | Payment terminal integration | Bold, MercadoPago Point, SumUp | Semi-integrated or cloud model |
| **Moderate** | E-commerce sync (Shopify/WooCommerce/MercadoLibre) | Expected for omnichannel | Inventory + order sync |
| **Moderate** | Cash drawer control (ESC/POS pulse) | Standard POS hardware | Depends on cash session model |
| **Moderate** | Camera-based barcode scanning | Growing for tablet POS | zxing-wasm or quagga2 |
| **Moderate** | Label printing (ZPL/barcode labels) | Common in retail/warehouse | Product and shelf labeling |
| **Low** | Delivery platform integration (Rappi/Uber Eats) | Restaurant vertical only | Via aggregator or direct API |
| **Low** | Weighing scale integration | Grocery/bulk retail only | Serial or USB HID |
| **Low** | Kiosk / self-service | 3/8 major competitors | Niche use case |
| **Low** | Appointment scheduling | 2/8 major competitors | Service businesses |
| **Low** | Route optimization | 0/8 major POS (logistics platforms) | Advanced logistics |
| **Low** | App marketplace / plugins | 5/8 major competitors | Long-term ecosystem |

## Read This Alongside

The current product strategy and implementation details for the missing capabilities now live in:

- [PLAN.md](/Users/johnny4young/Personal/github/puntovivo/docs/PLAN.md) — full technical roadmap with DB, API, UI, and test tickets per phase
- [OPEN_BACKLOG.md](/Users/johnny4young/Personal/github/puntovivo/docs/OPEN_BACKLOG.md) — operational gaps and suggested next slices

### Deferred Technical Migration

- `better-sqlite3` to `node:sqlite` should be evaluated only after the Node API is marked stable and no longer `release candidate`.
- The server DB bootstrap in `packages/server/src/db/index.ts` would need to move away from `drizzle-orm/better-sqlite3` to the Drizzle driver/runtime that supports `node:sqlite` at that time.
- Desktop main-process code in `apps/desktop/src/main/index.ts` currently relies on the raw `$client` shape and `prepare(...).get()/all()/run()` access patterns exposed by the current SQLite client, so those direct bridge queries would need to be adapted together with the ORM migration.
- Runtime handling and docs added for dual Node/Electron native binary preparation can be removed only after the repo no longer depends on native `better-sqlite3` artifacts.

Those items are tracked in:
[OPEN_BACKLOG.md](/Users/johnny4young/Personal/github/puntovivo/docs/OPEN_BACKLOG.md)

## Validation Baseline

The current repo routinely validates changes with:

- focused server Vitest suites
- full web Vitest suite
- web production build
- desktop TypeScript typecheck

Representative commands:

```bash
npm exec --workspace=@puntovivo/server -- vitest run sales dashboard sync --reporter=dot
npm run test --workspace=@puntovivo/web -- --run
npm run build --workspace=@puntovivo/web
npm run typecheck --workspace=@puntovivo/desktop
```

The web build no longer emits the previous Vite large-chunk warning after the route-level lazy loading and export-library split work.
