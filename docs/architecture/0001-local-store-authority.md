# 0001 — Local Store Authority

> Status: Accepted
> Date: 2026-05-02
> Owner: ENG-051

## Decision

**The Electron desktop binary on each cashier machine is the canonical
source of truth for operational data — sales, sale payments, sale
returns, cash sessions, cash movements, inventory movements,
inventory balances, fiscal documents, and audit logs. A future
central server consumes events from the local store; it never writes
directly into those tables.**

The embedded Fastify server runs **in-process** inside the Electron
main process (`apps/desktop/src/main/` imports `@puntovivo/server`
directly — see `AGENTS.md → Architecture landmine: embedded backend`).
This is not a deployment detail; it is the root of the authority
model. Every operational mutation has the same physical guarantee as
a local SQLite transaction, even when the network is offline.

Three runtime shapes share this rule:

- **Desktop** — the deployed shape. Electron main embeds Fastify; the
  renderer talks to it through tRPC over HTTP loopback.
- **Web development** — Vite serves the React app and Fastify runs
  separately from `packages/server`. The local store is still the
  developer's `packages/server/data/local.db`.
- **Standalone server** — the server package can run without
  Electron for tests. Tests treat the in-memory or tmpdir SQLite as
  the same kind of authority a real cashier device would have.

The tenant-isolation invariant (see `AGENTS.md → Multi-tenant
invariants`) sits on top of this: every operational mutation is
scoped by `ctx.tenantId`, derived server-side from the validated
session — never from a renderer-supplied tenant id. ENG-025 already
shipped this through the `desktopSession` singleton in
`apps/desktop/src/main/session/desktopSession.ts`, which the IPC
bridge consults before any DB call.

## Alternatives Rejected

- **Server-authoritative cloud (the renderer always talks to a remote
  central DB)** — breaks offline operation, which is a hard
  requirement for Colombian retail pilots and the
  `SELLABILITY.md` pilot-readiness criteria.
- **CRDT mesh peer-to-peer between cashier devices** — overkill for
  POS retail. Conflicts on money, fiscal, and cash require human
  resolution (see ADR-0004), not eventual convergence.
- **Shared SQLite over a network share or remote file system** —
  every multi-writer SQLite-over-NFS deployment we know of corrupts
  under load and adds latency to the hot path of a sale.
- **Migrate from Electron + SQLite to a fully cloud-native stack** —
  invalidates the local-first moat (see `PLAN-V2.md §4 — Architectural
  decisions`: "Local-first IS the moat. Moving to edge invalidates the
  privacy + latency story.").

## Implementation Impact

- **Already in place**: `desktopSession` singleton enforces tenant
  scope on every IPC handler in `apps/desktop/src/main/index.ts`;
  the renderer cannot supply a tenant id that the server has not
  validated. Audit logs (`audit_logs`) record the cashier's user id
  for every critical mutation.
- **Future contracts assume the local store is authoritative** —
  ADR-0002 (Command Envelope) requires `clientCreatedAt` on the
  cashier device clock, not server clock. ADR-0003 (Outbox Taxonomy)
  treats every outbox as a queue from local-store-of-truth to a
  downstream consumer (DIAN provider, payment rail, central server).
  ADR-0004 (Conflict Policy) trusts the local row for high-risk
  entities until an operator explicitly resolves a conflict.
- **Schema invariant**: tables that hold operational rows
  (`sales`, `sale_payments`, `sale_returns`, `cash_sessions`,
  `cash_movements`, `inventory_movements`, `inventory_balances`,
  `fiscal_documents`, `fiscal_document_items`, `audit_logs`) carry
  `tenant_id` and the cashier-device-aware columns introduced by
  ENG-052 (see ADR-0002). The future central server reads these
  rows through a sync contract (ENG-064), not by direct write.
- **Contract for the central server**: any Phase 3 sync architecture
  (libSQL embedded replicas spike per `PLAN-V2.md §4`) MUST preserve
  the local-write-first semantics. The replica may push into a cloud
  read replica, but the operational write always lands in the local
  Electron store first.

## Affected Tickets

- `ENG-052` — Device registry + command envelope. The device id is
  derived from the local Electron install, not assigned by a server.
- `ENG-053` — Operation journal + outbox kernel. The journal lives
  in the local store; effects fan out from there to the outboxes.
- `ENG-054` / `ENG-055` / `ENG-056` — Sale lifecycle services and
  cash session aggregate boundary. All three operate inside the
  local SQLite transaction; the application services never reach
  out for authoritative state.
- `ENG-057` — Fiscal outbox + contingency engine. Pulls from the
  local fiscal documents table and pushes to the provider; never
  the other way around.
- `ENG-064` — Sync contract v1. Defines the shape of the events
  the local store publishes to a future central server.
- `ENG-070` — Event-based public API + webhook foundation. Reads
  from the operation journal; the central server publishes events,
  not raw SQL access.

Updated: 2026-05-02 (ENG-051 — initial ADR set).
