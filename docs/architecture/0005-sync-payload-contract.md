# 0005 — Sync payload contract

> Status: **Accepted** (ENG-064 v1 2026-05-05; ENG-064b cutover 2026-05-05)
> Affects: every router that emits an entity change for replication; ENG-065 (Operations Center) read surfaces; ENG-066 (chaos suite) acceptance assertions; ENG-068+ multi-store sync negotiation.
> Predecessor ADRs: 0002 (command envelope), 0003 (outbox taxonomy), 0004 (conflict policy).

## Decision

The sync outbox carries a per-row contract that is exhaustively keyed against an entity-type manifest. Every row in `sync_outbox` carries:

- `payload_version` (integer, default 1) — schema-drift guard.
- `idempotency_key` (nullable text) — links the row to its emitting envelope (ADR-0002). Network retries with the same envelope collapse via the partial unique index `(tenant_id, entity_type, entity_id, operation, idempotency_key) WHERE idempotency_key IS NOT NULL`.
- `device_id` (nullable FK to `devices.id`) — provenance for cross-device debugging.
- `depends_on_operation_id` (nullable text, soft FK to `operation_events.operation_id`) — topological ordering hint so consumers apply parents before children.
- `operation_event_id` (nullable FK to `operation_events.id`) — journal trail correlation.
- `priority` (real, default 0) — drains by `(priority DESC, created_at ASC)`.
- `conflict_policy` (`manual | auto_lww`) — per ADR-0004 routing. `manual` for sales/cash/fiscal/inventory/audit; `auto_lww` for catalog/preferences. ENG-064 v1 surfaces the marker; the actual auto-resolution branch is parked for a follow-up.

The manifest at `packages/server/src/services/sync/contract.ts` is the single source of truth. New entity types added to a writer MUST land an entry in `SYNC_ENTITY_TYPES` + `SYNC_CONFLICT_POLICY` — TypeScript exhaustiveness on `Record<SyncEntityType, ...>` plus a vitest test that scans every router file for `entityType: '...'` literals catch drift at build time.

Consumers negotiate the contract via `sync.getContract()` (manager-or-admin) which returns `{ payloadVersion, entities: Array<{ entityType, conflictPolicy, defaultPriority }> }`. ENG-068+ multi-store sync uses this as the handshake before exchanging payloads. Bumping `SYNC_PAYLOAD_VERSION` invalidates cached snapshots on the consumer side; per-version codecs at the consumer side handle the back-compat.

## Alternatives Rejected

- **Free-form payload column with policy inferred at consumer side.** Pushes the routing decision out of the source-of-truth tenant, opening a window where two consumers disagree on whether a `customers` row is `manual` or `auto_lww`. The manifest closes that window: the policy is decided at emit time and travels with the row.
- **Separate `sync_outbox_manual` + `sync_outbox_auto_lww` tables.** Doubles the kernel plumbing without buying anything — the same kernel + the same retry policy + the same metadata table apply to both. A single column with an enum is sufficient.
- **Renaming `sync_queue` to `sync_outbox` in this slice.** ADR-0003 mandates the rename eventually, but doing it in v1 would require rewriting 19 router writers + the entire 731-line `routers/sync.ts` in the same commit. ENG-064 v1 ships the contract foundation + the new table sibling; the writer + procedure cutover is deferred to ENG-064b.

## Implementation Impact

- **Migration `0016_sync_contract_v1.sql`** creates `sync_outbox` mirroring the `fiscal_outbox` / `hardware_outbox` shape (kernel projection + 6 contract columns + 4 indexes including the partial unique on idempotency_key). A one-shot `INSERT OR IGNORE` copies pending `sync_queue` rows over with sensible defaults so consumer state survives the upgrade. **Migration `0017_drop_sync_queue.sql` (ENG-064b, 2026-05-05)** drops the legacy table once every writer routes through `enqueueSync` and the eight `sync.*` procedures cut over to `sync_outbox`.
- **`services/sync/contract.ts`** holds the manifest + `resolveConflictPolicy(entityType)` + `resolveDefaultPriority(entityType)` + `buildSyncContractManifest()`.
- **`services/sync/enqueue.ts`** ships `enqueueSync(ctx, args)` — the helper every writer should call instead of inlining `db.insert(syncQueue)`. Reads the envelope context (`ctx.envelope?.{operationId, idempotencyKey}` + `ctx.deviceId`) when present, looks up `operation_event_id` via the operation_events index, populates the contract, writes one row + one `operation_effects` trail.
- **Three new tRPC procedures** (`sync.getContract` / `sync.peekOutbox` / `sync.retry`) operate on `sync_outbox`. `sync.retry` re-arms only `retrying` / `dead_letter` rows; `queued` / `submitting` / `synced` / `conflict` are no-ops so a drained row is not replayed accidentally. The existing 8 procedures (`status / listQueue / addToQueue / removeFromQueue / listConflicts / push / pull / resolve`) cut over to `sync_outbox` in ENG-064b — `addToQueue` becomes a thin shim around `enqueueSync`, the legacy `incrementQueueFailure` helper became `markOutboxFailure`, and `sync.listQueue` + `sync.pull` alias `payload→data` and `payloadVersion→localVersion` in their projection so `useOfflineSync.ts` keeps consuming the same shape.
- **19 acceptance tests** at `packages/server/src/__tests__/sync-contract-v1.test.ts` cover ordering, retry, duplicate suppression, and manual-conflict-on-high-risk; 8 manifest exhaustiveness tests at `sync-contract-manifest.test.ts` lock the entity → policy mapping against the writer file scan.

## Affected Tickets

- `ENG-064` (this ADR) — Sync contract v1: contract foundation + 3 new procedures + acceptance tests. Shipped 2026-05-05.
- `ENG-064b` (Shipped 2026-05-05) — Migrated the 19 router inline writers from `db.insert(syncQueue)` to `enqueueSync` (plus 4 application services + 1 dev seed), cut the existing 8 `sync.*` procedures over from `sync_queue` to `sync_outbox`, dropped the legacy table via migration `0017_drop_sync_queue.sql`, and renamed the web client `services/storage/syncQueue.ts` → `offlineQueue.ts` to clear the file-name collision (the IndexedDB ObjectStore name stays `SYNC_QUEUE` to avoid a client-side DB version bump).
- `ENG-065` — Operations Center. Reads the manifest via `sync.getContract` + the per-row policy via `sync.peekOutbox` to render manual conflicts distinctly.
- `ENG-066` — Chaos suite. Asserts ordering / retry / dedup invariants under simulated network failures. The contract gives the suite something concrete to assert against.
- `ENG-068+` — Multi-store sync. Uses `sync.getContract` as the handshake before exchanging payloads.
