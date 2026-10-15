# 0003 — Outbox taxonomy

**Language:** English · [Español](../es/architecture/0003-outbox-taxonomy.md)

> Status: Accepted
> Date: 2026-05-02
> Current worker and schema contract reviewed: 2026-10-15

## Decision

Operational fan-out uses six purpose-specific queues: `sync_outbox`,
`fiscal_outbox`, `payment_outbox`, `webhook_outbox`, `hardware_outbox` and
`kds_outbox`. Their physical tables, lifecycle states, retry policies and
operator recovery remain separate. A stalled provider must not block another
stream or roll back an already committed sale.

The generic implementation at `packages/server/src/lib/outbox/` shares the
`OutboxRow<TPayload>` projection, `createOutboxKernel`, `tickOutbox` and
ownership-fenced settlement. It does not force every domain through one table
or one status enum. The row projection is:

```ts
interface OutboxRow<TPayload, TStatus extends string = string> {
  id: string;
  tenantId: string;
  status: TStatus;
  payload: TPayload;
  payloadVersion: number;
  attempts: number;
  nextRetryAt: string | null;
  lastError: NormalizedOutboxError | null;
  priority: number;
  claimToken: string | null;
  lockedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
```

## Queue boundaries

| Queue             | Purpose and current boundary                                                                                                                                                   | Lifecycle vocabulary                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `sync_outbox`     | Tenant-scoped domain intent for synchronization; the current push acknowledges local intent, not atomic delivery into another database. Manual recovery follows ADR-0004/0005. | `queued`, `submitting`, `synced`, `conflict`, `retrying`, `dead_letter`, plus terminal `local_only` where transport is forbidden. |
| `fiscal_outbox`   | Provider communication for an immutable fiscal document; local mock/draft operation does not establish authority certification.                                                | `queued`, `submitting`, `accepted`, `rejected`, `contingency`, `retrying`, `dead_letter`.                                         |
| `payment_outbox`  | Payment-rail intent and reconciliation. The software contract does not certify a live terminal or provider.                                                                    | `queued`, `submitting`, `approved`, `declined`, `timeout`, `retrying`, `settled`, `dead_letter`.                                  |
| `webhook_outbox`  | Signed outbound events to a provisioned HTTPS receiver; the HTTP delivery worker is implemented.                                                                               | `queued`, `submitting`, `delivered`, `failed`, `retrying`, `dead_letter`.                                                         |
| `hardware_outbox` | Recoverable receipt/drawer effects after the business transaction; direct USB/serial support is not implied.                                                                   | `queued`, `submitting`, `printed`, `failed`, `retrying`, `dead_letter`.                                                           |
| `kds_outbox`      | Kitchen invalidation for an already persisted preparation event, never a second sale or preparation.                                                                           | `queued`, `submitting`, `delivered`, `retrying`, `dead_letter`.                                                                   |

KDS has its own claim-fenced worker and does not add a kind to the generic
`OutboxKind` metadata enum. `outbox_metadata` currently aggregates the five
kinds `sync`, `fiscal`, `payment`, `webhook` and `hardware`; do not treat it as
proof that every dedicated queue is represented there. Operational alert
transitions also have a dedicated delivery queue and immutable attempt ledger;
see [observability](../OBSERVABILITY.md) and [webhooks](../WEBHOOKS.md).

Money, fiscal and cash state never inherit the retry policy of UI sync. The
Operations Center exposes domain recovery without making network success a
prerequisite for committing the original local business command.

## Fiscal boundary

`fiscal_documents` remains the document evidence; `fiscal_outbox` orchestrates
provider communication. Its `kind` distinguishes `emit`, `cancel`,
`retry_contingency` and `fetch_status`. `contingency` preserves the local sale
while provider work is pending; it is not proof of legal contingency
certification for a country pack.

The bounded generic backoff is 1 minute, 5 minutes, 15 minutes, 1 hour, 6 hours
and 24 hours, with a finite attempt budget and `dead_letter` recovery. A
concrete worker owns its policy; hardware currently uses
`BOUNDED_EXPONENTIAL_BACKOFF`, while webhooks use their documented separate
schedule. Do not infer hardware behavior from an old no-backoff comment in a
shared type file.

The normalized error projection carries `errorCode`, `providerMessage`,
`recoverable` and optional `details`. Public errors and diagnostic exports must
still apply their redaction boundary. A fiscal adapter returns
`FiscalAdapterIssueResult`; it does not own the queue. Provider identity,
`fiscal_document_id` and `cufe` remain fiscal data, not generic sync columns.
Document mirrors and accepted-event evidence advance only under the current
claim's settlement transaction.

## Lease ownership and settlement

Generic fiscal, hardware, webhook and operational-alert workers acknowledge
only their current tenant-local processing claim. A row id alone is not an
ownership credential. A late result returns `lost_claim` without changing
retry counts, delivery evidence, document mirrors, CUFE or health metadata.

Final effects and acknowledgment share a synchronous immediate SQLite
transaction. Intermediate webhook subscriber progress and alert attempt
creation use the same fence. Network calls run outside SQLite writers. A
local SQL failure is not a provider rejection. Optional public-event/metadata
failures stay best-effort in savepoints so they cannot provoke a second fiscal
submission. See the [outbox kernel pattern](./patterns/outbox-kernel.md#fenced-settlement-and-intermediate-progress).

External effects are at-least-once: a process can lose ownership after the
provider accepted a request. Neither `delivered` nor `printed` certifies
physical screen/printer receipt. KDS polling/reconnect recovers disconnected
displays; it does not create another preparation. See [ADR-0021](./0021-durable-kitchen-preparation.md).

## Alternatives rejected

- **One monolithic table with a `kind` discriminator:** couples query plans,
  lifecycle and recovery for unrelated streams.
- **In-memory bus only:** loses intent after Electron crash, OS reboot or process exit.
- **One queue per procedure:** multiplies tables and obscures domain health.
- **External Kafka/RabbitMQ/Redis dependency for local completion:** violates
  ADR-0001; a cashier must not need a network broker to close the local sale.

## Implementation and compatibility

- `packages/server/src/lib/outbox/` owns generic claims, retries, settlement and
  metadata helpers. Concrete workers select their table/status/policy.
- `services/sync/contract.ts` and `enqueueSync` own synchronization intent;
  `sync.{getContract, peekOutbox, retry}` expose bounded operator reads/recovery.
- `0016_sync_contract_v1.sql` copied pending `sync_queue` rows with
  `INSERT OR IGNORE`; `0017_drop_sync_queue.sql` removed the retired table after
  the writer/procedure cutover. The web queue moved from
  `services/storage/syncQueue.ts` to `offlineQueue.ts`; its IndexedDB store name
  stayed compatible.
- `0018_hardware_outbox_idempotency.sql` added `idempotency_key` and the partial
  unique index `(tenant_id, kind, idempotency_key) WHERE idempotency_key IS NOT NULL`.
  `packages/server/src/services/peripherals/enqueue-hardware.ts` returns
  `{deduped: true}` for same-envelope retries; null-keyed legacy work remains
  independent. `peripherals.printReceipt` and `peripherals.kickCashDrawer` use
  this boundary where they enqueue server-side work.
- `services/peripherals/hardware-worker.ts` preserves queued bytes across retry.
  A route change cannot silently complete an ESC/POS job as a System print.
- `operation_events`, `operation_effects` and `operation_errors` provide
  observability in `packages/server/src/services/operation-journal/`; they do
  not replace authoritative domain audit or outbox writes.
- Detailed reusable contracts live in [Operation Journal](./patterns/operation-journal.md)
  and [Outbox Kernel](./patterns/outbox-kernel.md). Provider/terminal and physical
  hardware qualification remain separate release evidence.
