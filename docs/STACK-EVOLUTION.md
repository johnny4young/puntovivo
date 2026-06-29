# Stack Evolution

> Status: design document. Triggered by the April 2026 architecture review
> during the MVP-for-Colombia planning.
> Created: April 21, 2026.

## Summary

Puntovivo's current stack — Electron + Fastify + tRPC + better-sqlite3
+ Drizzle + React — is **sufficient for the MVP (Rings 1-3)**. No stack
migration is needed to reach 71% → 95% of the retail + restaurant +
services markets.

Stack evolution becomes necessary when **Ring 4+** (franchises, public
API, mobile, LatAm multi-country, central BI, AI) enters the plan. The
evolution is **additive**: no codebase forks, no rewrites, no drop of
offline-first.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the current shape.

## Current stack (shipped)

- Electron 41 (desktop cross-platform)
- Fastify 5 (in-process, embedded in Electron main)
- tRPC 11 (end-to-end type safety via `AppRouter`)
- SQLite via `better-sqlite3` (in-process, synchronous, native)
- Drizzle ORM
- React 19 + Vite 8 + Tailwind v4 + TanStack Query + Zustand + i18next
- Auth: JWT access + rotated refresh cookie + CSRF + RBAC
- Sync queue with deferred send (offline-first)
- electron-builder packaging, GitHub Releases auto-updater, pino logging

## Where the current stack becomes friction

| Friction | Triggers when | Impact if ignored |
| --- | --- | --- |
| SQLite embedded cannot aggregate across installs | Franchises with live consolidated KPIs; public API; mobile companion; BI | Cannot serve franchises or central reporting |
| `better-sqlite3` ABI-dual binary | Happening today | Technical debt cost; cold-start fragility (mitigated by cache) |
| tRPC unfriendly to third parties | Public API, ecosystem integrations | Harder to attract integrators |
| Desktop-only auth | Mobile native apps, third-party API consumers | Security model doesn't fit those channels |
| No distributed tracing | Chain franchises, production SRE | Harder to debug at scale |
| SQLite analytics don't scale past ~1GB | BI with years of history | BI queries slow, drill-down poor |
| Electron can't produce mobile binaries | Owner mobile app | Need an additional wrap (Capacitor) or rewrite (React Native) |

## Planned evolution (four phases)

### Phase α — Technical debt cleanup (1-2 weeks)

Before Ring 4 begins. Keeps everything that's already shipped working
better.

- **Migrate `better-sqlite3` → libSQL (Turso)**. libSQL is a drop-in
  SQLite fork with **N-API-stable** native bindings, removing the
  dual-binary swap. Drizzle already supports libSQL via
  `drizzle-orm/libsql` — the change is ~1-2 days of refactor.
  Bonus: future replication opt-in.
- **Standalone server packaging**: publish `packages/server` as a
  Docker image + document its standalone use case.
- **Sentry opt-in** in main + renderer.
- **Close ENG-001** (end-to-end Playwright in CI).

### Phase β — Optional central server (3-4 weeks)

Unlocks franchises, BI, public API, mobile.

- Add a **Postgres adapter** via Drizzle (same schema source).
- "Hybrid deployment": desktop stays offline-first authoritative; a
  central server receives `sync_outbox` diffs.
- Conflict resolution: CRDT-like by `updated_at` + tombstones, per
  `tenantId`.
- Web admin UI (same React bundle) deployed as static site to the
  public Internet, against the central server.

### Phase γ — Public API + mobile (4-6 weeks)

Builds on Phase β.

- `trpc-openapi` → auto-generate REST + OpenAPI from existing procedures.
- API keys + scopes (`sales:read`, `inventory:write`, etc.).
- Owner mobile app: **Capacitor** wrapping the same Vite bundle.
  Restricted to dashboards, alerts, approvals — not full POS.

### Phase δ — BI + AI + IoT (as data and demand grow)

- CDC from Postgres → **ClickHouse** or **TimescaleDB** for heavy analytics.
- AI integrations (demand prediction, fraud detection, OCR) live on the
  central server. Client devices never hold AI API credentials.
- Event bus (NATS / Redis Streams) for IoT and webhooks.

## What does not change

Decisions that remain stable across all phases:

- **tRPC** for first-party clients (desktop, web, mobile-wrapped).
  REST coexists for third parties; tRPC is not replaced.
- **Drizzle** — portable across SQLite, libSQL, Postgres.
- **Fastify**.
- **Electron** for desktop. Not migrating to Tauri. (The binary-size
  advantage of Tauri does not compensate for losing the Node ecosystem
  and mature IPC story.)
- **React + Vite + Tailwind**. Capacitor wraps, does not replace.
- **Multi-tenant row-level by `tenantId`**. Not migrating to DB-per-tenant.

## What is deliberately NOT considered

- GraphQL, NestJS, Prisma, event-sourcing at the domain level, Next.js
  SSR for the desktop renderer — none offer a benefit proportional to
  their migration cost for the problem space.

## Open questions

- Phase β **timing**: tied to first franchise customer signing, not to
  a calendar date.
- Phase δ **storage choice**: ClickHouse vs TimescaleDB depends on the
  first BI use case (time-series heavy → Timescale; ad-hoc analytics
  heavy → ClickHouse).
- Mobile **depth**: Capacitor wrap for read-only dashboards is clear;
  whether to extend to full mobile POS is a market question, not a
  technical one. Full React Native rewrite only if offline-capable
  mobile POS becomes a differentiator.
