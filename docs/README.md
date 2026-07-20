# Puntovivo · Docs Index

This directory holds the design docs, runbooks, and reference material for the
project. Read the right file for the question, not the whole directory.

---

## Architecture & stack

| File                                                                                                  | Use                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md)                                                                | Top-level Electron + Fastify + tRPC + SQLite layout.                                                                                                                        |
| [`architecture/`](./architecture/README.md)                                                           | **Architecture Decision Records (ADRs)** — durable decisions for local authority, commands, outboxes, conflicts, security, modules, runtime modes, money, and labor policy. |
| [`TRPC_ARCHITECTURE.md`](./TRPC_ARCHITECTURE.md) + [`TRPC_TESTING_GUIDE.md`](./TRPC_TESTING_GUIDE.md) | tRPC procedure design, schema patterns, and HTTP-less testing.                                                                                                              |
| [`DESKTOP_RUNTIME_GUIDE.md`](./DESKTOP_RUNTIME_GUIDE.md)                                              | Electron-specific runtime notes (sandbox, dual-binary native modules).                                                                                                      |
| `architecture.mmd` + `architecture.svg`                                                               | Mermaid + rendered diagram of the system.                                                                                                                                   |

## Fiscal engine (LATAM)

| File                                               | Use                                                         |
| -------------------------------------------------- | ----------------------------------------------------------- |
| [`FISCAL-INTEGRATION.md`](./FISCAL-INTEGRATION.md) | Country-adapter maturity, invariants, and production gates. |

## Vertical scope

| File                                             | Use                                         |
| ------------------------------------------------ | ------------------------------------------- |
| [`MODULE-ACTIVATION.md`](./MODULE-ACTIVATION.md) | Per-tenant module gating.                   |
| [`HARDWARE-POS.md`](./HARDWARE-POS.md)           | ESC/POS, cash drawer, scanner, peripherals. |

## UX & design system

| File                                             | Use                                         |
| ------------------------------------------------ | ------------------------------------------- |
| [`COMPONENTS.md`](./COMPONENTS.md)               | Shared component catalog.                   |
| [`STYLING.md`](./STYLING.md)                     | Design system tokens + Tailwind primitives. |
| [`RECEIPT-TEMPLATES.md`](./RECEIPT-TEMPLATES.md) | Receipt template editor + renderer.         |

## Operations & runbooks

| File                                                             | Use                                                                                                                                                                      |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`PROJECT-STATUS.md`](./PROJECT-STATUS.md)                       | Canonical shipped-capability inventory, remaining gaps, and release-readiness verdict.                                                                                   |
| [`DEV-SEED.md`](./DEV-SEED.md)                                   | Seeded users, passwords, SEED_PRESET / SEED_RESET / SEED_COUNTRY env vars. **Never invent credentials — read this.**                                                     |
| [`LOGIN_GUIDE.md`](./LOGIN_GUIDE.md)                             | First-run login flow.                                                                                                                                                    |
| [`ENVIRONMENT_CONFIGURATION.md`](./ENVIRONMENT_CONFIGURATION.md) | Env vars catalog.                                                                                                                                                        |
| [`SECURITY.md`](./SECURITY.md)                                   | Auth hardening, rate-limit policy, audit log catalog.                                                                                                                    |
| [`DEBUGGING.md`](./DEBUGGING.md)                                 | Common dev gotchas.                                                                                                                                                      |
| [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md)                     | Operator-facing recovery procedures.                                                                                                                                     |
| [`TESTING.md`](./TESTING.md)                                     | Current CI, E2E, live-smoke, and release-candidate validation contract.                                                                                                  |
| [`PERF-BUDGETS.md`](./PERF-BUDGETS.md)                           | Performance budgets contract: bundle-size + tRPC p95 latency CI gates anchored on `perf-budget.json`.                                                                    |
| [`A11Y.md`](./A11Y.md)                                           | Accessibility contract: axe-core component helper, contrast CI gate on theme tokens, ARIA conventions.                                                                   |
| [`OBSERVABILITY.md`](./OBSERVABILITY.md)                         | Production observability rail: sink interface + captureException/withSpan helpers, tRPC tracing middleware, per-tenant opt-in + audit, renderer-side captureRenderError. |
| [`SHORTCUTS.md`](./SHORTCUTS.md)                                 | Canonical keyboard-shortcut catalogue + global Command Palette UX.                                                                                                       |

---

## Maintenance

Register every new public `docs/*.md` reference in the right section of this
index in the same commit. Public guides describe current behavior and durable
architecture only. Internal planning, estimates, ticket maps, and handoffs
belong under the ignored `docs/planning/` directory.
