# Sales Cockpit and Operator UX Guide

> Status: official design guide for operator-facing POS surfaces.
> Created: May 20, 2026.
> Updated: May 20, 2026.
> Roadmap anchor: `ENG-105` plus related Plan V3 tickets. Broader
> screen simplification and navigation work lives in
> [UI-REFRACTOR-V3.md](./UI-REFRACTOR-V3.md) under `ENG-131` and
> `ENG-132`.

This document defines what "premium" means for Puntovivo's operator
experience. For this product, premium does not mean decorative chrome,
marketing composition, or a dramatic color theme. Premium means a
cashier, waiter, cook, manager, or owner can complete repeated work
quickly, read the state at a glance, recover from mistakes, and trust
the result.

## 1. Design Principles

1. **Dense but legible**: high-frequency views should show the work
   surface first. Avoid oversized hero typography, decorative panels,
   nested cards, or empty illustration space.
2. **Stable dimensions**: cart rows, product tiles, KDS cards, counters,
   totals, icon buttons, and table columns must not resize when labels,
   warnings, timers, or prices change.
3. **Fast path first**: keyboard, scanner, touch, and voice flows must
   converge on the same cart and sale model. Do not fork business logic
   per surface.
4. **Accessible operations**: touch targets are at least 44px, contrast
   is strong in bright and dark environments, and status is communicated
   with text plus icon or shape, not color alone.
5. **Local-first confidence**: offline, hub-client, peripheral, and
   fiscal states must be visible before the operator reaches a blocking
   checkout moment.
6. **No claim ahead of runtime**: any surface that supports public
   website copy must have a matching shipped behavior and smoke proof.

## 2. Sales Cockpit v2

`ENG-105` is the main implementation ticket for `/sales`.

### Keyboard and Scanner Flow

| Action            | Target behavior                                                                      |
| ----------------- | ------------------------------------------------------------------------------------ |
| `F2`              | Focus the primary product/SKU/barcode search input.                                  |
| `Enter` in search | Add the highlighted product or open the exact-match row.                             |
| Scanner input     | Barcode wedge input is captured without stealing focus from payment or modal fields. |
| `F8`              | Open payment drawer.                                                                 |
| `F9`              | Open customer attach/search.                                                         |
| `Shift + E`       | Exact-cash checkout when the cart is valid and the cash session is open.             |
| `Escape`          | Close the top-most modal or clear the transient search state.                        |
| `Cmd/Ctrl + K`    | Open the global command palette for destinations and actions.                        |

Shortcuts must be discoverable through a command palette or help menu,
but the screen should not rely on visible instructional copy.

### Global Command Palette

The command palette is part of `ENG-105` and should search both routes
and safe actions:

- Create product, customer, provider, purchase, quotation, and cash
  movement.
- Open sales, operations, payment reconciliation, fiscal documents,
  customers, products, receipt templates, and diagnostics.
- Print or reprint the last receipt when a sale context exists.
- Open cash session or close cash session when the user's role allows it.
- Surface disabled commands with the reason when a module, role, or
  setup preflight blocks them.

### Layout Contract

- Cart, search, totals, and payment summary keep fixed responsive
  regions. Loading, warning, or empty text cannot push the checkout
  button or total card out of position.
- Primary commands use icon buttons where the action is familiar
  (`Search`, `ScanLine`, `CreditCard`, `Printer`, `ReceiptText`,
  `UserRound`, `Keyboard`, `Command`); tooltips name less common icons.
- Totals use tabular figures and stable line-height so prices do not
  jump during discount, tax, tip, or service-charge recalculation.
- Mobile and tablet variants keep the same state model but may rearrange
  controls into bottom bars and touch drawers.

### Error and Recovery Behavior

- A failed fiscal, payment, print, or sync side effect must explain
  whether the sale itself was completed.
- Retry actions live near the failed operation and write audit rows when
  they change durable state.
- The UI must not hide a manager-required action; it should request the
  approval through `ENG-106` when the cashier role cannot complete it.
- Reversible local actions expose undo; durable reversals use explicit
  void/refund/recall/approval flows and preserve audit identity.

### Checkout Preflight

`/sales` should show blockers before the final checkout gesture:

- No active cash session.
- Fiscal provider not ready for a fiscalized tenant.
- Hub unreachable in `hub_client` mode.
- Receipt printer or drawer configured but unreachable.
- Payment terminal unavailable for selected rail.
- Offline/sync backlog state that changes whether the sale can be
  safely completed.

The preflight should be compact and actionable: one line per blocker,
an icon, a short label, and a CTA when the current role can fix it.

### Quick Create

Cashiers and managers should not abandon a cart to create missing master
data. `ENG-105` owns the in-flow shell; domain-specific persistence may
land in `ENG-110` or adjacent tickets.

- Minimal product create from search miss.
- Minimal customer create from attach flow.
- Minimal provider create from purchase flow.
- Every quick-create modal returns to the original cart/purchase context
  and highlights the created entity.

### Fast-Register Mode

Fast-register mode is a compact `/sales` variant for minimarkets and
high-volume counters. It keeps only the scanner/search input, cart,
total, exact-cash checkout, print state, and next-sale affordance in the
primary viewport. Secondary panels move behind icon buttons or drawers.

## 3. Touch POS

Touch surfaces prioritize fat-finger safety over ornament:

- Product tiles use fixed aspect ratios with image, name, price, and
  stock state. Tile radius stays within the shared design system limit.
- Category filters use segmented controls or tabs, not decorative cards.
- Quantity editing uses a docked or modal numeric keypad with large
  target areas and explicit confirm/cancel controls.
- The cart remains visible or one tap away at all times.
- Touch mode must pass live smoke on tablet and phone viewports.

## 4. KDS and Restaurant Operations

`ENG-098` shipped the KDS foundation. `ENG-117` promotes the remaining
restaurant-service depth:

- Product-level station routing.
- Prep-time thresholds per station.
- Pending, preparing, ready, served, and recalled states.
- Waiter read-only view.
- Append-items-mid-service without recreating the draft.
- Optional audio cue, off by default.

KDS cards should be high contrast, resilient on distant screens, and
usable with wet or gloved fingers. Status should combine label, icon,
timer, and border treatment. Avoid translucent blur effects that reduce
readability in a kitchen.

## 5. Fiscal Setup Wizard

Fiscal settings need workflow framing, not raw form dumping:

1. Country and environment.
2. Legal identity and regime.
3. Numbering/certificates/CAF/PAC/PT credentials as applicable.
4. Tax templates and receipt/fiscal preview.
5. Readiness result with blocking issues and next action.

This wizard belongs under `ENG-104` when it is used for first-run
readiness, and under the relevant country-pack ticket when it needs a
provider-specific credential path.

## 6. Role-Based Home and Task Center

`ENG-104` should replace generic landing behavior with role-aware
workflow starts:

- Cashier: sales surface, active cash session state, and checkout
  preflight.
- Manager: operational task center with fiscal pending, payment
  mismatches, hardware offline, stock low, KDS delayed, and stale cash
  sessions.
- Admin: readiness checklist, provider setup, modules, users, and owner
  BI entry points.

Empty states must be actionable. They should name the missing object and
deep-link to the exact place to create or configure it.

## 7. Recipes, BOM, and Margin

Recipes and composite products land under `ENG-110`.

- BOM ingredients use fractional quantities and site-owned inventory.
- Cost is derived from the inventory costing model available in the
  codebase at implementation time.
- The product editor shows gross margin warnings without blocking unless
  the tenant config sets a hard threshold.
- KDS station and prep metadata live with the product/recipe, not in
  ad hoc restaurant-only conditionals.

## 8. Quotations and Conversion

Quotations already exist; Plan V3 expands the surrounding workflows:

- WhatsApp and email sharing, including quotation PDF/link delivery, live in `ENG-112`.
- Promotions and customer-group pricing live in `ENG-109`.
- Accounting export of quote-to-invoice outcomes lives in `ENG-115`.
- Conversion into checkout must keep tax, discount, customer, and audit
  snapshots stable.

## 9. Owner Control Tower

`ENG-116` should make dashboards operational rather than decorative:

- Net sales, gross margin, average ticket, sell-through, inventory
  valuation, cash variance, payment reconciliation, and anomalies.
- Drill-down by site, category, cashier, payment rail, customer segment,
  and date range.
- Scheduled PDF/email report with data freshness timestamp.
- Explicit empty/loading/error states for every tile.

## 10. Touch Surface Picker

`ENG-107` should make active touch surfaces discoverable from `/touch`.
Operators should be able to switch between:

- Catalog checkout.
- Voice ordering.
- Tables.
- Waiter/KDS read-only view when restaurant modules are active.

The picker is a compact segmented control or icon toolbar, not a
landing page.

## 11. Vertical Workflow Carry-Over

The staged May 2026 design draft contains vertical ideas that should
remain in the work plan as product requirements:

- Services (`ENG-119`): appointment calendar, line-level employee
  attribution, commission payout context in cash-session close, and
  customer asset/preference history for salons and repair shops.
- Pharmacy (`ENG-120`): INVIMA/regulatory metadata, active ingredient
  search, generic alternatives, expiry/lot warnings, and prescription
  capture for controlled products before checkout.
- Supermarket (`ENG-121`): scale input, PLU barcode decoding, weighted
  produce flows, and category-specific tax display on receipt/fiscal
  output.
- Hardware stores (`ENG-122`): fractional sale units, unit conversions,
  contractor credit context, project-kit explosion, internal barcode
  generation, and FTS5-backed dense search for large catalogs.

These are vertical workflows, not decorative UI themes. Each one should
only activate for tenants/modules that need it.

## 12. Validation Rules

Any UI implementation derived from this guide must include:

- Focused component tests for state and edge cases.
- `ci:web` and `ci:server` when the flow crosses tRPC.
- Live smoke on the affected route, including English and Spanish when
  copy changes.
- Responsive smoke for touch/mobile surfaces.
- No voseo in Spanish copy.
