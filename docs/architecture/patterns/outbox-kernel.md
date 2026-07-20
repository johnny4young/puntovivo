# Pattern: Outbox Kernel

> Status: Active (introduced by )
> Companion ADRs: [ADR-0003](../0003-outbox-taxonomy.md)
> Code: `packages/server/src/lib/outbox/`

The **outbox kernel** factors the mechanical lifecycle of an
asynchronous fan-out queue (claim → process → complete | retry |
dead-letter) into a reusable factory. Concrete outboxes (sync,
fiscal, payment, webhook, hardware — see ADR-0003) compose the
kernel with their own table, status enum, and retry policy.

## What

A factory + worker base class that abstracts:

- **Atomic claim** via the `status` + `claim_token` predicate —
  two workers can poll the same outbox concurrently and only one
  wins per row.
- **Explicit processing state** — `claimNext()` moves rows from
  `queued` / due `retrying` into the concrete outbox's processing
  status (`submitting`, `processing`, etc.) while also setting the
  worker lock.
- **Retry budget** with a per-outbox `OutboxRetryPolicy` —
  exponential backoff for fiscal/sync, immediate-retry for
  hardware, etc.
- **Lifecycle terminals** — once a row is in a terminal state
  (`succeeded`, `dead_letter`, etc.), the kernel refuses further
  transitions.
- **Recoverable vs permanent** failure handling — non-recoverable
  errors dead-letter immediately regardless of remaining budget.
- **Worker base class** — `tickOutbox()` runs one claim → process →
  complete | fail cycle and exposes the outcome to the caller.

The kernel does NOT own:

- The concrete outbox table — each outbox declares its own with
  the SHARED columns (id, tenantId, status, payload, attempts,
  nextRetryAt, lastError, claimToken, lockedAt, etc.) plus
  per-outbox extras (`fiscal_document_id`, `peripheral_id`, etc.).
- The status enum — concrete outboxes ship their own (fiscal has
  `contingency`, payment has `settled`, hardware has `cancelled`).
- The wall-clock loop — workers can run on `setInterval`, after
  each enqueue, or on a Bull-style scheduler. The kernel just
  exposes `tickOutbox()` as the unit of work.

## Why

The five outboxes share 90% of their lifecycle code: claim, retry,
backoff, dead-letter, last-error normalization. ADR-0003 explicitly
rejected "one outbox per procedure" and "one monolithic outbox
table" — the kernel is the third path. Each outbox keeps its own
table (so the schema is honest about each lifecycle's quirks) but
inherits the shared mechanics (so a stuck DIAN row doesn't share
code with a stuck webhook delivery).

Without the kernel, the sync, fiscal, payment, webhook, and hardware workers
would each reimplement attempts++, nextRetryAt math, claim_token
guards, and dead-letter transitions — five copies that drift over
time. With the kernel, the mechanics live once and concrete outboxes
focus on their domain logic (the actual fiscal emit, the payment
charge, the webhook POST).

## Lifecycle (canonical fiscal shape from ADR-0003)

```
       enqueue
           │
           ▼
        ┌──────────┐
        │  queued  │◄──────────────── claimNext (ready row)
        └────┬─────┘
             │ claimNext()
             ▼
        ┌──────────────┐
        │  submitting  │
        └──────┬───────┘
               │
       ┌───────┴─────────┐
       ▼                 ▼
    process()         process()
    returns ok        returns fail
       │                 │
       │      ┌───── recoverable ─────┐
       ▼      ▼                       ▼
 ┌───────────┐  ┌────────────┐   ┌─────────────┐
 │ succeeded │  │  retrying  │   │ dead_letter │
 └───────────┘  └────┬───────┘   └─────────────┘
   (terminal)        │ nextRetryAt arrives
                     │
                     └─► claimNext picks it up again
```

Terminal states (no further transitions allowed):

- `succeeded`
- `dead_letter`
- `cancelled` (only some outboxes; e.g. hardware)

## When to use it

Build a concrete outbox **only when** the side effect:

1. Cannot block the primary transaction (fiscal emit, payment
   charge, webhook delivery — all may take seconds/minutes/hours
   to confirm).
2. Has retry semantics distinct from the next sale (a 5xx from
   DIAN should not pause the next click; the kernel reschedules
   without blocking).
3. Carries enough state that an in-memory queue would lose
   correctness on restart (Electron crash mid-charge,
   OS reboot, dev server kill).

Do NOT build an outbox for:

- Synchronous side effects that MUST happen inside the primary
  transaction (e.g. inventory movements that fail the sale if
  stock is insufficient — those belong inside `db.transaction`).
- Read-only queries.
- Single-shot computations with no retry semantics (use a regular
  service function).
- Cases that fit into existing infrastructure better (e.g. an
  audit log — that's already covered by `audit_logs`).

## Defining a concrete outbox (example)

will land the `fiscal_outbox` like this:

```ts
// packages/server/src/db/schema.ts
export const fiscalOutbox = sqliteTable(
  'fiscal_outbox',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    status: text('status', { enum: fiscalOutboxStatusEnum }).notNull().default('queued'),
    payload: text('payload', { mode: 'json' }),
    payloadVersion: integer('payload_version').notNull().default(1),
    attempts: integer('attempts').notNull().default(0),
    nextRetryAt: text('next_retry_at'),
    lastError: text('last_error', { mode: 'json' }),
    priority: real('priority').notNull().default(0),
    claimToken: text('claim_token'),
    lockedAt: text('locked_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    // Per-outbox extras live alongside the shared shape:
    fiscalDocumentId: text('fiscal_document_id').notNull(),
    providerId: text('provider_id').notNull(),
  },
  table => [/* indices */]
);

// packages/server/src/services/fiscal/fiscalOutbox.ts
import {
  BOUNDED_EXPONENTIAL_BACKOFF,
  createOutboxKernel,
  tickOutbox,
} from '../../lib/outbox/index.js';

export const fiscalOutboxKernel = createOutboxKernel<FiscalOutboxStatus, FiscalPayload>({
  table: fiscalOutbox,
  kind: 'fiscal',
  initialStatus: 'queued',
  processingStatus: 'submitting',
  succeededStatus: 'accepted',
  retryingStatus: 'retrying',
  deadLetterStatus: 'dead_letter',
  terminalStatuses: ['accepted', 'dead_letter', 'rejected'],
  retryPolicy: BOUNDED_EXPONENTIAL_BACKOFF,
});

// Worker daemon (runs every 30 seconds inside the embedded server):
export async function fiscalWorkerTick(db, tenantId) {
  return tickOutbox(db, tenantId, {
    kernel: fiscalOutboxKernel,
    workerId: `fiscal-worker-${process.pid}`,
    loggerLabel: 'fiscal-outbox',
    process: async ({ row }) => {
      try {
        const result = await emitToProvider(row.payload);
        return { ok: true };
      } catch (err) {
        return {
          ok: false,
          error: normalizeProviderError(err),
        };
      }
    },
  });
}
```

The kernel handles claim/retry/dead-letter; the worker only writes
the `process` function and decides when to call `tick`.

## Retry policies

The kernel ships `BOUNDED_EXPONENTIAL_BACKOFF` as the canonical
default — `1m → 5m → 15m → 1h → 6h → 24h`, then dead-letter:

```ts
import { BOUNDED_EXPONENTIAL_BACKOFF } from '../../lib/outbox/index.js';
// maxAttempts: 6, exponential, sized for human-scale provider outages.
```

Each concrete outbox can ship its own:

- **Hardware**: no backoff (`nextDelayMs(_) => 0`), low maxAttempts
  (3) — a stuck printer either works on the next tick or gets
  cancelled.
- **Webhook**: exponential up to 24h with maxAttempts 10 — public
  integrators are slower to recover than fiscal providers.
- **Payment**: tighter window (10s → 30s → 90s, dead-letter at 4)
  — payment auth windows expire fast.

## Multi-tenant invariant

Every kernel method takes `tenantId` explicitly. Concurrency tests
verify that two parallel `claimNext` calls scoped to different
tenants never grab the same row, even if both rows happen to share
priority + createdAt. The `peek` helper is also tenant-scoped — no
cross-tenant inspection at the kernel layer.

## Concurrency: status + claim_token contract

Two workers polling the same outbox simultaneously is the expected
case (a foreground worker driven by the renderer + a background
worker driven by setInterval). The kernel's atomic claim works as
follows:

1. SELECT the next eligible row (by priority + createdAt + retry
   schedule) whose `claim_token` is null and whose status is
   `initialStatus` or due `retryingStatus`.
2. UPDATE that row to `processingStatus` while setting
   `claim_token` and `locked_at`, guarded by
   `id = ? AND status = <candidate status> AND claim_token IS NULL`.
   If the UPDATE returns `changes = 0`, another worker beat us to
   it or the row completed before our claim — the worker returns
   `null` and tries again on the next tick.

`claim_token` is the technical lock. `status` is the operator-facing
lifecycle that fiscal/payment/hardware screens and Operations Center
can explain to support.

This is the canonical SQLite claim pattern; better-sqlite3's
serializable isolation makes it safe without explicit locks.

## Outbox metadata table

`outbox_metadata` is the cross-outbox health surface. Each
concrete outbox refreshes its row periodically with
`pendingCount`, `oldestPendingAt`, `lastSuccessAt`, and
`lastFailureAt`. The Operations Center () reads ONLY this
table for its dashboard — never the concrete outbox tables — so
the panel grid is a single query regardless of how many outboxes
exist.

The kernel exposes `recordSuccess`, `recordFailure`, and
`refreshPendingCount` helpers that workers call after each tick.
These are NOT called automatically — concrete outboxes opt in.
That keeps the kernel decoupled from the metadata table during
early integration ( ships the metadata table; +
turns on metadata refresh as each outbox lands).

## Relation to other patterns

- **[Operation Journal](./operation-journal.md)** — outbox rows
  carry `operationId` in their payload; workers writing
  `operation_effects` (success) or `operation_errors` (failure)
  against the originating event close the trail end-to-end.
- **Command Envelope (ADR-0002)** — critical mutations enqueue
  outbox rows AFTER the primary transaction commits. The envelope
  middleware never enqueues directly; services do.
- **Local Store Authority (ADR-0001)** — outbox rows live in the
  local SQLite. Workers process them locally; results sync upstream
  via the future sync_outbox (). The kernel itself never
  reaches over the network.
