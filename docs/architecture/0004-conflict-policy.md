# 0004 — Conflict Policy

**Language:** English · [Español](../es/architecture/0004-conflict-policy.md)

> Status: Accepted
> Date: 2026-05-02

## Decision

**High-risk sync conflicts (money, fiscal, cash, inventory and audit) never
resolve automatically. Operator recovery is not an exemption: a choice must
preserve the complete business aggregate or remain blocked.**

The closed entity manifest classifies `manual` versus `auto_lww`, but the latter
is a policy marker, not an implemented automatic-resolution engine. Product
rows contain stock and financial bases as well as descriptive metadata; they
cannot be treated as wholly non-financial catalog records.

Current `sync.listConflicts` and `sync.pull` expose both `localRecordExists` and
server-computed `resolutionAvailability` for local, remote and merged choices.
The UI disables unavailable actions and explains that evidence is preserved.
The mutation rechecks the same scope/payload rules under an immediate writer
transaction. A missing local row does not automatically make accepting remote
safe. Inventory-owning aggregates and product financial/tracking fields cannot
be manually reconstructed, overwritten or removed through queue JSON.

For an existing tenant product, an explicit metadata allowlist supports
operator recovery without altering stock, valuation or custody. All original
queued payloads for that entity must also be safe before replacement or
deletion; a metadata-only conflict cannot hide a protected original command.
Conflict state and replacement outbox intent commit atomically. Domain commands
and retry of their original intent remain separate from manual payload edits.
See [ADR-0005](./0005-sync-payload-contract.md) for the v4 contract and current
local-acknowledgement limitation.

---

## High-risk entities

The following core families never accept automatic resolution. Conflicts remain
`pending` and need human review; the complete classification is maintained in
`SYNC_CONFLICT_POLICY`, not inferred from this illustrative list.

**Sales and returns**

- `sales`
- `sale_payments`
- `sale_returns`
- `sale_items` (immutable snapshot; a conflict requires corruption investigation, not overwrite)

**Cash**

- `cash_sessions`
- `cash_movements`

**Fiscal**

- `fiscal_documents`
- `fiscal_document_items`
- `fiscal_numbering_resolutions`
- `fiscal_certificates`
- `fiscal_outbox`

**Operational inventory**

- `inventory_movements`
- `inventory_balances`
- `transfer_orders`
- `transfer_order_items`
- `stock_adjustments`

**Audit**

- `audit_logs` (immutable snapshot; never overwritten)

These rows form the tenant's accounting and fiscal evidence. An automatic winner
could duplicate a charge, erase a fiscal credit note, unbalance closed cash,
lose inter-site stock provenance, or break the audit chain. Human intervention
is required to preserve business meaning; timestamp ordering alone cannot do so.

---

## Non-financial entities (last-write-wins allowed)

The following catalog/preference classifications are candidates for a future
automatic-resolution engine, not a claim that one currently runs. Any such
engine must record an audit snapshot and respect financial-field and aggregate
boundaries before using a timestamp:

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
- `site_peripherals`

**Sync metadata itself**

- `sync_outbox` rows in `synced` state
- `idempotency_keys` past their `expires_at`

**Boundary**: entity names alone are not a safety proof. Product costs, taxes,
tracking modes and geography affecting business aggregates need domain-specific
validation; an administrator role does not make arbitrary field replacement
safe. The current metadata allowlist is deliberately narrower than a full row.

The required audit shape for any future auto-resolution is:

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

This proposed loser snapshot supports investigation; it does not establish an
implemented undo action or permission to mutate committed business evidence.

## Alternatives Rejected

- **Universal last-write-wins** — corrupts accounting and fiscal provenance;
  accidental ordering could overwrite an original document with cancellation.
- **CRDT merge for everything** — insufficient for financial
  integrity. Money and tax fields cannot be merged by additive
  semantics; conflicting amounts always require human judgment.
- **Block every entity for manual review** — creates unnecessary operational
  work for minor safe catalog metadata changes.
- **Use timestamps with vector clocks** — adds complexity without
  fixing the integrity problem. Even with perfect ordering, a
  conflict on `sale_payments` still requires human review to
  decide which one was the actual transaction.

## Implementation Impact

- `services/sync/contract.ts` owns entity classification, transport policy and
  independent operator-payload policy. A manifest test locks their mapping.
- `services/sync/operator-policy.ts` shares tenant/entity/payload checks between
  read capabilities and authoritative mutations.
- `trpc/routers/sync/conflicts.ts` resolves a pending conflict and replaces safe
  queue intent inside one immediate transaction, rejecting stale decisions.
- `trpc/routers/sync/queue.ts` protects manual additions and deletions; system
  writers continue through the transactional outbox helper.
- Company synchronization UI presents pending incidents and their available
  choices. No automatic-resolution timeline or remote application is claimed.
- Backup and restore preserve queue and conflict evidence along with business
  rows; restoring a snapshot does not invent a remote reconciliation verdict.

Updated: 2026-09-06 (operator recovery boundary and implementation truth).
