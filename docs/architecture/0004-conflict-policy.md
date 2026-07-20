# 0004 — Conflict Policy

> Status: Accepted
> Date: 2026-05-02

## Decision

**Sync conflicts on high-risk entities (money, fiscal, cash,
inventory movements, audit trail) are NEVER resolved automatically.
The operator must resolve them manually through `sync.resolve` or
the Operations Center (). Non-financial entities (catalog
data, preferences) accept last-write-wins with mandatory audit log
entries.**

The split is binary and the lists are closed. New entities must be
classified at design time; defaulting to "high-risk" is the safe
choice when the call is ambiguous.

The current implementation () already exposes the building
blocks: `sync.listConflicts` and `sync.pull` return
`localRecordExists`; `sync.resolve` rejects `keepLocal` and
`merged` when the local row is missing and steers the operator to
`acceptRemote` (rebadged as "Discard Local Change" in the UI). This
ADR formalizes the entity classification so can wire each
list to the correct policy without re-arguing per row.

---

## Entidades de alto riesgo _(en español por convención fiscal y contable)_

Las siguientes entidades **nunca** aceptan resolución automática.
Cualquier conflicto detectado por el sync queda en estado
`pending` y exige acción humana:

**Ventas y devoluciones**

- `sales`
- `sale_payments`
- `sale_returns`
- `sale_items` _(snapshot inmutable; un conflicto aquí indica
  corrupción y debe inspeccionarse, no resolverse)_

**Caja**

- `cash_sessions`
- `cash_movements`

**Fiscal**

- `fiscal_documents`
- `fiscal_document_items`
- `fiscal_numbering_resolutions`
- `fiscal_certificates`
- `fiscal_outbox` _(introducida por )_

**Inventario operacional**

- `inventory_movements`
- `inventory_balances`
- `transfer_orders`
- `transfer_order_items`
- `stock_adjustments`

**Auditoría**

- `audit_logs` _(snapshot inmutable; nunca se sobreescribe)_

**Razón**: estas entidades son la base contable y legal del
tenant. Una resolución automática podría:

- Duplicar un cobro (sales + sale_payments).
- Borrar una nota de crédito ya emitida al SAT (fiscal_documents).
- Desbalancear una sesión de caja cerrada (cash_sessions +
  cash_movements).
- Romper la trazabilidad de stock entre sedes (transfer_orders).
- Romper la cadena legal de auditoría (audit_logs).

El daño en cualquiera de estos casos es **irreversible sin
intervención humana**. La política de conflictos automática
"último escritor gana" es matemáticamente correcta para datos sin
significado contable; aquí no.

---

## Non-financial entities (last-write-wins allowed)

The following entities accept automatic conflict resolution by
`updatedAt` server timestamp, with a mandatory `audit_logs` entry
recording the auto-resolution choice for the loser side:

**Catalog data**

- `customers`
- `products`
- `categories`
- `units`
- `providers`
- `vat_rates`
- `identification_types`
- `client_types`
- `commercial_activities`
- `regime_types`
- `person_types`

**Preferences and templates**

- `receipt_templates`
- `tenant_locale_settings`
- `app_settings`
- `tenants.settings` (the JSON blob — namespaced subkeys like
  `fiscal.mx.*` follow the parent rule)

**Sites and locations**

- `sites`
- `locations`
- `site_peripherals` _(when ships)_

**Sync metadata itself**

- `sync_outbox` rows in `synced` state
- `idempotency_keys` past their `expires_at`

**Why these are safe**: catalog and preference data is curated by
admins, not racing with concurrent sales. Two admins editing the
same customer row at the same time is rare; when it happens, the
loser side is recoverable from the audit log. None of these
entities affect money, taxes, stock balance, or legal compliance.

The audit log entry on auto-resolution carries:

```
{
  action: 'sync.auto_resolved',
  resourceType: '<table name>',
  resourceId: '<row id>',
  metadata: {
    winner: 'local' | 'remote',
    loserSnapshot: <full row JSON>,
    detectedAt: ISO timestamp,
    resolvedAt: ISO timestamp
  }
}
```

This makes auto-resolutions reversible by an admin from the
audit log viewer.

## Alternatives Rejected

- **Last-write-wins universal** — corrupts contabilidad y rompe
  trazabilidad fiscal. Un timing accidental haría que una
  cancelación SAT sobreescriba el comprobante original.
- **CRDT merge for everything** — insufficient for financial
  integrity. Money and tax fields cannot be merged by additive
  semantics; conflicting amounts always require human judgment.
- **Block all entities for manual review** — lentitud operacional
  insostenible. Un operator no debería revisar conflictos de
  catálogo de productos cuando el sync trae un cambio menor.
- **Use timestamps with vector clocks** — adds complexity without
  fixing the integrity problem. Even with perfect ordering, a
  conflict on `sale_payments` still requires human review to
  decide which one was the actual transaction.

## Implementation Impact

- **Already in place**: shipped `sync.listConflicts` /
  `sync.pull` / `sync.resolve` with `localRecordExists`. The
  `sync_conflicts` table records `resolution: 'local_wins' |
'remote_wins' | 'merged'` and is operator-driven for high-risk
  rows today. The errorCode `SYNC_LOCAL_RECORD_MISSING` already
  exists.
- **New mapping** (): the sync contract v1 publishes a
  per-entity `conflictPolicy` field in the payload header. Values
  are `manual` (high-risk) and `auto_lww` (non-financial). The
  resolver consults this field before deciding to auto-resolve or
  enqueue a manual resolution.
- **Operations Center ()**: shows two distinct panels —
  "Conflictos pendientes (alto riesgo)" with a count and an
  action button per row, and "Resoluciones automáticas (24h)"
  with a read-only summary of the loser snapshots that landed in
  the audit log.
- **Audit log discipline**: every `auto_lww` resolution writes the
  audit row described above. The
  `audit_logs.action='sync.auto_resolved'` enum value joins the
  catalog. No row-level entity write goes through the resolver
  without producing this audit event.
- **Forbidden flows**: the resolver MUST NOT carry an automatic
  branch for any high-risk table. Adding one would silently
  violate the policy; includes a vitest assertion that
  the high-risk list above maps 1:1 to schema tables tagged
  `conflictPolicy='manual'`.

## Implementation map

- Operation journal + outbox kernel. Logs every
  resolver decision (manual or auto) in the journal so the
  Operations Center can render the timeline.
- Fiscal outbox + contingency engine. The
  `fiscal_outbox` is high-risk by definition and never
  auto-resolves.
- Sync contract v1. Introduces the per-entity
  `conflictPolicy` field and the lint that maps the lists above
  to schema tables.
- Operations Center. Renders the two panels and the
  resolution timeline.
- Backup, restore, and local security. Backup must
  preserve the conflict resolution audit history alongside sales
  / fiscal / outbox data so a restored tenant can audit its
  history.

Updated: 2026-05-02 (initial ADR set).
