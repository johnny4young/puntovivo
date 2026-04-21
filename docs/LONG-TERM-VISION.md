# Long-Term Vision — Platform-Level Features

> Status: vision document, 12-36 months out.
> Created: April 21, 2026.

Cross-cutting features that multiply value across every vertical and
every country. Not tied to any single ring of market coverage.

## Themes

### Year 1-2 (near-term)

| Theme | Description |
| --- | --- |
| **Accounting integrations** | Automatic export of accounting entries to Siigo, Alegra, World Office, ContaPyme |
| **WhatsApp Business API** | Receipts by WhatsApp, appointment reminders, shareable catalog |
| **Owner mobile app** | Native wrapper (Capacitor) over the existing React bundle: dashboards, alerts, remote void approvals |
| **Open banking CO** (PSE push, Bre-B) | Direct bank-to-merchant payments without card or cash, per central bank 2024-2025 rollout |
| **AI support assistant** | In-product chatbot answering cashier/admin questions, onboarding in natural language |
| **Error tracking + basic analytics** | Sentry + per-tenant product analytics opt-in |

### Year 2-3 (medium-term)

| Theme | Description |
| --- | --- |
| **BI / advanced analytics** | Configurable dashboards, drill-down by site × category × time, cohort analysis |
| **Public API + plugin marketplace** | Third-party integrators build on Puntovivo, creating network effects |
| **Franchise / chain consolidation** | Multi-tenant-of-tenants topology, consolidated reporting, central catalog with local override |
| **White-label reseller program** | Local integrators sell Puntovivo under their brand |
| **AI-demand prediction** | Per-product, per-day demand forecast feeding auto purchase orders |
| **AI-fraud detection** | Pattern recognition on voids, discounts, refunds, stock adjustments |
| **AI-OCR for supplier invoices** | Photo → auto-registered purchase order |
| **Biometrics / facial recognition** | Employee clock-in, loss prevention |
| **IoT for restaurants** | Fridge/oven temperature sensors, predictive alerts |
| **Sustainability module** | Per-product carbon footprint, ESG-ready waste reports |

### Year 3+ (far-term)

| Theme | Description |
| --- | --- |
| **Self-checkout (Amazon Go-like)** | Computer vision + IoT, no cashier |
| **Voice ordering (drive-thru)** | Speech-to-text + intent extraction for restaurants |
| **AR inventory counting** | Phone camera scans shelves, counts inventory |
| **Embedded finance** | Merchant credit based on sales history, partnership with fintech |

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
