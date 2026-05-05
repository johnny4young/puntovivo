# 0003 — Outbox Taxonomy

> Status: Accepted
> Date: 2026-05-02
> Owner: ENG-051

## Decision

**Operational fan-out from the local store splits into five
purpose-specific outboxes — `sync_outbox`, `fiscal_outbox`,
`payment_outbox`, `webhook_outbox`, `hardware_outbox`. They share a
common kernel (the `Outbox` shape) but never a single table. Retry
policies, lifecycle states, and operator escalation paths are
defined per outbox so a stuck job in one stream cannot block another.**

The shared kernel exposes the same shape:

```
{
  id: string                // local row id
  tenantId: string          // multi-tenant scope (see AGENTS.md)
  kind: string              // outbox-specific subtype
  status: enum              // outbox-specific lifecycle
  attempts: integer         // retry counter
  nextRetryAt: ISO timestamp // backoff schedule
  payloadVersion: integer   // for forward compatibility
  payload: json             // text-backed JSON in SQLite
  lastError: json | null    // normalized error from the last attempt
  createdAt, updatedAt: ISO timestamps
}
```

ENG-053 ships the kernel as `packages/server/src/lib/outbox/` plus
shared metadata table (`outbox_metadata`) for cross-outbox stats,
without forcing one physical table for everything.

The five outboxes — and why each gets its own physical home:

1. **`sync_outbox`** — entity sync to a future central server.
   Replaced the legacy `sync_queue` in ENG-064 (table introduced)
   + ENG-064b (writer cutover + drop of `sync_queue`). Lifecycle:
   `queued → submitting → synced | conflict | retrying →
   dead_letter`. Retry policy is defensive; conflicts route to
   manual resolution per ADR-0004.
2. **`payment_outbox`** — payment terminal effects (charge / void
   / slip print on a Bold or Wompi datáfono once ENG-063 ships).
   Lifecycle: `queued → submitted → approved | declined | timeout
   | retrying → settled`. Failed payments do not roll back the
   sale; the outbox surfaces them in the Operations Center
   (ENG-065).
3. **`webhook_outbox`** — public webhook delivery to integrators.
   Backed by ENG-070's event-based public API. Lifecycle:
   `queued → delivering → delivered | failed | dead_letter`.
   Retry policy is exponential with a low priority — a webhook
   delay never blocks a sale.
4. **`hardware_outbox`** — printer / cash drawer / scanner jobs
   that can wait without affecting the sale (e.g. queueing a
   reprint after a paper jam). Lifecycle: `queued → printing →
   done | hardware_error | cancelled`. Lives device-local; never
   syncs upstream.
5. **`fiscal_outbox`** — see Spanish section below.

The split is not aesthetic. **Money / fiscal / cash never block on
or inherit retry policy from UI sync.** A `fiscal_document` in
contingency does not wait for a customer avatar to upload; an
unfinished `webhook` retry does not stall the next sale. The
Operations Center (ENG-065) renders one panel per outbox so the
operator sees independent health indicators.

---

## Fiscal outbox *(en español por convención fiscal)*

El `fiscal_outbox` es la cola más sensible — toca dinero, retención,
DIAN / SAT / SII y trazabilidad legal. Por eso:

- **Tabla dedicada**: `fiscal_outbox` con `kind` ∈ `{emit, cancel,
  retry_contingency, fetch_status}`. Convive con
  `fiscal_documents` que sigue siendo la fuente de verdad de cada
  comprobante; el outbox sólo orquesta el lifecycle de la
  comunicación con el proveedor.
- **Lifecycle**: `queued → submitting → accepted | rejected |
  contingency | retrying → dead_letter`. El estado `contingency`
  es el clave — corresponde al modo offline DIAN / SAT donde la
  venta se cierra localmente pero el comprobante queda pendiente
  de timbrado. Al recuperarse el proveedor, el daemon retoma
  desde `retrying`.
- **Política de reintentos**: backoff exponencial bounded
  (1m → 5m → 15m → 1h → 6h → 24h). Después del último intento
  cae a `dead_letter` y dispara una notificación al admin del
  tenant. El operator puede forzar un reintento manual desde el
  Operations Center.
- **Errores normalizados**: `lastError` es un objeto
  `{ providerCode, providerMessage, normalizedKind, recoverable }`.
  `normalizedKind` mapea los códigos del proveedor (Facture, HKA,
  PAC, SII) a un set cerrado para que la UI muestre mensajes
  consistentes sin importar el adapter activo.
- **Migración del estado actual**: hoy `fiscal_documents.status`
  ya cubre `pending | sent | accepted | rejected | contingency`.
  ENG-057 promueve estos estados a `fiscal_outbox.status` y deja
  `fiscal_documents.status` como espejo derivado del último
  evento del outbox. Sin pérdida de información histórica.
- **Convivencia con `services/fiscal/**`**: el adapter sigue
  retornando el shape de `FiscalAdapterIssueResult` (ENG-020 +
  ENG-035b). El outbox lo persiste y orquesta el reintento;
  el adapter no conoce el outbox. Esto preserva la separación
  Strategy/Factory de ENG-034.
- **No mezclar con `sync_outbox`**: aunque ambos pueden tener
  `tenant_id` y `kind`, las columnas de `fiscal_outbox` incluyen
  `fiscal_document_id`, `provider_id`, `cufe`, `xml_ref` que el
  sync genérico no necesita. Mezclarlos haría el schema más débil
  y forzaría joins que la `architectural-lint.test.ts` ya prohíbe
  para `routers/reports/fiscal*`.

---

## Alternatives Rejected

- **One monolithic outbox table with a `kind` discriminator** — the
  shape the legacy `sync_queue` carried. Forces every consumer to
  filter by kind, hurts query plans on growing tables, and (worst)
  makes it hard to apply different retry policies per stream. A
  stuck DIAN document would share a row in the same table with a
  queued customer-avatar update.
- **In-memory event bus only** — does not survive process restart,
  which is the exact failure mode the outboxes exist to handle
  (Electron crash mid-sale, OS reboot, dev server kill).
- **One outbox per procedure** — combinatorial explosion. Forty-plus
  critical commands would need their own table; the operator could
  not reason about overall health.
- **External queue infrastructure (Kafka, RabbitMQ, Redis Streams)**
  — invalidates the local-first authority of ADR-0001. Cashier
  devices cannot depend on a network broker for a sale to close.

## Implementation Impact

- **Kernel** (ENG-053): `packages/server/src/lib/outbox/` exports
  the shared `Outbox<TPayload>` type, an `OutboxKernel` factory,
  and a worker base class. Each concrete outbox composes the
  kernel with its own table, `kind` enum, and retry policy.
- **Five physical tables**: `sync_outbox`, `fiscal_outbox`,
  `payment_outbox`, `webhook_outbox`, `hardware_outbox`. Each
  carries its own status enum and any extra columns its kind
  requires (e.g. `fiscal_document_id` on `fiscal_outbox`,
  `peripheral_id` on `hardware_outbox`).
- **One shared metadata table**: `outbox_metadata` collects
  cross-outbox stats (`outbox_kind`, `tenant_id`, `pending_count`,
  `last_success_at`, `last_failure_at`, `oldest_pending_at`)
  refreshed periodically by a background job. The Operations
  Center reads this for its dashboard.
- **Migration plan**:
  1. ENG-053 lands the kernel + `outbox_metadata`.
  2. ENG-057 introduces `fiscal_outbox` and migrates the
     `fiscal_documents.status='contingency'` rows.
  3. ENG-064 (Shipped 2026-05-05) introduced `sync_outbox` via
     migration `0016_sync_contract_v1.sql` with a one-shot
     `INSERT OR IGNORE` data migration that copied pending
     `sync_queue` rows over, plus the contract foundation
     (per-entity manifest at `services/sync/contract.ts`,
     `enqueueSync` helper, three new procedures
     `sync.{getContract, peekOutbox, retry}`). ENG-064b (Shipped
     2026-05-05) closed the cutover: the 19 router inline writers
     + 4 application services + dev seed all route through
     `enqueueSync`, the eight legacy `sync.*` procedures
     (`status / listQueue / addToQueue / removeFromQueue /
     listConflicts / push / pull / resolve`) read/write
     `sync_outbox`, migration `0017_drop_sync_queue.sql` removes
     the legacy table, and the web client
     `services/storage/syncQueue.ts` is renamed to
     `offlineQueue.ts` to clear the file-name collision.
  4. ENG-063 introduces `payment_outbox` when the payment
     terminal adapter ships.
  5. ENG-070 introduces `webhook_outbox`.
  6. ENG-062 introduces `hardware_outbox` (migration
     `0015_hardware_outbox.sql`) together with the ESC/POS printer
     + RJ11 cash drawer adapters — the first peripheral drivers
     with real device I/O that can fail recoverably (USB unplug,
     paper out, TCP-host unreachable). The hardware worker
     (`services/peripherals/hardware-worker.ts`) mirrors the
     fiscal worker structurally; the kernel + retry policy are
     reused from `lib/outbox/`.
- **Backward compatibility**: the legacy `sync_queue` was retired
  in ENG-064b (migration `0017_drop_sync_queue.sql`); the
  `fiscal_documents.status` mirror is owned by `fiscal_outbox`
  per ENG-057. No data loss along the way — the ENG-064 backfill
  already copied pending rows before drop.

## Affected Tickets

- `ENG-053` — Operation journal + outbox kernel. Builds the shared
  primitives.
- `ENG-057` — Fiscal outbox + contingency engine. First concrete
  consumer of the kernel; ships the fiscal lifecycle described in
  the Spanish section above.
- `ENG-058` — Receipt fiscal finalization. Reads `fiscal_outbox`
  status to decide between `accepted | pending | contingency |
  rejected` rendering on the receipt.
- `ENG-060` — Peripheral registry + hardware ports. Introduces
  `hardware_outbox`.
- `ENG-063` — Payment terminal adapter. Introduces
  `payment_outbox`.
- `ENG-064` (Shipped 2026-05-05) — Sync contract v1. Introduced
  `sync_outbox` via migration `0016_sync_contract_v1.sql` plus the
  per-entity manifest + `enqueueSync` helper + three new procedures
  (`getContract` / `peekOutbox` / `retry`).
- `ENG-064b` (Shipped 2026-05-05) — Sync writer cutover. Routed
  every inline writer through `enqueueSync`, cut the eight legacy
  `sync.*` procedures over to `sync_outbox`, dropped the legacy
  `sync_queue` table via migration `0017_drop_sync_queue.sql`, and
  renamed the web client offline queue file to clear the name
  collision.
- `ENG-065` — Operations Center. Reads `outbox_metadata` and
  renders one panel per outbox.
- `ENG-070` — Event-based public API + webhook foundation.
  Introduces `webhook_outbox`.

Updated: 2026-05-02 (ENG-051 — initial ADR set).
Updated: 2026-05-03 (ENG-053 — outbox kernel shipped at
`packages/server/src/lib/outbox/`, exposing `createOutboxKernel`
factory + `tickOutbox` worker base + `outbox_metadata` helpers.
Operation journal triplet — `operation_events` + `operation_effects`
+ `operation_errors` — also shipped at
`packages/server/src/services/operation-journal/`. The five
concrete outboxes (sync / fiscal / payment / webhook / hardware)
remain parked behind their owner tickets (ENG-064 / ENG-057 /
ENG-063 / ENG-070 / ENG-060). Pattern docs:
`patterns/operation-journal.md` + `patterns/outbox-kernel.md`).
