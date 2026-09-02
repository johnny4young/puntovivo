# 0015 — Retail counts and replenishment

> Status: Accepted
> Date: 2026-08-31

## Context

A direct stock adjustment records a delta, but it cannot prove that an operator
counted a defined set of products without seeing the book quantity, submitted a
complete result for review, or reconciled against the same stock snapshot that
was current when counting began. Reusing that mutation for a physical count
would lose the workflow and make concurrent sales or receipts silently change
the meaning of the discrepancy.

Minimum stock is also only a threshold. Treating it as an automatic purchase
order would select a supplier, commit spend, or imply inbound stock without a
human business decision. Conversely, ignoring existing open orders would create
duplicate suggestions after the operator already planned replenishment.

## Decision

### Physical-count aggregate

- A count is a normalized site-owned aggregate: `inventory_count_sessions`
  stores lifecycle and actor evidence; `inventory_count_lines` freezes product,
  base unit, exact signed site on-hand, monotonic balance revision, and unit cost
  at creation. The signed book snapshot lets an operator reconcile historical
  negative stock while the physical quantity itself remains non-negative.
- The counting read redacts expected quantity, variance, and cost. Submit is
  allowed only after every line has a non-negative counted quantity and then
  freezes each discrepancy for review.
- Session and line mutations use compare-and-swap versions. `BEGIN IMMEDIATE`
  serializes creation so the same site/product cannot enter two unfinished
  sessions concurrently.
- Every runtime balance writer advances `inventory_balances.version`; this
  business revision is independent from `sync_version`, which remains transport
  metadata. Approval re-reads every authoritative site balance and its revision
  under the writer reservation. If either differs from the opening snapshot, or
  the product/base unit changed into an inactive or incompatible stock identity,
  the operation fails closed. A sale followed by a return therefore invalidates
  the count even when the net balance is unchanged. It never rebases a physical
  observation onto newer book stock.
- An approved line writes one `initial_inventory` physical-count record. Only a
  non-zero discrepancy changes `inventory_balances` and writes an adjustment
  movement. The status transition, evidence rows, audit record, manual-policy
  sync outbox, canonical command result, and idempotency completion commit in
  the same transaction. Rejection writes evidence but no stock.
- Aggregate counting accepts ordinary products and sellable variant children.
  It excludes services, variant parents, lots, and serials because a scalar
  quantity cannot reconstruct their required identities.

### Replenishment projection and draft

- A suggestion is site scoped and computes available stock as
  `max(on_hand - reserved, 0)`. Projected availability adds the remaining
  base-unit quantity from draft, submitted, and partially received purchase
  orders, subtracting linked completed receipt quantities exactly once.
- Only active stock products with a positive minimum participate. The suggested
  quantity closes the gap to that minimum; it is not a forecast, reorder point,
  safety-stock policy, or supplier recommendation.
- The operator chooses one supplier and the eligible lines. Acceptance creates
  an ordinary purchase order in `draft` status. A draft allocates its document
  number for stable audit/replay identity, but creates no stock, payable, or
  supplier-payment effect and cannot be received.
- A manager or administrator explicitly submits the draft before the existing
  order-receipt path can run. Either role may discard a draft; only an
  administrator may void a submitted order. The authorization and persisted
  status are rechecked under the writer reservation so a concurrent submit
  cannot widen manager authority.
- Lot- and serial-tracked suggestions may create a quantity-only draft because
  their physical identities do not exist until receipt. The receiving command
  requires the complete exact lot or serial allocation before it can change
  stock. Variant parents and services stay excluded.

## Consequences

- Daily stock control has auditable states rather than an unreviewed adjustment.
- A store that continues trading during a count may need to restart that count;
  correctness is preferred over silently folding later movement into the
  discrepancy.
- The same manager may count and approve in a small store. The aggregate records
  distinct actors when different people perform the steps, but this ADR does not
  mandate segregation of duties.
- Draft orders suppress duplicate suggestions while they remain active and
  reappear after discard when the projected shortage still exists.
- This design does not provide lot/serial physical counts, automated purchase
  placement, demand forecasting, supplier optimization, or external supplier
  acceptance.
- Exact lot receipt, supplier-return, transfer, and transformation provenance
  are owned by [ADR-0018](./0018-lot-procurement-and-transformations.md); they do
  not change the aggregate-count exclusion above.

## Alternatives rejected

- **Apply the count as a direct adjustment:** loses the blind worksheet,
  submission, reviewer evidence, and stale-snapshot protection.
- **Recalculate expected stock during approval:** changes the meaning of what was
  physically observed and can hide a concurrent sale or receipt.
- **Count lots or serials as one aggregate:** creates stock without proving which
  identities are present and breaks FEFO, warranty, recall, or provenance.
- **Create a submitted order directly from every shortage:** turns an advisory
  threshold into committed procurement without operator review.
- **Ignore draft/open orders:** repeatedly suggests stock already planned and can
  overstate purchasing need.
- **Let a manager void any order:** allows procurement evidence to be erased
  after commitment; only uncommitted drafts receive the broader discard rule.

## Verification

- `packages/server/src/__tests__/inventory-counts.test.ts`
- `packages/server/src/__tests__/orders.test.ts`
- `packages/server/src/__tests__/migrations.test.ts`
- `packages/server/src/__tests__/perf-store-profile.test.ts`
- `apps/web/src/features/inventory/InventoryControlPanel.test.tsx`
- `apps/web/src/features/orders/OrderDetailsModal.test.tsx`
- `e2e/web/business.spec.ts`
- `operator-journeys.json`
- `pnpm run ci:server`
- `pnpm run ci:web`
- `pnpm run test:e2e:web`
