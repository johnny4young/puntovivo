# 0014 — Normalized sale returns and store credit

> Status: Accepted
> Date: 2026-08-31
>
> Checkout redemption and exact source-linked restoration were later completed
> by [ADR-0016](./0016-server-authoritative-promotions-and-customer-value.md).

## Context

The historical return path changed a completed sale into `refunded` and
reversed the whole ticket. It could not represent a quantity from one line,
successive returns, exact tax cents, selected lots or serials, an exchange, or
the destination of each refunded tender. Reconstructing those facts later from
the mutable catalog or a single header amount would manufacture financial and
inventory evidence.

Store credit also needs more than a mutable customer number. Issuance, later
redemption, reversal, and concurrent registers require an immutable ledger and
a balance that cannot lose updates. An exchange must not bypass ordinary sale
rules merely because it follows a return.

## Decision

### Immutable return aggregate

- A completed source sale remains immutable. Every partial or full return is a
  new `sale_returns` aggregate with normalized line, tax-component, lot,
  serial, and original-payment allocation children.
- A return planner reads the source snapshots and all prior normalized returns
  inside the write boundary. It exposes only remaining quantities and computes
  proportional subtotal, discount, tax, total, and cost with `roundMoney`.
  Successive allocations give the final return the exact remaining cents.
- Current catalog prices, tax rates, names, SKUs, tracking flags, and customer
  state cannot rewrite the historical calculation. A tracking-mode mismatch
  fails closed because the original physical provenance can no longer be
  interpreted safely.
- Legacy whole-ticket return rows remain readable through a compatibility view.
  Migration materializes normalized children only from the historical
  full-ticket contract and frozen sale evidence. If a line, tender, lot, or
  serial cannot be proven, the header remains on the bounded legacy fallback
  rather than guessing missing provenance.

### Money and customer value

- Payment destinations must sum exactly to the return total. The plan starts
  from the still-returnable amount of each frozen original tender; callers may
  redirect paid portions only to supported destinations.
- Cash requires the currently open cash session at the original sale site and
  writes its signed drawer movement in the same transaction. Credit-sale
  allocations reduce the original customer's receivable rather than creating
  cash. External/card destinations require a non-empty operator reference,
  which records evidence but does not claim provider execution.
- Issuing store credit is allowed only for a source sale with a customer. The
  account is keyed by tenant, customer, and currency; its balance advances with
  compare-and-swap while an immutable movement records the return source.
  This decision established issuance; ADR-0016 extends the same ledger with
  first-class checkout redemption and source-linked restoration.
- Existing loyalty accrual is reversed proportionally exactly once. ADR-0016
  defines redemption and the fail-closed boundary for already-spent points
  rather than hiding those semantics in this migration.

### Inventory and exchange

- Stock returns to the original sale site only. Each selected lot quantity and
  serial must be a still-returnable part of the source sale and can be consumed
  by return history only once.
- Restoring quantity does not restore sellability. Expired, quarantined, and
  future non-vendable states remain blocked. Only a still-valid `depleted` lot
  can become `active` when quantity returns.
- An exchange is a unique link from one normalized return to an independently
  completed replacement sale. The replacement passes the normal cash, stock,
  tax, pricing, approval, and idempotency rules. If the source sale has a
  customer, the replacement must use that same customer.

### Transaction, replay, and replication

- Return domain rows, inventory and customer-value effects, cash movement,
  audit evidence, sync outbox rows, canonical command-result reference, and
  idempotency completion share one `BEGIN IMMEDIATE` transaction.
- `sales.create` and `sales.completeDraft` commit their sale and changed-lot
  outbox rows before the same deferred result reference and idempotency success.
  A replication-intent failure therefore rolls back the business transaction;
  a later failure after commit can replay the exact public response without
  duplicating a sale.
- Sync contract version 2 carries the return header and immutable children as
  one canonical aggregate. Independently mutable store-credit accounts,
  movements, lots, serials, balances, and exchange links retain their own
  deterministic outbox entities. This is durable local replication intent; it
  is not a claim of complete causal apply or multi-device convergence.
- Fiscal credit-note emission, realtime broadcast, and the presentation summary
  in the operation journal happen after the domain commit. Their failures do
  not roll back money or inventory, but they require a future explicit repair
  queue before the path is described as self-healing.

## Consequences

- A sale can move from no returns to `partially_refunded` and finally
  `refunded` without destroying its original evidence.
- Reporting, receipts, fiscal snapshots, accounting exports, privacy exports,
  Companion summaries, and day close consume normalized frozen return data;
  legacy rows retain their bounded compatibility fallback.
- Exchange pricing is intentionally not netted into the return. The return and
  replacement are two auditable business documents linked for navigation and
  reconciliation.
- Store-credit issuance remains the foundation. ADR-0016 adds the tender and
  its exact return/void reversal rules without changing historical issuance.
- Same-site returns are conservative. Cross-site exchange policy, external
  payment execution, fiscal-provider credit notes, and remote causal ordering
  remain explicit product or integration gaps.

## Alternatives rejected

- **Mutate the original sale or its lines:** destroys the frozen receipt and
  makes repeated returns indistinguishable from the original transaction.
- **Calculate from current product/tax data:** later catalog changes would alter
  historical money and could make tax components fail to reconcile.
- **Store only one returned amount:** cannot prove which quantity, lot, serial,
  tender, or customer-value movement produced it.
- **Reactivate every restored lot:** quantity does not override expiry,
  quarantine, or another future safety state.
- **Treat an exchange as one net mutation:** bypasses normal sale invariants and
  hides the separate refund and replacement documents.
- **Use one mutable customer credit field:** loses provenance and permits
  concurrent registers to overwrite one another.
- **Claim that an external reference refunded a card:** local evidence cannot
  prove a payment provider moved funds.

## Verification

- `packages/server/src/__tests__/partial-returns.test.ts`
- `packages/server/src/__tests__/application-sales-returnSale.test.ts`
- `packages/server/src/__tests__/sales-command-result-ref.test.ts`
- `packages/server/src/__tests__/operation-journal.test.ts`
- `packages/server/src/__tests__/reports-accounting.test.ts`
- `packages/server/src/__tests__/migrations.test.ts`
- `apps/web/src/features/sales/RefundConfirmOverlay.test.tsx`
- `apps/web/src/features/sales/SaleDetailsModal.test.tsx`
- `e2e/web/business.spec.ts`
- `e2e/web/checkout-approvals.spec.ts`
- `e2e/electron/refund.spec.ts`
- `pnpm run ci:server`
- `pnpm run ci:web`
- `pnpm run ci:desktop`
- `pnpm run test:e2e:web`
- `pnpm run test:e2e:electron`
