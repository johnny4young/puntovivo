# 0013 — Quotation conversion and supplier payables

> Status: Accepted
> Date: 2026-08-31

## Context

A quotation previously allowed a manual `converted` status without proving
that a corresponding sale existed. Even when the UI later created a sale, a
retry or concurrent register could separate inventory, cash, tax, and quote
state. Historical quotation lines also did not identify the exact unit
assignment used to compute their quantities.

Purchases prove that inventory was received; they do not prove when a supplier
issued an invoice, its due date, later credit notes, or payments. Inferring debt
from every historical purchase would manufacture financial obligations and
could not represent opening balances or documents received outside Puntovivo.

## Decision

### Quotation conversion

- New quotation lines freeze `unit_id` and `unit_equivalence` alongside their
  existing customer, site, price tier, currency, prices, discounts, and tax
  snapshots.
- `sales.create` is the only conversion command. A source quotation and source
  line id accompany the normal sale input; required serial identities remain a
  fulfillment input, not a commercial-term override.
- Inside the sale's `BEGIN IMMEDIATE` transaction, the server re-reads the
  tenant-owned quotation and requires accepted state, a valid unexpired ISO
  instant, the same site/customer/tier/currency, and exact line identity,
  quantity, unit, price, discount, and tax snapshots.
- The sale, inventory and cash effects, audit evidence, quotation status, and
  one immutable `quotation_sale_links` row commit together. Unique indexes on
  both quote and sale make the relationship one-to-one. A competing converter
  loses without a partial write. The existing sale sync enqueue and legacy
  sales Command Envelope completion remain post-commit and are not described
  as part of this SQLite transaction; a crash in that window cannot create a
  second sale, but exact replay of the original response still requires the
  sales lifecycle to adopt transactional idempotency completion.
- `converted` is no longer a manual status transition. Historical converted
  quotations remain readable, but no link is invented for them.

Migration `0051` backfills a quotation line's unit only when the product has
exactly one explicit base-unit assignment. An ambiguous historical line keeps
`NULL` and conversion fails closed rather than guessing.

### Supplier payables

- `provider_payable_invoices` records a supplier charge. Ordinary invoices may
  link one completed, same-tenant, same-provider purchase; `opening_balance`
  represents an operator-entered historical amount with an explicit note.
- `provider_payable_payments` and `provider_payable_credits` are immutable
  sources. Each must be allocated in full at creation through
  `provider_payable_allocations`; allocations cannot exceed an invoice's
  outstanding amount.
- A payment whose method is `cash` requires the operator's open cash session
  and writes a linked `paid_out` movement in the same transaction. Other
  methods never change the drawer.
- The payable balance is derived from normalized rows:
  `invoice charges - allocated payments - allocated credits`. Aging uses the
  frozen invoice due date. Document, due, payment, and credit dates are
  tenant-calendar days rather than UTC instants; aging resolves today in the
  tenant timezone. Statement order applies charges before same-day reductions
  so its running balance is deterministic.
- Migrations never derive supplier debt from purchases. Existing purchases
  appear only as candidates for an explicit invoice.
- Invoice, opening-balance, payment, and credit commands use ADR-0002's Command
  Envelope. Domain rows, allocations, audit, sync outbox, and canonical replay
  result share one transaction.
- Managers and administrators may operate supplier accounts. Provider catalog
  creation, editing, deletion, and category assignments remain administrator
  only; the manager route exposes a minimal read-only provider directory plus
  the account action. Inactive suppliers remain visible there so historical
  obligations can still be settled.

All monetary write inputs are cent-exact and use ADR-0009's `roundMoney`
boundary. Every query and parent lookup is tenant scoped; site-bearing writes
use the authenticated active site or the linked purchase's proven site.

## Consequences

- Accepted quotation terms are intentionally not editable at checkout. An
  operator must revise the quotation before acceptance rather than silently
  changing the resulting sale.
- Supplier payments recorded here are local ledger evidence. They do not claim
  that a bank transfer or external payment rail settled, and no provider
  statement or general-ledger posting is synthesized.
- The normalized ledger permits partial invoice settlement through multiple
  immutable source rows while making every source fully allocated and
  idempotent.
- A committed quotation-backed sale is discoverable through its unique link
  even if the process exits during legacy post-commit sale orchestration. Until
  the sales lifecycle adopts transactional Command Envelope completion, this
  is recovery evidence rather than a claim of exact response replay.
- The current account UI allocates payments and credits oldest-first. Source
  rows are immutable and there is no dedicated void/reversal command yet, so an
  incorrect entry cannot be silently offset with an invented supplier document;
  that correction workflow remains an explicit product gap.

## Alternatives rejected

- **Keep a manual converted status:** permits a quote to claim conversion with
  no sale, or a sale to commit after the status update fails.
- **Create a separate quotation checkout implementation:** would duplicate the
  sale transaction and let cash, fiscal, stock, serial, or lot invariants drift.
- **Backfill all missing units from the current catalog:** later catalog edits
  cannot prove the unit used by a historical quotation.
- **Treat every purchase total as supplier debt:** invents document dates,
  terms, credits, payments, and opening obligations.
- **Store one mutable supplier balance:** loses source documents, aging,
  allocation traceability, and deterministic replay.
- **Open the administrator provider page to managers:** grants unrelated
  catalog mutation rights merely to reach the payable action.

## Verification

- `packages/server/src/__tests__/quotations.test.ts`
- `packages/server/src/__tests__/provider-payables.test.ts`
- `packages/server/src/__tests__/migrations.test.ts`
- `apps/web/src/features/quotations/QuotationsPage.test.tsx`
- `apps/web/src/features/providers/ProviderPayablesModal.test.tsx`
- `scripts/e2e-baseline-cleanup.test.mjs`
- `e2e/web/quotations.spec.ts`
- `e2e/web/provider-payables.spec.ts`
- `pnpm run ci:server`
- `pnpm run ci:web`
- `pnpm run test:e2e:web`
