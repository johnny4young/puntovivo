# Long-Term Vision — Platform-Level Features

> Status: vision document, 12-36 months out.
> Created: April 21, 2026.

Cross-cutting features that multiply value across every vertical and
every country. Not tied to any single ring of market coverage.

## Themes

### Year 1-2 (near-term)

| Theme | Status | Description |
| --- | --- | --- |
| **Accounting integrations** | Promoted → `ENG-115` | Automatic export of accounting entries to Siigo, Alegra, World Office, ContaPyme |
| **WhatsApp Business API** | Promoted → `ENG-112` (outbound) + `ENG-144` (inbound commerce) | Receipts by WhatsApp, appointment reminders, shareable catalog, customer order intake |
| **Owner mobile app** | Open | Native wrapper (Capacitor) over the existing React bundle: dashboards, alerts, remote void approvals |
| **Open banking CO** (PSE push, Bre-B) | Promoted into `ENG-124` rail-by-rail | Direct bank-to-merchant payments without card or cash, per central bank 2024-2025 rollout |
| **AI support assistant** | Promoted → `ENG-130` | In-product chatbot answering cashier/admin questions, onboarding in natural language |
| **Error tracking + basic analytics** | Promoted → `ENG-135` (production observability) + `ENG-128` (local diagnostics) | Sentry + per-tenant product analytics opt-in |

### Year 2-3 (medium-term)

| Theme | Status | Description |
| --- | --- | --- |
| **BI / advanced analytics** | Promoted → `ENG-116` (control tower) + `ENG-153` (cohort/LTV/RFM) | Configurable dashboards, drill-down by site × category × time, cohort analysis |
| **Public API + plugin marketplace** | Promoted → `ENG-118` (public API + webhook) + `ENG-165` (rate-limit prerequisite). Plugin marketplace stays Open. | Third-party integrators build on Puntovivo, creating network effects |
| **Franchise / chain consolidation** | Promoted → `ENG-126` | Multi-tenant-of-tenants topology, consolidated reporting, central catalog with local override |
| **White-label reseller program** | Open | Local integrators sell Puntovivo under their brand |
| **AI-demand prediction** | Promoted → `ENG-130` (forecasting subset) + `ENG-111` (replenishment) | Per-product, per-day demand forecast feeding auto purchase orders |
| **AI-fraud detection** | Promoted → `ENG-130` (anomaly triage) + `ENG-142` (deterministic loss-prevention) | Pattern recognition on voids, discounts, refunds, stock adjustments |
| **AI-OCR for supplier invoices** | Promoted → `ENG-094` (Textract) + `ENG-101` (DocAI/Azure expansion) + `ENG-125` (procurement integration) | Photo → auto-registered purchase order |
| **Biometrics / facial recognition** | Open | Employee clock-in (could integrate with `ENG-140` shift management), loss prevention |
| **IoT for restaurants** | Open | Fridge/oven temperature sensors, predictive alerts |
| **Sustainability module** | Open | Per-product carbon footprint, ESG-ready waste reports |

### Year 3+ (far-term)

| Theme | Status | Description |
| --- | --- | --- |
| **Self-checkout (Amazon Go-like)** | Partial promote → `ENG-147` ships kiosk + QR-table; full computer-vision Amazon-Go stays Open | Computer vision + IoT, no cashier |
| **Voice ordering (drive-thru)** | Partial — `ENG-039a` shipped voice cart entry; drive-thru payment handoff stays Open (`ENG-099`) | Speech-to-text + intent extraction for restaurants |
| **AR inventory counting** | Open | Phone camera scans shelves, counts inventory |
| **Embedded finance** | Open (explicit V3 non-goal: Puntovivo does not hold merchant funds) | Merchant credit based on sales history, partnership with fintech |

## Architectural prerequisites

Each theme above depends on architectural foundations landing earlier:

- **Hybrid deployment with central server** ([STACK-EVOLUTION.md](./STACK-EVOLUTION.md) Phase β)
  is a prerequisite for: BI, public API, chain consolidation, mobile
  app, AI (server-side), embedded finance
- **Module activation** ([MODULE-ACTIVATION.md](./MODULE-ACTIVATION.md))
  is a prerequisite for every vertical specialization
- **Multi-currency + fiscal profile** ([LATAM-EXPANSION.md](./LATAM-EXPANSION.md))
  is a prerequisite for any out-of-CO deployment

## What this document is not

- A commitment. These are possibilities, not promises.
- A sequence. Items within a year bucket are not ordered — priority
  depends on market signals at the time.
- Exhaustive. It misses items that become relevant later.

## Governance

This document is reviewed quarterly. Items graduate out when they enter
active development (→ move to [ROADMAP.md](./ROADMAP.md)). New items
arrive from customer interviews, competitor moves, and regulatory
changes.
