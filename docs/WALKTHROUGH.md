# Walkthrough: Sales Cockpit, Surfaces, Modules, and Plan V3 Alignment

> Status: documentation alignment note.
> Updated: May 20, 2026.

This document records how the operator UX docs map to the current
roadmap. It intentionally avoids obsolete ticket aliases such as
`ENG-041a` or `ENG-044a`; the active post-core wave starts at
`ENG-103`, preserves the staged vertical ideas as `ENG-119..ENG-122`,
and extends the plan through launch, supportability, privacy, AI
automation, information architecture, and screen simplification in
`ENG-123..ENG-132`.

## 1. Documents in This Handoff

| File | Role |
| --- | --- |
| [`SALES-COCKPIT.md`](./SALES-COCKPIT.md) | Operator UX guide for `/sales`, touch, KDS, fiscal setup, recipes/BOM, quotations, and owner dashboards. |
| [`UI-SURFACES.md`](./UI-SURFACES.md) | Surface inventory for desktop, touch, KDS, customer display, and mobile waiter routes. |
| [`UI-REFRACTOR-V3.md`](./UI-REFRACTOR-V3.md) | Live-audit-backed plan to reduce visible options with role workspaces, surface switching, and progressive disclosure. |
| [`MODULE-ACTIVATION.md`](./MODULE-ACTIVATION.md) | Runtime module contract. The shipped source of truth is `tenants.settings.modules` plus `services/modules/manifest.ts`, not a separate `tenant_modules` table. |
| [`PLAN-V3.md`](./PLAN-V3.md) | Tactical bridge for `ENG-103..ENG-165`, the World-Class LatAm POS wave (extended 2026-05-20 with infra rails, monetization, LATAM labor + payroll, WhatsApp inbound, hardware ecosystem, hosted-SaaS substrate spike, and tRPC rate limiter). |
| [`ROADMAP.md`](./ROADMAP.md) | Canonical status source for every `ENG-NNN` row. |

## 2. Efficiency UX Requirements

These items are not loose ideas; they are now part of the Plan V3
ticket scope:

| Requirement | Ticket |
| --- | --- |
| Global command palette | `ENG-105` |
| Role-based home | `ENG-104` |
| Operational task center | `ENG-104` / `ENG-116` |
| Checkout preflight | `ENG-105` |
| Quick create inside checkout/purchase flow | `ENG-105` / `ENG-110` |
| Catalog import wizard | `ENG-104` / `ENG-110` |
| Fast-register mode | `ENG-105` |
| Actionable empty states | `ENG-104` |
| Undo and recovery patterns | `ENG-105` / `ENG-106` / `ENG-117` |
| Touch surface picker | `ENG-107` / `ENG-117` |
| Role workspace navigation | `ENG-131` |
| Progressive disclosure and screen simplification | `ENG-132` |

## 3. Design Decisions

- Premium means operational quality: speed, clarity, stability,
  accessibility, and recovery.
- Cashier, waiter, cook, manager, and owner surfaces use the same domain
  model through tRPC. UI routes may differ; business rules do not fork.
- Module activation is soft-disable by default. Historical rows remain
  durable when a module is off.
- Visual direction must remain restrained for a POS/operations tool.
  Avoid decorative glass, hero layouts, large empty panels, or color
  themes that make dense work harder to scan.

## 4. Roadmap Mapping

| Concept | Ticket |
| --- | --- |
| Export/download trust, semantic filenames, MIME and extension contract | `ENG-103` |
| Guided store setup, fiscal/peripheral/payment readiness checklist, role-based home, task center, import wizard, actionable empty states | `ENG-104` |
| Sales Cockpit v2 keyboard, command palette, scanner, preflight, quick create, fast-register mode, cart, and checkout speed | `ENG-105` |
| Staff PIN, clock-in baseline, manager approvals | `ENG-106` |
| Customer-facing display, kiosk/order status surfaces, and touch surface picker | `ENG-107` |
| Loyalty, gift cards, wallet/store credit | `ENG-108` |
| Promotions and pricing rules | `ENG-109` |
| Product variants, lots, expiry, serials, composites, KDS stations, catalog import mapping | `ENG-110` |
| Stock counts, replenishment, suggested purchase orders | `ENG-111` |
| WhatsApp receipts, quotation PDF/link sharing, reminders | `ENG-112` |
| Ecommerce and marketplace bridge | `ENG-113` |
| Delivery notes, pick/pack, routes, proof of delivery | `ENG-114` |
| Accounting exports and reconciliation packs | `ENG-115` |
| Owner BI and scheduled reports | `ENG-116` |
| KDS/service lifecycle v2 | `ENG-117` |
| Public API, webhook delivery, integrator kit | `ENG-118` |
| Services appointments, commissions, and customer asset history | `ENG-119` |
| Pharmacy compliance metadata, generics, controlled-sale capture | `ENG-120` |
| Supermarket scales, PLU barcodes, and category tax rules | `ENG-121` |
| Hardware-store fractional units, conversions, project kits, and dense search | `ENG-122` |
| Launch migration and data-quality workbench | `ENG-123` |
| Payment terminal, QR, wallet, and settlement v2 | `ENG-124` |
| Procurement, receiving, supplier invoices, and landed costs | `ENG-125` |
| Chain HQ and multi-location governance | `ENG-126` |
| Customer CRM, consent, segments, and campaigns | `ENG-127` |
| Supportability and remote operations readiness | `ENG-128` |
| Security, privacy, and data-retention pack | `ENG-129` |
| AI automation suite | `ENG-130` |
| Information architecture and navigation refactor | `ENG-131` |
| Screen simplification and progressive disclosure pass | `ENG-132` |

## 5. Validation Expectations

Each implementation ticket still follows repository rules:

1. Update `ROADMAP.md`, `SPRINT-PLAN.md`, and the specialty doc.
2. Run the affected CI workspace script.
3. Run live smoke for every user-facing change.
4. Verify English and Spanish when copy changes.
5. Keep staged scope and reviewer fixes separated when the work is part
   of a pre-commit review.
