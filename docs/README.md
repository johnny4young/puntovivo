# Puntovivo · Docs Index

This directory holds the design docs, runbooks, and reference material for the
project. Read the right file for the question, not the whole directory.

---

## Architecture & stack

| File                                                                                                                                                                   | Use                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md)                                                                                                                                 | Top-level Electron + Fastify + tRPC + SQLite layout.                                                                                                                                                                                                                  |
| [`architecture/`](./architecture/README.md)                                                                                                                            | **Architecture Decision Records (ADRs)** — locked decisions that gate work across the codebase (Local Store Authority, Command Envelope, Outbox Taxonomy, Conflict Policy). Read when designing schema or service boundaries that touch sales / fiscal / cash / sync. |
| [`AUTHORITY-NODE.md`](./AUTHORITY-NODE.md)                                                                                                                             | Runtime-mode architecture for `device_local`, `site_hub`, and `hub_client`. Read before touching LAN Store Hub, device registration, central-server ingestion, or local authority semantics.                                                                          |
| [`STACK-EVOLUTION.md`](./STACK-EVOLUTION.md)                                                                                                                           | Additive evolution rules — when each stack tier graduates (Ring 1..4).                                                                                                                                                                                                |
| [`SPIKE-LIBSQL-TURSO.md`](./SPIKE-LIBSQL-TURSO.md)                                                                                                                     | Spike outcome — libSQL/Turso embedded replicas evaluated as a sync substrate. Recommendation: Defer. Read when reopening the hybrid-DB question or when a pilot reports a `sync_outbox` shortcoming.                                                                  |
| [`TRPC_ARCHITECTURE.md`](./TRPC_ARCHITECTURE.md) + [`TRPC_IMPLEMENTATION_PLAN.md`](./TRPC_IMPLEMENTATION_PLAN.md) + [`TRPC_TESTING_GUIDE.md`](./TRPC_TESTING_GUIDE.md) | tRPC procedure design, schema patterns, HTTP-less testing.                                                                                                                                                                                                            |
| [`DESKTOP_RUNTIME_GUIDE.md`](./DESKTOP_RUNTIME_GUIDE.md)                                                                                                               | Electron-specific runtime notes (sandbox, dual-binary native modules).                                                                                                                                                                                                |
| `architecture.mmd` + `architecture.svg`                                                                                                                                | Mermaid + rendered diagram of the system.                                                                                                                                                                                                                             |

## Fiscal engine (LATAM)

| File                                               | Use                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------- |
| [`FISCAL-INTEGRATION.md`](./FISCAL-INTEGRATION.md) | DIAN-specific contract + gates + error map.                                |
| [`LOCALE-CURRENCY.md`](./LOCALE-CURRENCY.md)       | `tenant_locale_settings` schema + per-tenant currency / format resolution. |

## Vertical scope

| File                                                   | Use                                                      |
| ------------------------------------------------------ | -------------------------------------------------------- |
| [`PRODUCT-COMPOSITION.md`](./PRODUCT-COMPOSITION.md)   | Product modeling for composite SKUs.                     |
| [`RESTAURANT-LIFECYCLE.md`](./RESTAURANT-LIFECYCLE.md) | Tables, KDS, modifiers — design for the restaurant pack. |
| [`MODULE-ACTIVATION.md`](./MODULE-ACTIVATION.md)       | Per-tenant module gating.                                |
| [`HARDWARE-POS.md`](./HARDWARE-POS.md)                 | ESC/POS, cash drawer, scanner, peripherals.              |

## AI features

| File                                                   | Use                                    |
| ------------------------------------------------------ | -------------------------------------- |
| [`AI-ANOMALY-DETECTION.md`](./AI-ANOMALY-DETECTION.md) | Local-only z-score detector design.    |
| [`AI-SEMANTIC-SEARCH.md`](./AI-SEMANTIC-SEARCH.md)     | OpenAI embeddings + cosine similarity. |

## UX & design system

| File                                             | Use                                                                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| [`UI-SURFACES.md`](./UI-SURFACES.md)             | Inventory of admin surfaces + role gating.                                                                                           |
| [`SALES-COCKPIT.md`](./SALES-COCKPIT.md)         | Operator UX guide for cashier speed, touch ergonomics, KDS readability, fiscal setup, recipes/BOM, quotations, and owner dashboards. |
| [`UI-REFRACTOR-V3.md`](./UI-REFRACTOR-V3.md)     | Information architecture and progressive-disclosure plan for reducing visible options per screen.                                    |
| [`WALKTHROUGH.md`](./WALKTHROUGH.md)             | Design handoff alignment for Sales Cockpit, surfaces, and module activation.                                                         |
| [`COMPONENTS.md`](./COMPONENTS.md)               | Shared component catalog.                                                                                                            |
| [`STYLING.md`](./STYLING.md)                     | Design system tokens + Tailwind primitives.                                                                                          |
| [`RECEIPT-TEMPLATES.md`](./RECEIPT-TEMPLATES.md) | Receipt template editor + renderer.                                                                                                  |

## Operations & runbooks

| File                                                             | Use                                                                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`SELLABILITY.md`](./SELLABILITY.md)                             | Colombian retail pilot / production readiness checklist and blocker index.                                                                                               |
| [`DEV-SEED.md`](./DEV-SEED.md)                                   | Seeded users, passwords, SEED_PRESET / SEED_RESET / SEED_COUNTRY env vars. **Never invent credentials — read this.**                                                     |
| [`LOGIN_GUIDE.md`](./LOGIN_GUIDE.md)                             | First-run login flow.                                                                                                                                                    |
| [`ENVIRONMENT_CONFIGURATION.md`](./ENVIRONMENT_CONFIGURATION.md) | Env vars catalog.                                                                                                                                                        |
| [`SECURITY.md`](./SECURITY.md)                                   | Auth hardening, rate-limit policy, audit log catalog.                                                                                                                    |
| [`AUDIT-2026-06-28.md`](./AUDIT-2026-06-28.md)                   | Repo-wide review summary with implemented hardening fixes and follow-up proposal.                                                                                        |
| [`DEBUGGING.md`](./DEBUGGING.md)                                 | Common dev gotchas.                                                                                                                                                      |
| [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)                     | Operator-facing recovery procedures.                                                                                                                                     |
| [`TEST-PLAN.md`](./TEST-PLAN.md)                                 | E2E test inventory + automation status.                                                                                                                                  |
| [`PERF-BUDGETS.md`](./PERF-BUDGETS.md)                           | Performance budgets contract: bundle-size + tRPC p95 latency CI gates anchored on `perf-budget.json`.                                                                    |
| [`A11Y.md`](./A11Y.md)                                           | Accessibility contract: axe-core component helper, contrast CI gate on theme tokens, ARIA conventions.                                                                   |
| [`OBSERVABILITY.md`](./OBSERVABILITY.md)                         | Production observability rail: sink interface + captureException/withSpan helpers, tRPC tracing middleware, per-tenant opt-in + audit, renderer-side captureRenderError. |
| [`SHORTCUTS.md`](./SHORTCUTS.md)                                 | Canonical keyboard-shortcut catalogue + global Command Palette UX.                                                                                                       |

---

## Maintenance

When a ticket lands a new `docs/*.md` file, register it in the right section of
this index in the same commit so the documentation map stays accurate.
