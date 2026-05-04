# Pattern: Operation Journal

> Status: Active (introduced by ENG-053)
> Companion ADRs: [ADR-0001](../0001-local-store-authority.md), [ADR-0002](../0002-command-envelope.md), [ADR-0003](../0003-outbox-taxonomy.md)
> Code: `packages/server/src/services/operation-journal/journal.ts`

The **operation journal** is the append-only correlation trail that
joins every critical command's lifecycle in one place: the click
that started it, the side effects it produced, and any post-commit
failures that survived the primary transaction.

## What

Three tables backed by `operation_id` (the UUID minted by the
renderer per envelope, ADR-0002):

| Table | Cardinality | Purpose |
|---|---|---|
| `operation_events` | one per critical click | "Click X started at T1, transitioned to status S at T2" |
| `operation_effects` | many per event | "This operation wrote audit row Y, emitted sync queue row Z, etc." |
| `operation_errors` | zero or more per event | "After commit, the fiscal push failed with code F (recoverable)" |

A successful sale produces:

```
operation_events:  status = succeeded
operation_effects: kind = sale_row, kind = audit_log, kind = inventory_movement, ...
operation_errors:  (empty)
```

A sale that committed but failed downstream fan-out produces:

```
operation_events:  status = partial
operation_effects: kind = sale_row, kind = audit_log, ...   (the parts that committed)
operation_errors:  errorCode = FISCAL_TRANSIENT, recoverable = true
```

A sale rejected by the procedure (rolled back) produces:

```
operation_events:  status = failed
operation_effects: (empty — nothing committed)
operation_errors:  errorCode = INVENTORY_INSUFFICIENT, recoverable = false
```

## Why

Without the journal, debugging "why did this click not produce X?"
requires grepping logs, joining timestamps across 5+ tables, and
guessing which audit row corresponds to which user intent. With the
journal, **one query** (`SELECT * FROM operation_events WHERE
operation_id = ?`) returns the entire trail — what happened, what
side-effects landed, what failed without rolling back the primary.

The pattern also supports the [outbox kernel](./outbox-kernel.md):
when a future fiscal/payment/sync worker fails on a row, it reads
the `operation_id` it's working on and writes an `operation_errors`
entry against the original journal event. The Operations Center
(ENG-065) renders one panel per outbox plus a dedicated journal
detail view that joins these tables.

## When to use it

Only **critical commands** (the closed list in ADR-0002) emit
journal events. The middleware that wraps them (`commandEnvelope`)
records the start row automatically — services do NOT call
`recordOperationStart` directly.

Effects and errors ARE called by services (or workers) explicitly:

- After committing a sale: `recordEffect({operationEventId, kind:
  'sale_row', resourceType: 'sales', resourceId: saleId})`.
- After a post-commit fan-out fails:
  `recordError({operationEventId, errorCode, recoverable: true})`
  followed by `markOperationCompleted(eventId, 'partial')`.

Do **not** emit journal entries for:

- Read-only queries (no envelope, no event row).
- Catalog mutations (products, customers, units, vat rates) — they
  are protected by row-level uniqueness and not in the closed list.
- Preference toggles (`fiscalSettings.update`,
  `ai.settings.update`).

## Lifecycle

```
                     ┌──────────────────┐
                     │  commandEnvelope  │
                     └────────┬─────────┘
                              │
                              ▼
                  recordOperationStart()
                              │
                              ▼
                  ┌────────────────────────┐
                  │  procedure runs inside  │
                  │  a DB transaction       │
                  └────────────┬───────────┘
                              │
            ┌─────── success ─┴─ failure ────────┐
            ▼                                     ▼
   recordEffect(...)                       recordError(...)
   markCompleted('succeeded')              markCompleted('failed')


      ┌─── post-commit fan-out (workers, ENG-057+) ────┐
      ▼                                                ▼
   ok: recordEffect(kind='fiscal_emit', ...)    fail: recordError(...)
                                                       markCompleted('partial')
```

## API surface

```ts
// services/operation-journal/journal.ts

recordOperationStart(db, {
  tenantId, operationId, operationKind, deviceId, userId, requestHash, summary?
}): Promise<{ eventId, isNew }>

recordEffect(db, {
  operationEventId, kind, resourceType, resourceId, effectData?
}): Promise<{ effectId }>

recordError(db, {
  operationEventId, errorCode, message, recoverable, errorData?
}): Promise<{ errorId }>

markOperationCompleted(db, eventId, status): Promise<void>
  // status: 'succeeded' | 'failed' | 'partial'
  // Idempotent: refuses to transition out of a terminal state.

getOperationTrail(db, { tenantId, operationId }):
  Promise<{ event, effects, errors } | null>
```

## Multi-tenant invariant

Every helper takes `tenantId` explicitly (`recordOperationStart`,
`getOperationTrail`) or is FK-bound to a row that already carries
tenant scope (`recordEffect`, `recordError` reference an event row
which has `tenantId`). Cross-tenant lookups are physically
impossible at this layer. The composite UNIQUE on `(tenantId,
operationId)` guarantees Tenant A and Tenant B can use the same
`operationId` value without colliding — the kernel separates them
at the row level.

## Best-effort POST-procedure semantics

`recordEffect` and `recordError` MUST NEVER cause the primary work
to roll back. The middleware wraps these calls in `try/catch` with
warn-level logs, and procedures should follow the same pattern when
they emit effects directly. The journal is observability, not a
correctness gate.

If the journal write itself fails (DB lock, disk full), the primary
work stays committed. The Operations Center surfaces gaps in the
journal trail as warnings, not as data integrity violations.

## Code example

```ts
// In a future application service (ENG-054 will do this for
// `completeSale`):
import {
  getOperationTrail,
  recordEffect,
} from '../../services/operation-journal/journal.js';

async function completeSale(ctx: Context, input: CompleteSaleInput) {
  const { sale, audit } = await ctx.db.transaction(async tx => {
    const sale = await insertSaleRow(tx, input);
    const audit = await writeSaleCreateAuditLog(tx, sale);
    // Inside the transaction we DO NOT emit journal effects —
    // any failure here rolls back the primary work, including the
    // effect, which would leave a dangling reference.
    return { sale, audit };
  });

  // Outside the transaction: best-effort journal effects.
  try {
    const trail = await getOperationTrail(ctx.db, {
      tenantId: ctx.tenantId,
      operationId: ctx.envelope.operationId,
    });
    if (!trail) {
      ctx.log.warn('journal event missing; sale committed without effect trail');
      return sale;
    }
    await recordEffect(ctx.db, {
      operationEventId: trail.event.id,
      kind: 'sale_row',
      resourceType: 'sales',
      resourceId: sale.id,
      effectData: { total: sale.total, paymentMethod: sale.paymentMethod },
    });
    await recordEffect(ctx.db, {
      operationEventId: trail.event.id,
      kind: 'audit_log',
      resourceType: 'audit_logs',
      resourceId: audit.id,
    });
  } catch (err) {
    ctx.log.warn({ err }, 'journal effect emission failed; sale committed');
  }
}
```

## Relation to other patterns

- **Command Envelope (ADR-0002)** — the journal writes are keyed by
  the envelope's `operationId`. Without the envelope there is no
  journal event, and that's by design: only critical commands need
  this trail.
- **[Outbox kernel](./outbox-kernel.md)** — the outbox stores
  retryable side effects; the journal stores the historical record
  of WHAT was attempted and WHAT happened. Workers that process
  outbox rows write `operation_effects` (success) or
  `operation_errors` (failure) against the originating event.
- **Local Store Authority (ADR-0001)** — the journal is local-first
  like every other store. Future sync (ENG-064) publishes journal
  events to a central server; the central never writes back.

## Related tickets

- ENG-052 added `audit_logs.operation_id` (the column) and the
  `commandEnvelope` middleware that mints the envelope.
- ENG-053 added the journal tables + service + middleware wiring
  (this pattern's owner ticket).
- ENG-054 / ENG-055 / ENG-056 will be the first SERVICE-level
  consumers — extracting `completeSale` etc. and emitting effects.
- ENG-057 will be the first WORKER-level consumer (fiscal outbox
  worker recording effects/errors against the journal).
- ENG-065 will surface the journal in the Operations Center UI.
