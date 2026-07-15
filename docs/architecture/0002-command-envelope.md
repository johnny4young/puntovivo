# 0002 — Command Envelope

> Status: Accepted
> Date: 2026-05-02
> Owner: ENG-051

## Decision

**Critical mutations require a Command Envelope on the input —
`operationId`, `deviceId`, `idempotencyKey`, and `clientCreatedAt`.
Non-critical CRUD does not. The list of "critical mutations" is
closed and lives at the bottom of this ADR.**

Each envelope field has a single purpose:

- `operationId` — UUID v4 minted by the cashier device per click /
  user intent. Used to correlate UI events, tRPC calls, DB
  transactions, and outbox effects in the operation journal
  (ENG-053). Not the same as a sale id; one operation may produce
  multiple downstream effects.
- `deviceId` — string FK to the `devices` table that ENG-052
  introduces. Identifies which cashier machine fired the operation.
  The `desktopSession` singleton (ADR-0001) registers the device id
  at login and propagates it through tRPC headers and IPC.
- `idempotencyKey` — string supplied by the client (or derived from
  the operation id when the client cannot supply one). Server-side
  storage in an `idempotency_keys` table makes retries safe: the
  first caller reserves the key before the command runs, duplicate
  requests return the cached resource after success, concurrent
  retries get a structured in-progress error, and a conflicting
  payload under the same key is rejected with a structured conflict.
- `clientCreatedAt` — ISO 8601 UTC timestamp captured on the cashier
  device. Used for ordering when the local store eventually syncs to
  a central server (ENG-064) and for debugging clock-skew issues.
  The server clock is still authoritative for `created_at` columns
  on the row itself; `clientCreatedAt` is metadata for sync /
  diagnostics, not a substitute.

The envelope is mandatory only on operations that mutate money,
fiscal, cash, or stock state. Read queries, preference toggles, and
catalog management (products, customers, providers, units, vat
rates, receipt templates, locale settings) do not require it because
they are idempotent at the row level and do not flow through the
outboxes.

## Alternatives Rejected

- **Server-derived idempotency only** — breaks retry from a cashier
  device that lost connectivity mid-charge. The client cannot replay
  the same logical operation without a key it owns.
- **Trace id only (no idempotency key)** — sufficient for logs but
  insufficient for the duplicate-prevention contract. A trace id
  changes on every retry; an idempotency key intentionally does
  not.
- **No envelope at all (the current state)** — leaves race
  conditions on double-click charge, suspend, or void, and makes
  cross-system debugging painful (a click cannot be traced from UI
  through tRPC to the DB transaction without grepping timestamps).
- **Carry envelope on every procedure (including read queries and
  catalog CRUD)** — needless ceremony. Catalog rows are protected by
  per-row uniqueness constraints; they do not need an idempotency
  table to be safe.

## Implementation Impact

- **New table** (added by ENG-052): `idempotency_keys` with
  columns `tenant_id`, `device_id`, `idempotency_key`,
  `operation_kind`, `request_hash`, `status`, `result_ref`,
  `locked_at`, `completed_at`, `created_at`, `expires_at`.
  Composite unique index on `(tenant_id, device_id,
  idempotency_key, operation_kind)`. Replaying a key with a
  matching `request_hash` returns `COMMAND_IN_PROGRESS` while
  `status='processing'` or `result_ref` after `status='succeeded'`;
  a mismatched hash returns a typed conflict error.
- **New tRPC middleware** (added by ENG-052): `commandEnvelope`
  wraps procedures listed in the closed list below. It validates
  the envelope shape via Zod, atomically reserves `idempotency_keys`,
  and short-circuits with the cached `result_ref` on a completed hit.
  ENG-053 will add the operation journal around the same envelope
  context before the application service runs.
- **Renderer**: the React layer mints `operationId` and
  `idempotencyKey` per user intent; the existing `useToast` /
  command queue helpers carry them through. The Electron preload
  injects `deviceId` and `clientCreatedAt` so the renderer cannot
  forge either.
- **Existing primitives reused**: `desktopSession.requireTenantId()`
  (ENG-025) gives the tenant scope; the envelope adds the device +
  operation dimensions on top. Audit logs gain an `operation_id`
  column that joins back to the journal.

### Closed list of critical commands

The Command Envelope applies to exactly these procedures (as of
ENG-051). Adding to this list requires a Superseder ADR or a
follow-up amendment.

**Sales lifecycle**

- `sales.create`
- `sales.completeDraft`
- `sales.suspend`
- `sales.resume`
- `sales.discardDraft`
- `sales.returnSale`
- `sales.void`
- `sales.getForReprint` (writes counter / audit row)
- `sales.changeTable` (ENG-039c — manager/admin restaurant transfer)
- `sales.splitDraft` (ENG-039c3 — manager/admin restaurant split-bill)

**Cash sessions**

- `cashSessions.open`
- `cashSessions.close`
- `cashSessions.recordMovement` (for `paid_in`, `paid_out`, `skim`,
  and `replenishment`)

**Inventory**

- `inventory.adjustStock`
- `transfers.create`
- `transfers.receive`
- `transfers.void`

**Fiscal** *(in español por convención fiscal)*

- `fiscal.emitDocument` *(canal interno disparado por sales lifecycle)*
- `fiscal.cancelDocument` *(cancelación SAT explícita; ENG-035c lo ship)*
- `fiscal.retryFromContingency` *(operator-initiated retry; ENG-057)*

**Payment**

- `payment.charge` (when the payment terminal adapter ships,
  ENG-063)
- `payment.void`

**Users / security**

- `users.create`
- `users.update` (when changing `role` or `isActive`)
- `users.setStaffPin` (ENG-106a — staff credential rotation or removal)
- `auth.changePassword`

**Employee attendance**

- `employeeShifts.clockIn` (ENG-106b — start the authenticated employee's shift)
- `employeeShifts.clockOut` (ENG-106b — close the authenticated employee's open shift)

**Manager approvals**

- `managerApprovals.request` (ENG-106c1 — create one bounded sensitive-action request)
- `managerApprovals.decideWithPin` (ENG-106c1 — approve/reject with a fresh manager PIN)
- `managerApprovals.cancel` (ENG-106c1 — requester withdraws a still-pending request)

**Module activation**

- `modules.setActive` (ENG-068 — admin toggle of a tenant module)

Procedures **not** in the envelope: every read query
(`*.list`, `*.get`, `*.search`, `*.export`), every catalog mutation
(`products.*`, `customers.*`, `providers.*`, `units.*`, `vatRates.*`,
`categories.*`, `locations.*`, `receiptTemplates.*`, `tenantLocale.*`),
preference toggles (`ai.settings.update`, `fiscalSettings.*`),
notification reads, dashboard reads, and the audit log query API.

## Affected Tickets

- `ENG-052` — Device registry + command envelope. Adds the
  `devices` and `idempotency_keys` tables, the
  `commandEnvelope` middleware, and the renderer plumbing.
- `ENG-053` — Operation journal + outbox kernel. Reads
  `operationId` from the envelope and writes the
  `operation_events` / `operation_effects` / `operation_errors`
  trail.
- `ENG-054` — Extract `completeSale` application service.
  First service to consume the envelope; behavior parity with
  current `sales.create` / `completeDraft`.
- `ENG-055` — Extract sale lifecycle services. `returnSale`,
  `voidSale`, `completeDraft`, `discardDraft` all carry the
  envelope.
- `ENG-056` — Cash session aggregate boundary. The
  `CashSessionService` consumes the envelope on every
  cash-affecting operation.
- `ENG-063` — Payment terminal adapter. Adds `payment.charge` and
  `payment.void` to the closed list with envelope.

Updated: 2026-05-02 (ENG-051 — initial ADR set).
Updated: 2026-05-02 (ENG-052a — foundation shipped: `devices` and
`idempotency_keys` tables, `commandEnvelope` middleware, `auth.registerDevice`,
and `auth.changePassword` wrapped as the proof procedure. Web
`deviceId.ts` + `commandEnvelope.ts` + AuthProvider device
registration. ENG-052b will wire the remaining 17 procedures from
the closed list above and add the `useCriticalMutation` web hook +
Electron `device.getId/setId` preload).
Updated: 2026-05-03 (ENG-052b — closed: 17 critical procedures
across `sales`, `cashSessions`, `inventory`, `transfers`, `users`
now flow through the envelope; `useCriticalMutation` generalized
with `CriticalCommandPath` + type inference so renderer call sites
mint a fresh envelope per call automatically; Electron preload
exposes `electron.device.getId/setId` backed by an atomic file
write under `app.getPath('userData')/device-id.txt`; Fastify
`onRequest` hook hangs `requestId` + `deviceId` on `request.log`
so non-envelope requests share request-scoped provenance).
Updated: 2026-07-14 (ENG-106a — added `users.setStaffPin` to the
closed list so PIN credential rotation and removal use the same
idempotent command envelope as other user-security mutations).
Updated: 2026-07-14 (ENG-106b — added self-service clock-in/out as
critical attendance commands; retries cannot create duplicate open
shifts or close a different employee's shift).
Updated: 2026-07-14 (ENG-106c1 — added request, PIN decision, and
cancellation commands for the short-lived manager approval rail).
Updated: 2026-05-03 (ENG-053 — operation journal wired into
envelope: `recordOperationStart` runs after the idempotency
reservation and before `next()`, idempotent on
`(tenant_id, operation_id)` so replay-cached calls reuse the
existing event row; success path calls
`markOperationCompleted(eventId, 'succeeded')`; throw path calls
`recordError` + `markOperationCompleted(eventId, 'failed')` so
post-commit failures captured without rolling back the original
sale/cash/inventory operation. Pattern doc:
`patterns/operation-journal.md`).
