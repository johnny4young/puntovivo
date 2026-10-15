# Pattern: Operation Journal

**Language:** English · [Español](../../es/architecture/patterns/operation-journal.md)

> Status: Active
> Companion ADRs: [ADR-0001](../0001-local-store-authority.md), [ADR-0002](../0002-command-envelope.md), [ADR-0003](../0003-outbox-taxonomy.md)
> Code: `packages/server/src/services/operation-journal/journal.ts`

The **operation journal** correlates every critical command's lifecycle:
the click that started it, the side effects it produced, and any post-commit
failures that survived the primary transaction. Effect and error rows are
appended; the event row carries an updatable summary and lifecycle status.

## What

Three tables backed by `operation_id` (the UUID minted by the
renderer per envelope, ADR-0002):

| Table               | Cardinality            | Purpose                                                            |
| ------------------- | ---------------------- | ------------------------------------------------------------------ |
| `operation_events`  | one per critical click | "Click X started at T1, transitioned to status S at T2"            |
| `operation_effects` | many per event         | "This operation wrote audit row Y, emitted sync queue row Z, etc." |
| `operation_errors`  | zero or more per event | "After commit, the fiscal push failed with code F (recoverable)"   |

On a first attempt with complete journal writes, a successful sale produces:

```
operation_events:  status = succeeded
operation_effects: kind = sale_row, kind = audit_log, kind = inventory_movement, ...
operation_errors:  (empty)
```

A sale that committed but failed downstream fan-out can produce the following
when the event is still started. Once terminal, its status cannot change to a
different terminal status; a later worker error does not itself turn an already
successful event into partial completion:

```
operation_events:  status = partial
operation_effects: kind = sale_row, kind = audit_log, ...   (the parts that committed)
operation_errors:  errorCode = FISCAL_TRANSIENT, recoverable = true
```

A sale rejected by the procedure (rolled back) produces the following on its
first attempt. A same-envelope retry after a fully rolled-back failure may
reopen the event when command kind, device, actor and request hash still match;
earlier error rows remain attempt evidence even if a later retry succeeds:

```
operation_events:  status = failed
operation_effects: (empty — nothing committed)
operation_errors:  errorCode = INVENTORY_INSUFFICIENT, recoverable = false
```

## Why

Without the journal, debugging "why did this click not produce X?"
requires grepping logs, joining timestamps across 5+ tables, and
guessing which audit row corresponds to which user intent. With the
journal, **one helper call** to `getOperationTrail` loads the tenant-scoped
event and its ordered effects and errors. A raw
`SELECT * FROM operation_events WHERE operation_id = ?` reads only the event
header and omits the tenant predicate; it is not a complete or safe application
lookup for the trail.

The pattern also supports the [outbox kernel](./outbox-kernel.md):
workers can correlate a failed row through its `operation_id` and append an
`operation_errors` entry against the original journal event. Each integration
must emit that evidence explicitly; an outbox row alone does not populate the
trail. The Operations Center exposes outbox and attention surfaces; the current
operations router does not expose a dedicated full-journal detail procedure.

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
  followed by `markOperationCompleted(eventId, 'partial')` only while the event
  is still started. Errors recorded after terminal completion remain separate
  evidence without changing that terminal status.

Do **not** emit journal entries for:

- Read-only queries (no envelope, no event row).
- Ordinary catalog mutations outside the current critical-command list
  (products, customers, units, vat rates). Row-level uniqueness is not a general
  replacement for a command envelope: for example, `restaurantModifiers.save`
  is an explicitly enveloped catalog command.
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


      ┌─── post-commit fan-out (workers, +) ────┐
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
which has `tenantId`). Cross-tenant lookups are
prevented by the tenant-scoped lookup when callers use that boundary. The
internal effect/error writers trust the supplied event id; their foreign key
does not independently authorize a caller or accept an arbitrary cross-tenant
id safely. The composite UNIQUE on `(tenantId, operationId)` guarantees Tenant
A and Tenant B can use the same
`operationId` value without colliding — the kernel separates them
at the row level.

## Best-effort POST-procedure semantics

`recordEffect` and `recordError` MUST NEVER cause the primary work
to roll back. The middleware wraps these calls in `try/catch` with
warn-level logs, and procedures should follow the same pattern when
they emit effects directly. The journal is observability, not a
correctness gate.

If the journal write itself fails (DB lock, disk full), the primary
work stays committed. Missing journal evidence is an observability gap, not
proof that the primary transaction failed. Consult the warn-level logs and
authoritative domain state; the current Operations Center does not provide a
dedicated journal-gap view.

## Code example

The example below is schematic pseudocode showing the post-commit boundary, not
a runnable service or a future implementation requirement. The current
`completeSale` use case already emits best-effort effects through
`packages/server/src/application/sales/journal-effects.ts`. The API excerpt and
lifecycle sketch show terminal completion; the matching failed-attempt reopening
rule is implemented separately by `recordOperationStart`.

```ts
// In a future application service ( will do this for
// `completeSale`):
import { getOperationTrail, recordEffect } from '../../services/operation-journal/journal.js';

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
  outbox rows can explicitly append `operation_effects` (success) or
  `operation_errors` (failure) against the originating event.
- **Local Store Authority (ADR-0001)** — the journal belongs to the local
  authority. Correlation with a sync outbox is not evidence that complete journal
  events are published remotely. Any future publication needs an explicit
  transport contract and must preserve local authority.
