# Spike — libSQL / Turso embedded replicas as a sync substrate (ENG-037)

> Status: **Spike report — complete.** Recommendation: Defer; implementation remains gated on a future reopen trigger in §2.
> Owner: ENG-037.
> Date: 2026-05-08.
> Related ADRs: 0001 (Local Store Authority), 0002 (Command Envelope), 0003 (Outbox Taxonomy), 0004 (Conflict Policy), 0005 (Sync Payload Contract), 0006 (Local Data Security), 0008 (Authority Node Runtime Modes).
> Related code: [`packages/server/src/services/sync/contract.ts`](../packages/server/src/services/sync/contract.ts), [`packages/server/src/services/sync/enqueue.ts`](../packages/server/src/services/sync/enqueue.ts), [`packages/server/src/db/schema.ts`](../packages/server/src/db/schema.ts) (`sync_outbox` table).

## 1. Executive summary

ENG-037 asks whether Puntovivo should adopt libSQL / Turso embedded
replicas to close the multi-site sync gap referenced in the hybrid
database runtime plan without migrating off SQLite. The answer this spike returns is
**Defer** — revisit after Phase 4 vertical work or after at least
two pilot tenants are running production sales on the existing
`sync_outbox` pipeline.

Three findings drive the recommendation:

1. **Turso's default architectural model conflicts with ADR-0001
   (Local Store Authority).** The default Turso topology is
   cloud-primary: writes flow to the cloud, the local replica
   serves reads. Puntovivo's POS is the inverse — the Authority
   Node's local SQLite is the canonical truth, and the cloud is the
   eventual consumer. Adopting Turso "as advertised" would invert
   the moat.
2. **Current Turso Sync still does not match Puntovivo's
   conflict policy.** The current docs moved offline-first writes
   to `@tursodatabase/sync`, mark the new Turso Database surface
   as beta, and document Last-Push-Wins for concurrent pushes.
   Puntovivo needs strict/manual handling for money, fiscal,
   inventory, audit and cash data, with the operator decision
   visible in Operations Center.
3. **libSQL as a pure SQLite engine swap (without Turso cloud)
   buys nothing this iter.** The `libsql` npm package is
   API-compatible with `better-sqlite3` but uses Rust-based native
   bindings tied to a specific Node ABI — it inherits the same
   Electron 41 (MODULE_VERSION 145) vs Node 24 (MODULE_VERSION 137)
   dual-binary problem. A pure
   engine swap is a non-trivial migration with no immediate user
   benefit.

The path that does have value is **bespoke `sync_outbox` →
central-server pipeline** (already shipped via ENG-064 + ENG-064b)
plus a separate **cloud-backup destination** for disaster recovery.
That separation respects ADR-0001 and ADR-0004 and lands when the
operator commissions a central server (Phase 3+ in PLAN-V2 or
later).

The full evaluation follows. §11 lists what would change the
recommendation if reopened.

## 2. Recommendation

**Defer (revisit after Phase 4).**

| Outcome                                      | Status                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Greenlit (proceed to implementation now)** | ❌ rejected — see §6 + §8.                                                                                                     |
| **Yellow (proceed with conditions)**         | ❌ rejected — the conditions list (offline-writes GA + manual-resolution API + N-API libSQL) is not under Puntovivo's control. |
| **Defer (revisit after Phase 4)**            | ✅ recommended.                                                                                                                |

**Triggers that would reopen this spike** (each is a sufficient
condition; the operator does not need all of them):

1. Turso publishes Offline Writes as **GA with durability
   guarantees** AND ships a **manual-resolution API** compatible
   with ADR-0004's high-risk entity list. The current public docs
   document Last-Push-Wins rather than operator-mediated
   resolution.
2. The Phase 3+ central-server architecture lands and an operator
   pilot reports **`sync_outbox` drain failures or conflict
   pile-up** that the current bespoke pipeline cannot solve.
3. **libSQL** publishes a **N-API binding** so the ABI burden
   matches `node-sqlite3` (already N-API) instead of
   `better-sqlite3` (still C++ bindings + dual-binary cache).
4. A pilot tenant requires **multi-cashier read-replica latency
   < 1 s** at a site where the existing local-SQLite-on-Electron
   topology cannot meet the latency requirement (this is
   architecturally unlikely — Electron-embedded SQLite is faster
   than any network round trip — but listed for completeness).

**What ships in this iter:** this spike report only. The operator
reviews §11 trigger conditions and decides.

## 3. The current sync substrate (recap)

ENG-064 + ENG-064b shipped a complete, contract-driven sync
foundation in May 2026. The relevant moving parts:

### 3.1 Tables (defined in `packages/server/src/db/schema.ts`)

- **`sync_outbox`** — the canonical outbox. Replaced the legacy
  `sync_queue` in migration `0017_drop_sync_queue.sql`. Row shape:
  `{tenant_id, status, entity_type, entity_id, operation, payload,
payload_version, conflict_policy, idempotency_key, device_id,
depends_on_operation_id, operation_event_id, attempts, priority,
created_at, updated_at}`. Status enum: `queued | submitting |
synced | retrying | dead_letter | conflict`.
- **`operation_events`** — one row per critical command (sale,
  return, void, etc.). Carries the command envelope from ADR-0002.
  `sync_outbox.operation_event_id` is a soft FK that lets
  consumers replay in causal order.
- **`operation_effects`** — journal effects per `operation_event`,
  including `kind='outbox_enqueue:sync'` for trail correlation.
- **`fiscal_outbox`** + **`hardware_outbox`** — sibling outboxes
  per ADR-0003. Mirror the kernel projection so a single drainer
  can apply uniform retry / backoff / dead-letter semantics.

### 3.2 Code surfaces

- **[`services/sync/contract.ts`](../packages/server/src/services/sync/contract.ts)** —
  manifest with `SYNC_ENTITY_TYPES` (~46 entries), per-entity
  `SYNC_CONFLICT_POLICY: Record<SyncEntityType, 'manual' |
'auto_lww'>`, and `SYNC_PAYLOAD_VERSION = 1`. The
  exhaustiveness of the `Record<...>` type catches new entities
  that land without a deliberate policy decision.
- **[`services/sync/enqueue.ts`](../packages/server/src/services/sync/enqueue.ts)** —
  single `enqueueSync(ctx, args)` entry point used by 19 routers
  - 4 application services + 1 dev seed. Reads the envelope
    context, looks up `operation_event_id`, populates the contract,
    emits one `sync_outbox` row + one `operation_effects` row.
    Idempotency via the partial unique index on `(tenant_id,
entity_type, entity_id, operation, idempotency_key) WHERE
idempotency_key IS NOT NULL`.
- **`packages/server/src/trpc/routers/sync.ts`** — 11 tRPC
  procedures: `status`, `listQueue`, `addToQueue`, `removeFromQueue`,
  `listConflicts`, `push`, `pull`, `resolve`, `getContract`,
  `peekOutbox`, `retry`. The first eight migrated from
  `sync_queue` → `sync_outbox` in ENG-064b.

### 3.3 What the current substrate does well

- **Local-first by construction.** Every row is enqueued inside
  the same SQLite transaction that mutated the operational table.
  Power loss between the mutation and the enqueue is impossible.
- **Per-entity conflict routing.** ADR-0004's two lists (manual /
  auto_lww) are mechanically enforced by the manifest. New entity
  types fail the build until they are classified.
- **Idempotent retries.** ADR-0002 envelopes carry an
  `idempotency_key`; the partial unique index collapses retries
  into the same row.
- **Operations Center visibility (ENG-065a / b / c).** Operators
  see what is pending, what failed, and which action to take
  without reading logs.
- **Diagnostic export sanitization (ENG-066 / ADR-0006).** The
  `reports.diagnostics.export` endpoint redacts secrets before
  shipping the bundle to support.

### 3.4 What the current substrate does NOT do (the gap)

- **No central server yet.** `sync_outbox` rows accumulate locally
  awaiting a downstream consumer that does not exist in
  production. Phase 3 (PLAN-V2) commissions that consumer.
- **No cloud backup.** ENG-066 ships local-disk backups; off-box
  archival is operator-driven.
- **No Store Hub mode yet.** A second cashier in the same store either
  runs a separate `device_local` SQLite file today or needs the
  `site_hub` / `hub_client` Authority Node wave (`ENG-071..ENG-075`)
  before it can share one site database over LAN.

These are real gaps, but they are **commissioning gaps** of the
central server side of Phase 3 — not gaps in the local-first
substrate itself. The bespoke pipeline is sufficient as the local
emitter.

## 4. What libSQL is

[libSQL](https://github.com/tursodatabase/libsql) is a fork of
SQLite created and maintained by Turso. Key claims:

- **Open source** (MIT) and open contributions — SQLite proper
  accepts contributions only from a small set of maintainers.
- **100% file-format compatible** with SQLite. A `local.db`
  produced by `better-sqlite3` opens unchanged in libSQL and
  vice versa.
- **API-compatible** at the SQL level. Standard SQLite syntax,
  pragmas, and functions are preserved.
- **Adds extensions** SQLite proper does not have: vector search
  (`vss0`-style), built-in encryption-at-rest (libSQL-WAL2),
  user-defined Wasm functions (experimental), and HTTP / remote
  protocols.
- **Single-writer model preserved.** "libSQL inherits SQLite's
  fundamental limitations such as the single-writer model" —
  quoted directly from the libsql-js README.

### 4.1 The Node SDK (`libsql` npm package)

- Package: `libsql` on npm. `latest` is `0.5.29`; `next` points
  at `0.6.0-pre.35` as of 2026-05-08. `@libsql/client` latest is
  `0.17.3` and depends on `libsql`; current Turso Sync docs use
  `@tursodatabase/sync` (`0.5.3` latest).
- Native bindings: still a native runtime concern. The package
  ships prebuilt platform optional dependencies (`@libsql/*` and
  `@tursodatabase/sync-*` families), so Puntovivo cannot assume an
  engine swap removes the Electron / Node native-binary burden
  until a real Electron build validates it. This means:
  - Electron runtime validation is required, even if a rebuild is
    not necessary on every platform.
  - The dual-binary cache pattern in
    `scripts/ensure-native-runtime.mjs` would extend to libSQL
    if the package proves Node-ABI bound in practice. Net change
    in operational complexity is not known to be better than
    `better-sqlite3`.
- API surface: aims to be drop-in for `better-sqlite3`. Same
  `Database` and `Statement` classes, same synchronous query
  pattern. Async variant available via `import Database from
'libsql/promise'`.
- Embedded-replica configuration: opt-in via
  `new Database('file:replica.db', { syncUrl: '...',
authToken: '...', syncInterval: 60 })`. When `syncUrl` is
  omitted, libSQL behaves as a regular local SQLite engine.

### 4.2 Distinction the spike must hold

There are three modes one can adopt libSQL in:

1. **Engine-only swap** — replace `better-sqlite3` with `libsql`.
   No Turso cloud. No replicas. Just a SQLite-fork engine with
   a few extra extensions. This is the lowest-risk adoption mode.
2. **Embedded replica with cloud-primary** — the default Turso
   topology. Writes go to Turso Cloud; the local file mirrors.
   This violates ADR-0001.
3. **Turso Sync / offline-first writes** — the local file accepts
   writes; explicit `push()` / `pull()` calls synchronize with
   Turso Cloud later. Current docs describe Last-Push-Wins conflict
   resolution and the Turso Database surface is still beta.

§5 details mode 2 + 3. §10 details what mode 1 would cost.

## 5. What Turso is

[Turso](https://turso.tech) operates multiple database surfaces
relevant to this spike:

### 5.1 Turso Cloud (libSQL-as-a-service)

A managed libSQL primary that the libsql-js client reads from
and writes to. Default topology:

```
[App / Electron device] --HTTP--> [Turso Cloud primary]
    \\                             /
     \\____ [Embedded replica] ___/
            (local file, read-from-local, writes-to-cloud)
```

Reads are served from the local file (zero network round trip).
Writes go to the cloud primary first; the local replica updates
after the cloud write succeeds.

This is a CDN-for-databases model — excellent for read-heavy
SaaS apps where the cloud DB is the source of truth and devices
are clients. **Inverted from Puntovivo's model.**

Current Turso docs now call Embedded Replicas a legacy Turso Cloud
feature and direct new sync projects to Turso Sync. That strengthens
the "do not adopt this topology for new POS sync" conclusion.

### 5.2 Turso Sync (offline-first writes)

Announced October 2024 (private beta) and March 2025 (public
beta), then documented under the current Turso Database / Sync
surface. Lets the local file accept writes while offline. When the
device reconnects, pending writes push to the cloud primary.

Status timeline:

- **Oct 2024**: private beta. Strategies offered:
  `FAIL_ON_CONFLICT` (default), `DISCARD_LOCAL`, `REBASE_LOCAL`,
  `MANUAL_RESOLUTION` (custom `conflictResolver` callback).
- **Mar 2025**: public beta. Conflict detection works but
  resolution is "not yet implemented" in that wave. The launch
  post includes a beta disclaimer that there are no durability
  guarantees.
- **May 2026 (today)**: current docs expose explicit `push()` /
  `pull()` through `@tursodatabase/sync`, mark the new Turso
  Database surface as beta, and document Last-Push-Wins conflict
  handling for concurrent pushes. No operator-mediated manual
  conflict API compatible with ADR-0004 was verified.

Conflict resolution model in the current docs:

- Row-level logical logging.
- Default: Last-Push-Wins.
- Pull rolls local unpushed changes back to the last synced state,
  applies remote changes, then replays local changes atomically.

### 5.3 Pricing tiers (May 2026)

For multi-tenant scale projection in §9, the public pricing page
returns:

| Tier       | Monthly | Storage   | Rows R/W      | Syncs     | Notes                  |
| ---------- | ------- | --------- | ------------- | --------- | ---------------------- |
| Free       | $0      | 5 GB      | 500 M / 10 M  | 3 GB      | Community support      |
| Developer  | $4.99   | 9 GB      | 2.5 B / 25 M  | 10 GB     | Single user            |
| Scaler     | $24.92  | 24 GB     | 100 B / 100 M | 24 GB     | Teams, DPA             |
| Pro        | $416.58 | 50 GB     | 250 B / 250 M | 100 GB    | SSO, BYOK, HIPAA, SOC2 |
| Enterprise | custom  | unlimited | unlimited     | unlimited | Dedicated infra        |

Overages: storage $0.50-0.75/GB, reads $0.75-1.00/B, writes
$0.75-1.00/M, syncs $0.15-0.35/GB.

Per-tenant model: each Puntovivo tenant would map to either
(a) one Turso database per tenant, or (b) one shared database
with `tenant_id` as a row-level filter. (a) gives tenant isolation
at the DB level (matches ADR-0001's per-tenant authority promise);
(b) gives lower DB count.

## 6. The architectural tension with ADR-0001

ADR-0001 establishes the default `device_local` SQLite as the
canonical source of truth for operational data, and ADR-0008
generalizes that rule as Authority Node runtime modes. ADR-0001
now says:

> The Electron desktop binary on each cashier machine is the
> canonical source of truth for operational data in the default
> `device_local` runtime mode.

Compare against Turso's default model (§5.1). In a
cloud-primary topology, the cloud writes to the shared
authoritative store and the local replica receives the result.
This is the inverse of "the device is authoritative".

### 6.1 Three reconciliation paths considered

**Path A — adopt Turso cloud-primary AND amend ADR-0001.** This
is a fundamental architectural pivot. The architecture plan explicitly
lists "Local-first IS the moat. Moving to edge invalidates the
privacy + latency story." Adopting Path A would invalidate that
claim. The spike rejects this path on §1's grounds.

**Path B — adopt Turso Sync (offline writes) and treat the
cloud as backup-only.** The local file is authoritative, the
cloud is downstream. This respects ADR-0001 in spirit. Two
concrete blockers:

- **Beta status and authority mismatch.** ADR-0006's threat
  model (§Threat model in `docs/architecture/0006-local-data-security.md`)
  treats every byte of operational data as legally and fiscally
  irreplaceable. A beta sync substrate whose documented conflict
  model is Last-Push-Wins is not the right authority layer for
  sale, payment, fiscal, cash or inventory truth.
- **Conflict resolution mismatch.** ADR-0004 mandates
  `manual` resolution for sales / cash / fiscal / inventory /
  audit. Turso's documented model is Last-Push-Wins at push time.
  Even if a future manual hook lands, it would need to defer
  high-risk records into Puntovivo's operator workflow rather than
  auto-resolving inside the sync hot path.

**Path C — adopt libSQL as a pure SQLite engine swap (no Turso
cloud).** Replace `better-sqlite3` with `libsql`. The local file
is still authoritative. Turso Cloud is not used. The bespoke
`sync_outbox` pipeline keeps its current design.

Path C is defensible on its merits but produces no immediate
user benefit. §10 details the migration cost.

### 6.2 Why "Path B with strict policy" still does not work

A reader could propose: "Turso Sync in offline mode + a future
manual resolver hook that always routes high-risk entities to a
`sync_conflicts` table for manual resolution."

This is technically possible, but it duplicates the existing
design rather than replacing it:

- The `sync_conflicts` table already exists (ENG-042).
- The `Operations Center` already renders conflicts (ENG-065).
- The bespoke pipeline already routes `manual` rows correctly
  via `SYNC_CONFLICT_POLICY` in
  [`services/sync/contract.ts`](../packages/server/src/services/sync/contract.ts).

Wrapping all of that inside a Turso resolver layer adds:

- A second authority surface (Turso's row-level logical log)
  alongside the existing `sync_outbox`.
- A dependency on a beta feature that may change before GA.
- A dependency on a managed cloud service in the hot path of
  conflict resolution.

The bespoke pipeline already solves the problem the spike
investigated. Turso Sync would replicate that solution against
a less-mature substrate.

## 7. Side-by-side comparison

| Concern                        | Bespoke `sync_outbox` (today)                                                                                  | Turso Embedded Replica + Sync                                                                                                   |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Authoritative store            | Local SQLite per device                                                                                        | **Cloud primary by default** in legacy Embedded Replicas **or** local file in Turso Sync (Turso Database beta)                  |
| Offline writes                 | Native (every transaction is local-first)                                                                      | Available through Turso Sync `push()` / `pull()`, but the surface is still beta                                                 |
| Conflict resolution policy     | Two lists per ADR-0004; `manual` for high-risk; mechanically enforced at compile time                          | Documented as Last-Push-Wins for concurrent pushes; no verified operator-mediated resolver API compatible with ADR-0004         |
| Idempotency                    | Partial unique index on `(tenant, entity, id, op, idempotency_key)` collapses retries                          | Row-level logical logging; semantics depend on the strategy enum chosen                                                         |
| Operations Center visibility   | `sync.peekOutbox`, `sync.listConflicts`, `sync.retry`, `sync.resolve`; Operations Center renders all           | Would require integration: Turso replication does not surface as `sync_outbox` rows                                             |
| Diagnostic export sanitization | `reports.diagnostics.export` redacts secrets per ADR-0006                                                      | Turso replication is opaque — sanitization layer would have to wrap or re-implement on the replication channel                  |
| Schema lifecycle               | Drizzle migrations, single source of truth at `db/schema.ts`                                                   | libSQL accepts SQLite migrations natively; Turso Cloud accepts the same                                                         |
| File format                    | SQLite (`better-sqlite3`)                                                                                      | SQLite-compatible (libSQL fork)                                                                                                 |
| Native binding burden          | `better-sqlite3` C++ bindings; Electron 41 / Node 24 dual-binary cache via `scripts/ensure-native-runtime.mjs` | Native platform packages (`libsql` / `@tursodatabase/sync-*`); must be validated in Electron before claiming lower burden       |
| Vendor lock-in                 | Zero — SQLite is in the public domain, the central-server consumer is whatever Puntovivo writes                | Turso Cloud lock-in for the cloud side; libSQL itself remains MIT                                                               |
| Cost (incremental)             | Engineering only (~$0 marginal)                                                                                | $4.99-$416.58/month per shared DB or per tenant; see §9                                                                         |
| Maintenance velocity           | Owned by Puntovivo; full control                                                                               | Tied to Turso's release cadence; beta features can change before GA                                                             |
| Production readiness           | Shipped + acceptance-tested in ENG-064 / ENG-064b (19 + 8 tests)                                               | Embedded Replicas are now documented as legacy for new sync projects; Turso Sync is beta                                        |
| Data-loss risk                 | Defensible (transaction boundary + integrity check on backup)                                                  | Depends on Turso Sync beta semantics and LPW conflict handling; not acceptable for high-risk POS entities without a manual lane |

The comparison resolves to: the bespoke pipeline is currently
better aligned with ADR-0001 + ADR-0004 + ADR-0006, the
production-readiness bar is higher, and the cost is zero. The
Turso path becomes interesting only when (a) Offline Writes go
GA with durability guarantees, (b) a manual-resolution API
supports ADR-0004's high-risk lists, and (c) a real central
server is in operation and the bespoke pipeline shows a concrete
shortcoming.

## 8. Conflict-resolution semantics

ADR-0004 closes this question definitively for Puntovivo:

- **Manual** for `sales`, `sale_items`, `sale_payments`,
  `sale_returns`, `cash_sessions`, `cash_movements`,
  `fiscal_documents`, `fiscal_document_items`,
  `fiscal_numbering_resolutions`, `fiscal_certificates`,
  `inventory_movements`, `inventory_balances`,
  `transfer_orders`, `transfer_order_items`, `stock_adjustments`,
  `audit_logs`, plus money-bound flows (`orders`, `order_items`,
  `purchases`, `purchase_returns`, `purchase_return_items`).
- **Auto-LWW** for catalog and preferences (`customers`,
  `products`, `categories`, `units`, `providers`, `vat_rates`,
  identity catalogs, geography, sites, locations, logos,
  sequentials, users, customer_catalogs, receipt_templates,
  site_peripherals).

The current substrate enforces this via `SYNC_CONFLICT_POLICY`
in
[`services/sync/contract.ts:111-162`](../packages/server/src/services/sync/contract.ts).
Rows write to `sync_outbox` with the policy travelling on the
row. The Operations Center reads the policy via `sync.getContract`
to render manual conflicts distinctly.

Turso Sync's native model is the inverse: rows reach the cloud,
the resolver fires at sync time, and the developer chooses one
strategy per database (or via the custom callback). The model
forces resolution at sync-event time; ADR-0004 wants resolution
at operator-decision time. Bridging the two requires emulating
`sync_outbox` semantics on top of Turso replication, which is
duplication rather than replacement.

A second axis: **fiscal_outbox** (ADR-0003 + ADR-0004) is its own
outbox — fiscal documents go to a country PT, NOT to a central
sync server. Turso replicas would need a separate channel for
fiscal traffic anyway, so the gain on the fiscal side from
adopting Turso is zero.

## 9. Cost analysis (back-of-envelope)

Modeled at the boundary of "the central server is commissioned"
and "tenants are sending sync traffic to it". Assumes:

- Each tenant produces ~100-500 sales per day, ~5-10 audit rows
  per sale, ~20 catalog edits per day. ~3000 outbox rows per
  tenant per day at the high end.
- Average row size ~500 bytes (payload JSON). ~1.5 MB / day /
  tenant of sync traffic.
- ~30-day retention before archival.

Two topologies:

**Topology X — bespoke central server (Phase 3+, Puntovivo-owned).**

- Hosting: a small VPS (~$20/month) running Fastify + a SQLite
  or PostgreSQL DB sized to the aggregate traffic.
- At 100 tenants: ~150 MB / day; ~4.5 GB / month before archival.
  $20-50/month total.
- At 500 tenants: ~22 GB / month. $50-150/month total (slightly
  bigger VPS + S3 archive).
- At 1000 tenants: ~45 GB / month. $150-400/month total
  (multiple regions or multi-tenant DB shards).
- **Engineering cost**: writing the central server is itself a
  Phase 3 ticket not yet scoped. ~3-4 weeks senior engineering
  for v1.

**Topology Y — Turso shared cloud DB.**

- One shared Turso DB at the **Scaler** tier: $24.92/month base.
  At the row counts above (100 tenants × ~3000 rows × 30 days
  ≈ 9 M rows/month writes), Scaler covers up to 100 M writes
  → no overage.
- At 500 tenants: 45 M writes/month. Still inside Scaler.
- At 1000 tenants: 90 M writes/month. Still under Scaler's
  100 M but approaching the cap; Pro at $416.58/month gives
  250 M writes headroom.
- Sync traffic: 100 tenants × 1.5 MB/day × 30 = 4.5 GB/month
  (under Scaler's 24 GB allowance). 1000 tenants: 45 GB/month
  (overage of ~21 GB × $0.25 = $5.25 extra/month, plus need
  to upgrade to Pro).
- **Engineering cost**: integration of the libsql-js SDK + the
  offline-writes feature + ADR-0004 conflict-routing emulation.
  Estimated 2-3 weeks senior engineering for v1, less than
  Topology X but with the architectural caveats from §6 + §8.

**Topology X+Y — bespoke central server + Turso cloud-backup
destination.** The recommended Phase 3+ shape if cloud backup is
a requirement: the bespoke central server stays the operational
authority, and a Litestream / Turso / S3-compatible target
serves as the off-box archival. Cost: Topology X + flat
~$5-20/month per tenant for archival storage at S3 prices, or
~$30/month flat for a single regional Litestream replica. Turso
Free tier could sustain a backup-only role for dozens of tenants
without paid uplift.

The conclusion the cost analysis returns: at every realistic
scale, **Topology X is cheaper than Topology Y at the operational
authority layer.** Turso becomes attractive only for the
backup/archival side, where Topology X+Y is the natural shape.

## 10. Migration impact (if adopted)

This section assumes the operator overrides the recommendation
and authorizes adoption. Lists the concrete impact on each layer
of the codebase.

### 10.1 Engine swap (`better-sqlite3` → `libsql`)

- **`packages/server/src/db/index.ts`** swap the driver import
  from `better-sqlite3` to `libsql`. Drizzle has a `libsql`
  dialect since v0.30+; the schema in `db/schema.ts` is reusable
  with minimal drift.
- **`scripts/ensure-native-runtime.mjs`** may need to cover
  libSQL bindings instead of disappearing. Net change in
  operational complexity is not proven until Electron 41 and
  Node 24 both load the native packages cleanly across macOS,
  Linux and Windows.
- **Drizzle migration runner** would need a one-time validation
  pass: every existing migration applies cleanly against libSQL.
  Risk level low (file-format compatibility) but a CI pin
  required.

Estimated effort: ~3-5 days dev + a thorough CI run + a real
desktop install validation (Mac / Linux / Windows). Risk: native
binding regression on a particular OS / Electron build.

### 10.2 Sync substrate (libSQL embedded replicas)

- New code path that opens libSQL with `syncUrl` + `authToken`.
  Only relevant if Topology Y is adopted.
- Requires a per-tenant Turso DB or a shared Turso DB with
  tenant scoping.
- Requires authentication / credential rotation for the Turso
  token — extends `tenants.settings.fiscal.*.csd.*`-style
  encryption-at-rest patterns.
- Requires emulating `SYNC_CONFLICT_POLICY` semantics on top of
  Turso's conflict model — duplicates the manifest in another
  format unless Turso ships a compatible manual lane.
- Requires an integration test against Turso staging (~2-3
  days), plus an end-to-end test against a paying-tier account.

Estimated effort: ~3-4 weeks senior engineering, matching the
PLAN-V2 §2 estimate for ENG-037 implementation.

### 10.3 Test harness

- **vitest server tests** use `:memory:` SQLite — libSQL
  supports the same URI. No expected drift.
- **Electron e2e** (`e2e/electron/`) launches via
  `_electron.launch()` against a tmpdir DB. libSQL substitution
  passes through.
- **Playwright web e2e** runs against the standalone backend.
  Same substitution applies.
- Risk: subtle behavioral drift on edge cases (recursive CTE,
  particular pragma defaults, JSON1 extension presence). Each
  is testable and fixable but the discovery pass could surface
  N issues.

### 10.4 Operations Center (ENG-065)

`Operations Center → Sync` reads `sync_outbox` directly. If
Topology Y is adopted, the Operations Center either:

- (a) keeps reading `sync_outbox` and ignores Turso — the
  bespoke pipeline runs in parallel for visibility, defeating
  the purpose of the substitution;
- (b) reads from Turso's replication log via the libsql-js SDK
  — requires a new view layer + wire format + permissions.

Option (b) is a non-trivial UI rewrite estimated at ~1-2 weeks.

### 10.5 Backup / restore (ENG-066)

ENG-066 / ADR-0006 produces a ZIP with `local.db` +
`device-id.txt` + manifest. The `local.db` is a SQLite snapshot
via `db.backup()`. libSQL supports the same `backup()` primitive.

If Topology Y is adopted, the backup payload includes only the
local replica state — the cloud authoritative copy is NOT in the
ZIP. The operator's mental model "restore = the snapshot is
exactly the state I saw when I pressed the button" no longer
holds: a restore would replay against Turso Cloud and diverge.

This is fixable (e.g. `restore` triggers a forced
`db.sync()` against Turso) but adds operator-facing UX.

### 10.6 Net effort to ship if adopted

| Layer                            | Effort         | Risk                               |
| -------------------------------- | -------------- | ---------------------------------- |
| Engine swap                      | 3-5 days       | Low (file-format compat)           |
| Sync substrate                   | 3-4 weeks      | High (beta feature, ADR violation) |
| Test harness validation          | 1 week         | Medium (edge cases)                |
| Operations Center rewrite        | 1-2 weeks      | Medium (UI surface change)         |
| Backup / restore semantic update | 2-3 days       | Low                                |
| **Total**                        | **~6-8 weeks** | **High aggregate**                 |

The estimate exceeds PLAN-V2 §2's "1-week investigation + 3-4
week implementation" by ~2-4 weeks. The estimate also assumes
Turso Sync reaches a production-ready contract before the
implementation completes, which is not under Puntovivo's control.

## 11. Risks (if adopted)

- **Vendor lock-in.** Turso Cloud is a proprietary managed
  service. Migration off Turso requires a one-shot data export
  - import into the replacement engine. The libSQL engine itself
    is MIT, so the engine layer is portable; the cloud layer is
    not.
- **Beta-feature dependency.** Turso Sync is still documented
  under the Turso Database beta surface. Adopting it as the
  authority layer before a GA contract and manual conflict lane
  violates the operational invariant from ADR-0006 that
  operational data is irreplaceable.
- **Cost growth at scale.** §9 shows Topology Y becomes more
  expensive than Topology X past ~500 tenants. The trade is
  "managed convenience" vs "engineering authorship" — the
  managed convenience evaporates at scale because customisation
  costs more than rolling Topology X.
- **Conflict-resolution flexibility downgrade.** ADR-0004's
  manual list is granular — 21 entity types where the operator
  chooses. Turso's documented model is Last-Push-Wins for
  concurrent pushes. Bridging forces Puntovivo to re-implement
  `SYNC_CONFLICT_POLICY` on top of a second sync plane.
- **Operations Center fragmentation.** A Topology X+Y hybrid
  shows two view surfaces — `sync_outbox` for the bespoke
  pipeline and Turso's replication log for the cloud side.
  Operators reading either alone get an incomplete picture.
- **Diagnostic export sanitization gap.** ENG-066's sanitizer
  redacts secrets in `sync_outbox.payload` before exporting a
  diagnostic ZIP. Turso's replication channel does not surface
  through the same sanitizer. A new sanitizer would have to be
  written.
- **Backup mental-model change.** §10.5 covers this; the gist
  is that operators currently understand a backup as a frozen
  snapshot; under Topology Y the snapshot is partial.
- **Schema-drift detection regression.** ENG-002's Drizzle
  migration discipline is tied to a single SQLite engine.
  libSQL extensions (vector search, libSQL-WAL2 encryption)
  could land in a future migration that does not apply cleanly
  to a regression test against vanilla SQLite.

## 12. Acceptance criteria for follow-up implementation (if greenlit)

This list is provided for the operator's reference if the
recommendation is overridden. It is NOT a commitment from this
spike.

The implementation slice that would close ENG-037 in the
greenlit case:

1. **Engine swap (Topology Y mode 1).** `better-sqlite3` →
   `libsql` across `packages/server`. All existing tests pass
   (`pnpm run ci:server`). Native rebuild scripts handle libSQL
   bindings on Electron + Node 24.
2. **Embedded-replica config plumbing.** Per-tenant config
   surface for `syncUrl` + `authToken` with encryption-at-rest
   per the existing fiscal CSD pattern. Admin Settings card
   shows replica health (last sync, pending offline rows,
   conflict count).
3. **Conflict resolver bridge.** Turso manual-resolution support
   or an equivalent Puntovivo bridge consults
   `SYNC_CONFLICT_POLICY` and routes `manual` rows to
   `sync_conflicts` (the existing table from ENG-042) instead of
   letting Turso auto-resolve. ADR-0004 acceptance test pins that
   no high-risk row auto-resolves.
4. **Operations Center view.** A new tab "Cloud replication"
   in the Operations Center shows pending offline rows, sync
   lag, and conflict-resolver decisions. Existing
   `sync_outbox` view stays — both data planes visible.
5. **Diagnostic export sanitizer extension.** The sanitizer
   wraps Turso's replication payloads so the ENG-066 ADR-0006
   redaction guarantees still hold.
6. **Backup / restore semantic note.** The operator-facing
   backup wizard explains that the local snapshot is partial
   under cloud-replication mode; restore offers a "force
   resync" button.
7. **Production validation.** A pilot tenant runs for ≥ 30
   days with sales + fiscal traffic and at least one network
   partition recovery without data loss.

If any of (1) through (7) is not achievable, the
implementation slice STOPS and the ticket flips back to Defer
with a status update on this report.

## 13. References

- libSQL repository: <https://github.com/tursodatabase/libsql>
- libsql-js (Node SDK): <https://github.com/tursodatabase/libsql-js>
- Turso embedded replicas docs:
  <https://docs.turso.tech/features/embedded-replicas/introduction>
- Turso Sync usage docs:
  <https://docs.turso.tech/sync/usage>
- Turso Sync conflict-resolution docs:
  <https://docs.turso.tech/sync/conflict-resolution>
- Turso Offline Writes (private beta announcement, Oct 2024):
  <https://turso.tech/blog/introducing-offline-writes-for-turso>
- Turso Sync (public beta, March 2025):
  <https://turso.tech/blog/turso-offline-sync-public-beta>
- Turso pricing: <https://turso.tech/pricing>
- Internal: ADR-0001 Local Store Authority — `docs/architecture/0001-local-store-authority.md`
- Internal: ADR-0002 Command Envelope — `docs/architecture/0002-command-envelope.md`
- Internal: ADR-0003 Outbox Taxonomy — `docs/architecture/0003-outbox-taxonomy.md`
- Internal: ADR-0004 Conflict Policy — `docs/architecture/0004-conflict-policy.md`
- Internal: ADR-0005 Sync Payload Contract — `docs/architecture/0005-sync-payload-contract.md`
- Internal: ADR-0006 Local Data Security — `docs/architecture/0006-local-data-security.md`
- Internal: ADR-0008 Authority Node Runtime Modes — `docs/architecture/0008-authority-node-runtime-modes.md`
- Internal sync code: `packages/server/src/services/sync/contract.ts`,
  `packages/server/src/services/sync/enqueue.ts`,
  `packages/server/src/db/schema.ts` (`sync_outbox`).

---

**Decision owner**: johnny4young (operator).
**Spike author**: ENG-037 implementation agent.
**Next review trigger**: any of the conditions in §2 changes, or
the operator commissions the central-server side of Phase 3 and
encounters a real shortcoming the bespoke pipeline cannot solve.
