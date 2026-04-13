# Puntovivo Strategic Plan and Technical Roadmap

> Updated: April 13, 2026
> Purpose: strategic product analysis plus technical roadmap for turning Puntovivo into a stronger POS, logistics, and multi-topology platform
> Inputs: repository scan, current architecture docs, competitive analysis of 23+ POS systems, academic/industry POS frameworks, logistics platform research, and hybrid database architecture patterns

## 1. Executive Summary

Puntovivo already has a credible operational core:

- multi-tenant POS foundation
- desktop-first/offline-capable runtime
- embedded Fastify + tRPC backend
- products, pricing, units, providers, customers, VAT, locations, sites, and users
- sales, refunds, voids, purchases, purchase orders, partial receiving, and purchase returns
- inventory movements, initial inventory, adjustments, and dashboard reporting
- sync center, backup/restore, receipt printing, and desktop operations

The app is no longer missing "basic POS." The biggest gaps are now:

- cash management and cashier shift control
- outbound logistics and transport execution
- warehouse/site-owned inventory and transfer flows
- fulfillment tracking and delivery proof
- quotation-to-order and richer product handling
- loyalty/promotions, gift cards, and store credit
- employee management, commissions, and time tracking
- advanced reporting and business intelligence
- fiscal localization and accounting depth
- **country-parametrizable fiscal rules** — current Colombia-hardcoded IVA/INC/propina/DIAN logic must become a profile-driven system before any non-Colombian deployment
- multi-currency support
- payment method depth (split payments, installments, credit accounts)
- **credit sales (ventas a crédito)** — installment schedules (cuotas), partial payment posting (abonos), configurable per tenant/company/site
- restaurant/food service adaptations (tables, kitchen display, modifiers)
- appointment/service scheduling
- a future-ready hybrid data topology for local SQLite plus remote source-of-truth infrastructure
- public API, webhooks, and integration ecosystem

## 2. Competitive Landscape Analysis

### 2.1 Global POS Leaders

#### Square POS (Square for Retail / Square for Restaurants)

- **Core POS**: Checkout, split payments, custom tipping, digital receipts, offline mode (limited)
- **Inventory**: Real-time tracking, stock alerts, multi-location, automatic purchase orders, COGS tracking, barcode label printing
- **CRM/Loyalty**: Built-in loyalty program (points-based), customer directory, marketing email campaigns, customer groups/segments
- **Employee**: Time tracking, shift scheduling, labor cost vs sales reporting, role-based permissions, team management
- **Cash**: Cash drawer tracking, shift-level cash management, blind close option
- **Payments**: Own payment processing (Square Payments), NFC/contactless, chip, swipe, invoicing, recurring billing, buy-now-pay-later (Afterpay)
- **Reporting**: Sales analytics, inventory reports, labor reports, customer insights, real-time dashboard, custom date ranges
- **Omnichannel**: Online store, Instagram/Facebook selling, pickup, delivery, QR code ordering
- **Restaurant**: Table management, course management, kitchen display (KDS), modifier groups, auto-86ing, tip management
- **Integrations**: Open API, app marketplace (500+ integrations), webhooks
- **Pricing**: Free base plan, paid tiers from $60/month/location

**Key differentiators vs Puntovivo**: Payment processing ecosystem, marketing tools, loyalty built-in, restaurant KDS, strong app marketplace. Puntovivo advantage: offline-first, open source, no transaction fees, self-hosted.

#### Shopify POS

- **Core POS**: Unified online+offline commerce, smart grid checkout UI, custom sale, layaways
- **Inventory**: Demand forecasting, purchase orders, transfers, receiving, low stock reports, detailed product variants (unlimited), inventory counting
- **CRM**: Unified customer profiles across channels, order history, marketing automation, segments
- **Loyalty**: Via apps (Smile.io, LoyaltyLion), not native
- **Employee**: Staff POS PINs, role-based permissions, staff performance tracking
- **Cash**: Cash tracking, shift management, register reports
- **Payments**: Shopify Payments + 100+ payment gateways, split payments, partial payments, gift cards, store credit, custom payment types
- **Reporting**: 60+ pre-built reports, custom reports (Plus plan), profit margin reports, tax reports
- **Omnichannel**: The strongest omnichannel story — online store, POS, social commerce, marketplaces, buy online pickup in store (BOPIS), ship-from-store, local delivery
- **Integrations**: 8,000+ apps, REST + GraphQL API, webhooks, Flow automation
- **Pricing**: $39-399/month plus hardware

**Key differentiators vs Puntovivo**: Best-in-class omnichannel, massive app ecosystem, product variants. Puntovivo advantage: desktop-native, offline-first, no subscription, self-hosted, Colombia-first.

#### Lightspeed Retail (X-Series, formerly Vend)

- **Core POS**: Fast checkout, custom receipts, layaways, quotes, on-account sales
- **Inventory**: Matrix inventory (variants), serial numbers, bundles, composite products, multi-location, supplier catalogs, purchase orders, stock transfers, reorder points, stock takes
- **CRM**: Customer groups, custom fields, loyalty (built-in), store credit, on-account purchasing
- **Loyalty**: Points-based, tiered rewards, customer marketing
- **Employee**: Time tracking, commission tracking, performance reporting, granular permissions
- **Cash**: Cash register management, shift reconciliation, X/Z reports
- **Payments**: Integrated payments, split tender, partial payments, store credit, gift cards, on-account
- **Reporting**: 40+ built-in reports, custom reports, sales by employee, inventory valuation, sell-through analysis
- **Omnichannel**: Integrated ecommerce, social selling, click-and-collect
- **Advanced**: B2B price lists, quote-to-invoice, purchase order management, landed cost tracking
- **Integrations**: Open API, accounting integration (Xero, QuickBooks), ecommerce
- **Pricing**: From $89/month

**Key differentiators vs Puntovivo**: Serial numbers, matrix products, B2B features, quote-to-invoice, landed cost, commission tracking. These are the features most directly comparable to Puntovivo's ambition.

#### Toast POS (Restaurant-focused)

- **Core POS**: Restaurant-optimized checkout, table management, course firing, split checks, tip management
- **Inventory**: Recipe costing, ingredient tracking, waste logging, menu engineering, theoretical vs actual food cost
- **Employee**: Payroll, scheduling, time tracking, tip distribution, labor cost reporting
- **Restaurant-specific**: Kitchen Display System (KDS), online ordering, catering, guest feedback, menu engineering, tableside ordering (handheld), QR code ordering, waitlist management
- **Reporting**: Labor vs sales, food cost analysis, sales mix, hourly sales, server performance
- **Integrations**: 200+ integrations, open API
- **Pricing**: Free starter plan, from $69/month

**Key differentiators vs Puntovivo**: If Puntovivo wants restaurant vertical, Toast sets the bar — KDS, recipe costing, tip distribution, menu engineering are must-haves.

#### Clover POS

- **Core POS**: Modular hardware, flexible checkout, tabs, pre-authorizations
- **Inventory**: Item-level tracking, modifiers, variants, cost tracking, low stock alerts
- **CRM**: Customer database, marketing, feedback surveys
- **Loyalty**: Built-in rewards program, gift cards, promotions
- **Employee**: Shifts, roles, permissions, time clock
- **Cash**: Cash register management, tip adjustments
- **Payments**: Own payment processing (Fiserv), split payments, contactless, invoicing
- **App Market**: 300+ third-party apps
- **Pricing**: From $14.95/month plus hardware

#### Revel Systems (iPad POS, Enterprise-grade)

- **Core POS**: Enterprise POS, kiosk mode, drive-through, delivery management
- **Inventory**: Multi-location, purchase orders, vendor management, ingredient-level tracking, waste management
- **CRM**: Advanced customer management, loyalty, gift cards, marketing
- **Employee**: Scheduling, time clock, payroll integration, commission tracking, performance
- **Cash**: Full cash management, blind close, denomination counting, safe management
- **Reporting**: Business intelligence platform, custom dashboards, API-driven analytics
- **Restaurant**: KDS, delivery dispatch, driver tracking, online ordering
- **Integration**: Open API, QuickBooks, Sage, 100+ integrations
- **Pricing**: Custom enterprise pricing

**Key differentiators vs Puntovivo**: Enterprise cash management (denomination counting, safe management), delivery dispatch, driver tracking, kiosk mode. These are features Puntovivo should model for advanced cash operations and logistics.

#### Loyverse POS

- **Core POS**: Free POS, clean mobile-first UI, offline mode
- **Inventory**: Purchase orders, stock management, multi-store, low stock notifications, stock takes
- **CRM**: Customer database, purchase history
- **Loyalty**: Built-in loyalty program (paid add-on)
- **Employee**: Access rights, time clock, individual sales tracking
- **Cash**: Cash register management, shift reports
- **Reporting**: Sales reports, inventory reports, employee performance
- **Pricing**: Free base, paid add-ons ($25/store/month for advanced inventory, $25/store/month for loyalty)

**Key differentiators vs Puntovivo**: Very similar product positioning (free, simple, small business). Loyverse is the closest direct competitor in the free/simple tier. Puntovivo must differentiate through offline-first desktop native, open source, and deeper operational features.

### 2.2 Open Source POS Systems

#### Odoo POS (within Odoo ERP)

- **Strength**: Full ERP integration (accounting, CRM, warehouse, manufacturing, HR)
- **POS Features**: Restaurant mode, bar mode, loyalty, coupons, gift cards, pricelists by customer/date, multi-store
- **Inventory**: Full warehouse management (WMS), routes, replenishment rules, lot/serial tracking, cross-docking, dropshipping, cycle counting
- **Procurement**: RFQ, purchase agreements (blanket orders), 3-way matching, landed cost, vendor bills
- **Accounting**: Full double-entry accounting, multi-currency, bank reconciliation, fiscal localization for 70+ countries
- **Logistics**: Shipping carriers, routes, push/pull rules, barcode operations, batch/wave picking, put-away rules
- **Integration**: REST/JSON-RPC API, 40,000+ community apps

**Key differentiators vs Puntovivo**: Odoo is the gold standard for feature breadth. Puntovivo should study Odoo's module design but compete on simplicity, offline-first, and developer experience.

#### ERPNext POS

- **Strength**: Python/JavaScript open source ERP with POS module
- **POS Features**: Basic checkout, offline POS, customer loyalty, multi-mode payments
- **Inventory**: Batch/serial, warehouse management, stock reconciliation, reorder levels, quality inspection
- **Procurement**: Purchase orders, supplier quotations, blanket orders, purchase receipt, purchase invoice
- **Logistics**: Delivery Note, Pick List, Shipment, Delivery Trip, Packing Slip — the most complete open-source logistics document set
- **Accounting**: Full accounting, multi-currency, tax templates, payment terms, budget tracking

**Key differentiators vs Puntovivo**: ERPNext has the most mature open-source logistics model. Its Delivery Note → Pick List → Shipment → Delivery Trip pipeline should be the reference model for Puntovivo's logistics implementation.

#### Other Open Source POS

| System | Notable Features | Relevance to Puntovivo |
| --- | --- | --- |
| **Unicenta** | Java-based, restaurant features, tax flexibility, scripting | Tax engine design reference |
| **Floreant POS** | Restaurant-focused, floor plan, kitchen display, drive-through | Restaurant mode reference |
| **Chromis POS** | Fork of Openbravo POS, customizable, scripting engine | Plugin architecture reference |
| **Openbravo** | Full retail/restaurant, mobile POS, enterprise features | Multi-store architecture reference |

### 2.3 Latin America / Colombia-Focused POS

#### Siigo POS

- **Strength**: Colombian accounting + POS integration, DIAN-compliant electronic invoicing
- **Features**: POS, invoicing, inventory, accounting, payroll, purchasing, multi-store, bank reconciliation
- **Fiscal**: Full Colombia electronic invoicing (factura electrónica), support documents, credit/debit notes, POS equivalente electrónico
- **Pricing**: From COP 89,900/month

#### Alegra POS

- **Strength**: Cloud-first, LatAm multi-country (Colombia, Mexico, Dominican Republic, etc.)
- **Features**: POS, invoicing, inventory, expenses, contacts, reports, multi-store
- **Fiscal**: Electronic invoicing for Colombia, Mexico, and other countries
- **Pricing**: From $10 USD/month

#### Treinta

- **Strength**: Mobile-first for micro-businesses in Colombia, free tier
- **Features**: Sales recording, expenses, debts tracking, inventory, customers, reports
- **Fiscal**: Basic Colombian compliance
- **Pricing**: Free base, paid from COP 49,900/month

**Key insight for Colombia market**: Siigo and Alegra own the compliance story. Puntovivo must implement DIAN electronic POS document (documento equivalente POS electrónico) and eventually full electronic invoicing to be competitive in Colombia.

### 2.4 Competitive Feature Summary Matrix

| Feature Category | Square | Shopify | Lightspeed | Toast | Loyverse | Odoo | ERPNext | Siigo | Puntovivo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Core POS/Checkout | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Yes** |
| Offline Mode | Limited | Limited | No | No | Yes | No | Yes | No | **Yes (strong)** |
| Desktop Native | No | No | No | No | No | No | No | No | **Yes (unique)** |
| Open Source | No | No | No | No | No | Community | Yes | No | **Yes** |
| Multi-Location | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Partial** |
| Product Variants | Yes | Yes | Yes | Yes | No | Yes | Yes | No | **No** |
| Serial/Lot/Batch | No | No | Yes | No | No | Yes | Yes | No | **No** |
| Expiry Tracking | No | No | No | No | No | Yes | Yes | No | **No** |
| Bundles/Kits | No | Yes | Yes | No | No | Yes | Yes | No | **No** |
| Cash Management | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **No** |
| Split Payments | Yes | Yes | Yes | Yes | No | Yes | Yes | No | **No** |
| Gift Cards | Yes | Yes | Yes | Yes | No | Yes | No | No | **No** |
| Store Credit | Yes | Yes | Yes | No | No | Yes | No | No | **No** |
| Loyalty Program | Yes | Apps | Yes | No | Paid | Yes | Yes | No | **No** |
| Promotions/Coupons | Yes | Yes | Yes | Yes | No | Yes | Yes | No | **No** |
| Quotations | No | No | Yes | No | No | Yes | Yes | Yes | **No** |
| Employee Time Track | Yes | No | Yes | Yes | Yes | Yes | No | No | **No** |
| Commissions | No | No | Yes | No | No | Yes | No | No | **No** |
| Kitchen Display (KDS) | Yes | No | No | Yes | No | Yes | No | No | **No** |
| Table Management | Yes | No | No | Yes | No | Yes | No | No | **No** |
| Pick/Pack/Ship | No | Yes | No | No | No | Yes | Yes | No | **No** |
| Delivery Management | Yes | Yes | No | Yes | No | Yes | Yes | No | **No** |
| Purchase Orders | Yes | Yes | Yes | No | Yes | Yes | Yes | Yes | **Yes** |
| Landed Cost | No | No | Yes | No | No | Yes | Yes | No | **No** |
| Supplier Invoices/3-Way Match | No | No | No | No | No | Yes | Yes | Yes | **No** |
| Multi-Currency | No | Yes | Yes | No | No | Yes | Yes | No | **No** |
| Accounting Integration | Apps | Apps | Yes | Apps | Apps | Built-in | Built-in | Built-in | **No** |
| Electronic Invoicing (Colombia) | No | No | No | No | No | Community | Community | **Yes** | **No** |
| API/Webhooks | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Limited | **No** |
| App Marketplace | Yes | Yes | Yes | Yes | No | Yes | Yes | No | **No** |
| Reporting/BI | Strong | Strong | Strong | Strong | Basic | Strong | Strong | Moderate | **Basic** |
| Kiosk/Self-Service | Yes | No | No | Yes | No | Yes | No | No | **No** |

## 3. Academic and Industry Frameworks Analysis

### 3.1 Transaction Lifecycle (Quote → Order → Sale → Return → Credit Note)

**Academic basis**: Laudon & Laudon's "Management Information Systems", SAP SD module documentation, OASIS UBL (Universal Business Language).

The canonical transaction lifecycle follows a **document state machine** model:

- **Quote/Estimate**: Non-binding price commitment with validity period. No inventory reservation (optional soft reservations). Captures customer, line items, pricing snapshot, terms, and margin analysis.
- **Sales Order**: Binding commitment. Triggers inventory allocation (not decrement). This is the "demand signal" for ATP (Available-to-Promise) calculation. Supports partial fulfillment.
- **Sale/Invoice**: Revenue recognition event. Inventory decremented. Payment captured or accounts receivable created. Must be ACID-compliant (inventory decrement + payment capture + journal entry all succeed or all roll back).
- **Return**: Reversal document linked to original sale. Inventory conditionally incremented (defective items may go to quarantine location). Requires reason codes for analytics.
- **Credit Note**: Financial reversal instrument. May or may not accompany a physical return. Must reference original invoice for audit trail.

**Current repo status**: Sale and Return are implemented. Quote, Sales Order (customer-side), and Credit Note are missing.

### 3.2 Payment Processing Models

**Standard**: PCI DSS v4.0 (Payment Card Industry Data Security Standard).

- **Split Payments**: Single transaction settled across multiple tenders. System maintains tender collection where sum(tenders) >= total. Each tender type has different settlement characteristics.
- **Partial Payments / Layaway**: Creates accounts receivable with payment schedule. Track outstanding balance with aging reports (current, 30, 60, 90 days).
- **Installments**: Integration with financing providers or internal engine. Calculate interest, payment schedule, early payoff.
- **Credit Accounts / On-Account**: Customer has credit limit. Real-time credit checking against current exposure (open orders + unpaid invoices).
- **Deposits/Prepayments**: Partial payment securing a future order.

**Current repo status**: Basic payment capture exists. Split payments, partial payments, installments, credit accounts, and deposits are all missing.

### 3.3 Tax Calculation Models

**Standards**: OECD VAT/GST guidelines, Avalara/Vertex documentation, ISO 4217.

- **Tax-Inclusive (VAT)**: Displayed price includes tax. Tax = price - (price / (1 + rate)). Standard in EU, LatAm, most of world.
- **Tax-Exclusive (US Sales Tax)**: Tax added at point of sale. Complexity: nexus rules.
- **Multi-Tax / Compound Tax**: Multiple taxes applied in parallel or cascading. System needs a "tax group" concept.
- **Tax Exemptions**: Customer-level (resellers), product-level (food staples), transaction-level (diplomatic).

**Best practice**: Tax calculation should be an isolated engine or external service, because rules change frequently.

**Current repo status**: VAT rates and basic tax exist. Tax groups, compound tax, exemptions, and tax engine isolation are missing.

### 3.4 Discount and Promotion Engine

**Academic basis**: Nagle & Holden "Strategy and Tactics of Pricing", Blattberg & Neslin "Sales Promotion".

Required discount types:
- **Percentage**: Line or transaction level. Define pre/post-tax, compounding vs exclusive.
- **Fixed Amount**: Absolute reduction. Must prorate across line items for correct tax and return handling.
- **BOGO**: Conditional promotion (trigger condition + reward action). Handle edge: return of "bought" item keeping "free" item.
- **Tiered/Volume**: Price breaks at quantity thresholds. Incremental vs retroactive tiers.
- **Loyalty-Based**: Points earn/redeem. Separate subsystem with API.
- **Time-Based**: Happy hour, flash sales, scheduled promotions with start/end dates.
- **Customer-Group-Based**: Different pricing by customer segment.
- **Coupon/Voucher**: Single-use or multi-use codes with validation rules.

Promotion priority and stacking: Must define conflict resolution (best price for customer, best margin for business, or priority ordering). NRF recommends making stacking rules explicit and auditable.

**Current repo status**: Basic discounts at sale level. No promotion engine, no coupons, no loyalty, no time-based rules, no stacking logic.

### 3.5 Inventory Management Frameworks

**Academic basis**: Silver, Pyke & Peterson "Inventory and Production Management in Supply Chains", Stevenson "Operations Management".

#### Costing Methods
- **FIFO**: Assumes oldest inventory sold first. Maintain cost layers per receipt.
- **LIFO**: Newest sold first. Prohibited under IFRS, allowed under US GAAP.
- **Weighted Average Cost (WAC)**: Recalculated after each purchase. Most common in POS.
- **Specific Identification**: Each unit tracked by serial/lot with actual cost.

#### Inventory Intelligence
- **ABC Analysis**: Pareto classification (A=20% SKUs/80% revenue, B=30%/15%, C=50%/5%). Drives reorder and counting frequency.
- **Reorder Point**: ROP = (Avg Daily Demand x Lead Time) + Safety Stock.
- **Safety Stock**: Z x σ_d x √L (service level factor x demand std deviation x sqrt of lead time).
- **EOQ**: √(2DS/H) where D=annual demand, S=ordering cost, H=holding cost.
- **Cycle Counting**: Continuous audit by ABC class (A monthly, B quarterly, C annually). Blind counts preferred.
- **Dead Stock / Aging**: Buckets (0-30 current, 31-90 slow, 91-180 at risk, 180+ dead). Track carrying cost.
- **Sell-Through Rate**: Units Sold / (Units Sold + On Hand) x 100.
- **GMROI**: Gross Margin / Average Inventory Cost. Key productivity metric (>2.0 healthy).
- **Demand Forecasting**: Moving average, exponential smoothing (Holt-Winters), ARIMA/SARIMA, ML models.

**Current repo status**: Stock tracking and movement history exist. No costing method, no ABC analysis, no reorder points, no safety stock, no cycle counting, no dead stock analysis, no GMROI, no forecasting.

### 3.6 Procurement Best Practices

**Standard**: COSO framework, ISM (Institute for Supply Management).

Full lifecycle: **PR → RFQ → PO → Receipt → Invoice → 3-Way Match**

- **Purchase Requisition**: Internal request, approval by dollar threshold.
- **RFQ**: Sent to multiple vendors, comparison matrix.
- **Purchase Order**: Binding commitment. Partial receipts and tolerances.
- **Goods Receipt**: Physical receiving. Quality inspection. Inventory increment.
- **3-Way Match**: PO vs Receipt vs Vendor Invoice. Discrepancies trigger exceptions.
- **Landed Cost**: Purchase price + freight + insurance + customs + handling. Allocate by value, weight, volume, or quantity.
- **Vendor Rating**: Weighted scorecard (quality, delivery, price, service, stability).
- **Blanket Orders**: Long-term agreements with scheduled releases.

**Current repo status**: PO and receipt exist. RFQ, 3-way match, landed cost, vendor rating, blanket orders are missing.

### 3.7 Cash Management Framework

**Industry standard from Revel Systems, Square, and retail operations literature**:

- **Cash Session Model**: Open (assign float + denomination count) → Operate (track all cash movements) → Close (count and reconcile).
- **Blind Close**: Cashier counts without seeing expected amount. Preferred for internal control.
- **Denomination Counting**: Bills and coins counted by type. Enables change order preparation.
- **Cash Float**: Standardized starting amount with defined denomination breakdown.
- **Mid-Shift Operations**: Skim (cash drop to safe when drawer exceeds threshold), replenishment (add change).
- **Over/Short Tracking**: Per cashier, over time. Pattern analysis for theft/error detection.
- **Multi-Register**: Each register has its own session. Cashier may transfer between registers.

**Current repo status**: Completely missing. This is the highest-priority commercial gap for Colombia/LatAm.

### 3.8 Employee Management

**Academic basis**: Sandhu et al. "Role-Based Access Control Models" (ACM Computing Surveys).

- **RBAC**: Users → Roles → Permissions. Hierarchical roles with inheritance. Constrained RBAC for separation of duties.
- **Shift Management**: Clock in/out, break tracking, scheduling, swap requests, overtime calculation.
- **Commission Tracking**: Flat rate, percentage, tiered, product-specific, team vs individual. Clawback on returns.
- **Performance Metrics**: Sales per hour, average transaction value, items per transaction, conversion rate, returns rate per employee.
- **Audit Trail**: Every action logs user, timestamp, terminal. Voids and modifications preserve originals. Manager overrides record both users.

**Current repo status**: Basic RBAC exists. Shift management, commissions, performance metrics, and action-level audit trail are missing.

### 3.9 Reporting and Business Intelligence

**Academic basis**: Kimball & Ross "The Data Warehouse Toolkit", Few "Information Dashboard Design", NRF/RILA publications.

Essential KPIs by category:

**Sales**: Sales per sq ft, average transaction value (ATV), basket size, units per transaction, conversion rate, comparable store sales, gross margin.
**Inventory**: GMROI, turnover, days of supply, stockout rate, shrinkage rate.
**Customer**: Customer acquisition cost, lifetime value (CLV), retention rate, NPS.
**Operational**: Labor cost % of sales, average wait time, returns rate.

Dashboard types:
- **Executive**: Revenue, margin, comp sales, top/bottom performers, trend sparklines.
- **Operational**: Hourly sales curve, transactions per hour, staffing, inventory alerts.
- **Exception-Based**: Anomaly highlighting (void rate spikes, cash variances, sudden conversion drops).
- **Drill-Down**: Summary → detail navigation.

**Current repo status**: Basic dashboard with revenue KPIs exists. Most advanced KPIs, drill-down, exception-based alerting, and BI depth are missing.

### 3.10 Multi-Store/Enterprise Patterns

**Academic basis**: Mintzberg "Structure in Fives".

- **Hierarchy**: Organization → Region → District → Store → Register. Config inheritance with override at each level.
- **Centralized vs Decentralized**: Core assortment centralized, local adjustments within guardrails.
- **Inter-Store Transfers**: Two-step posting (ship from source, receive at destination). In-transit as distinct state.
- **Price Book Management**: Master price book + location-specific overrides + customer-specific pricing + effective dates.
- **Consolidated Reporting**: Roll-up, benchmarking, inter-company elimination.

**Current repo status**: Sites exist but no hierarchy, no transfer workflow, no price books, no consolidated reporting beyond basic multi-site.

### 3.11 Multi-Vertical Adaptability — Deep Analysis

**Academic basis**: Clements & Northrop "Software Product Lines: Practices and Patterns".

Puntovivo aims to serve multiple business types from a single codebase: tiendas, supermercados, farmacias, ferreterías, retail especializado, restaurantes, and more. This requires a deliberate product-line architecture, not just feature accumulation.

#### 3.11.1 Vertical-Specific Requirements Summary

| Business Type | Key Differentiators (Beyond Generic POS) |
| --- | --- |
| **Retail General** | Barcode scanning, variant management (size/color matrix), returns, gift registry, loyalty, layaway, consignment |
| **Fashion/Apparel** | Size/color matrix, style numbers, season management, markdown scheduling by age, lookbook/outfit cross-sell |
| **Electronics** | Per-unit serial tracking, warranty management, extended warranty sales, repair/service tracking, trade-in programs |
| **Supermarket/Grocery** | Weighing scale integration, PLU codes, variable-weight barcodes (GS1 DataBar), perishable FEFO, fresh department production/shrink, DSD receiving, age-restricted product controls, multi-department reporting, loyalty cards, self-checkout |
| **Pharmacy** | Controlled substance tracking (Resolución 1478), prescription management, lot/batch traceability, expiry/FEFO, INVIMA Registro Sanitario, SISMED reporting, EPS billing/RIPS, regulated pricing ceilings (CNPMDM), generic substitution, patient medication history, drug interaction alerts, cold chain flags |
| **Hardware Store (Ferretería)** | Fractional unit sales (by meter/kg/liter), cut-to-size service charges, unit conversion (sheets↔m², rolls↔linear m), project quoting, contractor credit accounts (30/60/90 days), special orders/back-orders, product cross-reference/compatibility, technical specs as attributes, bulk pricing/quantity breaks, in-house barcode generation, partial-use returns, high-SKU search optimization |
| **Restaurant** | Table management, floor plan, KDS with multi-station routing, course firing, modifiers, split checks, tips (propina voluntaria), tab management, combo/meal deal engine, daypart menus, delivery aggregator integration (Rappi/iFood/Uber Eats/PedidosYa), waste tracking vs theoretical food cost, recipe costing/BOM, allergen tracking, QR ordering, impuesto al consumo 8%, kitchen printer routing by station, delivery zones |
| **Services** | Appointment scheduling, calendar with employee lanes, duration tracking, staff assignment, consumable tracking, recurring appointments |
| **Wholesale/B2B** | Customer-specific pricing, credit terms and aging, large quantities, pallet units, tax-exempt customers, EDI, RFQ workflows, blanket orders |
| **Pet Store** | Pet profiles linked to customer, recurring purchase reminders, grooming scheduling, loyalty tied to pet |
| **Optical/Eyewear** | Prescription management (optical Rx), lens customization orders, insurance billing, repair services |
| **Jewelry** | Consignment tracking, appraisal management, custom order management, precious metal weight, certification records (GIA, etc.) |

#### 3.11.2 Architecture Patterns for Multi-Vertical (Research Findings)

**How competitors handle it**:

- **Odoo**: Module-based architecture. Core POS is one module; restaurant mode, loyalty, etc. are separate installable modules. Each module adds its own models, views, and business logic. Feature activation is per-database (company). Odoo uses a manifest file (`__manifest__.py`) per module declaring dependencies.
- **Square**: Separate products — Square for Retail and Square for Restaurants are different apps sharing a common payment/customer backend. UI and workflows are distinct.
- **Lightspeed**: Separate products — Lightspeed Retail (X-Series) and Lightspeed Restaurant (L-Series) are completely different codebases with different feature sets.
- **Loyverse**: Single app with feature toggles. Restaurant-specific features (tables, KDS) are activated via settings. Simpler approach, fewer verticals.
- **Toast**: Restaurant-only. Deep vertical focus rather than multi-vertical.

**Recommended pattern for Puntovivo** (configuration-driven module activation):

1. **Module Registry**: A `modules` table where each tenant/site activates specific feature modules (`pharmacy`, `restaurant`, `hardware_store`, `supermarket`, etc.). Each module unlocks specific UI routes, checkout behaviors, product attributes, and reports.

2. **JSON Metadata Columns**: Instead of EAV (too complex, poor query performance in SQLite), use typed JSON columns on core entities for vertical-specific attributes. Example: `products.vertical_metadata` stores `{ "registro_sanitario": "...", "controlled_schedule": "II", "inn_dci": "..." }` for pharmacy, or `{ "voltage": "110V", "thread_type": "M6" }` for hardware.

3. **Configurable Checkout Flows**: The POS checkout component reads module flags to determine behavior — show table selector (restaurant), require prescription (pharmacy), read scale (supermarket), allow fractional quantities (hardware store).

4. **Vertical-Specific Role Templates**: Pre-configured role profiles per vertical — `pharmacist` role with controlled-substance access, `waiter` role with table/course actions, `cashier` with standard POS.

5. **Template-Based Documents**: Receipt templates, labels, and reports configurable per module. Pharmacy receipts include lot/expiry and Registro Sanitario. Restaurant receipts include table/covers and propina. Hardware store receipts include cut-to-size details.

6. **Module-Conditional Navigation**: Sidebar items, dashboard widgets, and settings pages conditionally rendered based on active modules. A pharmacy sees "Prescriptions" and "Controlled Substances" in the sidebar; a hardware store sees "Project Quotes" and "Contractor Accounts".

**Current repo status**: No module activation system. No vertical-specific product attributes. No configurable checkout flows. The codebase is retail-focused with generic POS capabilities. Phase 0 in the roadmap now includes `DB-004` (module activation table) and `API-004` (module registry), which are the foundation for multi-vertical.

#### 3.11.3 Pharmacy Vertical — Detailed Gap Analysis

The pharmacy vertical is uniquely demanding because of heavy regulation. Colombia's pharmaceutical regulatory framework creates features that are **legally required to operate**, not just competitive advantages.

| # | Feature | Regulation | Legal Req? | Effort | Priority |
| --- | --- | --- | --- | --- | --- |
| P-1 | Lot/batch tracking + expiry/FEFO | Resolución 1403/2007, BPM | Yes | Moderate | Critical |
| P-2 | INVIMA Registro Sanitario on products | Decreto 677/1995 | Yes | Low | Critical |
| P-3 | Regulated price ceiling enforcement | CNPMDM Circulares | Yes | Moderate | Critical |
| P-4 | Prescription management (Rx capture, partial dispensing, validity) | Decreto 2200/2005 | Yes (for Rx) | High | Critical |
| P-5 | Controlled substance tracking + FNE monthly report | Resolución 1478/2006, Resolución 315/2020 | Yes | High | Critical |
| P-6 | Patient prescription history (historia farmacoterapéutica) | Decreto 2200/2005 | Yes (full-service) | Moderate | High |
| P-7 | EPS billing + RIPS generation | Resolución 3374/2000 | Yes (EPS contracts) | High | High |
| P-8 | SISMED price reporting | Resolución 4002/2007 | Yes | Moderate | High |
| P-9 | Generic substitution suggestions (INN/DCI grouping) | Decreto 2200/2005, Circular 04/2006 | Encouraged | Moderate | Moderate |
| P-10 | Cold chain product flags + storage zone tracking | Resolución 1403/2007, BPA | Yes | Low | Moderate |
| P-11 | Pharmaceutical returns + INVIMA recall management | Decreto 677/1995 | Yes | Moderate | Moderate |
| P-12 | Drug interaction alerts | Ley 212/1995 (professional) | Professional duty | High | Low-Moderate |

**Key competitors**: Logifarma (full pharma workflow, FNE, RIPS, SISMED), Infoware Farmacias (strong inventory/lot), DrugStore (Rx + EPS), Siigo Farmacia (accounting backbone but weak on pharma-specific features).

**Market opportunity**: No modern, offline-capable, open-source pharmacy POS exists in Colombia. Legacy systems (Logifarma, Infoware) have outdated UIs and on-premise limitations.

#### 3.11.4 Supermarket/Grocery Vertical — Detailed Gap Analysis

| # | Feature | Priority | Effort | Notes |
| --- | --- | --- | --- | --- |
| S-1 | Weighing scale integration (serial RS232, USB HID) | Critical | High | Toledo, CAS, Mettler Toledo protocols. POS sends "request weight" → scale responds. Requires `serialport` npm in Electron main process. |
| S-2 | PLU code management + variable-weight barcodes (GS1 DataBar) | Critical | Moderate | Barcode format: prefix (2x) + PLU (5 digits) + weight/price (5 digits) + check digit. Must parse embedded price/weight from scanned barcode. |
| S-3 | Perishable inventory management (FEFO, use-by dates, automated markdowns) | Critical | Moderate | Shared with pharmacy (lot/batch/expiry). Automated markdown rules near expiry. |
| S-4 | Age-restricted product controls | High | Low | Flag on product, prompt at POS for ID verification. Colombian law: alcohol 18+, tobacco 18+. |
| S-5 | Multi-department reporting + P&L by department | High | Moderate | Department hierarchy on products/categories. Gross margin by department. |
| S-6 | Fresh department management (bakery, deli, meat) | Moderate | Moderate | Production tracking, shrink by department (theft, damage, spoilage, admin error), yield tracking. |
| S-7 | DSD (Direct Store Delivery) receiving | Moderate | Moderate | Vendor delivers directly to shelf (Coca-Cola, Postobón, etc.). Separate receiving workflow bypassing warehouse. |
| S-8 | Promotional flyer/circular management with auto price activation | Moderate | Moderate | Scheduled promotions with start/end dates, automatic price changes. Shared with promotions engine (Phase 7). |
| S-9 | Vendor-funded promotions and rebate tracking | Moderate | Moderate | Track promotional allowances from suppliers, apply at POS, reconcile rebates. |
| S-10 | Shelf label printing + electronic shelf labels | Moderate | Moderate | ZPL barcode labels per product/location. ESL via API integration (SoluM, Hanshow). |
| S-11 | Self-checkout / express lane | Low | High | Simplified UI for customer-facing mode. Requires significant UX work. |
| S-12 | Customer-facing display | Low | Moderate | Second screen showing cart items, totals, and advertising. Electron can manage dual screens. |
| S-13 | Colombian specifics: IVA categories (0%, 5%, 19% for food), bolsa plástica tax, impuesto saludable (sugary drinks/ultra-processed 2023+) | High | Moderate | Tax group system needed. Bolsa plástica: COP $90/bag (2026). Impuesto saludable: 15%→20% in 2025. |

**Key competitors for supermarket**: Caja Registradora (Colombia-local), Loggro, SAP Business One (large chains: Éxito, Olímpica, Jumbo use enterprise systems), Odoo with supermarket modules.

#### 3.11.5 Hardware Store (Ferretería) Vertical — Detailed Gap Analysis

| # | Feature | Priority | Effort | Notes |
| --- | --- | --- | --- | --- |
| H-1 | Fractional unit sales (by meter, kg, liter, etc.) | Critical | Moderate | Current system has units but needs decimal quantity support in checkout with arbitrary precision. Cable by the meter, paint by the liter, wood by board-foot. |
| H-2 | Unit conversion management (sheets↔m², rolls↔linear m, bags↔kg) | Critical | Moderate | Product has a "purchase unit" and one or more "sale units" with conversion factors. Buy a roll of 100m, sell by the meter. |
| H-3 | In-house barcode generation | High | Low | Many ferretería products lack manufacturer barcodes. Auto-generate internal barcodes (EAN-13 with in-house prefix) and print via label printer. |
| H-4 | Bulk pricing / quantity breaks | High | Moderate | Price tiers: 1-9 units = $X, 10-49 = $Y, 50+ = $Z. Automatic tier application at POS based on line quantity. Can extend existing multi-tier pricing. |
| H-5 | Contractor/professional credit accounts (30/60/90 days) | High | Moderate | Credit limit, terms, aging report. Shared with customer credit accounts (Phase 5, DB-403). Colombian ferreterías heavily depend on contractor credit. |
| H-6 | Project/job quoting | High | Moderate | Customer brings a project list → staff builds a quote with materials, quantities, prices. Shared with quotations module (Phase 5). Needs "project template" concept (bathroom kit, kitchen kit). |
| H-7 | Cut-to-size services and service charges | Moderate | Low | Add service line items to sale (pipe cutting, glass cutting, wood cutting). Service charges on receipt. |
| H-8 | Product technical specifications as searchable attributes | Moderate | Moderate | Voltage, amperage, diameter, thread type, material, color, length, etc. Needed for staff product lookup ("I need a 3/8 galvanized screw"). JSON metadata column + search index. |
| H-9 | Special orders / back-orders for non-stock items | Moderate | Moderate | Customer orders a product not in stock → create special order → link to PO when ordered → notify customer on arrival. |
| H-10 | Returns with partial use | Moderate | Low | Customer bought 10m of cable, used 7m, returns 3m. System must accept partial-quantity returns and restock the returned portion. |
| H-11 | Product cross-reference / compatibility | Low | Moderate | "Which screws fit this anchor?" Compatibility groups or related products. |
| H-12 | High-SKU search optimization | Moderate | Moderate | Ferreterías typically have 10,000-50,000 SKUs. Fast fuzzy search, search by partial name, by code, by technical spec. SQLite FTS5 full-text search index. |

**Key competitors for ferretería**: ManagementPro (Mexico, specialized), POS Ferretería (posferreteria.com, Colombia), Alegra POS (generic), World Office, Siigo.

**Market insight**: Most Colombian ferreterías use basic systems or paper. A modern offline-capable POS with fractional units, contractor credit, and project quoting would be highly differentiated.

#### 3.11.6 Restaurant/Food Service Vertical — Detailed Gap Analysis (Beyond Phase 12)

Phase 12 in the current roadmap covers the basics (tables, KDS, modifiers, tips, appointments). The following are deeper restaurant-specific gaps identified through research:

| # | Feature | Priority | Effort | Notes |
| --- | --- | --- | --- | --- |
| R-1 | Multi-station kitchen routing (grill, fryer, bar, dessert, prep) | Critical | Moderate | Each product or modifier group routes to a specific kitchen station/printer. Not just one KDS — multiple screens per kitchen area. |
| R-2 | Impuesto al consumo 8% (Colombian restaurant consumption tax) | Critical | Moderate | **NOT additive to IVA — it REPLACES IVA for restaurants**. Restaurants above ~3,500 UVT income charge 8% consumption tax instead of 19% IVA on prepared food/beverages. Tax base EXCLUDES tips. Non-creditable (unlike IVA). Mixed establishments (grocery + prepared food) must handle both tax types on the same receipt. Requires tax type discriminator on products (IVA vs CONSUMO, mutually exclusive). |
| R-3 | Combo/meal deal pricing engine | High | Moderate | "Almuerzo ejecutivo" / "Combo #1" with component selection. Price != sum of components. Customer selects options within groups (choose drink, choose side). |
| R-4 | Delivery aggregator integration (Rappi, iFood, PedidosYa, Uber Eats) | High | High | Receive orders via webhooks, auto-create kitchen orders, update status back. Consider third-party aggregator middleware (Deliverect, GetOrder) to avoid 4 separate integrations. |
| R-5 | Tab management with pre-authorization holds | High | Moderate | Open a tab → run up charges → close with payment. Bar/lounge workflow. Optional credit card pre-auth hold. |
| R-6 | Menu versioning / daypart management | Moderate | Moderate | Different menus for breakfast/lunch/dinner. Products visible/available based on time of day. Automatic menu switching. |
| R-7 | Waste tracking: theoretical vs actual food cost | Moderate | Moderate | Track waste events (spoilage, overcooking, spills). Compare actual cost vs theoretical (recipe cost × units sold). Food cost variance report. |
| R-8 | Allergen tracking and dietary flags | Moderate | Low | Product attributes: gluten, dairy, nuts, shellfish, vegan, etc. Display on KDS and optionally on customer-facing menus/QR ordering. |
| R-9 | Propina (tip) handling — **Ley 1935 de 2018 compliance** | **Critical** (legal) | Moderate | Tips are ALWAYS voluntary by law. POS MUST present a consent dialog ("¿Desea incluir la propina voluntaria del 10%? Sí / No / Otro valor"). Suggested amount CANNOT exceed 10%. Tips MUST be distributed among ALL workers (not just waiters) within 1 month. Tips are NOT revenue (no IVA, no INC, no withholding). Tips MUST appear as separate line item excluded from tax base. SIC (Superintendencia de Industria y Comercio) supervises compliance — violations sanctioned under Ley 1480. In electronic invoice XML, tip is a distinct concept, not part of tax base. |
| R-10 | Delivery zone management with minimums | Moderate | Moderate | Define zones by neighborhood/polygon, set minimum order amounts, delivery fees, estimated times per zone. |
| R-11 | Reservations and waitlist management | Low | Moderate | Calendar-based table reservations, walk-in waitlist with estimated wait times, SMS/WhatsApp notification when table ready. |
| R-12 | Drive-through workflows | Low | Moderate | Order at window → prepare → deliver at pickup window. Specialized queue view. Low priority for Colombian market. |
| R-13 | Catering / event orders | Low | Moderate | Large advance orders with deposits, special menus, delivery logistics. Shared with quotation module. |

#### 3.11.7 General Retail Sub-Verticals — Cross-Cutting Gap Analysis

| # | Feature | Sub-Verticals That Need It | Priority | Effort |
| --- | --- | --- | --- | --- |
| GR-1 | Product variants (size/color matrix) | Fashion, footwear, electronics | Critical | High (already in Phase 6) |
| GR-2 | Serial number tracking per unit | Electronics, appliances, jewelry | High | High (already in Phase 6) |
| GR-3 | Warranty management + extended warranty sales | Electronics, appliances | High | Moderate |
| GR-4 | Layaway with payment schedules | All retail | High | Moderate (already in Phase 5) |
| GR-5 | Consignment vendor management | Jewelry, boutiques, art galleries | Moderate | Moderate |
| GR-6 | Trade-in / buy-back programs | Electronics, jewelry, automotive parts | Moderate | Moderate |
| GR-7 | Gift registry / wish lists | All retail, especially jewelry, baby stores | Low | Moderate |
| GR-8 | Rental management (tools, equipment, costumes) | Hardware, party supplies, equipment | Low | High |
| GR-9 | Season/collection management with markdown scheduling | Fashion, footwear | Moderate | Moderate |
| GR-10 | Product personalization/engraving service charges | Jewelry, gifts | Low | Low |
| GR-11 | Retención en la fuente at POS | All B2B retail (Colombia) | High | Moderate |
| GR-12 | Rete-IVA and Rete-ICA handling | All B2B retail (Colombia) | High | Moderate |
| GR-13 | Régimen responsable vs no responsable de IVA | All retail (Colombia) | Critical | Low |
| GR-14 | Documento Soporte (purchases from non-invoicers) | All retail (Colombia) | High | Moderate |
| GR-15 | **Layaway / Apartado** (payment schedules, inventory reservation) | ALL retail (deeply embedded LatAm purchasing pattern) | **Critical** | High |
| GR-16 | Customer special orders with deposits | All retail (electronics, furniture, optical, jewelry) | High | Moderate |
| GR-17 | Repair/service ticket management | Electronics, optical, jewelry, cell phones | High | High |
| GR-18 | Company-level fiscal regime classification (Responsable IVA, Gran Contribuyente, Régimen Simple) | All Colombian businesses | **Critical** | Low |

#### 3.11.8 Colombian Fiscal/Tax Gaps Across All Verticals

Several tax-related gaps apply to ALL business types operating in Colombia:

| # | Feature | Applies To | Legal Status | Priority |
| --- | --- | --- | --- | --- |
| T-1 | Tax groups (IVA 0%, 5%, 19% + impuesto al consumo 8% + impuesto saludable 15-20%) | All | Required | Critical |
| T-2 | Tax type discriminator per product: IVA vs CONSUMO (mutually exclusive for restaurants — restaurants charge 8% INC, NOT 19% IVA) | Restaurants, mixed establishments | Required | Critical |
| T-3 | Retención en la fuente (income withholding at source) | B2B transactions | Required | High |
| T-4 | Rete-IVA (VAT withholding) | B2B, specific regimes | Required | High |
| T-5 | Rete-ICA (industry/commerce tax withholding) | B2B, municipality-specific | Required | Moderate |
| T-6 | Tax-exempt customers (diplomats, special entities) | All | Required | Moderate |
| T-7 | Impuesto saludable (sugary drinks 15%→20%, ultra-processed 10%→15%→20%) | Supermarkets, tiendas | Required since 2023 | High |
| T-8 | Bolsa plástica tax (COP $90/bag in 2026) | Supermarkets, retail | Required | Moderate |
| T-9 | Documento Soporte Electrónico (purchases from non-invoicers) | All | Required | High |
| T-10 | GMF (4x1000 financial transaction tax) awareness in payment reconciliation | All | Awareness | Low |

#### 3.11.9 Cross-Vertical Feature Dependency Map

Many vertical-specific features share underlying platform capabilities:

| Platform Capability | Verticals That Need It | Phase |
| --- | --- | --- |
| Module activation system | ALL | Phase 0 |
| JSON metadata columns on products | Pharmacy, hardware, electronics, restaurant | Phase 0 |
| Tax groups (compound/multi-tax) | ALL Colombian businesses | Phase 0 or Phase 1 |
| Lot/batch/expiry tracking | Pharmacy, supermarket, food | Phase 6 |
| Fractional quantity support in checkout | Hardware store, supermarket (by weight) | Phase 1 addon |
| Customer credit accounts | Hardware store (contractors), B2B, jewelry | Phase 5 |
| Quotations | Hardware store (projects), B2B, jewelry (custom orders) | Phase 5 |
| Recipe/BOM | Restaurant, bakery, production | Phase 6 |
| Weighing scale integration | Supermarket, bulk retail | Phase 6 addon |
| Prescription/Rx management | Pharmacy, optical | Pharmacy module |
| Table management + KDS | Restaurant | Phase 12 |
| Appointment scheduling | Services, pet grooming, optical | Phase 12 |
| Promotions engine | ALL | Phase 7 |
| Serial number tracking | Electronics, jewelry, appliances | Phase 6 |

**Key insight**: The vertical modules are mostly compositions of shared platform capabilities, NOT entirely separate feature sets. The most effective strategy is to build the platform capabilities in the right order, then compose vertical-specific modules that activate and configure those capabilities.

#### 3.11.10 Recommended Module Directory Structure

```text
packages/server/src/modules/
  core/              -- shared: products, sales, inventory, customers (always active)
  restaurant/        -- tables, floors, kitchen orders, courses, tips, combos
    router.ts        -- tRPC procedures for restaurant module
    schema.ts        -- restaurant-specific table definitions
    service.ts       -- business logic
  pharmacy/          -- Rx, controlled substances, RIPS, SISMED, FNE, lot FEFO
    router.ts
    schema.ts
    service.ts
  ferreteria/        -- unit conversion, project quoting, cut-to-size, FTS5 search
    router.ts
    schema.ts
    service.ts
  supermarket/       -- scale integration, PLU, DSD receiving, perishable markdowns
    router.ts
    schema.ts
    service.ts
```

Each module exports:
- A tRPC router creator that gets composed into the main router
- Schema definitions (DDL) that get created when the module is activated
- A capabilities declaration (what boolean flags this module enables)
- Default configuration (categories, roles, receipt templates)

#### 3.11.11 Checkout Pipeline Pattern

The checkout screen diverges the most across verticals. Use a configurable step pipeline:

| Vertical | Checkout Pipeline |
| --- | --- |
| **Retail** | Scan Items → Review Cart → Select Payment → Process → Print Receipt |
| **Supermarket** | Scan/Weigh Items → Review Cart → Bag Count → Select Payment → Process → Print Receipt |
| **Pharmacy** | Scan Items → Link Prescription → Verify Lot → Controlled Substance Check → Review → Payment → Print → Patient Counseling |
| **Ferretería** | Scan/Measure Items → Unit Selection → Review Cart → Service Charges → Payment → Print |
| **Restaurant** | Select Table → Take Order → Send to Kitchen → (serve) → Split Check → Add Tip → Payment → Print |

Each step is a lazy-loaded React component. The active vertical determines which pipeline executes. Non-active vertical steps never get bundled.

#### 3.11.12 Implementation Priority for Multi-Vertical Foundation

| Item | Impact | Effort | Priority |
| --- | --- | --- | --- |
| `vertical` field on sites | High | Low | **P0** |
| JSON `metadata` on products | High | Low | **P0** |
| `SiteCapabilities` React Context | High | Medium | **P0** |
| Tax group engine (compound tax) | High | Medium | **P0** |
| Capability-filtered sidebar navigation | Medium | Low | **P1** |
| Checkout step pipeline | High | Medium | **P1** |
| Receipt template registry | Medium | Medium | **P1** |
| Module directory structure (server) | High | Medium | **P1** |
| tRPC router composition per module | High | Medium | **P2** |
| Dashboard widget registry per module | Medium | Medium | **P2** |
| Lazy loading per module (React.lazy) | Medium | Low | **P2** |
| Module-aware DDL migrations | Medium | High | **P3** |
| Setup wizard per vertical | High | High | **P3** |
| SQLite generated columns + indexes on JSON metadata | Medium | Low | **P3** |

### 3.12 Credit Sales (Ventas a Crédito) — Analysis and Design

#### 3.12.1 Business Model

A credit sale allows a customer to take goods immediately but pay later — partially or in full — under a documented payment agreement. In Latin American retail this is a widespread and deeply embedded commercial practice, especially in hardware stores (ferreterías), pharmacies, and wholesale/B2B contexts.

Key concepts:

- **Venta a crédito**: The merchant sells goods without collecting the full amount at the time of the transaction. The outstanding balance becomes an account receivable.
- **Cuotas (installments)**: The outstanding balance is divided into a fixed number of periodic payments (usually monthly) on pre-agreed due dates.
- **Cuota inicial / Enganche**: The upfront payment at the time of sale. Can be 0% (no payment required) up to any agreed percentage. The minimum is configurable per tenant, company, or store.
- **Abono**: A partial payment posted against an existing credit invoice. The customer can walk into the store and pay any amount at any time — not necessarily aligned to the installment schedule. An abono reduces the outstanding balance and is applied against one or more pending installments.
- **Tasa de interés**: Credit may be interest-free (0%) or carry a monthly interest rate. The platform must compute and display the effective total cost of credit (TEC) for informed consent.
- **Saldo vencido (overdue balance)**: When installments are not paid by their due date (plus any grace period), the balance transitions to overdue. Overdue balances may accrue additional interest (mora) depending on the configured policy.

This is distinct from the `customer_credit_accounts` concept (Phase 5, DB-403 / API-403), which is a revolving credit account (running tab model). Credit sales are per-invoice credit agreements with explicit installment schedules tied to a specific sale document.

#### 3.12.2 Configuration Model

Credit sales behavior is configurable at three levels (most specific wins):

```
Tenant (company_id)
  └─ Company (companies.id)
       └─ Site (sites.id)
```

Configuration parameters:

| Parameter | Type | Description |
| --- | --- | --- |
| `credit_sales_enabled` | boolean | Master switch — credit sales allowed at this level |
| `min_downpayment_pct` | integer 0–100 | Minimum upfront payment percentage (0 = no payment required) |
| `max_credit_days` | integer | Maximum days a credit sale can remain open (e.g., 90) |
| `max_installments` | integer | Maximum number of installments allowed (e.g., 12) |
| `interest_rate_monthly_pct` | decimal | Monthly interest rate (0 = interest-free) |
| `mora_rate_daily_pct` | decimal | Daily interest rate for overdue installments |
| `require_approval_above_amount` | decimal | Amounts above this threshold require manager approval |
| `max_credit_per_customer` | decimal | Global outstanding credit ceiling per customer |
| `grace_period_days` | integer | Days after due date before installment becomes overdue |
| `allow_abono_any_amount` | boolean | Whether customers can pay arbitrary amounts (abonos) |
| `require_customer_id` | boolean | Whether a credit sale requires a fully-identified customer |

#### 3.12.3 Data Model

```
company_credit_settings
  company_id (FK, nullable — null = tenant-level default)
  site_id (FK, nullable — null = applies to all sites in company)
  credit_sales_enabled
  min_downpayment_pct
  max_credit_days
  max_installments
  interest_rate_monthly_pct
  mora_rate_daily_pct
  require_approval_above_amount
  max_credit_per_customer
  grace_period_days
  allow_abono_any_amount
  require_customer_id

credit_sales
  id
  sale_id (FK → sales — the original POS transaction)
  customer_id (FK → customers, non-nullable for credit sales)
  total_amount
  downpayment_amount (collected at time of sale)
  outstanding_balance (computed: total - downpayment - sum of payments)
  interest_total (0 for interest-free)
  status [active | partially_paid | fully_paid | overdue | written_off | cancelled]
  approved_by (FK → users, nullable — required if above threshold)
  installment_count
  first_due_date
  created_at
  notes

credit_installments
  id
  credit_sale_id (FK)
  installment_number (1-based)
  due_date
  principal_amount
  interest_amount
  total_amount (principal + interest)
  outstanding_amount (initially = total_amount; decremented by abono applications)
  status [pending | partially_paid | paid | overdue | waived]
  paid_at (nullable)

credit_payments    ← this is an "abono"
  id
  credit_sale_id (FK)
  amount
  payment_method (cash | bank_transfer | card | etc.)
  reference (nullable — bank reference, voucher number)
  received_by (FK → users)
  received_at
  notes
  applied_installments JSON   ← [{installment_id, amount_applied}]
```

Abono application logic:
1. Payment is posted to `credit_payments`.
2. The amount is distributed across installments in chronological order (oldest pending first), unless the customer specifies a different application.
3. `credit_installments.outstanding_amount` decrements per installment; status transitions: `pending → partially_paid → paid`.
4. `credit_sales.outstanding_balance` recomputes after each payment.
5. Status transitions: `active → partially_paid` when any installment paid; `→ fully_paid` when balance reaches zero.

#### 3.12.4 Colombian Legal Context

- A "venta a crédito" in Colombia must be documented as a **Factura Electrónica de Venta** (not a DEE/POS document). The DEE (Documento Equivalente POS) is exclusively for cash transactions at the point of sale per DIAN Resolución 000202/2025. A credit sale with deferred payment is a factura, regardless of amount.
- The factura a crédito must include payment terms in the `cac:PaymentTerms` UBL element.
- Interest rates are bounded by the **Usury Rate** (*interés bancario corriente* + ceiling set quarterly by Superfinanciera de Colombia). Exceeding this is criminally penalized (Ley 599/2000 Art. 305).
- **Mora interest**: The default mora rate is the same as the agreed interest rate, unless a higher mora was explicitly contracted (Commercial Code Art. 884).
- The credit relationship between merchant and customer is governed by:
  - Código Civil Art. 1617 (mora y perjuicios)
  - Código de Comercio Art. 884 (interés mercantil)
  - Estatuto del Consumidor Ley 1480/2011 (retail credit disclosure obligations)
  - Decreto 4861/2008 and subsequent SFC circulares on consumer credit

#### 3.12.5 Implementation Scope in Puntovivo

Credit sales integrate with:
- **Phase 5** (payment method depth): credit sale creation, installment schedule, abono recording
- **Phase 11** (fiscal): credit sales generate factura electrónica (not DEE), so fiscal document generation must support credit payment terms in the UBL output
- **Phase 9** (reporting): accounts receivable aging, credit portfolio health, overdue alerts
- **Phase 7** (loyalty): credit history may inform customer segment or loyalty tier

---

### 3.13 Country-Parametrizable Fiscal Rules — Analysis and Design

#### 3.13.1 The Problem: Colombia-Hardcoded Fiscal Logic

The current codebase treats fiscal rules as Colombia-specific constants:

- **Tax rates**: IVA (0%, 5%, 19%), INC (8%), impuesto saludable, bolsa plástica — hardcoded Colombian DIAN codes
- **Propina (tip)**: Ley 1935/2018 — Colombian voluntary service charge law, consent dialog required, max 10% suggestion, excluded from tax base, mandatory worker distribution
- **Electronic invoicing**: DIAN DEE and factura electrónica, DIAN web service endpoints, CUFE/CUDE SHA-384
- **Fiscal regimes**: Responsable de IVA, No Responsable de IVA, Régimen Simple de Tributación, Gran Contribuyente — all Colombian DIAN regime codes
- **Withholding**: Retención en la fuente, autorretenedor, agente de retención — Colombian withholding framework
- **Municipal taxes**: ICA (Impuesto de Industria y Comercio) — Colombian only
- **Document types**: Factura Electrónica, DEE, Nota Crédito Electrónica — DIAN document taxonomy

If Puntovivo is deployed in Ecuador, Perú, Chile, Panamá, or any other country, all of this breaks or is irrelevant.

#### 3.13.2 Target Countries and Their Fiscal Profiles

| Country | VAT/GST | Consumption Tax | Electronic Invoicing | Special Rules |
| --- | --- | --- | --- | --- |
| **Colombia** | IVA 0%/5%/19% | INC 8% (restaurants), impuesto saludable | DIAN DEE + Factura Electrónica | Ley 1935 propina, retención, ICA |
| **Ecuador** | IVA 12% | ICE (selective consumption tax, variable) | SRI factura electrónica | Punto de emisión, CAF |
| **Perú** | IGV 18% | ISC (selective consumption) | SUNAT Factura Electrónica (CFDI-like) | Boleta de venta for retail |
| **Chile** | IVA 19% | — | SII Boleta Electrónica (mandatory 2024) | RUT, folio management |
| **México** | IVA 16% / 8% (border) | IEPS (fuel, alcohol, tobacco, sugary drinks) | SAT CFDI 4.0 | RFC, complementos |
| **Panamá** | ITBMS 7% | — | DGI Factura Electrónica | — |
| **Argentina** | IVA 21%/10.5%/2.7% | — | AFIP Comprobante Electrónico | Inscripción, categoría monotributo |
| **Venezuela** | IVA 16% | IGTF 3% (financial transactions) | SENIAT — | Multiple exchange rates |

#### 3.13.3 Proposed Architecture: Fiscal Profile System

**Core concept**: Replace hardcoded country-specific rules with a `country_fiscal_profiles` configuration table that defines all fiscal rules for a given country. The application's tax engine, tip dialog, electronic invoicing adapter, and document generation all read from the active profile.

**Profile selection**: determined by `companies.country_code` (already on the companies table).

**Profile schema** (stored as structured JSON columns in SQLite):

```json
{
  "tax_types": [
    {
      "code": "IVA",
      "name": "Impuesto al Valor Agregado",
      "rates": [0, 5, 19],
      "default_rate": 19,
      "applies_to": "all",
      "calculation_base": "net_price",
      "mutual_exclusion_group": null,
      "is_additive_with": ["INC", "BOLSA"]
    },
    {
      "code": "INC",
      "name": "Impuesto Nacional al Consumo",
      "rates": [8],
      "default_rate": 8,
      "applies_to": "prepared_food_services",
      "calculation_base": "net_price",
      "mutual_exclusion_group": "consumption_tax",
      "is_additive_with": []
    }
  ],
  "tip_rules": {
    "enabled": true,
    "label": "Propina",
    "max_suggested_pct": 10,
    "requires_consent_dialog": true,
    "consent_dialog_text": "La propina es voluntaria. ¿Desea agregar propina al servicio?",
    "excluded_from_tax_base": true,
    "distribution_required": true,
    "distribution_deadline_days": 30,
    "legal_reference": "Ley 1935/2018 Art. 1"
  },
  "electronic_invoicing": {
    "required": true,
    "provider_code": "DIAN",
    "adapter": "dian_colombia",
    "document_types": ["DEE", "INVOICE", "CREDIT_NOTE", "DEBIT_NOTE"],
    "pos_document_type": "DEE",
    "credit_sale_document_type": "INVOICE",
    "hash_algorithm": "SHA-384",
    "test_endpoint": "https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc",
    "prod_endpoint": "https://vpfe.dian.gov.co/WcfDianCustomerServices.svc",
    "legal_reference": "Resolución DIAN 000202/2025"
  },
  "withholding_rules": {
    "enabled": true,
    "types": [
      { "code": "RTEFUENTE", "name": "Retención en la Fuente", "applicable_to_regimes": ["GRAN_CONTRIBUYENTE"] }
    ]
  },
  "regime_types": [
    { "code": "RESPONSABLE_IVA", "name": "Responsable de IVA", "charges_vat": true },
    { "code": "NO_RESPONSABLE_IVA", "name": "No Responsable de IVA", "charges_vat": false },
    { "code": "REGIMEN_SIMPLE", "name": "Régimen Simple de Tributación", "charges_vat": false },
    { "code": "GRAN_CONTRIBUYENTE", "name": "Gran Contribuyente", "charges_vat": true, "withholding_agent": true }
  ],
  "municipal_taxes": [
    { "code": "ICA", "name": "Impuesto de Industria y Comercio", "rate_variable": true, "applies_to": "gross_income" }
  ]
}
```

**Profile table** (one row per country code, seeded at startup):

```
country_fiscal_profiles
  country_code (PK — ISO 3166-1 alpha-2)
  name
  currency_code (ISO 4217)
  tax_config_json
  tip_config_json
  electronic_invoicing_config_json
  withholding_config_json
  regime_types_json
  municipal_taxes_json
  created_at
  updated_at
```

**Company-level overrides** (for companies that deviate from country defaults, e.g., a free-zone company):

```
company_fiscal_overrides
  company_id (FK, PK)
  tax_config_json (nullable — replaces country default if set)
  tip_config_json (nullable)
  electronic_invoicing_config_json (nullable)
  withholding_config_json (nullable)
  notes
```

#### 3.13.4 Electronic Invoicing Adapter Pattern

The `fiscal_adapter` interface (TypeScript):

```typescript
interface FiscalAdapter {
  readonly providerCode: string;                    // e.g. "DIAN", "SRI", "SUNAT"
  generateDocument(sale: Sale, profile: FiscalProfile): Promise<FiscalDocument>;
  sign(document: FiscalDocument, cert: FiscalCertificate): Promise<SignedDocument>;
  transmit(signed: SignedDocument): Promise<TransmitResult>;
  handleContingency(sale: Sale): Promise<ContingencyDocument>;
  generateCreditNote(original: FiscalDocument, reason: string): Promise<FiscalDocument>;
}
```

Active adapter is selected by `electronic_invoicing_config.adapter`:
- `"dian_colombia"` → existing Colombia DIAN implementation (Phase 11)
- `"sri_ecuador"` → Ecuador SRI adapter (future)
- `"sunat_peru"` → Perú SUNAT adapter (future)
- `"sii_chile"` → Chile SII adapter (future)
- `"none"` → no electronic invoicing required

#### 3.13.5 Tip/Propina Parametrization

The propina Ley 1935/2018 implementation (Phase 12, API-1106) is currently Colombia-specific. Under the parametrized system:

- The POS tip dialog reads `tip_config_json` from the active profile.
- If `tip_rules.enabled = false` (e.g., for a country with no tip regulation), no dialog appears.
- If `requires_consent_dialog = true`, the consent text from `consent_dialog_text` is displayed — the exact text is country-specific and legally mandated.
- `excluded_from_tax_base` controls whether the tip amount is excluded from the IVA/INC calculation.
- `distribution_required = true` triggers reporting obligations tracked in `tip_distribution_log`.

Countries where voluntary service charges are regulated differ significantly:
- Colombia (Ley 1935/2018): max 10%, voluntary, excluded from tax, distributed to ALL workers within 30 days
- México: propina is entirely voluntary, no legal framework, but IS subject to IVA if employer-declared
- Chile: no legal framework for restaurant tips; they are typically paid directly by the customer to the worker
- USA: tip is subject to FICA and income tax; employer must report

#### 3.13.6 Tax Engine Isolation

The current tax calculation is called at several points (sale line totaling, purchase line totaling, dashboard). Under the parametrized system:

1. `resolveFiscalProfile(companyId)` → loads `country_fiscal_profiles` + `company_fiscal_overrides`
2. `taxEngine.compute(lineItems, profile)` → applies profile tax rules with mutual exclusion and additivity
3. `fiscalAdapter(profile.electronic_invoicing_config.adapter)` → selected at runtime

This makes the tax engine a pure function of profile + line items, not a hard-coded Colombian function. Colombia continues to work exactly as today — its behavior is simply the "CO" profile.

#### 3.13.7 Migration Strategy

1. **Extract**: Identify all Colombia-hardcoded constants (IVA rates, INC rates, regime codes, propina rules, DIAN endpoints) across the codebase.
2. **Seed**: Create a "CO" `country_fiscal_profiles` row in the DB seed with all extracted values.
3. **Refactor**: Replace each hardcoded constant with a lookup from the active profile.
4. **Test**: Verify that all existing Colombia tests still pass with profile-driven values.
5. **Extend**: Adding Ecuador or Chile becomes a new profile row with a new adapter — no code changes required for the existing Colombia path.

---

## 4. Current Support For Transport, Product Handling, Tracking, and Logistics

### 4.1 What the current system can already support

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

### 4.2 What is missing

Puntovivo does not yet have first-class support for:

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

## 5. Market Comparison: Logistics and Transport Features

### 5.1 ERP and commerce platforms

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

### 5.2 Last-mile and transport platforms

Platforms focused on final-mile delivery such as Bringg, Shipday, Onfleet, Route4Me, and Circuit differentiate through:

- route optimization (Clarke-Wright savings algorithm, nearest neighbor, metaheuristics)
- live GPS tracking
- ETA recalculation
- driver mobile apps
- customer notifications (SMS, email, push)
- proof of delivery via photo/signature/barcode/GPS
- SLA and exception visibility
- dispatch boards with drag-and-drop assignment
- geofencing for automatic status updates
- batch delivery grouping and zone optimization

These are especially relevant if Puntovivo wants to serve:

- stores with own delivery fleet
- food and restaurant models
- local retail with same-day delivery
- service companies that schedule on-site visits

### 5.3 Last-Mile Delivery Platform Comparison

For potential integration or feature reference:

| Platform | Core Features | API | Pricing | Best For |
| --- | --- | --- | --- | --- |
| **Shipday** | Live tracking, auto-dispatch, route optimization, driver app, customer notifications, 3PL gateway | REST + webhooks (from Pro plan). Integrations with Uber, Shopify, Toast, Lightspeed | Free basic, Pro $39/mo (300 orders), Elite $99/mo, Business $299/mo | **Best fit for Puntovivo** — lowest cost, designed for own-fleet operations, POS integration ready |
| **Onfleet** | Route optimization, auto-dispatch, real-time tracking, POD (photo/signature), SMS, barcode, age verification | RESTful (high quality, compared to Stripe). Full CRUD webhooks | From ~$550/mo (Launch), Scale ~$1,265/mo (5,000 tasks). No free tier | Mid-size businesses with mature delivery operations |
| **Bringg** | End-to-end delivery orchestration, 200+ carrier integrations, reverse logistics, multi-fleet (internal + 3PL + gig) | Extensive API + carrier integrations (FedEx, Uber, DHL, Stuart) | Enterprise custom pricing only | Large enterprises with complex multi-carrier needs |

**Recommendation**: For Phase 4 (Transport Execution), build core dispatch/tracking/POD features natively. For businesses needing advanced route optimization, offer Shipday integration as optional module — its free tier and API access at $39/mo align well with Puntovivo's small-business target.

### 5.3 Proof of Delivery (POD) Patterns

Industry-standard POD methods:

| Method | Description | When Used |
| --- | --- | --- |
| **Digital Signature** | Customer signs on driver device | High-value, B2B, formal deliveries |
| **Photo Capture** | Photo of delivered package at location | E-commerce, leave-at-door deliveries |
| **Barcode/QR Scan** | Scan at delivery point | Supply chain, warehouse-to-warehouse |
| **GPS Confirmation** | Geofenced auto-confirmation | Route deliveries, utility services |
| **PIN/Code Verification** | Customer provides code to confirm | Secure deliveries, age-restricted items |
| **Recipient Name** | Record of who received | B2B, front-desk deliveries |

## 6. Product, Logistics, and Multi-Vertical Gap Matrix

### 6.1 Core Platform Gaps (All Verticals)

| Capability cluster | Market expectation | Current repo status | Gap level |
| --- | --- | --- | --- |
| Module activation system | tenant/site-level vertical selection | Missing | **Critical (new)** |
| Tax groups / compound tax | multi-tax per product (IVA + INC + impuesto saludable) | Missing | **Critical (new)** |
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
| Cash management | sessions, blind close, denomination, over/short | Missing | Critical |
| Split/partial payments | multi-tender, layaway, installments | Missing | High |
| Loyalty and promotions | points, coupons, gift cards, store credit | Missing | High |
| Quotations | quote-to-order-to-invoice lifecycle | Missing | High |
| Employee management | shifts, time tracking, commissions | Missing | Moderate |
| Advanced reporting | GMROI, sell-through, ABC, forecasting | Missing | Moderate |
| Restaurant features | KDS, tables, modifiers, course firing | Missing | Moderate |
| Multi-currency | display, settlement, exchange rates | Missing | Moderate |
| Fiscal localization (Colombia) | electronic POS, electronic invoice | Partial | Critical |
| Public API and webhooks | integration ecosystem | Missing | High |
| Audit trail | action-level, manager overrides | Partial | High |
| JSON metadata columns on products | vertical-specific product attributes | Missing | **High (new)** |
| Fractional quantity support in checkout | decimal qty with arbitrary precision | Missing | **High (new)** |
| Customer credit accounts (30/60/90 day terms) | credit limit, aging, statement | Missing | **High (new)** |
| Retención en la fuente / Rete-IVA / Rete-ICA | B2B tax withholdings at POS | Missing | **High (new)** |
| Documento Soporte Electrónico | purchases from non-invoicers | Missing | **High (new)** |

### 6.2 Vertical-Specific Gap Matrix

| Capability | Pharmacy | Supermarket | Hardware Store | Restaurant | Gen. Retail | Status |
| --- | --- | --- | --- | --- | --- | --- |
| **Module activation** | Required | Required | Required | Required | Required | Missing |
| Lot/batch/expiry (FEFO) | **Critical** (legal) | **Critical** | Low | Low | Low | Missing |
| Controlled substance tracking | **Critical** (legal) | — | — | — | — | Missing |
| Prescription management | **Critical** (legal) | — | — | — | Optical only | Missing |
| INVIMA Registro Sanitario | **Critical** (legal) | — | — | — | — | Missing |
| Regulated price ceilings (CNPMDM) | **Critical** (legal) | — | — | — | — | Missing |
| EPS billing + RIPS | **High** (legal) | — | — | — | — | Missing |
| SISMED reporting | **High** (legal) | — | — | — | — | Missing |
| Generic substitution (INN/DCI) | **Moderate** | — | — | — | — | Missing |
| Cold chain flags | **Moderate** | Moderate | — | Moderate | — | Missing |
| Drug interaction alerts | Low-Moderate | — | — | — | — | Missing |
| Weighing scale integration | — | **Critical** | Low | — | — | Missing |
| PLU codes + variable-weight barcodes | — | **Critical** | — | — | — | Missing |
| Age-restricted product controls | — | **High** | — | Moderate | — | Missing |
| Fresh dept production/shrink | — | **Moderate** | — | — | — | Missing |
| DSD receiving | — | **Moderate** | — | — | — | Missing |
| Multi-department P&L | — | **High** | — | — | Moderate | Missing |
| Impuesto saludable | — | **High** (legal) | — | — | — | Missing |
| Bolsa plástica tax | — | **Moderate** (legal) | — | — | Moderate | Missing |
| Fractional unit sales | — | **Critical** (weight) | **Critical** | — | — | Missing |
| Unit conversion management | — | Low | **Critical** | — | — | Missing |
| In-house barcode generation | — | Low | **High** | — | Low | Missing |
| Bulk pricing / quantity breaks | — | Low | **High** | — | Moderate | Missing |
| Contractor credit (30/60/90) | — | — | **High** | — | Moderate | Missing |
| Project/job quoting | — | — | **High** | — | — | Missing |
| Cut-to-size service charges | — | — | **Moderate** | — | — | Missing |
| Technical specs as product attrs | — | — | **Moderate** | — | — | Missing |
| High-SKU search (FTS5) | — | Moderate | **Moderate** | — | — | Missing |
| Partial-use returns | — | — | **Moderate** | — | — | Missing |
| Table management + floor plan | — | — | — | **Critical** | — | Missing |
| KDS multi-station routing | — | — | — | **Critical** | — | Missing |
| Impuesto al consumo 8% | — | — | — | **Critical** (legal) | — | Missing |
| Combo/meal deal engine | — | — | — | **High** | — | Missing |
| Delivery aggregator integration | — | — | — | **High** | — | Missing |
| Tab management | — | — | — | **High** | — | Missing |
| Daypart menus | — | — | — | **Moderate** | — | Missing |
| Waste tracking (actual vs theoretical) | — | Moderate | — | **Moderate** | — | Missing |
| Recipe costing / BOM | — | — | — | **Moderate** | — | Missing |
| Allergen/dietary flags | — | — | — | **Moderate** | — | Missing |
| Propina (voluntary 10%) | — | — | — | **Moderate** | — | Missing |
| Size/color variant matrix | — | — | — | — | **Critical** (fashion) | Missing |
| Serial number per unit | — | — | — | — | **High** (electronics) | Missing |
| Warranty management | — | — | — | — | **High** (electronics) | Missing |
| Consignment tracking | — | — | — | — | **Moderate** (jewelry) | Missing |
| Season/markdown scheduling | — | — | — | — | **Moderate** (fashion) | Missing |
| Trade-in / buy-back | — | — | — | — | **Moderate** (electronics) | Missing |

### 6.3 Multi-Vertical Readiness Matrix

| Vertical | Can Operate Today? | Blocking Gaps | Earliest Usable After |
| --- | --- | --- | --- |
| **Generic Retail / Tienda** | Partial — no cash management | Cash sessions, split payments | Phase 1 |
| **Ferretería** | No — no fractional units, no credit terms | Fractional qty, unit conversion, customer credit, project quoting | Phase 5 |
| **Supermercado** | No — no scales, no perishable management | Scale integration, PLU, lot/expiry, impuesto saludable | Phase 6 + Phase 14 |
| **Farmacia** | No — missing all legally required features | Lot/batch, Rx, controlled substances, RIPS, SISMED, INVIMA | Phase 6 + Phase 13 |
| **Restaurante** | No — no tables, no KDS | Table management, KDS, INC 8%, modifiers, tips | Phase 12 |
| **Fashion/Apparel** | No — no variants | Size/color matrix, season management | Phase 6 |
| **Electronics** | No — no serial tracking | Serial numbers, warranty management | Phase 6 |
| **B2B / Wholesale** | No — no credit terms, no quotations | Customer credit, quotations, retención en la fuente | Phase 5 + Phase 11 |
| **Services** | No — no appointments | Appointment scheduling, calendar | Phase 12 |

### 6.4 Colombian Tax Compliance Readiness

| Tax Type | Applies To | Current Status | Phase |
| --- | --- | --- | --- |
| IVA (0%, 5%, 19%) | All | Basic (single rate per product) | **Needs tax groups — Phase 0** |
| Impuesto al Consumo 8% | Restaurants (on-premises) | Missing | Phase 0 |
| Impuesto Saludable (15-20%) | Sugary drinks, ultra-processed | Missing | Phase 0 |
| Bolsa Plástica (COP $90/bag) | Retail, supermarkets | Missing | Phase 0 |
| Retención en la Fuente | B2B transactions | Missing | Phase 11 |
| Rete-IVA | B2B, specific regimes | Missing | Phase 11 |
| Rete-ICA | B2B, municipality-specific | Missing | Phase 11 |
| DEE POS Electrónico | All (mandatory 2024+) | Missing | Phase 11 |
| Factura Electrónica | All above 3,500 UVT | Missing | Phase 11 |
| Nota Crédito Electrónica | All | Missing | Phase 11 |
| Documento Soporte Electrónico | Purchases from non-invoicers | Missing | Phase 11 |

### 6.5 Detailed Competitive Capability Matrices

These matrices compare Puntovivo's current repo status against 8 major competitors per feature category.

#### Core POS Operations

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

#### Payment Methods

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

#### Cash Management

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

#### Inventory Management

| Capability | Square | Shopify | Lightspeed | Toast | Loyverse | Odoo | ERPNext | Siigo | Repo status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Stock tracking | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Implemented** |
| Movement history | Limited | Yes | Yes | No | Yes | Yes | Yes | No | **Implemented** |
| Adjustments | Yes | Yes | Yes | No | Yes | Yes | Yes | Yes | **Implemented** |
| Physical count / stock take | Yes | Yes | Yes | No | Yes | Yes | Yes | No | **Implemented** |
| Low stock alerts | Yes | Yes | Yes | No | Yes | Yes | Yes | No | **Implemented** |
| Multi-location balances | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Partial |
| Inter-store transfers | No | Yes | Yes | No | Yes | Yes | Yes | No | Missing |
| Product variants (size/color) | Yes | Yes | Yes | Yes | No | Yes | Yes | No | Missing |
| Serial number tracking | No | No | Yes | No | No | Yes | Yes | No | Missing |
| Batch / lot tracking | No | No | No | No | No | Yes | Yes | No | Missing |
| Expiry date tracking | No | No | No | No | No | Yes | Yes | No | Missing |
| Bundles / kits / combos | No | Yes | Yes | No | No | Yes | Yes | No | Missing |
| Reorder points / auto PO | Yes | Yes | Yes | No | Yes | Yes | Yes | No | Missing |
| Inventory costing method | No | WAC | WAC/FIFO | No | No | All | All | WAC | Missing |

#### Procurement

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

#### Tax and Fiscal Compliance

| Capability | Square | Shopify | Lightspeed | Toast | Loyverse | Odoo | ERPNext | Siigo | Repo status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tax rate configuration | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Implemented** |
| Multi-tax / compound tax | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | Missing |
| Tax groups | Yes | Yes | Yes | Yes | No | Yes | Yes | Yes | Missing |
| Tax-exempt customers | Yes | Yes | Yes | No | No | Yes | Yes | Yes | Missing |
| Electronic invoicing (Colombia) | No | No | No | No | No | Community | Community | **Yes** | Missing |
| Credit notes (formal) | No | Yes | Yes | No | No | Yes | Yes | Yes | Missing |
| Multi-country fiscal adapters | No | No | No | No | No | Yes (70+) | Yes (40+) | Limited | Missing |

#### Integration and Extensibility

| Capability | Square | Shopify | Lightspeed | Toast | Loyverse | Odoo | ERPNext | Siigo | Repo status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Public REST/GraphQL API | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Limited | Missing |
| Webhooks | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Missing |
| API keys / OAuth | Yes | Yes | Yes | Yes | Yes | Yes | Yes | No | Missing |
| Accounting integration | Apps | Apps | Built-in | Apps | Apps | Built-in | Built-in | Built-in | Missing |
| E-commerce integration | Yes | Built-in | Yes | Yes | No | Built-in | Yes | No | Missing |
| App marketplace / plugins | 500+ | 8000+ | Yes | 200+ | No | 40000+ | Yes | No | Missing |
| Import/export (CSV/Excel) | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes | **Implemented** |

#### Hybrid Database / Data Architecture

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

### 6.6 Deferred Technical Migrations

- `better-sqlite3` → `node:sqlite`: evaluate only after `node:sqlite` leaves release candidate status. Impacts `packages/server/src/db/index.ts` (Drizzle driver), `apps/desktop/src/main/index.ts` (raw `$client` bridge queries), and all dual Node/Electron native binary handling.

### 6.7 Ongoing Technical Work

- Omnichannel orders, pickup, and ship-from-store workflows
- Remote sync strategy hardening beyond retry/failure observability
- Procurement edge cases: supplier credit-note handling, mixed return/void reconciliation, approval-oriented audit surfaces
- Desktop security hardening (Electron `sandbox: false`)
- Performance cleanup and bundle hygiene
- Browser IndexedDB vs Electron desktop DB: define long-term ownership boundary for consistent offline behavior
- Broader integration/E2E coverage

### 6.8 Operator Documentation Needs

- Backup/restore runbook
- Sync conflict resolution playbook
- Release verification checklist
- Workstation provisioning guide
- Domain glossary (tenant, site, location, order, purchase, void, refund)

## 7. Recommended Logistics Model For Puntovivo

The cleanest path is to treat logistics as a document-driven extension of the existing sales and inventory model.

### 7.1 New operational documents

Recommended new outbound/internal documents:

- `fulfillment_orders`
- `pick_lists`
- `packing_slips`
- `shipments`
- `delivery_notes`
- `transfer_orders`
- `proof_of_delivery`
- `delivery_exceptions`

### 7.2 Suggested lifecycle

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

## 8. Product Handling Enhancements Needed For Logistics

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

## 9. Hybrid Data Architecture: SQLite Local + Remote Source of Truth

### 9.1 What the user wants

Target shape:

- local SQLite continues to exist for offline work on device
- canonical truth lives remotely
- remote truth may be SQLite-based or PostgreSQL-based
- the app should still work without connection and sync later

This is a valid and strong product direction.

### 9.2 What the current code supports well

The current repo already has some enabling pieces:

- clear application API boundary through tRPC
- sync queue and conflict tables
- browser IndexedDB and desktop local DB support
- tenant/site request context
- domain routers that centralize business logic
- Drizzle ORM, which supports multiple SQL dialects in general

These are good foundations for a hybrid architecture.

### 9.3 What currently blocks dual-database support

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

### 9.4 Hybrid database technology landscape

#### PowerSync (Recommended — strongest fit)

- **How it works**: Sync rules define which rows each client sees. Postgres is source of truth. Client uses SQLite. Sync is managed by PowerSync service.
- **Pricing (2026)**: Free tier (2 GB synced/mo, 500 MB hosted), Pro from $49/mo (30 GB), Scale custom. Self-hosted Open Edition is free (source-available). Self-hosted Enterprise has dedicated support.
- **React/TypeScript SDK**: `@powersync/react` provides auto-reactive hooks. `@powersync/tanstack-react-query` integrates with TanStack Query (pagination, caching, Suspense). Supports Kysely for auto-generated TypeScript types.
- **Electron support**: Officially supported with two approaches — Web SDK in renderer (WASM SQLite) or Node.js SDK in main process (native better-sqlite3, faster). Dedicated blog post: "Speeding Up Electron Apps With PowerSync".
- **Conflict resolution**: Default is last-write-wins **per field** (not per row). Custom resolution can be implemented in backend API. Updates to different fields on same record do not conflict.
- **Sync rules**: Declarative SQL-based rules. Data queries define which buckets a row belongs to; parameter queries define which buckets a user gets. Supports dynamic partial replication.
- **Applicability**: **HIGH**. This is the most directly applicable solution. It supports Electron natively, uses SQLite locally (which Puntovivo already uses), has a free tier and self-hosted option, and handles the exact offline-write-then-sync pattern needed.

#### Electric SQL

- **How it works**: Postgres-to-client sync engine. Streams Postgres logical replication to clients. Shape-based sync (subscribe to subsets of data).
- **Current state (2026)**: Electric 1.0 released March 2025 (GA, stable APIs). Electric 1.1 released August 2025 (100x faster writes). Electric Cloud public beta launched April 2025.
- **React integration**: `@electric-sql/react` with `useShape({ url, params: { table } })` hook. Returns `{ data, isLoading, lastSyncedAt, isError }`. Shape instances cached globally.
- **Write-path**: Electric is primarily a **read-path sync engine**. Writes are handled via optimistic state on client — you write to your backend (REST, tRPC) and Electric syncs the result back. There is NO built-in local-first write queue. You implement your own write path.
- **Self-hosted**: Fully open source (Elixir-based), deploy anywhere. Cloud option also available.
- **Key limitation vs PowerSync**: Does NOT provide a local SQLite database or bidirectional sync out of the box. It streams shape data into memory/state. For true offline-first with local persistence, you'd need to combine Electric with PGlite or your own local store.
- **Applicability**: **MODERATE**. Good for read-heavy sync (catalog, prices, config) but not a complete offline-write solution. Could complement PowerSync for specific read patterns.

#### Turso / libSQL

- **How it works**: libSQL is a fork of SQLite with embedded replicas. Primary database is remote, replicas run locally. Automatic replication.
- **Pros**: SQLite everywhere (no dialect mismatch). Very fast reads. Server and edge replicas.
- **Cons**: Not a full bidirectional sync engine — primarily read replica pattern. Write forwarding to primary.
- **Applicability**: MODERATE. Good fit for Option A (SQLite everywhere). Less suitable for the full offline-write-then-sync pattern.

#### LiteFS by Fly.io

- **How it works**: FUSE-based distributed SQLite. Primary node accepts writes, replicas get streaming replication.
- **Pros**: Zero application code changes for reads. SQLite everywhere.
- **Cons**: Single-writer model. Replicas are read-only. Fly.io has deprioritized LiteFS development.
- **Applicability**: LOW. Single-writer doesn't fit multi-device offline writes.

#### PGlite (Alternative approach — eliminates dual-dialect problem)

- **How it works**: Full Postgres running in WASM, usable in browser and Node.js. Drizzle has first-class PGlite support.
- **Pros**: Single `pgTable` schema works for both local embedded and remote Postgres. Eliminates the entire dual-schema problem. Drizzle supports it natively.
- **Cons**: WASM Postgres is heavier than native SQLite. May not match better-sqlite3 performance for heavy desktop workloads. Relatively new technology.
- **Applicability**: **HIGH for new greenfield**. For Puntovivo, migration cost from better-sqlite3 is significant, but this is the cleanest long-term path if starting fresh.

#### Drizzle ORM Multi-Dialect Strategy

**Important finding from research**: Drizzle does NOT support a unified schema that generates both `sqliteTable` and `pgTable` from a single definition. Each dialect has its own table builder because column types differ fundamentally. There is no Prisma-style abstraction planned.

**Viable approaches for Puntovivo**:

1. **PGlite approach (cleanest)**: Switch local DB to PGlite, use a single `pgTable` schema everywhere. Eliminates dual-dialect entirely. Highest migration cost from current better-sqlite3 but simplest long-term.

2. **Dual schema derived from shared types**: Define source-of-truth as TypeScript interfaces or Zod schemas, then derive both `sqliteTable` and `pgTable` as thin adapters. Maintain two `drizzle.config.ts` files:
   ```bash
   drizzle-kit generate --config=drizzle-sqlite.config.ts
   drizzle-kit generate --config=drizzle-pg.config.ts
   ```
   Each config specifies its own dialect, schema path, and migration output directory.

3. **Code generation**: Auto-generate both dialect schemas from shared TypeScript type definitions. Most robust but requires building the generator.

Key normalization rules (regardless of approach):

| Concept | SQLite | PostgreSQL |
| --- | --- | --- |
| Boolean | INTEGER (0/1) | BOOLEAN |
| Timestamp | TEXT (ISO 8601) | TIMESTAMP WITH TIME ZONE |
| JSON | TEXT (JSON string) | JSONB |
| Money | INTEGER (cents) | INTEGER (cents) or NUMERIC |
| UUID | TEXT | UUID |
| Auto-increment | INTEGER PRIMARY KEY | SERIAL or GENERATED ALWAYS AS IDENTITY |
| Array | TEXT (JSON array) | Array type or JSONB |
| Enum | TEXT | Native ENUM or TEXT |

**Recommended path for Puntovivo**: Option 2 (dual schema from shared types) for near-term, with evaluation of PGlite as a potential long-term simplification. PowerSync for the sync layer regardless of local DB choice.

#### CRDTs and Operation-Based Sync

For the most robust offline-first experience:

- **CRDTs** (Conflict-free Replicated Data Types): Automerge, Yjs. Guarantee eventual consistency without coordination. Best for collaborative editing, less proven for transactional business data.
- **Operation-Based Sync**: Instead of syncing state, sync operations (events). Each offline operation is a record. Server applies operations in order, resolves conflicts. This is the pattern most ERP sync systems use.
- **Event Sourcing**: All state changes are events. Local and remote maintain event logs. Reconciliation merges event streams. Most architecturally clean but highest implementation cost.

**Recommendation for Puntovivo**: Operation-based sync with last-write-wins default and manual conflict resolution for business-critical entities (sales, inventory adjustments). This builds naturally on the existing `syncQueue` pattern. PowerSync's per-field last-write-wins aligns well with this approach.

## 10. Viable Architecture Options

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

## 11. Recommended Data Strategy

Recommended target architecture for Puntovivo:

### Near term

- keep SQLite local for desktop/offline
- formalize remote sync API and conflict policy
- remove direct business logic dependence on `better-sqlite3` APIs
- introduce a database capability layer that can target SQLite now and PostgreSQL later

### Mid term

- support PostgreSQL as remote source of truth
- keep local SQLite as offline working set
- move sync from "pending CRUD queue" toward "operation/event contract with server acknowledgements"

### Long term

- support deployment modes:
  - standalone local-first SQLite
  - managed remote SQLite topology for simpler hosted editions
  - PostgreSQL-backed client-server topology for larger installations

## 12. Technical Roadmap By Phase

This roadmap is deliberately technical.
Each phase includes concrete tracks for DB, tRPC, UI, and tests.

### Phase 0: Architecture Foundation and Multi-Vertical Module System

Goal:
- prepare the codebase for logistics expansion, dual-database compatibility, multi-vertical module activation, and compound tax support
- this is the most critical phase because it creates the architectural seams that ALL subsequent vertical work plugs into

DB tickets:

- `DB-001` Introduce dialect-neutral schema conventions
- `DB-002` Replace raw schema bootstrap with versioned Drizzle migrations
- `DB-003` Define money, quantity, and timestamp normalization rules
- `DB-004` Add `vertical` column to `sites` table (enum: `retail`, `supermarket`, `pharmacy`, `ferreteria`, `restaurant`, `restaurant_qsr`, `services`, `wholesale`) — defaulting to `retail`. This is the single most important multi-vertical change.
- `DB-005` Add `metadata` JSON column to `products` table for vertical-specific attributes — typed via `text('metadata', { mode: 'json' }).$type<ProductMetadata>()` with discriminated union types per vertical (PharmacyProductMeta, FerreteriaProductMeta, RestaurantProductMeta, etc.)
- `DB-006` Add `settings` JSON column to `sites` table for site-level configuration and capabilities map
- `DB-007` Create `tax_groups` table (name, taxes JSON array with rate/type/applies_to) — supports compound tax scenarios AND mutual exclusivity. **Critical design rule**: IVA and INC (impuesto al consumo) are MUTUALLY EXCLUSIVE for restaurants — restaurants above ~3,500 UVT charge 8% INC instead of 19% IVA on prepared food. However, a mixed establishment (supermarket with deli) may have IVA products AND INC products on the same receipt. Impuesto saludable and bolsa plástica ARE additive with IVA.
- `DB-008` Create `tax_group_items` table (tax_group_id, tax_type [iva, inc, imp_saludable, bolsa_plastica, custom], rate, calculation_base [pre_tax, post_iva, fixed_amount], exclusive_with [array of tax_types this is mutually exclusive with])
- `DB-009` Link products to tax_groups instead of single VAT rate (migration: create default tax groups from existing vatRates, update product references)

tRPC tickets:

- `API-001` Introduce repository/service boundaries for core domains
- `API-002` Separate persistence concerns from router procedures
- `API-003` Define sync acknowledgement contract
- `API-004` Create module registry service: resolve site vertical → compute `SiteCapabilities` map → inject into tRPC context. Capabilities are boolean flags (`hasTableManagement`, `hasLotTracking`, `hasCutToLength`, `hasScaleIntegration`, etc.) computed from vertical + site settings.
- `API-005` Compound tax calculation engine: given a cart of items, each with a tax_group, compute all applicable taxes with correct ordering (IVA on base, INC on base, impuesto saludable on base, bolsa plástica as fixed amount)
- `API-006` Module-conditional tRPC router composition: each vertical module exports a router creator; the main router conditionally includes module routers based on active modules

UI tickets:

- `UI-001` Add system diagnostics page for runtime topology
- `UI-002` Add admin-facing sync topology indicators
- `UI-003` Create vertical/module activation settings page — site setup wizard that when selecting a vertical: activates the module, creates vertical-specific categories, sets up vertical-specific role templates, pre-configures receipt templates
- `UI-004` Create `SiteCapabilities` React Context provider — computed from site vertical and settings, consumed by all components for conditional rendering
- `UI-005` Extend `Sidebar.tsx` navigation items with `requiredCapability?: keyof SiteCapabilities` filtering — items with a required capability only render when the capability is active
- `UI-006` Update checkout to read tax groups and display compound taxes separately on receipt (IVA line, INC line, impuesto saludable line, bolsa plástica line)

Test tickets:

- `TEST-001` Add persistence contract tests reusable across dialects
- `TEST-002` Add schema migration smoke tests
- `TEST-003` Add sync contract tests for accepted/conflicted/rejected flows
- `TEST-004` Compound tax calculation: IVA 19% + INC 8% on same item produces correct total
- `TEST-005` SiteCapabilities correctly computed from vertical + settings for each vertical type
- `TEST-006` Module-conditional sidebar only shows items for active vertical

### Phase 1: Cash Management, Shift Control, and Fractional Quantity Foundation

Goal:
- implement the most critical missing commercial feature for LatAm retail
- unblock fractional quantity sales (required by ferreterías and supermarkets)

DB tickets:

- `DB-050` **CRITICAL MIGRATION: Convert `stock` and `quantity` from `integer` to `real` across ALL tables** — currently `products.stock`, `saleItems.quantity`, `purchaseItems.quantity`, `orderItems.quantity`, `inventoryMovements.quantity` are all `integer`. This blocks ferreterías (sell 2.5m of cable), supermarkets (sell 0.75kg of produce), and any business selling fractional units. Add product flags: `sell_by_fraction` (boolean), `fraction_step` (real, e.g., 0.5 for half-meter increments), `fraction_minimum` (real). This is the single most impactful schema migration for multi-vertical support.
- `DB-051` Create `cash_sessions` table (register, cashier, site, opening_float, opening_count_denominations, expected_balance, actual_count, actual_count_denominations, over_short, status, opened_at, closed_at)
- `DB-052` Create `cash_movements` table (session_id, type [sale, refund, paid_in, paid_out, skim, replenishment], amount, reference_id, note, created_by)
- `DB-053` Create `denomination_templates` table for standardized float breakdowns

tRPC tickets:

- `API-051` Add `cashSessions.open` with denomination counting and float validation
- `API-052` Add `cashSessions.close` with blind close support (expected hidden until count submitted)
- `API-053` Add `cashSessions.movements` for paid-in, paid-out, skim, replenishment
- `API-054` Add `cashSessions.report` with over/short history per cashier
- `API-055` Update `sales.create` and `sales.refund` to require active cash session and record cash movement

UI tickets:

- `UI-051` Cash session open dialog with denomination counting grid
- `UI-052` Cash session close dialog with blind close mode
- `UI-053` Cash session summary with movement timeline
- `UI-054` Cash management dashboard: active sessions, over/short trends, alerts
- `UI-055` Register assignment in POS checkout header

Test tickets:

- `TEST-051` Opening cash: denomination count matches float
- `TEST-052` Sale increments session expected balance
- `TEST-053` Refund decrements session expected balance
- `TEST-054` Blind close does not expose expected amount before count submission
- `TEST-055` Over/short calculation is accurate

### Phase 2: Site-Owned Inventory and Transfer Logistics

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

### Phase 3: Outbound Logistics Documents

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

### Phase 4: Transport Execution and Tracking

Goal:
- support dispatch, transport, and delivery follow-through

DB tickets:

- `DB-301` Create `shipments`, `shipment_stops`, `drivers`, `vehicles`, and `carriers`
- `DB-302` Create `proof_of_delivery` (type [signature, photo, barcode, gps, pin], media_url, location, timestamp, recipient_name)
- `DB-303` Create `delivery_exceptions` (type [failed, damaged, partial, refused, reattempt], resolution_status)

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

### Phase 5: Payment Method Depth, Quotations, and Layaway

Goal:
- support complex payment scenarios, pre-sale conversion flows, and the deeply embedded Latin American "apartado" purchasing pattern

DB tickets:

- `DB-401` Create `quotations` and `quotation_items` with validity period, version tracking, margin analysis fields
- `DB-402` Add `sale_payments` for multi-tender support (each payment has method, amount, reference, status)
- `DB-403` Create `customer_credit_accounts` with credit limit, balance, aging buckets (current, 30, 60, 90 days)
- `DB-404` Create `gift_cards` and `store_credits` with balance tracking
- `DB-405` Create `layaway_orders` and `layaway_payments` (customer_id, items JSON, total, deposit, payment_schedule JSON [dates+amounts], status [active, completed, cancelled, forfeited], forfeiture_policy_pct, inventory_reservation flag)
- `DB-406` Create `special_orders` (customer_id, product_id, description, deposit_amount, deposit_paid, estimated_arrival, provider_id, status [pending, ordered, arrived, notified, delivered, cancelled])
- `DB-407` Create `service_tickets` (customer_id, device_description, serial_number, problem, status [received, diagnosing, awaiting_parts, in_repair, ready, delivered, cancelled], assigned_to, parts_used JSON, labor_charge, estimated_completion)
- `DB-408` Add fiscal regime fields to `companies` table: `fiscal_regime` (enum: responsable_iva, no_responsable_iva, regimen_simple, gran_contribuyente), `autorretenedor` (boolean), `agente_retencion` (boolean)

tRPC tickets:

- `API-401` Quotation CRUD, versioning, margin display, and convert-to-sale/order
- `API-402` Split payment processing: multiple tenders per sale, change calculation per tender
- `API-403` On-account sales: credit check, balance update, aging report
- `API-404` Gift card issue/activate/redeem/balance-check
- `API-405` Store credit issue/redeem on return or standalone
- `API-406` Layaway/apartado: create layaway order with deposit + payment schedule, record installment payments, reserve inventory (available but not sellable), convert to final sale on full payment, handle cancellation with configurable forfeiture policy
- `API-407` Special orders: create with deposit, link to PO when ordered from provider, notify customer on arrival, convert to sale on delivery
- `API-408` Service tickets: full status workflow (received → diagnosing → awaiting_parts → in_repair → ready → delivered), parts consumption from inventory, labor charge calculation, customer notification triggers
- `API-409` Company fiscal regime: affect tax calculation behavior based on regime (responsable_iva charges IVA, no_responsable does not; gran_contribuyente has special withholding rules; autorretenedor self-withholds)

UI tickets:

- `UI-401` Quotations module with version history, margin indicators, and conversion button
- `UI-402` Checkout: multi-tender payment dialog (add/remove payment methods, running balance)
- `UI-403` Customer credit account management and aging report
- `UI-404` Gift card issuance, lookup, and redemption in checkout
- `UI-405` Store credit balance display and application in checkout
- `UI-406` Quotation follow-up reminders and win/loss tracking
- `UI-407` Layaway/apartado management: create layaway, view payment schedule, record installment, cancel with forfeiture
- `UI-408` Special order tracking: create, link to PO, mark arrived, notify customer
- `UI-409` Service ticket management: intake form, status board, parts usage, customer notification
- `UI-410` Company fiscal regime settings page

Test tickets:

- `TEST-401` Quote conversion preserves prices and taxes
- `TEST-402` Split payment sum must equal or exceed transaction total
- `TEST-403` On-account sale fails when exceeding credit limit
- `TEST-404` Gift card redemption reduces balance correctly
- `TEST-405` Return to store credit creates credit entry
- `TEST-406` Layaway reserves inventory (not sellable to others)
- `TEST-407` Layaway cancellation applies forfeiture percentage correctly
- `TEST-408` Layaway full payment converts to completed sale
- `TEST-409` Service ticket parts consumption decrements inventory
- `TEST-410` Company fiscal regime correctly affects IVA charging behavior

#### Phase 5 Extension: Credit Sales (Ventas a Crédito) and Abonos

Goal:
- support the deeply embedded LatAm commercial practice of selling on credit with installment schedules and partial payment posting

DB tickets:

- `DB-409` Create `company_credit_settings` (company_id FK nullable, site_id FK nullable, credit_sales_enabled boolean, min_downpayment_pct integer 0–100 default 0, max_credit_days integer, max_installments integer, interest_rate_monthly_pct decimal default 0, mora_rate_daily_pct decimal default 0, require_approval_above_amount decimal, max_credit_per_customer decimal, grace_period_days integer default 3, allow_abono_any_amount boolean default true, require_customer_id boolean default true — resolution order: site > company > tenant default)
- `DB-410` Create `credit_sales` (id, sale_id FK, customer_id FK non-nullable, total_amount, downpayment_amount, outstanding_balance, interest_total, status [active | partially_paid | fully_paid | overdue | written_off | cancelled], approved_by FK users nullable, installment_count, first_due_date, created_at, notes)
- `DB-411` Create `credit_installments` (id, credit_sale_id FK, installment_number, due_date, principal_amount, interest_amount, total_amount, outstanding_amount, status [pending | partially_paid | paid | overdue | waived], paid_at nullable)
- `DB-412` Create `credit_payments` (id — represents an "abono", credit_sale_id FK, amount, payment_method, reference nullable, received_by FK users, received_at, notes, applied_installments_json — [{installment_id, amount_applied}])

tRPC tickets:

- `API-410` `creditSettings.get` / `.upsert` — fetch and configure credit settings for company/site; resolve the most-specific applicable config for a given sale context
- `API-411` `creditSales.create` — create a credit sale linked to a completed sale; validate: customer has account, downpayment >= min_downpayment_pct, outstanding balance <= max_credit_per_customer, approve or require manager approval above threshold; generate installment schedule (principal + interest per installment); Colombia: validate that a factura electrónica is generated (not DEE)
- `API-412` `creditSales.list` — list credit sales with filter by status, customer, date range, site; include outstanding balance and days overdue
- `API-413` `creditSales.get` — fetch credit sale with installment schedule and payment history
- `API-414` `creditSales.abono` (record a credit payment) — post payment amount, apply to installments in chronological order; update `credit_installments.outstanding_amount` and `status`; recompute `credit_sales.outstanding_balance` and `status`; emit `credit_payment_recorded` event for sync
- `API-415` `creditSales.overdueScan` — scheduled procedure to transition installments past grace period to `overdue` and credit_sales to `overdue`; calculates accrued mora; can be triggered on demand or by a cron job
- `API-416` `creditSales.writtenOff` — write off uncollectable credit sale (manager role required); moves status to `written_off` and creates accounting event
- `API-417` `creditSales.aging` — accounts receivable aging report: buckets by current / 30 / 60 / 90 / 90+ days; per customer breakdown and grand total

UI tickets:

- `UI-411` Credit sales settings page (per company/site): enable/disable, configure min downpayment %, max installments, interest rate, approval threshold
- `UI-412` Checkout extension: when credit is enabled and customer is identified, show "Venta a Crédito" tender option; collect downpayment amount; show projected installment schedule before confirming
- `UI-413` Credit sale confirmation dialog: show full installment schedule (dates, amounts, total cost of credit), require customer acknowledgment
- `UI-414` Manager approval dialog: triggered when sale exceeds `require_approval_above_amount`; manager enters PIN or credentials
- `UI-415` Abono (payment posting) screen: select customer, shows all open credit sales; enter payment amount and method; auto-applies to oldest installments; shows updated balance
- `UI-416` Credit portfolio management list: all open credit sales across the company, sortable by due date, balance, status; overdue highlighted
- `UI-417` Customer credit history: within customer detail screen, show all credit sales (open and closed), installment schedule, payment history, outstanding balance

Test tickets:

- `TEST-411` Credit sale creates correct installment schedule (principal + interest per installment, sum equals total)
- `TEST-412` Downpayment below minimum is rejected
- `TEST-413` Credit sale exceeding max_credit_per_customer is blocked without manager approval
- `TEST-414` Abono application distributes correctly to chronologically oldest installments first
- `TEST-415` Abono that partially pays an installment transitions it to `partially_paid`
- `TEST-416` Final abono that zeroes outstanding_balance transitions credit_sale to `fully_paid`
- `TEST-417` Overdue scan transitions installments past grace_period_days to `overdue`
- `TEST-418` Interest-free credit (0% rate) produces zero interest_total
- `TEST-419` Colombia credit sale generates factura electrónica (not DEE) via fiscal adapter
- `TEST-420` Credit settings resolution uses most specific level (site > company > tenant)

### Phase 6: Product Handling and Advanced Inventory

Goal:
- support more product categories and operational complexity

DB tickets:

- `DB-501` Create `product_variants` (product_id, attributes JSON, sku, barcode, price_override)
- `DB-502` Create `serial_numbers` (product_id, serial, status [available, sold, returned, damaged], current_site)
- `DB-503` Create `batches` and `batch_balances` (product_id, batch_number, expiry_date, manufactured_date, qty)
- `DB-504` Create `bundle_components` and `recipes` (parent_product_id, component_product_id, qty)
- `DB-505` Add product `weight`, `width`, `height`, `depth`, `shipping_class`, `lead_time_days`, `reorder_point`, `safety_stock`

tRPC tickets:

- `API-501` Variant-aware product search and sale lines
- `API-502` Serial/batch assignment for receipt, sale, transfer, and return
- `API-503` Expiry-aware allocation helpers (FEFO — First Expiry First Out)
- `API-504` Bundle explosion and recipe consumption services
- `API-505` Reorder point alerts and auto-suggestion of purchase orders
- `API-506` ABC analysis calculation (trailing revenue classification)
- `API-507` Inventory aging report (days in stock by bucket)
- `API-508` GMROI and sell-through rate calculations
- `API-509` Cycle count workflow (freeze → count → compare → adjust)

UI tickets:

- `UI-501` Product form: variant matrix builder (size x color grid)
- `UI-502` Receiving and sales dialogs: serial/batch selector
- `UI-503` Expiry alerts and near-expiry dashboard widgets
- `UI-504` Bundle/recipe management in product form
- `UI-505` Reorder point dashboard with suggested POs
- `UI-506` ABC analysis view with classification overrides
- `UI-507` Inventory aging heatmap
- `UI-508` Cycle count worksheet UI

Test tickets:

- `TEST-501` Serialized products require exact serial capture
- `TEST-502` Batch FEFO allocation uses earliest-expiry stock
- `TEST-503` Bundles decrement the right components
- `TEST-504` Reorder point triggers at correct threshold
- `TEST-505` ABC classification matches expected Pareto distribution

### Phase 7: Loyalty, Promotions, and Commercial Expansion

Goal:
- improve conversion, retention, and omnichannel readiness

DB tickets:

- `DB-601` Create `promotion_rules` (type [percentage, fixed, bogo, tiered, time_based], conditions JSON, rewards JSON, priority, stackable, start_date, end_date)
- `DB-602` Create `coupons` (code, promotion_rule_id, usage_limit, used_count, valid_from, valid_to)
- `DB-603` Create `loyalty_accounts` (customer_id, points_balance, tier)
- `DB-604` Create `loyalty_transactions` (account_id, type [earn, redeem, expire, adjust], points, reference)
- `DB-605` Create `loyalty_tiers` (name, min_points, multiplier, benefits JSON)
- `DB-606` Extend order/fulfillment records for sales channel and delivery mode (online, in_store, phone)

tRPC tickets:

- `API-601` Promotion engine: evaluate cart against active rules, apply best/stackable discounts
- `API-602` Coupon validation and redemption
- `API-603` Loyalty earn on sale (configurable points per currency unit or per product)
- `API-604` Loyalty redeem as payment method in checkout
- `API-605` Points expiry batch job
- `API-606` Omnichannel fulfillment procedures for pickup and delivery mode selection

UI tickets:

- `UI-601` Promotion management: rule builder with condition/reward configuration
- `UI-602` Coupon management and generation (bulk codes)
- `UI-603` Checkout: automatic promotion application with applied/rejected display
- `UI-604` Checkout: loyalty points display, earn preview, and redeem option
- `UI-605` Customer profile: loyalty history, tier status, available rewards
- `UI-606` Omnichannel order queue with pickup/delivery states

Test tickets:

- `TEST-601` BOGO promotion correctly identifies trigger and reward items
- `TEST-602` Promotion priority/stacking follows defined rules
- `TEST-603` Coupon single-use prevents double redemption
- `TEST-604` Loyalty refund reverses earned points
- `TEST-605` Tier upgrade triggers on reaching threshold

### Phase 8: Employee Management and Audit Trail

Goal:
- support full employee lifecycle and operational accountability

DB tickets:

- `DB-701` Create `employee_shifts` (user_id, site_id, clock_in, clock_out, break_minutes, status)
- `DB-702` Create `employee_commissions` (user_id, sale_id, rate, amount, status [pending, paid, clawed_back])
- `DB-703` Create `commission_rules` (product_category_id, rate_type [flat, percentage, tiered], rate_value)
- `DB-704` Create `audit_logs` (entity_type, entity_id, action, before_json, after_json, user_id, override_user_id, terminal, timestamp)
- `DB-705` Create `approval_policies` (action_type, threshold, required_role)
- `DB-706` Create `approval_events` (policy_id, requested_by, approved_by, status)

tRPC tickets:

- `API-701` Shift clock in/out, break tracking, overtime calculation
- `API-702` Commission calculation on sale, clawback on return
- `API-703` Commission payout report with period aggregation
- `API-704` Audit log recording for all sensitive actions (sale void, refund, price override, inventory adjustment, user change, backup restore)
- `API-705` Approval workflow for threshold-exceeding actions (discount > X%, PO > $Y)
- `API-706` Employee performance metrics: sales/hour, ATV, items/transaction, returns rate

UI tickets:

- `UI-701` Employee shift management: clock in/out, active shifts view
- `UI-702` Commission rules configuration per category/product
- `UI-703` Commission report per employee per period
- `UI-704` Audit log viewer with filters by entity, action, user, date
- `UI-705` Approval inbox for pending approvals
- `UI-706` Employee performance dashboard with ranking

Test tickets:

- `TEST-701` Clock in/out records correct timestamps
- `TEST-702` Commission clawback reverses on return
- `TEST-703` Audit log captures before/after state correctly
- `TEST-704` Approval blocks action until resolved

### Phase 9: Advanced Reporting and Business Intelligence

Goal:
- provide actionable insights beyond basic sales/inventory views

DB tickets:

- `DB-801` Create materialized/cached `daily_sales_summary` (site, date, revenue, cost, margin, transactions, items, avg_basket)
- `DB-802` Create `daily_inventory_snapshot` for trend analysis
- `DB-803` Create `customer_cohorts` for retention analysis

tRPC tickets:

- `API-801` Sales KPIs: ATV, UPT, basket size, hourly sales curve, comp sales
- `API-802` Inventory KPIs: GMROI, turnover, days of supply, stockout rate, shrinkage rate
- `API-803` Customer KPIs: CLV (simplified), retention rate, purchase frequency, recency
- `API-804` Employee KPIs: sales/hour, ATV per employee, conversion per employee
- `API-805` Exception alerts: unusual void rate, cash variance > threshold, sudden sales drop
- `API-806` Drill-down API: organization → site → category → product → transactions
- `API-807` Export: scheduled report email/download

UI tickets:

- `UI-801` Executive dashboard with sparklines, trend indicators, top/bottom performers
- `UI-802` Operational dashboard: hourly sales curve (today vs last week), current activity
- `UI-803` Inventory intelligence dashboard: ABC chart, aging heatmap, reorder alerts
- `UI-804` Customer insights: cohort retention chart, CLV distribution, segments
- `UI-805` Exception-based alert panel on main dashboard
- `UI-806` Drill-down navigation: click to zoom from summary to detail
- `UI-807` Custom date range picker with comparison periods
- `UI-808` Report builder: configurable columns, filters, grouping, export

Test tickets:

- `TEST-801` Daily summary aggregation matches transaction-level data
- `TEST-802` GMROI calculation matches formula
- `TEST-803` Comp sales excludes stores open < 1 year

### Phase 10: Hybrid Database Runtime

Goal:
- allow SQLite local runtime plus PostgreSQL-compatible remote truth

DB tickets:

- `DB-901` Introduce a dialect abstraction package (`packages/db-core` or similar)
- `DB-902` Port schema definitions to shared schema → generate `sqliteTable` and `pgTable` variants
- `DB-903` Create Postgres migration path and bootstrap tooling
- `DB-904` Define upload queue / operation log schema independent of local storage engine
- `DB-905` Normalize all boolean, timestamp, JSON, and UUID handling across dialects

tRPC tickets:

- `API-901` Move core services to repository interfaces that accept either dialect
- `API-902` Add remote sync/apply endpoints for operation batches
- `API-903` Add remote conflict response model with field/entity/version context
- `API-904` Add server capability negotiation (client asks server: "what dialect? what features?")

UI tickets:

- `UI-901` Admin settings for remote authority configuration (URL, credentials, sync mode)
- `UI-902` Improved sync center with upstream status, queue policy, and topology mode display
- `UI-903` Conflict resolution UI with richer entity diffing (side-by-side local vs remote)

Test tickets:

- `TEST-901` Run full contract suite against SQLite
- `TEST-902` Run full contract suite against PostgreSQL
- `TEST-903` Offline write then reconnect replay scenarios
- `TEST-904` Multi-client conflict scenarios with resolution

### Phase 11: Fiscal, Accounting, and Integration Layer

Goal:
- make the platform market-ready for broader deployment, with Colombia DIAN compliance as first priority

#### Colombia DIAN Fiscal Compliance — Technical Specification

This section is based on deep research of current DIAN regulations (Resolución 000165/2023, Resolución 000008/2024, Resolución 000202/2025).

**Mandatory electronic documents for Colombia POS**:

1. **Documento Equivalente POS Electrónico (DEE)**: Replaced traditional paper POS receipts. Mandatory since May-July 2024 (depending on taxpayer category). Must be XML UBL 2.1, digitally signed, transmitted to DIAN for validation, and carry a CUDE (Código Único de Documento Equivalente).

2. **Factura Electrónica de Venta**: Full electronic invoice. XML UBL 2.1 per Anexo Técnico v1.9 (mandatory since May 1, 2024). Carries a CUFE (Código Único de Factura Electrónica) calculated with SHA-384.

3. **Nota Crédito Electrónica**: Required to decrease value of a previously issued invoice (discounts, returns, annulments). Must reference original invoice in `cac:BillingReference`.

4. **Nota Débito Electrónica**: Required to increase value. DIAN recommends issuing a new invoice instead for the additional amount.

**DIAN web service endpoints**:
- Habilitación (test): `https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc`
- Producción: `https://vpfe.dian.gov.co/WcfDianCustomerServices.svc`
- WSDL available at each endpoint with `?wsdl` suffix

**Digital signature requirements**:
- XMLDSig enveloped, XAdES-EPES format per ETSI TS 101 903
- Certificate from ONAC-authorized entity (e.g., GSE)
- SOAP envelope also requires WS-Security signature for DIAN service authentication
- DIAN signature policy: `https://facturaelectronica.dian.gov.co/politicadefirma/v2/politicadefirmav2.pdf`

**Habilitación (testing/certification) process**:
1. Register at DIAN electronic invoicing portal
2. Configure software to connect to habilitación environment
3. Successfully transmit test documents (invoices, credit notes, debit notes, DEE)
4. Once all test sets pass validation, software is enabled for production

**Contingency mode**: When DIAN services are unavailable, invoices must still be generated and delivered to customer. Pre-authorized contingency numbering required. Once service is restored, contingency invoices must be transmitted within 30 calendar days. Per Resolución 000202/2025, 48-hour window for on-site invoicing with connectivity issues.

**Penalties**: 1% of un-invoiced operations value (Art. 652 ET), 5% for irregularities, and temporary closure of establishment after 3 months of non-compliance (Art. 684-2 ET). DIAN actively using AI for detection (183,000+ inspections in 2024).

**Key mandatory fields for DEE/POS electrónico**:
- DIAN-authorized numbering range (prefix + number range)
- CUDE (SHA-384 hash)
- Seller NIT, name/razón social
- Buyer identification (type, number, name — per Resolución 000202/2025, only 3 data points may be requested)
- Date and time of issuance
- Itemized lines with quantities, unit values, tax breakdown (IVA, INC)
- Total value
- Digital signature (XAdES-EPES)
- QR code for verification

**Key technical documentation links**:
- Anexo Técnico Factura Electrónica v1.9: `https://www.dian.gov.co/impuestos/factura-electronica/Documents/Anexo-Tecnico-Factura-Electronica-de-Venta-vr-1-9.pdf`
- Anexo Técnico DEE v1.0: `https://www.dian.gov.co/impuestos/factura-electronica/Documents/Anexo-Tecnico-Documento-Equivalente-Electronico-V1-0-final.pdf`
- Resolución 000202/2025: `https://www.dian.gov.co/normatividad/Normatividad/Resoluci%C3%B3n%20000202%20de%2031-03-2025.pdf`
- Open source reference: `https://github.com/soenac/api-dian` (SOENAC UBL 2.1 API)

DB tickets:

- `DB-1001` Create `fiscal_documents` (type [dee, invoice, credit_note, debit_note], xml_content, cufe_cude, status [draft, signed, sent, accepted, rejected], dian_response, numbering_range_id, related_document_id)
- `DB-1002` Create `fiscal_numbering_ranges` (prefix, from_number, to_number, current_number, resolution_number, resolution_date, valid_from, valid_to, document_type)
- `DB-1003` Create `fiscal_certificates` (certificate_data, password_encrypted, issuer, valid_from, valid_to, status)
- `DB-1004` Create `credit_notes` and `debit_notes` with proper accounting document model and `cac:BillingReference` to original
- `DB-1005` Create `fiscal_contingency_log` (document_id, reason, generated_at, transmitted_at, dian_response)
- `DB-1006` Create `supplier_invoices`, `purchase_requests`, `supplier_quotes`, `landed_cost_allocations`
- `DB-1007` Create `api_keys`, `webhooks`, `webhook_deliveries`
- `DB-1008` Create `currency_rates` for multi-currency support

tRPC tickets:

- `API-1001` Fiscal adapter service contract (TypeScript interface that country modules implement: `generateXml`, `sign`, `transmit`, `handleResponse`, `generateContingency`)
- `API-1002` Colombia DIAN adapter: UBL 2.1 XML generation for DEE, invoice, credit note, debit note
- `API-1003` CUFE/CUDE calculation service (SHA-384 with DIAN technical control key)
- `API-1004` XAdES-EPES digital signature service (enveloped XMLDSig)
- `API-1005` DIAN SOAP web service client (habilitación + production endpoints, WS-Security)
- `API-1006` Numbering range management: request, track consumption, alert on near-exhaustion
- `API-1007` Contingency mode: detect DIAN unavailability, use contingency numbering, queue for later transmission
- `API-1008` Credit note and debit note lifecycle with BillingReference to original document
- `API-1009` Procurement approvals and landed cost services
- `API-1010` Multi-currency: rate management, transaction currency, reporting currency, conversion
- `API-1011` Public API: REST facade over tRPC for external consumers, API key authentication
- `API-1012` Webhook registration, event matching, signed delivery with retry
- `API-1013` Accounting integration events (sale, return, credit note, purchase → journal entries for external accounting)

UI tickets:

- `UI-1001` Fiscal document status views (per document type, with DIAN validation status)
- `UI-1002` Numbering range management (current consumption, alerts, request new range)
- `UI-1003` Digital certificate upload and management
- `UI-1004` DIAN habilitación testing wizard (send test documents, verify acceptance)
- `UI-1005` Credit/debit note creation with original document reference
- `UI-1006` Contingency mode indicator in POS header + contingency document queue
- `UI-1007` Multi-currency settings and rate management
- `UI-1008` Integration and webhook admin screens
- `UI-1009` API key management
- `UI-1010` Accounting export/sync status

Test tickets:

- `TEST-1001` CUFE/CUDE SHA-384 calculation matches DIAN test vectors
- `TEST-1002` UBL 2.1 XML generation validates against DIAN XSD schema
- `TEST-1003` XAdES-EPES signature is valid per ETSI TS 101 903
- `TEST-1004` Credit note references original invoice correctly in BillingReference
- `TEST-1005` Contingency numbering activates when DIAN endpoint is unreachable
- `TEST-1006` Contingency documents transmit after connectivity restored
- `TEST-1007` Webhook signing and retry tests
- `TEST-1008` Multi-currency conversion accuracy
- `TEST-1009` API key authentication and rate limiting

#### Phase 11 Extension: Country-Parametrizable Fiscal Rules

Goal:
- remove all Colombia-hardcoded fiscal logic from application code and replace with a profile-driven system so any country's rules can be configured without code changes

DB tickets:

- `DB-1020` Create `country_fiscal_profiles` (country_code PK ISO alpha-2, name, currency_code ISO 4217, tax_config_json, tip_config_json, electronic_invoicing_config_json, withholding_config_json, regime_types_json, municipal_taxes_json, updated_at)
- `DB-1021` Seed `country_fiscal_profiles` with "CO" (Colombia) profile: all existing IVA/INC rates, propina Ley 1935/2018 rules, DIAN DEE + factura configuration, retención en la fuente, ICA, all Colombian regime codes — existing behavior is 100% preserved, now driven by profile
- `DB-1022` Create `company_fiscal_overrides` (company_id FK PK, tax_config_json nullable, tip_config_json nullable, electronic_invoicing_config_json nullable, withholding_config_json nullable, notes — company-level deviations from country defaults, e.g., free-zone companies with tax exemptions)
- `DB-1023` Alter `fiscal_documents.document_type` to accept profile-defined document type codes (not hardcoded DEE/INVOICE enum), and add `fiscal_adapter_code` column tracking which adapter generated each document

tRPC tickets:

- `API-1020` `fiscalProfiles.list` — list all seeded country fiscal profiles (country_code, name, currency_code)
- `API-1021` `fiscalProfiles.get` — fetch full profile by country_code including all JSON config
- `API-1022` `fiscalProfiles.resolve(companyId)` — return the effective profile for a company: merges company_fiscal_overrides on top of country profile; this is the function called by all tax calculation paths
- `API-1023` `fiscalProfiles.updateOverride` — set company-level fiscal overrides (admin role, audit-logged)
- `API-1024` Tax engine refactor: replace all Colombia-hardcoded rate lookups with calls to `fiscalProfiles.resolve(companyId).tax_config`; make `computeTax(lineItems, profile)` a pure function; mutual exclusion groups enforced from profile config (not from hardcoded IVA vs INC logic)
- `API-1025` Tip rules refactor: replace hardcoded Ley 1935/2018 constants with `profile.tip_config`; tip dialog shown only when `tip_rules.enabled = true`; consent text, max %, and exclusion-from-tax-base all read from profile; `distribution_required` flag drives reporting obligation
- `API-1026` Fiscal adapter factory: `getFiscalAdapter(profile.electronic_invoicing_config.adapter)` returns the correct adapter instance; supported adapter codes: `"dian_colombia"` (existing implementation), `"none"` (no e-invoicing); future adapters (`"sri_ecuador"`, `"sunat_peru"`, `"sii_chile"`) pluggable without touching existing code
- `API-1027` `sales.create` refactor: resolve profile before document type selection; use `profile.electronic_invoicing_config.pos_document_type` for cash sales and `profile.electronic_invoicing_config.credit_sale_document_type` for credit sales (connects to Phase 5 Extension credit sales)
- `API-1028` Regime type refactor: `companies.fiscal_regime` values are validated against `profile.regime_types[].code`, not a hardcoded Colombian enum; regime-based tax behavior (charges_vat, withholding_agent) read from profile
- `API-1029` Add "CO" default fiscal profile seeding to DB bootstrap so that existing deployments work after migration with zero behavior change

UI tickets:

- `UI-1020` Company settings: replace hardcoded Colombian fiscal regime dropdown with profile-driven regime selector (options loaded from resolved profile)
- `UI-1021` Tax rate selector on products: load available tax types and rates from active fiscal profile, not hardcoded constants
- `UI-1022` POS tip dialog: render consent text and max % from active profile; hide tip option entirely when `tip_rules.enabled = false`; show distribution notice when `distribution_required = true`
- `UI-1023` Fiscal profile admin view (superadmin only): list profiles, view full JSON config, create custom profiles for unlisted countries
- `UI-1024` Company fiscal override editor: allow company admins to see their effective fiscal profile and set overrides (subject to access control)

Test tickets:

- `TEST-1020` Colombia "CO" profile resolves all existing tax rates correctly (IVA 0%/5%/19%, INC 8%)
- `TEST-1021` `computeTax` with CO profile produces identical results to previous hardcoded implementation for all existing test cases
- `TEST-1022` Mutual exclusion: IVA and INC on same product line triggers error when both assigned (profile: mutual_exclusion_group = "consumption_tax")
- `TEST-1023` Tip dialog renders with CO profile (enabled, 10% max, consent required, excluded from tax base)
- `TEST-1024` Tip dialog is suppressed for a hypothetical country profile with `tip_rules.enabled = false`
- `TEST-1025` Fiscal adapter factory returns `DianColombiaAdapter` for CO profile
- `TEST-1026` Fiscal adapter factory returns `NullAdapter` for profile with `adapter = "none"`
- `TEST-1027` `fiscalProfiles.resolve` merges company_fiscal_overrides on top of country profile correctly
- `TEST-1028` Colombian regime type "NO_RESPONSABLE_IVA" resolves `charges_vat = false` from profile (not hardcoded)
- `TEST-1029` Credit sale in CO profile uses `"INVOICE"` document type (not `"DEE"`) per `credit_sale_document_type` config
- `TEST-1030` Seeded CO profile is present in DB after bootstrap; all existing e2e tests pass without change

### Phase 12: Restaurant and Service Vertical Modules

Goal:
- enable the POS to serve restaurant, food service, and appointment-based service businesses

DB tickets:

- `DB-1101` Create `tables` (site_id, name, capacity, zone, status [available, occupied, reserved])
- `DB-1102` Create `table_sessions` (table_id, sale_id, covers, opened_at, closed_at)
- `DB-1103` Create `kitchen_orders` (sale_id, station, items JSON, status [pending, preparing, ready, served])
- `DB-1104` Create `product_modifiers` and `modifier_groups` (required, min_select, max_select)
- `DB-1105` Create `appointments` (customer_id, employee_id, service_product_id, start_at, end_at, status)
- `DB-1106` Create `tip_records` (sale_id, employee_id, amount, tip_pool_id)

tRPC tickets:

- `API-1101` Table management: assign, transfer, merge, split
- `API-1102` Kitchen order routing: send to station, update status, notify ready
- `API-1103` Course firing: hold courses until fired by server
- `API-1104` Modifier application to sale items with price adjustments
- `API-1105` Split check: divide a table session into multiple sales
- `API-1106` Tip management (Ley 1935/2018 compliant): mandatory consent dialog before finalizing sale, suggested amount ≤ 10%, tip excluded from all tax bases (IVA, INC), tip distribution tracking among ALL service workers, monthly settlement records
- `API-1107` Appointment CRUD with calendar view and conflict detection
- `API-1108` Auto-86ing: automatically disable items when ingredient stock hits zero
- `API-1109` Menu entity with daypart scheduling: create menus with time/day rules, resolve active menu at checkout based on time + channel (dine-in, takeout, delivery), menu-specific pricing overrides per product
- `API-1110` Combo/set menu engine: define combos with slots (main + side + drink), slot constraints (min/max selections), fixed combo pricing, automatic combo detection at checkout, prix fixe support for "almuerzo ejecutivo"
- `API-1111` Kitchen printer routing: map products to station printers (grill, bar, cold prep), split order across multiple printers, reprint/void tickets per station

UI tickets:

- `UI-1101` Floor plan editor: drag-and-drop table placement
- `UI-1102` Table status grid with color-coded occupancy
- `UI-1103` Kitchen Display System (KDS): order cards with timers, bump bar support
- `UI-1104` Modifier selection in checkout item detail
- `UI-1105` Split check dialog with item-level or equal-split options
- `UI-1106` Tip consent dialog (Ley 1935 compliance): "¿Desea incluir la propina voluntaria?" with Sí (10%) / No / Otro valor buttons. Must appear BEFORE payment is finalized.
- `UI-1107` Appointment calendar with employee lanes and booking
- `UI-1108` Service mode checkout with duration and consumables
- `UI-1109` Menu management: create/edit menus with daypart schedules, assign products with menu-specific prices
- `UI-1110` Combo builder: define combo slots with product options, set combo price, preview margin
- `UI-1111` Kitchen printer configuration: map printers to stations, test print per station

Test tickets:

- `TEST-1101` Table session links correctly to sale
- `TEST-1102` Kitchen order status transitions are valid
- `TEST-1103` Split check math distributes items correctly
- `TEST-1104` Tip pool distribution is proportional across all service workers
- `TEST-1105` Appointment conflict detection prevents double-booking
- `TEST-1106` Tip is excluded from consumption tax (INC 8%) base calculation
- `TEST-1107` Tip consent flag is mandatory before payment — cannot skip
- `TEST-1108` Daypart menu auto-activates at configured time
- `TEST-1109` Combo pricing applies correctly when all slots are filled
- `TEST-1110` Kitchen printer routing sends correct items to correct station printer

### Phase 13: Pharmacy Vertical Module

Goal:
- enable legal pharmacy operations in Colombia through regulatory-compliant dispensing, tracking, and reporting

Prerequisites: Phase 0 (module activation, JSON metadata), Phase 6 (lot/batch/expiry, serial tracking), Phase 11 (DIAN fiscal documents)

DB tickets:

- `DB-1201` Create `prescriptions` (patient_id, prescriber_name, prescriber_license, date, diagnosis_cie10, validity_days, status [active, partial, fulfilled, expired])
- `DB-1202` Create `prescription_items` (prescription_id, product_id, dosage, quantity_authorized, quantity_dispensed, refill_count, refill_remaining)
- `DB-1203` Create `dispensation_records` (prescription_item_id, sale_item_id, lot_id, quantity, dispensed_by, dispensed_at)
- `DB-1204` Create `controlled_substance_ledger` (product_id, lot_id, date, type [purchase, dispensation, adjustment, destruction], quantity, running_balance, prescription_id, patient_id, created_by)
- `DB-1205` Create `fne_reports` (period, status [draft, submitted], submitted_at, file_content)
- `DB-1206` Create `rips_records` (sale_id, patient_id, eps_id, diagnosis_cie10, copago, cuota_moderadora, items JSON, rips_file_content)
- `DB-1207` Add pharmacy-specific product fields: `invima_registro_sanitario`, `controlled_schedule` (enum: none, I, II, III, IV), `inn_dci`, `atc_code`, `pharmaceutical_form`, `concentration`, `storage_condition` (enum: room, cold_2_8, frozen_minus20), `max_regulated_price`, `price_regulation_source`
- `DB-1208` Create `eps_contracts` (eps_id, eps_name, contract_number, copago_rules JSON)
- `DB-1209` Create `equivalence_groups` (inn_dci, pharmaceutical_form, concentration) for generic substitution

tRPC tickets:

- `API-1201` Prescription CRUD with validity checking, partial dispensing, and refill tracking
- `API-1202` Controlled substance dispensation with ledger entry and prescription requirement enforcement
- `API-1203` FNE monthly report generation (Fondo Nacional de Estupefacientes format)
- `API-1204` RIPS generation per EPS contract (Resolución 3374/2000 format)
- `API-1205` SISMED price report generation (ATC code + Registro Sanitario + quantities + prices)
- `API-1206` Regulated price ceiling enforcement at POS (block sale above CNPMDM ceiling)
- `API-1207` Generic substitution suggestions at POS (lookup by INN/DCI group)
- `API-1208` Patient medication history lookup by cédula
- `API-1209` INVIMA recall processing: quarantine lot, identify affected patients, generate notification list

UI tickets:

- `UI-1201` Prescription capture form at POS (prescriber, patient, items, Rx scan/photo)
- `UI-1202` Controlled substance dispensation flow with ledger confirmation
- `UI-1203` Patient medication history lookup screen
- `UI-1204` FNE report generation and submission tracking
- `UI-1205` RIPS generation per EPS billing period
- `UI-1206` SISMED report generation
- `UI-1207` Generic substitution suggestion popup at POS
- `UI-1208` Regulated price alert/block on product pricing
- `UI-1209` INVIMA recall management: affected lots, patient notifications

Test tickets:

- `TEST-1201` Controlled substance sale requires valid prescription
- `TEST-1202` Partial dispensing tracks remaining authorized quantity
- `TEST-1203` FNE ledger running balance is accurate
- `TEST-1204` Expired prescription blocks dispensation
- `TEST-1205` Regulated price ceiling prevents over-pricing
- `TEST-1206` RIPS file format matches Resolución 3374 specification

### Phase 14: Supermarket Vertical Module

Goal:
- enable full supermarket operations with weighing, produce management, and perishable workflows

Prerequisites: Phase 0 (module activation), Phase 1 (fractional quantities), Phase 6 (lot/batch/expiry), Phase 7 (promotions)

DB tickets:

- `DB-1301` Create `scale_configurations` (site_id, port, baud_rate, protocol [toledo, cas, mettler, generic], parity, data_bits, stop_bits)
- `DB-1302` Create `plu_codes` (product_id, plu_number, barcode_prefix, price_embedded, weight_embedded)
- `DB-1303` Create `departments` (name, code, parent_department_id, margin_target) — supermarket department hierarchy separate from product categories
- `DB-1304` Create `shrinkage_records` (product_id, department_id, type [theft, damage, spoilage, admin_error, markdown], quantity, value, recorded_by, date)
- `DB-1305` Create `dsd_receiving` (vendor_id, site_id, items JSON, received_by, verified_by, date, status)
- `DB-1306` Add product fields for supermarket: `sold_by_weight` flag, `plu_code`, `age_restricted` flag, `age_minimum`, `department_id`, `perishable` flag, `shelf_life_days`
- `DB-1307` Create `vendor_promotions` (vendor_id, product_id, allowance_amount, promotion_period, rebate_type, status)

tRPC tickets:

- `API-1301` Scale reading service: connect to serial/USB scale, request weight, return value
- `API-1302` Variable-weight barcode parsing: decode GS1 DataBar embedded price/weight from scanned barcode
- `API-1303` Age restriction enforcement at POS: prompt for ID verification, log check
- `API-1304` Department-level P&L reporting: sales, cost, margin, shrinkage by department
- `API-1305` Shrinkage recording and analysis by type and department
- `API-1306` DSD receiving workflow: vendor-direct receiving with verification
- `API-1307` Automated markdown rules for near-expiry perishables
- `API-1308` Impuesto saludable calculation (sugary drinks, ultra-processed products per Ley 2277/2022)

UI tickets:

- `UI-1301` Scale connection setup and test page
- `UI-1302` POS: automatic weight reading for products marked `sold_by_weight`
- `UI-1303` Age verification prompt at POS for restricted products
- `UI-1304` Department-level reporting dashboard
- `UI-1305` Shrinkage recording form and trend reports
- `UI-1306` DSD receiving screen (vendor arrives with product, staff verifies and records)
- `UI-1307` Perishable markdown management with expiry-based rules

Test tickets:

- `TEST-1301` Variable-weight barcode correctly decodes embedded price/weight
- `TEST-1302` Age-restricted product blocks sale without verification
- `TEST-1303` Department shrinkage totals match individual records
- `TEST-1304` Impuesto saludable applies correct rate by product category

### Phase 15: Hardware Store (Ferretería) Vertical Module

Goal:
- enable ferretería-specific workflows: fractional selling, unit conversion, project quoting, contractor accounts

Prerequisites: Phase 0 (module activation, JSON metadata), Phase 1 (fractional quantities), Phase 5 (quotations, customer credit)

DB tickets:

- `DB-1401` Create `product_sale_units` (product_id, unit_id, conversion_factor, is_default_sale_unit, barcode) — a product can be sold in multiple units with conversion factors
- `DB-1402` Create `service_charges` (name, price, unit, description) — cut-to-size, delivery, etc.
- `DB-1403` Create `project_templates` (name, description, items JSON) — "bathroom remodel kit", "electrical kit"
- `DB-1404` Add product technical specification fields via JSON metadata: `voltage`, `amperage`, `diameter`, `thread_type`, `material`, `length`, `weight_per_unit`, etc.
- `DB-1405` Create FTS5 virtual table `products_fts` for full-text product search across name, code, barcode, and technical specs

tRPC tickets:

- `API-1401` Multi-unit product sale: select sale unit → apply conversion factor → calculate price per sale unit
- `API-1402` In-house barcode generation: auto-generate EAN-13 with internal prefix, link to product
- `API-1403` Project template management: create/edit templates, apply template to quotation (explode all items)
- `API-1404` Service charge application to sale lines
- `API-1405` Partial-use return: return fractional quantity of a product
- `API-1406` Full-text product search using FTS5: search by name, code, barcode, or technical specs
- `API-1407` Bulk pricing tier auto-application at POS based on line quantity

UI tickets:

- `UI-1401` Product form: manage multiple sale units with conversion factors
- `UI-1402` POS: unit selector on sale line (meters, kilos, sheets, etc.)
- `UI-1403` Barcode generation and label print button on product form
- `UI-1404` Project template builder (drag products, set quantities)
- `UI-1405` Quote from project template (customer selects template → pre-filled quote)
- `UI-1406` Service charge addition at POS (cutting fee, delivery fee)
- `UI-1407` Enhanced product search with fuzzy matching and technical spec filters

Test tickets:

- `TEST-1401` Unit conversion correctly calculates price per sale unit
- `TEST-1402` Generated barcode is valid EAN-13 with correct check digit
- `TEST-1403` Project template explodes all items into quotation
- `TEST-1404` Bulk pricing applies correct tier based on quantity
- `TEST-1405` Partial-use return restocks correct fractional quantity
- `TEST-1406` FTS5 search returns relevant results for technical specs

## 13. Colombia Payment Ecosystem

### 13.1 Payment Gateways and Processors

| Gateway | Focus | Supported Methods | Node.js SDK | POS/In-Person | Pricing (approx.) |
| --- | --- | --- | --- | --- | --- |
| **Wompi** (Bancolombia) | Colombia-first | Cards, PSE, Nequi, Bancolombia QR, Corresponsal bancario, Efecty | REST API, community packages | No native POS terminal; online/API focus | 2.99% cards, PSE COP $3,500/tx |
| **ePayco** | Colombian aggregator | Cards, PSE, Efecty, Baloto, Daviplata, bank accounts | `epayco-sdk-node` on npm/GitHub | Limited POS; primarily online | ~3.49% cards + VAT |
| **MercadoPago** | LatAm-wide | Cards, PSE, Efecty, account balance, installments | `mercadopago` npm (official, maintained) | Yes — Mercado Pago Point terminals | 3.49% + COP $900 cards |
| **PayU Latam** | LatAm-wide | Cards, PSE, Efecty, Baloto, bank reference, Nequi | REST API, community SDKs | No native terminal | ~3.49% cards |
| **Bold** | Colombia POS terminal | Cards (Visa, Mastercard, Amex), contactless (NFC) | REST API for reporting | **Yes — own hardware terminals (Smart, Plus)** | 2.69-2.79% per tx, no monthly fee |
| **Kushki** | Modern LatAm infra | Cards, PSE, bank transfers, cash, wallets | REST API, JS SDK | API-driven, no own terminal | Custom enterprise pricing |
| **SumUp** | Global micro-merchant | Cards, NFC/contactless | REST API | **Yes — SumUp Air, Solo terminals** | ~3.25% per tx in Colombia |

### 13.2 Colombian-Specific Payment Methods

| Method | Type | How It Works | Integration Path |
| --- | --- | --- | --- |
| **PSE (Pagos Seguros en Línea)** | Bank transfer | Customer selects bank, redirected to bank site, confirms, returns. Near-instant confirmation. | Via Wompi, ePayco, PayU, or ACH Colombia. Not directly accessible — must go through aggregator. |
| **Nequi** | Digital wallet | Customer scans QR or approves push notification. Instant P2P or P2M payments. 18M+ users. | Via Wompi API (Bancolombia owns Nequi). Also via ePayco, PayU. QR-based or push notification flow. |
| **Daviplata** | Digital wallet | Davivienda's wallet. Similar to Nequi — QR or OTP-based. 16M+ users. | Via ePayco or PayU. Less API-friendly than Nequi for third parties. |
| **Bancolombia QR** | QR payment | Customer scans QR with Bancolombia or Nequi app. Instant settlement. | Via Wompi API. Generate QR → customer scans → webhook confirmation. |
| **Efecty** | Cash network | Customer gets reference code, pays at any Efecty point (thousands of locations). Settlement T+1 or T+2. | Via ePayco, PayU, Wompi. Generate payment reference → customer pays → webhook confirmation. |
| **Baloto** | Cash network | Similar to Efecty. Pay at Baloto points across Colombia. | Via ePayco, PayU. Same flow as Efecty. |
| **Corresponsal bancario** | Cash at stores | Pay at convenience stores (Éxito, Surtimax, etc.) acting as bank correspondents. | Via Wompi. Similar reference code flow. |
| **Tarjeta de crédito/débito** | Card | Visa, Mastercard, American Express, Diners. Processed through Credibanco or Redeban networks. | Via any gateway. Bold for in-person. |

### 13.3 Payment Terminal Hardware in Colombia

| Terminal | Provider | Connectivity | Key Features | POS Integration |
| --- | --- | --- | --- | --- |
| **Bold Smart** | Bold (Colombian fintech) | 4G + WiFi | Touchscreen, prints receipt, NFC, chip, swipe, QR | Closed ecosystem — Bold app only. No third-party API for transaction initiation from external POS. Reporting API available. |
| **Bold Plus** | Bold | 4G + WiFi | Smaller/simpler, NFC, chip | Same as Smart — closed for transaction initiation. |
| **Mercado Pago Point** | MercadoLibre | Bluetooth + phone | NFC, chip, swipe, connects to phone app | Semi-open — MercadoPago API can create payments. Point device processes card. Bluetooth pairing with phone/tablet. |
| **SumUp Air / Solo** | SumUp | Bluetooth / WiFi | NFC, chip, compact | SumUp API for payment initiation. Bluetooth pairing model. Node.js integrable. |
| **Datafono bancario** | Banks (via Credibanco/Redeban) | Fixed line, WiFi, 4G | Traditional bank terminals. Verifone, Ingenico, PAX hardware. | Mostly closed. Semi-integrated mode possible with some models (ISO 8583 protocol). Bank relationship required. |

**Key insight for Puntovivo**: Bold terminals are dominant in Colombia for small businesses but their closed ecosystem limits POS integration. MercadoPago Point and SumUp offer better API integration paths. For custom POS hardware integration, consider the semi-integrated terminal model via payment gateway APIs rather than trying to directly control bank terminals.

### 13.4 Recommended Payment Integration Strategy

**Phase 1 — Immediate (software payments)**:
- Integrate Wompi as primary gateway (best Colombian coverage: cards, PSE, Nequi, Bancolombia QR, Efecty)
- Support `sale_payments` multi-tender model: cash + card + digital wallet per transaction
- Record payment method and gateway reference per tender

**Phase 2 — Terminal integration**:
- MercadoPago Point via Bluetooth API (most API-friendly terminal available in Colombia)
- SumUp as alternative terminal option
- Implement the semi-integrated terminal pattern: POS sends amount → terminal processes card → POS receives confirmation

**Phase 3 — Full ecosystem**:
- ePayco as secondary gateway (adds Daviplata, broader Baloto coverage)
- WhatsApp payment links for remote sales
- QR code generation for Nequi/Bancolombia direct payments at POS counter

### 13.5 Regulatory Considerations

- **Retención en la fuente**: Card processors withhold income tax (retención) on transactions above certain thresholds. The POS should record gross vs net received amounts per payment.
- **IVA on processing fees**: 19% IVA applies to payment processing fees. This affects the true cost of each gateway.
- **GMF (4x1000)**: Financial transactions tax of 0.4% applies to bank account movements. Affects settlement calculations. Some accounts are exempt (first account designated by each taxpayer).
- **Superintendencia Financiera**: Payment aggregators like Wompi, ePayco, Bold operate under SFC regulation. The POS software itself does not need SFC licensing unless it holds customer funds.
- **Data protection (Ley 1581 de 2012 — Habeas Data)**: Customer payment data must comply with Colombia's data protection law. PAN masking, no raw card storage, customer consent for data use.

## 14. POS Hardware Integration Patterns

### 14.1 Thermal Receipt Printers

**ESC/POS Protocol**: Epson's Standard Code for POS printers. De-facto industry standard supported by nearly all thermal receipt printers (Epson, Star Micronics, HPRT, Xprinter, Bixolon, Citizen, etc.). Command-based protocol: byte sequences control text formatting, image printing, barcode rendering, paper cutting, and cash drawer opening.

**Node.js libraries**:

| Package | Interface | Status | Notes |
| --- | --- | --- | --- |
| `node-thermal-printer` | USB, Network (TCP), Serial | Maintained | Supports Epson, Star, Bixolon. High-level API: `printer.println()`, `printer.printBarcode()`, `printer.printQR()`. **Recommended for Puntovivo.** |
| `escpos` | USB, Network, Serial, Bluetooth | Community | Lower-level ESC/POS. Supports image printing, custom character sets. |
| `receipt-printer-encoder` | Framework-agnostic | By Niels Leenheer | Generates ESC/POS byte arrays. Works in Node and browser. For advanced customization. |

**Connection modes for Electron**:
- **USB**: Via `node-usb` package (direct USB communication from main process). Most reliable for desktop POS.
- **Network (TCP)**: Connect to printer's IP address on port 9100. Works from main or renderer process. Best for shared printers.
- **Serial**: Via `serialport` npm package. For older printers or printers connected via RS-232/USB-serial adapters.
- **Bluetooth**: Via `noble` (BLE) or platform-specific Bluetooth libraries. Best for mobile POS.

**Current Puntovivo status**: Receipt printing is already implemented via the desktop bridge. The existing bridge can be extended to support additional printer types and connection modes.

### 14.2 Barcode Scanners

- **USB HID (keyboard wedge)**: Most USB barcode scanners emulate a keyboard. They "just work" — scanned data appears as keystroke input in whatever field has focus. The POS needs a barcode input listener that detects rapid character entry followed by Enter/CR. **No special driver or library needed.**
- **Serial/COM scanners**: Use `serialport` npm package. Less common now.
- **Camera-based scanning**: Libraries: `@AlesandroJS/barcode-detector` (web standard), `zxing-wasm`, `quagga2`. Useful for mobile/tablet POS. Works via webcam or phone camera.
- **2D/QR support**: Modern scanners and camera libraries support 1D (Code 128, EAN-13, UPC-A) and 2D (QR, Data Matrix) out of the box.

**Current Puntovivo status**: Barcode field exists in products. Keyboard wedge scanners work automatically with the existing product search field.

### 14.3 Cash Drawers

Cash drawers typically connect **through the receipt printer** via an RJ-11 cable. Opening is triggered by sending an ESC/POS pulse command (`ESC p 0 25 250` — DLE DC4). No separate driver needed.

- **Printer-connected**: Send pulse command to the printer → printer triggers drawer. Standard and most reliable.
- **USB-connected**: Some drawers connect directly via USB. These emulate an HID device and respond to specific USB commands. `node-usb` can control these.
- **Integration pattern**: Cash drawer open should be triggered by: (1) completed cash sale, (2) manual open from POS UI (with audit log), (3) cash session open/close. Always log who opened the drawer and when.

### 14.4 Weighing Scales

- **Serial port scales**: Most commercial scales (Toledo, CAS, Adam, Mettler Toledo) use RS-232 serial protocols. Common pattern: POS sends "request weight" command, scale responds with weight value and unit.
- **USB HID scales**: Some modern scales implement USB HID Usage Tables for Point of Sale (HID POS). Weight reading is a standard HID report. `node-hid` package can read these.
- **Integration in checkout**: When a product is marked as "sold by weight", the POS reads the scale before adding to cart. The weight becomes the quantity multiplied by price-per-unit.

### 14.5 Label Printers

- **ZPL (Zebra Programming Language)**: Industry standard for barcode label printers (Zebra, Honeywell). Generate ZPL commands as text strings, send to printer. `jszpl` npm package generates ZPL programmatically.
- **TSPL**: TSC printer language. Similar concept to ZPL but for TSC printers.
- **Brother QL**: Brother label printers use their own protocol. `brother-ql` community packages available.
- **Use cases in POS**: Product barcode labels, price tags, shelf labels, shipping labels, inventory labels.

### 14.6 Payment Terminal Integration Models

| Model | How It Works | Complexity | Flexibility |
| --- | --- | --- | --- |
| **Standalone** | Terminal operates independently. Cashier keys in amount manually. | Very low | None — no POS integration |
| **Semi-integrated** | POS sends amount to terminal via API/socket. Terminal handles card. Returns approval/decline. | Medium | Good — POS controls amount, terminal handles payment security |
| **Fully-integrated** | POS software directly controls terminal hardware (Nexo/SPDH protocol). | High | Full control but requires payment certification |
| **Cloud-integrated** | POS sends payment intent to cloud API. Cloud routes to paired terminal. Terminal processes. Webhook confirms. | Medium | Good — decouples POS from terminal hardware |

**Recommendation for Puntovivo**: Semi-integrated or cloud-integrated model. MercadoPago Point uses cloud-integrated. SumUp uses Bluetooth semi-integrated. Both avoid the complexity of direct terminal control and payment certification requirements.

## 15. LatAm Integration Ecosystem

### 15.1 WhatsApp Business API

**Critical for LatAm POS** — WhatsApp has 90%+ penetration in Colombia. Utility messages cost ~$0.0008 USD each. Service replies are free.

**POS use cases**:
- Digital receipt delivery via WhatsApp after POS transaction
- Order confirmation and tracking notifications
- Delivery status updates
- Customer re-engagement and promotions
- WhatsApp Flows for interactive ordering/catalog browsing

**Node.js SDKs**: `whatsapp-business` (community, TypeScript, well-maintained), official Meta SDK (`WhatsApp/WhatsApp-Nodejs-SDK`), `@great-detail/whatsapp` (ESM + CJS).

**Implementation priority**: P0 — extremely cheap, massive user base, direct revenue impact.

### 15.2 Marketplace and E-Commerce

| Platform | API | Node.js SDK | Inventory Sync | Order Sync | Priority |
| --- | --- | --- | --- | --- | --- |
| **MercadoLibre** | REST, OAuth 2.0 | `mercadolibre-nodejs-sdk` (official) | Items API + webhooks | Orders API + fulfillment | P1 — dominant LatAm marketplace |
| **Shopify** | GraphQL Admin API (mandatory for new apps since April 2025) | `@shopify/shopify-api` v13 (TypeScript-first) | InventoryLevel + InventoryItem per location, webhooks | Orders + Fulfillment APIs | P1 — for merchants with online stores |
| **WooCommerce** | REST API v3 (enabled by default) | `@woocommerce/woocommerce-rest-api` (official) | Full CRUD + batch ops | Orders + inventory webhooks | P1 — very common in LatAm |
| **Rappi** | REST (requires approval) | REST, no SDK | Via menu management API | Order reception with cooking times | P2 — restaurant vertical |
| **Uber Eats** | REST + webhooks | REST, no SDK | Menu API | Full order lifecycle webhooks | P2 — restaurant vertical |
| **iFood / Domicilios.com** | REST (event-driven) | REST, no SDK | Menu API | Event-based order intake | P2 — iFood acquired Domicilios.com |
| **PedidosYa** | REST | REST, no SDK | Catalog API | Real-time order intake | P2 — Delivery Hero owned |

**Third-party aggregators**: Deliverect, GetOrder, Ordatic offer unified middleware connecting to multiple delivery platforms simultaneously. More practical than integrating each platform individually for restaurant vertical.

### 15.3 Colombian Accounting Integration

| Software | API Maturity | Endpoints | Auth | Priority |
| --- | --- | --- | --- | --- |
| **Alegra** | High | REST API: invoices, clients, products, expenses, banks. E-Provider API for electronic invoicing. | API key | P1 — best API, DIAN-compliant |
| **Siigo** | Medium-High | REST API: invoices, contacts, products, users. 40+ partnerships. | API key | P1 — largest market share in Colombia |
| **World Office** | Medium | REST API: customers, invoices, transactions, accounting. Free for Enterprise version. | API key | P3 |
| **Helisa** | Low | Two-way API: account lists, queries by type/year/company. Less developer-friendly. | Custom | P4 |

**Integration pattern**: POS → accounting should push: (1) daily sales summary or individual invoices, (2) expense records from purchases, (3) inventory movements for cost tracking. Pull: customer/supplier data, chart of accounts for proper coding.

### 15.4 Delivery Platform Integration

For restaurant vertical, use a **third-party aggregator** (Deliverect, GetOrder) unless volume justifies direct integration with individual platforms.

Key SLAs:
- Rappi: 98% API request success rate required or risk access revocation
- Uber Eats: webhooks for full order lifecycle
- iFood: event-oriented architecture, invested in 3 POS companies in 2025

### 15.5 Government / Regulatory APIs

| Service | Official API | Practical Path | Use Case |
| --- | --- | --- | --- |
| **DIAN RUT (NIT validation)** | No public REST API. Manual portal at muisca.dian.gov.co | Third-party: Apitude (`apitude.co`) — POST endpoint for RUT validation | Validate customer/supplier NIT at creation |
| **RUES (business registry)** | No stable public API. Portal at rues.org.co | Third-party: Apitude | Verify business registration |
| **Cédula (ID validation)** | No self-service API. Registraduría requires formal written request. | Third-party: Verifik (`verifik.co`) — instant cédula validation | Customer identity verification |

### 15.6 Integration Priority Matrix

| Integration | API Ready | Node.js Ready | POS Relevance | Priority |
| --- | --- | --- | --- | --- |
| WhatsApp Business (receipts/notifications) | Yes | Yes (official + community) | Very High | **P0** |
| Wompi (payments) | Yes | Yes (REST) | Very High | **P0** |
| Alegra (accounting) | Yes | Yes (REST) | High | **P1** |
| Siigo (accounting) | Yes | Yes (REST) | High | **P1** |
| Shopify (e-commerce) | Yes | Yes (official TS SDK) | High | **P1** |
| WooCommerce (e-commerce) | Yes | Yes (official npm) | High | **P1** |
| MercadoLibre (marketplace) | Yes | Yes (official npm) | High | **P1** |
| MercadoPago Point (terminal) | Yes | Yes (REST) | High | **P1** |
| Rappi (delivery) | Yes (requires approval) | Yes (REST) | High for restaurants | **P2** |
| Uber Eats (delivery) | Yes | Yes (REST + webhooks) | High for restaurants | **P2** |
| iFood/Domicilios (delivery) | Yes | Yes (REST, event-driven) | Medium-High | **P2** |
| DIAN RUT/RUES (validation) | Via third-party | Yes (REST) | Medium | **P3** |

## 16. Recommended Implementation Order (Updated for Multi-Vertical Strategy)

If the team wants the highest practical return across multiple business types:

1. **Phase 0** — Architecture foundation, module activation system, JSON metadata columns, tax group engine
2. **Phase 0.5 (NEW)** — **i18n foundation** (`i18next` + `react-i18next`), Spanish + English, high-visibility surfaces (auth, dashboard, sales, navigation). Full coverage + CI enforcement follows in parallel with Phase 1. See section 17 for details.
3. **Phase 1** — **Cash management and shift control** + fractional quantity support + compound tax (IVA + INC + impuesto saludable)
3. **Phase 2** — Site-owned inventory and transfers
4. **Phase 5** — Payment depth, quotations, and customer credit accounts (unlocks ferretería + B2B)
5. **Phase 6** — Advanced product handling: lot/batch/expiry, variants, serial numbers, bundles/BOM (unlocks pharmacy + supermarket + electronics + restaurant)
6. **Phase 7** — Loyalty, promotions, and commercial expansion
7. **Phase 3** — Outbound logistics documents
8. **Phase 11** — Fiscal localization (DIAN), Colombian tax depth (retención, rete-IVA, rete-ICA, documento soporte)
9. **Phase 4** — Transport execution and tracking
10. **Phase 8** — Employee management and audit trail
11. **Phase 9** — Advanced reporting and BI
12. **Phase 12** — Restaurant and service vertical modules (tables, KDS, modifiers, appointments)
13. **Phase 10** — Hybrid database runtime
14. **Phase 13 (NEW)** — Pharmacy vertical module (Rx, controlled substances, RIPS, SISMED)
15. **Phase 14 (NEW)** — Supermarket vertical module (weighing scale, PLU, DSD, perishable workflows)
16. **Phase 15 (NEW)** — Hardware store vertical module (unit conversion, project quoting, product specs search)

### Why this order changed from the previous plan:

- **Phase 0 now includes module activation and tax groups** — these are prerequisites for ANY vertical. Without compound tax, restaurants and supermarkets cannot operate legally in Colombia. Without module activation, every vertical-specific feature is a hardcoded if/else.
- **Phase 1 now includes fractional quantities** — this is critical for both ferreterías (by the meter) and supermarkets (by weight). It touches the same checkout flow as cash management.
- **Phase 5 moved up** — customer credit accounts (30/60/90 days) are essential for ferreterías and B2B. Quotations enable project-based selling for hardware stores.
- **Phase 6 moved up** — lot/batch/expiry is legally required for pharmacies, critical for supermarkets, and needed for restaurant recipe costing. This is the gateway to all regulated verticals.
- **Phase 11 moved up** — Colombian fiscal compliance (retención, rete-IVA, documento soporte) blocks legal operation for B2B transactions. Without this, ferreterías cannot sell to contractors properly.
- **Phase 12 stays** — restaurant features are optional modules, not blocking for other verticals.
- **Phases 13-15 are new** — these are vertical-specific modules that COMPOSE capabilities built in earlier phases. They are mostly configuration + specialized UI + regulatory reporting, not new platform capabilities.

### Implementation Dependency Chain:

The following dependency chain must be respected across phases — building out of order creates rework:

0. **Fractional quantity migration** (Phase 1, DB-050) → `integer` to `real` across stock/quantity fields. Blocks ferretería, supermarket, and any weight-based selling. Must be the first schema migration.
1. **Company fiscal regime fields** (Phase 5, DB-408) → must exist before withholding tax engine
2. **Tax groups / compound tax** (Phase 0, DB-007-009) → must exist before any vertical-specific tax (INC 8%, impuesto saludable)
3. **Withholding tax engine** (retención + rete-IVA + rete-ICA) (Phase 11) → depends on company regime + tax groups
4. **Facturación electrónica** (Phase 11) → depends on correct tax calculations including withholdings
5. **Product variants** (Phase 6, DB-501) → must exist before fashion/apparel vertical works
6. **Serial number tracking** (Phase 6, DB-502) → depends on variant infrastructure (serials are per-variant, not per-parent)
7. **Lot/batch/expiry** (Phase 6, DB-503) → prerequisite for pharmacy and supermarket verticals
8. **Layaway/apartado** (Phase 5, DB-405) → requires payment scheduling infrastructure that also benefits installments and deposits
9. **Customer credit accounts** (Phase 5, DB-403) → prerequisite for ferretería and B2B verticals
10. **Loyalty program** (Phase 7) → independent but should work with customer model and variant model
11. **Service tickets** (Phase 5, DB-407) → standalone but benefits from serial tracking for electronics
12. **Appointment scheduling** (Phase 12) → standalone module serving pet grooming, optical, jewelry

### Multi-Vertical Activation Strategy:

| After Phase... | Verticals Unlocked |
| --- | --- |
| Phase 1 | Generic retail, tiendas |
| Phase 5 | Ferreterías (credit + quoting), B2B retail |
| Phase 6 | Pharmacies (basic — lot/expiry), supermarkets (basic — perishables), electronics (serials), fashion (variants) |
| Phase 11 | All Colombian businesses (full fiscal compliance) |
| Phase 12 | Restaurants, food service, service businesses |
| Phase 13 | Pharmacies (full — Rx, controlled, RIPS, SISMED) |
| Phase 14 | Supermarkets (full — scales, PLU, DSD) |
| Phase 15 | Hardware stores (full — unit conversion, project quoting, specs search) |

## 17. i18n System — Analysis & Design (PV-i18n)

### 17.1 Current State

Puntovivo has **zero i18n infrastructure**. All 126 component files (92 feature + 34 shared) contain hardcoded English strings: ~300+ user-facing labels, ~137 toast notifications, ~187 form fields/placeholders, plus validation messages, status badges, empty states, and modal titles.

No i18n library is installed. The product is English-only with some Spanish-context domain terminology (DIAN, IVA, retención) appearing only in server-side fiscal logic.

### 17.2 Why Now — Strategic Context

Puntovivo targets **Latin American retail** (Colombia-first). The operator persona — store owners, cashiers, warehouse staff — overwhelmingly works in Spanish. English-only UI is a **deployment blocker** for any real-world pilot. Additionally:

- Fiscal localization (Phase 11) will introduce Colombia-specific labels and document names that must display in Spanish
- Multi-vertical expansion (ferretería, farmacia, supermercado) targets markets where Spanish is mandatory
- An i18n foundation is easier to lay now than to retrofit after 10+ more phases of hardcoded strings

### 17.3 Tech Stack Decision: `i18next` + `react-i18next`

| Library | Why |
|---------|-----|
| `i18next` | Runs in browser (Vite/React), Node.js (Fastify standalone), and Electron main process — one library, all surfaces. Namespace support for per-feature splitting. Fallback chain: `es-CO` → `es` → `en` automatic. Framework-agnostic core. |
| `react-i18next` | `useTranslation(namespace)` hook integrates with React render cycle. `<Trans>` component for JSX-embedded translated strings (links, bold). No prop-drilling. |

**Rejected alternatives:**
- `react-intl` — React-only, no Node/Electron main process support without duplicating logic
- Custom solution — reinventing namespace loading, pluralization, interpolation, and fallback chains is wasted effort
- Translation SaaS (Lokalise, Crowdin) — premature before having >2 languages; adds cost and CI complexity

### 17.4 Architecture

```
apps/web/src/
  i18n/
    index.ts              ← i18next instance + init(), exported for import in main.tsx
    resolveLocale.ts      ← navigator.languages[0] for web; app.getPreferredSystemLanguages() for Electron
    locales/
      en/
        common.json       ← shared: buttons, statuses, pagination, table headers
        auth.json
        dashboard.json
        sales.json
        purchases.json
        inventory.json
        products.json
        customers.json
        settings.json     ← company, locations, sites, users, units, vat-rates, sequentials
        errors.json       ← validation, API error, network error messages
      es/
        (same structure)

packages/server/src/
  i18n/
    index.ts              ← server-side i18next for error messages, email templates (future)
    locales/
      en/
        server.json       ← API error messages, seed data labels
      es/
        server.json
```

**Key rules:**
- Semantic keys, never English text as keys: `sales.chargeButton` not `"Charge"`
- Namespace = file name: `useTranslation('sales')` → `sales.json`
- Config objects store `labelKey`, never resolved strings — resolve at render time
- Never localize: code identifiers, product SKUs, API field names, file extensions
- Server error messages sent to client use error codes; the client resolves the display text

### 17.5 Settings Integration (Zustand)

```typescript
// In existing settings store — add one field
interface AppSettings {
  language: 'system' | 'en' | 'es';
}

// On change:
i18next.changeLanguage(resolvedLocale);
// React re-renders automatically via react-i18next context — no app reload needed
```

Persisted via Zustand's existing `persist` middleware. Default: `'system'` (auto-detect from browser/OS).

### 17.6 Locale Resolution

```typescript
// apps/web/src/i18n/resolveLocale.ts
export function resolveLocale(preference: 'system' | 'en' | 'es'): string {
  if (preference !== 'system') return preference;

  // Electron renderer has access to navigator
  const browserLang = navigator.languages?.[0] ?? navigator.language ?? 'en';
  // Normalize: "es-CO" → "es", "en-US" → "en"
  return browserLang.startsWith('es') ? 'es' : 'en';
}
```

For the Electron main process (future — dialog strings, tray menu):
```typescript
const { app } = require('electron');
const lang = app.getPreferredSystemLanguages()[0] ?? 'en';
```

### 17.7 Phased Rollout

| Phase | Scope | When | Effort |
|-------|-------|------|--------|
| **i18n-1: Foundation** | Install `i18next` + `react-i18next`. Create `apps/web/src/i18n/` scaffold. Wire `init()` in `main.tsx`. Add `language` to settings store. Create `en/common.json` + `es/common.json` stubs. Convert shared UI components (`apps/web/src/components/`) — buttons, status badges, table chrome, empty states. | Before any new feature phase | 2–3 days |
| **i18n-2: High-Visibility Surfaces** | Convert `auth`, `dashboard`, `sales` (checkout flow), and top-level navigation/layout. These are the first screens any user sees. | Same sprint as i18n-1 or immediately after | 3–4 days |
| **i18n-3: Full Feature Coverage** | Convert remaining features: `products`, `customers`, `purchases`, `inventory`, `orders`, plus settings screens (`company`, `locations`, `sites`, `users`, `units`, `vat-rates`, `sequentials`). | Next sprint | 4–5 days |
| **i18n-4: Server + CI Enforcement** | Server-side error messages. Electron main process strings (dialogs, tray). CI lint rule: block new hardcoded strings in `.tsx` files. Missing-key and orphaned-key checks in CI. | Before contributor onboarding | 2–3 days |

**Total estimate: ~12–15 days of focused work across 4 phases.**

### 17.8 What NOT To Do

| Anti-pattern | Why |
|--------------|-----|
| Translation SaaS in MVP | Cost, vendor lock-in, CI complexity before having real translators — add after 3+ languages |
| Runtime bundle download | Keep all locales in repo for V1; TTFB and offline behavior are easier |
| Localized code output | Generated file names, receipt template variables, export column names stay English |
| Community language packs | Need a plugin loading model first (post-Phase 14 plugin architecture) |
| Inline `t()` in Zustand stores | Store `labelKey` strings, resolve with `t()` only in React components at render time |
| Over-splitting namespaces | Start with ~10 namespace files, not one per component — merge small features into `settings.json` |

### 17.9 Priority Placement

i18n sits **between Phase 0 (architecture foundation) and Phase 1 (cash management)** in the implementation order. Rationale:

1. Phase 0 establishes the module activation system and tax engine — these create new UI that should be born i18n-ready
2. i18n-1 and i18n-2 (foundation + high-visibility) should land before Phase 1 starts adding cash management UI
3. i18n-3 (full coverage) can run in parallel with Phase 1 without blocking it
4. i18n-4 (CI enforcement) must land before contributor onboarding to prevent regression

This avoids the worst outcome: building 10+ more phases of hardcoded English strings and then doing a massive retroactive extraction.

## 18. Immediate Documentation Updates Needed

These docs should exist after the first implementation phases:

- `docs/INVENTORY_OWNERSHIP_MODEL.md`
- `docs/FULFILLMENT_AND_LOGISTICS_MODEL.md`
- `docs/HYBRID_DATA_TOPOLOGY.md`
- `docs/CASH_OPERATIONS_RUNBOOK.md`
- `docs/FISCAL_ARCHITECTURE.md`
- `docs/INTEGRATION_STRATEGY.md`
- `docs/DOMAIN_GLOSSARY.md`
- `docs/PROMOTION_ENGINE_DESIGN.md`
- `docs/REPORTING_KPI_DEFINITIONS.md`
- `docs/MULTI_VERTICAL_MODULE_GUIDE.md` — how to activate, configure, and extend vertical modules
- `docs/PHARMACY_REGULATORY_GUIDE.md` — INVIMA, controlled substances, RIPS, SISMED, FNE compliance
- `docs/COLOMBIAN_TAX_ENGINE.md` — IVA, INC, impuesto saludable, retención, rete-IVA, rete-ICA, bolsa plástica
- `docs/VERTICAL_PRODUCT_METADATA_SCHEMA.md` — JSON metadata column schemas per vertical
- `docs/I18N_GUIDE.md` — i18n conventions, namespace mapping, key naming rules, and how to add a new language

## 18. Sources

### Competitive product references

- [Square Retail POS](https://squareup.com/us/en/point-of-sale/retail)
- [Square Restaurant POS](https://squareup.com/us/en/point-of-sale/restaurants)
- [Shopify POS](https://www.shopify.com/pos)
- [Lightspeed Retail POS](https://www.lightspeedhq.com/pos/retail/)
- [Lightspeed Restaurant](https://www.lightspeedhq.com/pos/restaurant/)
- [Toast POS](https://pos.toasttab.com/)
- [Clover POS](https://www.clover.com/)
- [Revel Systems](https://www.revelsystems.com/)
- [Loyverse POS](https://loyverse.com/)
- [Hike POS](https://hikeup.com/)
- [TouchBistro](https://www.touchbistro.com/)
- [Odoo POS](https://www.odoo.com/app/point-of-sale)
- [ERPNext POS](https://erpnext.com/open-source-pos)
- [Siigo POS](https://www.siigo.com/sistema-pos/)
- [Alegra POS](https://www.alegra.com/rdominicana/pos)
- [Treinta](https://treinta.co/)
- [Unicenta POS](https://unicenta.com/)
- [Floreant POS](https://floreantpos.org/)

### Logistics and transport references

- [ERPNext Delivery Note](https://docs.frappe.io/erpnext/user/manual/en/delivery-note)
- [ERPNext Pick List](https://docs.frappe.io/erpnext/user/manual/en/pick-list)
- [ERPNext Shipment](https://docs.frappe.io/erpnext/v13/user/manual/en/stock/shipment)
- [ERPNext Delivery Trip](https://docs.frappe.io/erpnext/user/manual/en/delivery-trip)
- [ERPNext Packing Slip](https://docs.frappe.io/erpnext/user/manual/en/packing-slip)
- [Odoo third-party shipper](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory/shipping_receiving/setup_configuration/third_party_shipper.html)
- [Odoo barcode receipts and deliveries](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/barcode/operations/receipts_deliveries.html)
- [Odoo routes and push/pull rules](https://www.odoo.com/documentation/19.0/fr/applications/inventory_and_mrp/inventory/shipping_receiving/daily_operations/use_routes.html)
- [Zoho Inventory](https://www.zoho.com/inventory/)
- [Bringg real-time delivery tracking](https://www.bringg.com/resources/real-time-delivery-tracking)
- [Shipday routing](https://www.shipday.com/route-planning)
- [Onfleet delivery management](https://onfleet.com/)
- [Route4Me route optimization](https://route4me.com/)

### Data topology and database references

- [SQLite: Appropriate Uses For SQLite](https://www.sqlite.org/whentouse.html)
- [SQLite as an application file format](https://www.sqlite.org/appfileformat.html)
- [Drizzle ORM overview](https://orm.drizzle.team/docs/overview)
- [LiteFS overview](https://fly.io/docs/litefs/)
- [PowerSync documentation](https://docs.powersync.com/)
- [PowerSync documentation](https://docs.powersync.com/)
- [PowerSync pricing](https://www.powersync.com/pricing)
- [PowerSync React SDK](https://www.npmjs.com/package/@powersync/react)
- [PowerSync Electron guide](https://www.powersync.com/blog/speeding-up-electron-apps-with-powersync)
- [PowerSync conflict resolution](https://docs.powersync.com/handling-writes/custom-conflict-resolution)
- [PowerSync JS SDK GitHub](https://github.com/powersync-ja/powersync-js)
- [PowerSync types and Postgres mapping](https://docs.powersync.com/usage/sync-rules/types)
- [Electric SQL 1.0 release](https://electric-sql.com/blog/2025/03/17/electricsql-1.0-released)
- [Electric SQL writes guide](https://electric-sql.com/docs/guides/writes)
- [Electric SQL React integration](https://electric-sql.com/docs/integrations/react)
- [Electric SQL GitHub](https://github.com/electric-sql/electric)
- [Turso / libSQL](https://turso.tech/)
- [Turso embedded replicas](https://turso.tech/embedded-replicas)
- [Drizzle ORM multi-dialect discussion #5385](https://github.com/drizzle-team/drizzle-orm/discussions/5385)
- [Drizzle ORM dual database discussion #3396](https://github.com/drizzle-team/drizzle-orm/discussions/3396)
- [PGlite — Postgres in WASM](https://pglite.dev/)

### Academic and industry framework references

- Silver, Pyke & Peterson — *Inventory and Production Management in Supply Chains*
- Hyndman & Athanasopoulos — *Forecasting: Principles and Practice* (otexts.com/fpp3)
- Levy, Weitz & Grewal — *Retailing Management*
- Nagle & Holden — *Strategy and Tactics of Pricing*
- Blattberg & Neslin — *Sales Promotion*
- Kumar & Shah — *Building and Sustaining Profitable Customer Loyalty*
- Kimball & Ross — *The Data Warehouse Toolkit*
- Few — *Information Dashboard Design*
- Sandhu et al. (1996) — *Role-Based Access Control Models* (ACM Computing Surveys)
- Bartholdi & Hackman — *Warehouse & Distribution Science*
- Clements & Northrop — *Software Product Lines: Practices and Patterns*
- Mintzberg — *Structure in Fives*
- Laudon & Laudon — *Management Information Systems*

### Industry standards

- NRF (National Retail Federation) / ARTS — Retail technology standards
- PCI DSS v4.0 — Payment card security
- APICS/ASCM — Supply chain and inventory management
- GS1 — Barcode and product identification (GTIN, EAN, UPC)
- OASIS UBL — Universal Business Language for electronic documents
- ISO 8583 — Financial transaction card messaging
- ISO 4217 — Currency codes
- Gartner Magic Quadrant for Unified Commerce
- Forrester Wave: Point of Service

### Colombia DIAN fiscal compliance references

- [DIAN Resolución 000165 de 2023](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0165_2023.htm)
- [DIAN Resolución 000008 de 2024](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0008_2024.htm)
- [DIAN Resolución 000202 de 2025](https://www.dian.gov.co/normatividad/Normatividad/Resoluci%C3%B3n%20000202%20de%2031-03-2025.pdf)
- [DIAN Micrositio — Documento Equivalente Electrónico](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/documento-equivalente-electronico/)
- [DIAN Micrositio — Documentación Técnica](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/documentacion-tecnica/)
- [DIAN Micrositio — Registro y Habilitación](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/proceso-de-registro-y-habilitacion-como-facturador-electronico/)
- [DIAN Micrositio — Proveedores Tecnológicos](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/proveedores-tecnologicos/)
- [Anexo Técnico Factura Electrónica v1.9](https://www.dian.gov.co/impuestos/factura-electronica/Documents/Anexo-Tecnico-Factura-Electronica-de-Venta-vr-1-9.pdf)
- [Anexo Técnico DEE v1.0](https://www.dian.gov.co/impuestos/factura-electronica/Documents/Anexo-Tecnico-Documento-Equivalente-Electronico-V1-0-final.pdf)
- [DIAN Signature Policy v2](https://facturaelectronica.dian.gov.co/politicadefirma/v2/politicadefirmav2.pdf)
- [DIAN Web Services Guide](https://www.dian.gov.co/impuestos/factura-electronica/Documents/Guia-Herramienta-para-el-Consumo-de-Web-Services.pdf)
- [VPFE Habilitación WSDL](https://vpfe-hab.dian.gov.co/WcfDianCustomerServices.svc?wsdl)
- [VPFE Producción](https://vpfe.dian.gov.co/WcfDianCustomerServices.svc)
- [SOENAC API DIAN open source](https://github.com/soenac/api-dian)

### Last-mile delivery platform references

- [Shipday pricing](https://www.shipday.com/pricing)
- [Shipday API docs](https://docs.shipday.com/reference/shipday-api)
- [Onfleet pricing](https://onfleet.com/pricing)
- [Bringg delivery orchestration](https://www.bringg.com/)

### Colombia payment ecosystem references

- [Wompi documentation](https://docs.wompi.co/)
- [ePayco SDK Node on GitHub](https://github.com/epayco/epayco-node)
- [MercadoPago SDK Node](https://www.npmjs.com/package/mercadopago)
- [PayU Latam API](https://developers.payulatam.com/)
- [Bold Colombia](https://bold.co/)
- [Kushki documentation](https://docs.kushki.com/)
- [PSE — ACH Colombia](https://www.achcolombia.com.co/pse)
- [Nequi](https://www.nequi.com.co/)
- [SumUp Colombia](https://www.sumup.com/es-co/)
- [Credibanco](https://www.credibanco.com/)
- [Redeban](https://www.redeban.com/)

### POS hardware integration references

- [node-thermal-printer on npm](https://www.npmjs.com/package/node-thermal-printer)
- [escpos on npm](https://www.npmjs.com/package/escpos)
- [receipt-printer-encoder (Niels Leenheer)](https://github.com/nickvdyck/receipt-printer-encoder)
- [jszpl — ZPL generation](https://www.npmjs.com/package/jszpl)
- [serialport on npm](https://www.npmjs.com/package/serialport)
- [node-hid on npm](https://www.npmjs.com/package/node-hid)
- [ESC/POS command reference (Epson)](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/)

### LatAm integration ecosystem references

- [WhatsApp Business Platform](https://business.whatsapp.com/products/platform-pricing)
- [WhatsApp Business Node.js SDK (official)](https://github.com/WhatsApp/WhatsApp-Nodejs-SDK)
- [whatsapp-business npm (community)](https://github.com/MarcosNicolau/whatsapp-business-sdk)
- [MercadoLibre Developers](https://global-selling.mercadolibre.com/devsite/api-docs)
- [MercadoLibre Node.js SDK](https://github.com/mercadolibre/nodejs-sdk)
- [Rappi Developer Portal](https://dev-portal.rappi.com/)
- [Uber Eats Marketplace APIs](https://developer.uber.com/docs/eats/introduction)
- [iFood Developer Portal](https://developer.ifood.com.br/)
- [PedidosYa Developer Docs](https://developers.pedidosya.com/)
- [WooCommerce REST API](https://woocommerce.github.io/woocommerce-rest-api-docs/)
- [@woocommerce/woocommerce-rest-api on npm](https://www.npmjs.com/package/@woocommerce/woocommerce-rest-api)
- [Shopify Admin API](https://shopify.dev/docs/api/admin-graphql/latest)
- [@shopify/shopify-api on npm](https://www.npmjs.com/package/@shopify/shopify-api)
- [Siigo API documentation](https://siigoapi.docs.apiary.io/)
- [Alegra API documentation](https://developer.alegra.com/)
- [Alegra E-Provider API](https://e-provider-docs.alegra.com/)
- [World Office API](https://developer.worldoffice.cloud/)
- [Apitude — DIAN RUT validation](https://apitude.co/es/docs/services/dian-rut-validation-co/)
- [Verifik — Colombian identity verification](https://verifik.co/)
- [Deliverect](https://www.deliverect.com/)

### Other compliance references

- [Stripe Tax overview](https://docs.stripe.com/tax)
- [Spain VERI*FACTU overview](https://sede.agenciatributaria.gob.es/static_files/Sede/Biblioteca/Folleto/VERIFACTU/Folleto_VERIFACTU_en_gb.pdf)
- [Ley 1581 de 2012 — Habeas Data Colombia](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=49981)
- [PCI DSS v4.0](https://www.pcisecuritystandards.org/document_library/)
