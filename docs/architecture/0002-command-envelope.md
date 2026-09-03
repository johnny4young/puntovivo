# 0002 — Command Envelope

> Status: Accepted
> Date: 2026-05-02
> Updated: 2026-09-03

## Decision

**Critical mutations require a Command Envelope header with `operationId`,
`idempotencyKey`, and `clientCreatedAt`, plus a separate registered
`x-device-id` header. Non-critical CRUD does not. The list of critical
mutations is closed and lives at the bottom of this ADR.**

Each envelope field has a single purpose:

- `operationId` — UUID v4 minted by the cashier device per click /
  user intent. Used to correlate UI events, tRPC calls, DB
  transactions, and outbox effects in the operation journal. It is not the
  same as a sale id; one operation may produce
  multiple downstream effects.
- `deviceId` — string FK to the `devices` table. It identifies which terminal
  fired the operation and is validated independently from the envelope so a
  renderer cannot claim an unregistered or cross-tenant device. The device also
  carries an active-user binding plus a monotonic identity generation. Staff
  handoff advances that generation atomically with parking the previous
  operator's active drafts. Ordinary authenticated registration is idempotent
  only for the same active actor; a stale session cannot rebind a terminal that
  now belongs to another operator.
- `idempotencyKey` — string supplied by the client (or derived from
  the operation id when the client cannot supply one). Server-side
  storage in an `idempotency_keys` table makes retries safe: the
  first caller reserves the key before the command runs, duplicate
  requests return the cached resource after success, concurrent
  retries get a structured in-progress error, and a conflicting
  payload under the same key is rejected with a structured conflict. A
  successful result remains cached for 24 hours. A processing reservation has
  a separate 60-second crash-recovery lease; only a new reservation owner can
  complete the row after that lease.
- The versioned canonical request hash binds the input to user id, role, JWT
  session generation and device identity generation. The unique key remains
  device-scoped: a different actor cannot turn a replay into a second command.
  Old unbound cache entries fail closed. A password change or staff handoff
  invalidates the old identity's envelope, including its cached response.
  Role guards precede cache lookup, and current identity is checked again after
  cache hydration. Processing-lease recovery requires the same bound hash.
- `clientCreatedAt` — ISO 8601 UTC timestamp captured on the cashier
  device. Used for sync ordering metadata and debugging clock-skew issues.
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
- **No envelope at all** — leaves race
  conditions on double-click charge, suspend, or void, and makes
  cross-system debugging painful (a click cannot be traced from UI
  through tRPC to the DB transaction without grepping timestamps).
- **Carry envelope on every procedure (including read queries and
  catalog CRUD)** — needless ceremony. Catalog rows are protected by
  per-row uniqueness constraints; they do not need an idempotency
  table to be safe.

## Implementation Impact

- **Persistence**: `idempotency_keys` stores
  columns `tenant_id`, `device_id`, `idempotency_key`,
  `operation_kind`, `request_hash`, `status`, `result_ref`,
  `locked_at`, `completed_at`, `created_at`, `expires_at`.
  Composite unique index on `(tenant_id, device_id,
idempotency_key, operation_kind)`. Replaying a key with a
  matching `request_hash` returns `COMMAND_IN_PROGRESS` while
  `status='processing'` or `result_ref` after `status='succeeded'`;
  a mismatched hash returns a typed conflict error.
- **tRPC middleware**: `commandEnvelope`
  wraps procedures listed in the closed list below. It validates
  the envelope shape via Zod, atomically reserves `idempotency_keys`,
  and short-circuits with the cached `result_ref` on a completed hit. Critical
  migrated application services call `completeInTransaction` as their final
  write
  so business rows, audit evidence, authoritative sync outbox, canonical
  response, and idempotency success commit or roll back together. The operation
  journal remains best-effort observability outside that primary transaction.
  For operation kinds in the explicit transactional-completion set, returning
  from a real authenticated command without that call fails the reservation.
  Legacy kinds remain on compatibility completion until their entire domain
  write set is moved; applying the guard before that move would report failure
  after business state had already committed.
  For real JWT requests, that final write also revalidates both the user's
  `sessionVersion`, current role and the captured device identity generation under the domain
  writer lock. A logout or staff switch that wins the race therefore rolls the
  stale command back; if the command wins, the later identity transaction parks
  its newly created or recovered claim.
- **Renderer**: `useCriticalMutation` mints one envelope per logical user
  intent. Concurrent equivalent clicks share one in-flight Promise and React
  Query retries reuse that envelope. Success or an explicit terminal server
  rejection closes the identity; transport-uncertain, busy, and in-progress
  outcomes retain it for the next user retry so a lost response cannot create
  a second money/stock command. Retained failed intents expire with the
  server's 24-hour replay window and are released when the owning view unmounts.
  The registered device id is read from the renderer's bounded device store and
  sent as its own header. If `sales.resume` commits but local workspace
  hydration fails, the renderer removes any partial workspace and compensates
  with `sales.suspend` using the original label and table. A second failure is
  reported as an uncertain committed state and explicitly blocks recreation.
- **Existing primitives reused**: `desktopSession.requireTenantId()` gives the
  tenant scope; the envelope adds the device and
  operation dimensions on top. Audit logs gain an `operation_id`
  column that joins back to the journal.

### Closed list of critical commands

The Command Envelope applies to exactly these procedures as of 2026-09-03.
Adding to this list requires a superseding ADR or a documented amendment here.

**Sales lifecycle**

- `sales.create`
- `sales.completeDraft`
- `sales.suspend`
- `sales.resume`
- `sales.discardDraft`
- `sales.returnSale`
- `sales.void`
- `sales.getForReprint` (writes counter / audit row)
- `sales.changeTable` (manager/admin restaurant transfer)
- `sales.splitDraft` (manager/admin restaurant split-bill)
- `restaurantServices.openCheck` (atomic table service and sale draft)

**Cash sessions**

- `cashSessions.open`
- `cashSessions.close`
- `cashSessions.recordMovement` (for `paid_in`, `paid_out`, `skim`,
  and `replenishment`)

**Reports / attestations**

- `reports.dayClose.signOff` (one irreversible manager/admin
  attestation of the frozen comprehensive business-day report)

**Inventory**

- `inventory.adjustStock`
- `inventory.createMovement` (compatibility-only positive manual adjustment;
  domain sale/purchase/transfer/return types are rejected)
- `inventoryLots.receive`
- `inventory.createCountSession`
- `inventory.saveCountSession`
- `inventory.submitCountSession`
- `inventory.approveCountSession`
- `inventory.rejectCountSession`
- `transfers.create`
- `transfers.receive`
- `transfers.void`
- `inventoryTransformations.createRecipe`
- `inventoryTransformations.updateRecipe`
- `inventoryTransformations.execute`
- `inventoryTransformations.void`

**Procurement**

- `purchases.create`
- `purchases.createFromOrder`
- `purchases.returnPurchase`
- `purchases.void`
- `orders.create`
- `orders.submitDraft`
- `orders.void`
- `providerPayables.createInvoice`
- `providerPayables.createOpeningBalance`
- `providerPayables.recordPayment`
- `providerPayables.recordCredit`

**Peripherals**

- `peripherals.kickCashDrawer` (audited physical dispatch)
- `peripherals.buildDrawerKickBytes` (audited hub-client dispatch)

**Users / security**

- `users.create`
- `users.update` (when changing `role` or `isActive`)
- `users.setStaffPin` (staff credential rotation or removal)
- `auth.changePassword`

**Employee attendance**

- `employeeShifts.clockIn` (start the authenticated employee's shift)
- `employeeShifts.clockOut` (close the authenticated employee's open shift)
- `employeeShifts.breaks.start` (start an explicit rest interval)
- `employeeShifts.breaks.end` (close the authenticated employee's active rest interval)
- `employeeShifts.schedule.create` (publish a durable scheduled shift)
- `employeeShifts.schedule.update` (revise a versioned scheduled shift)
- `employeeShifts.schedule.cancel` (cancel without deleting labor evidence)
- `employeeShifts.attendance.corrections.create` (append an effective attendance snapshot without rewriting raw evidence)

**Manager approvals**

- `managerApprovals.request` (create one bounded sensitive-action request)
- `managerApprovals.decideWithPin` (approve/reject with a fresh manager PIN)
- `managerApprovals.cancel` (requester withdraws a still-pending request)

**Module activation**

- `modules.setActive` (admin toggle of a tenant module)
- `modules.applyPreset` (admin application of one explicit vertical preset)

**Pharmacy custody**

- `pharmacy.createAuthorization`
- `pharmacy.revokeAuthorization`
- `pharmacy.recordEvidence`
- `pharmacy.approveEvidence`
- `pharmacy.revokeEvidence`
- `pharmacy.createRecall`
- `pharmacy.closeRecall`
- `pharmacy.transitionLot`
- `pharmacy.destroyLot`

**Loss prevention**

- `lossPrevention.updateSettings` (audited per-role checkout
  authority and blocked-hours policy)
- `lossPrevention.acknowledgeAlert` (shared manager review of a
  deterministic loss-prevention alert)

Procedures **not** in the envelope: every read query
(`*.list`, `*.get`, `*.search`, `*.export`), every catalog mutation
(`products.*`, `customers.*`, `providers.*`, `units.*`, `vatRates.*`,
`categories.*`, `locations.*`, `receiptTemplates.*`, `tenantLocale.*`),
preference toggles (`ai.settings.update`, `fiscalSettings.*`),
notification reads, dashboard reads, and the audit log query API.

## Implementation map

- `packages/server/src/trpc/middleware/commandEnvelope.ts` validates devices and
  envelopes, reserves/replays keys, provides transactional completion, maps
  lock contention safely, and writes best-effort operation-journal evidence.
- `packages/server/src/services/idempotency/idempotencyService.ts` owns the
  reservation state machine, cache TTL, crash-recovery lease, versioned
  completion, and cleanup.
- `apps/web/src/lib/useCriticalMutation.ts` owns the typed closed list, logical
  intent lifetime, duplicate-click coalescing, and retry reuse.
- Sales, cash, inventory, transfers, procurement, workforce, approvals,
  security, modules, peripherals, and loss-prevention routers opt in only via a
  `criticalCommand*Procedure` decorator.
- The operation journal correlates attempts and errors but does not replace the
  domain transaction or authoritative audit/outbox rows.
- Fiscal-enabled sale completion stores a frozen `fiscal_emission_intents` row
  before `completeInTransaction`. A separate worker transaction materializes
  the document, fiscal line snapshots, consecutive advance, and provider outbox
  atomically. Command replay remains read-only and never recreates side effects.

## Amendment history

- 2026-05-02: accepted foundation with device registry, idempotency table,
  middleware, renderer envelope plumbing, and password-change proof command.
- 2026-05-03: expanded to sales, cash, inventory, transfers, and users; added
  typed renderer dispatch, Electron device persistence, request correlation,
  and operation-journal integration.
- 2026-07-14 to 2026-07-16: added staff PIN, attendance, breaks, schedules,
  manager approvals, day-close sign-off, modules, and loss prevention.
- 2026-08-30: added procurement commands and transactional idempotency
  finalization; duplicate clicks, automatic retries, and user retries after an
  uncertain outcome now retain one envelope, the processing lease is separate
  from the successful cache TTL, and SQLite writer contention returns a safe
  retry code.
- 2026-09-02: added `restaurantServices.openCheck`; sale, stock, normalized
  service/check metadata, audit, sync intent, canonical result, and idempotency
  success now share one immediate transaction.
- 2026-09-03: moved draft suspend, resume, discard, table transfer, bill split,
  and module toggle/preset result completion into their domain transactions.
  The renderer now treats post-commit cache or hydration failures as recovery
  states instead of retryable command failures.
- 2026-09-03: made transactional completion mandatory for the explicitly
  migrated real-JWT commands, closed stale-session device re-registration, and added the
  sale-bound fiscal intent so a process exit before the post-commit wake-up
  cannot lose the fiscal obligation.
