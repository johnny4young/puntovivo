# Puntovivo Strategic Plan and Technical Roadmap

> Updated: April 12, 2026
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
- multi-currency support
- payment method depth (split payments, installments, credit accounts)
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

### 3.11 Multi-Vertical Adaptability

**Academic basis**: Clements & Northrop "Software Product Lines: Practices and Patterns".

A POS system adaptable to multiple business types needs:

| Business Type | Key Differentiators |
| --- | --- |
| **Retail** | Barcode scanning, variant management, returns, gift registry, loyalty |
| **Restaurant** | Table management, course firing, modifiers, split checks, tips, KDS |
| **Services** | Appointment scheduling, duration tracking, staff assignment, consumable tracking |
| **Wholesale/B2B** | Customer-specific pricing, credit terms, large quantities, pallet units, tax-exempt, EDI |
| **E-commerce** | Catalog management, shipping, digital payments, cart abandonment |

Configuration-driven approach: Feature flags, configurable workflows, custom fields, configurable receipt layouts, module activation patterns.

**Current repo status**: Retail-focused. No restaurant, service, or B2B-specific adaptations.

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

## 6. Product and Logistics Gap Matrix

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

### Phase 0: Architecture Foundation

Goal:
- prepare the codebase for logistics expansion, dual-database compatibility, and module-driven feature activation

DB tickets:

- `DB-001` Introduce dialect-neutral schema conventions
- `DB-002` Replace raw schema bootstrap with versioned Drizzle migrations
- `DB-003` Define money, quantity, and timestamp normalization rules
- `DB-004` Create `feature_flags` or module activation table for business-type customization

tRPC tickets:

- `API-001` Introduce repository/service boundaries for core domains
- `API-002` Separate persistence concerns from router procedures
- `API-003` Define sync acknowledgement contract
- `API-004` Create module registry for optional feature enablement

UI tickets:

- `UI-001` Add system diagnostics page for runtime topology
- `UI-002` Add admin-facing sync topology indicators
- `UI-003` Create module activation settings page

Test tickets:

- `TEST-001` Add persistence contract tests reusable across dialects
- `TEST-002` Add schema migration smoke tests
- `TEST-003` Add sync contract tests for accepted/conflicted/rejected flows

### Phase 1: Cash Management and Shift Control

Goal:
- implement the most critical missing commercial feature for LatAm retail

DB tickets:

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

### Phase 5: Payment Method Depth and Quotations

Goal:
- support complex payment scenarios and pre-sale conversion flows

DB tickets:

- `DB-401` Create `quotations` and `quotation_items` with validity period, version tracking, margin analysis fields
- `DB-402` Add `sale_payments` for multi-tender support (each payment has method, amount, reference, status)
- `DB-403` Create `customer_credit_accounts` with credit limit, balance, aging buckets
- `DB-404` Create `gift_cards` and `store_credits` with balance tracking
- `DB-405` Create `payment_installments` for layaway/installment schedules

tRPC tickets:

- `API-401` Quotation CRUD, versioning, margin display, and convert-to-sale/order
- `API-402` Split payment processing: multiple tenders per sale, change calculation per tender
- `API-403` On-account sales: credit check, balance update, aging report
- `API-404` Gift card issue/activate/redeem/balance-check
- `API-405` Store credit issue/redeem on return or standalone
- `API-406` Layaway/installment: create schedule, record payments, handle early payoff

UI tickets:

- `UI-401` Quotations module with version history, margin indicators, and conversion button
- `UI-402` Checkout: multi-tender payment dialog (add/remove payment methods, running balance)
- `UI-403` Customer credit account management and aging report
- `UI-404` Gift card issuance, lookup, and redemption in checkout
- `UI-405` Store credit balance display and application in checkout
- `UI-406` Quotation follow-up reminders and win/loss tracking

Test tickets:

- `TEST-401` Quote conversion preserves prices and taxes
- `TEST-402` Split payment sum must equal or exceed transaction total
- `TEST-403` On-account sale fails when exceeding credit limit
- `TEST-404` Gift card redemption reduces balance correctly
- `TEST-405` Return to store credit creates credit entry

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
- `API-1106` Tip management: per-employee, tip pool, tip-out percentage
- `API-1107` Appointment CRUD with calendar view and conflict detection
- `API-1108` Auto-86ing: automatically disable items when ingredient stock hits zero

UI tickets:

- `UI-1101` Floor plan editor: drag-and-drop table placement
- `UI-1102` Table status grid with color-coded occupancy
- `UI-1103` Kitchen Display System (KDS): order cards with timers, bump bar support
- `UI-1104` Modifier selection in checkout item detail
- `UI-1105` Split check dialog with item-level or equal-split options
- `UI-1106` Tip entry after payment
- `UI-1107` Appointment calendar with employee lanes and booking
- `UI-1108` Service mode checkout with duration and consumables

Test tickets:

- `TEST-1101` Table session links correctly to sale
- `TEST-1102` Kitchen order status transitions are valid
- `TEST-1103` Split check math distributes items correctly
- `TEST-1104` Tip pool distribution is proportional
- `TEST-1105` Appointment conflict detection prevents double-booking

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

## 16. Recommended Implementation Order

If the team wants the highest practical return:

1. Phase 0 — architecture foundation and module system
2. Phase 1 — **cash management and shift control** (highest commercial priority for LatAm)
3. Phase 2 — site-owned inventory and transfers
4. Phase 3 — outbound logistics documents
5. Phase 5 — payment depth and quotations
6. Phase 7 — loyalty, promotions, and commercial expansion
7. Phase 4 — transport execution and tracking
8. Phase 6 — advanced product handling
9. Phase 8 — employee management and audit trail
10. Phase 9 — advanced reporting and BI
11. Phase 10 — hybrid database runtime foundation
12. Phase 11 — fiscal/accounting/integration depth
13. Phase 12 — restaurant and service verticals

Why this order:

- cash management is the most visible gap for Colombian/LatAm retail — every competitor has it
- logistics without believable stock ownership is dangerous
- payment depth and quotations unlock B2B and higher-ticket sales
- loyalty/promotions are a market expectation that drives retention
- hybrid runtime without repository boundaries will create expensive rewrites
- transport and tracking become much easier once fulfillment documents exist
- restaurant/service verticals are optional modules that expand addressable market

## 17. Immediate Documentation Updates Needed

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
