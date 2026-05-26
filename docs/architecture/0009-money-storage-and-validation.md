# 0009 - Money Storage and Validation

> Status: Accepted
> Date: 2026-05-25 (Step-a) → 2026-05-25 (Step-b precision invariant reinstated)
> Owner: ENG-176a
> Supersedes: none

## Status Update — 2026-05-25 (Step-b)

The precision invariant deferred in Step-a landed in Step-b. Step-b
added:

- **Canonical helper at `packages/server/src/lib/money.ts`** —
  `roundMoney(value) = Math.round((value + Number.EPSILON) * 100) / 100`.
  Six duplicate local definitions consolidated
  (`services/payments/reconciliation.ts`, `trpc/routers/cashSessions.ts`,
  `trpc/routers/reports/cash.ts`, `services/cash-session.ts`,
  `services/pricing.ts`, `services/restaurant/settings.ts`).
- **Application sweep at covered money write boundaries** —
  `application/sales/completeSale.ts` rounds per-line accumulation
  (`subtotal += lineBase; taxAmount += lineTax`) AFTER each iteration
  to defeat sub-cent stacking, and rounds the header
  `subtotal / taxAmount / discountAmount / tipAmount /
  serviceChargeAmount / total` plus every line's
  `unitPrice / discount / taxAmount / costAtSale / total` before the
  INSERT. `services/quotations.ts` mirrors the same shape. Cash
  sessions, purchases, orders, inventory, products, customer credit
  limits, and split-draft sales recomputes now normalize money before
  writes. `services/cash-session.ts:insertCashMovement` wraps the
  `expected_balance + signedAmount` UPDATE in SQL `round(..., 2)` so
  the running balance never drifts.
- **Schema restored the precision CHECK** — `moneyPositiveChecks` now
  emits BOTH `chk_<prefix>_nonneg` AND `chk_<prefix>_2dec`, and a
  reinstated `moneyTwoDecimalCheck(prefix, col)` adds the precision
  invariant to seven signed columns (sales/sale_items/quotations/
  quotation_items discounts, cash_movements.amount,
  sale_payments.amount, cash_sessions.over_short).
- **Migration `0036_eng176a_rounding_precision.sql`** recreates each
  affected table to attach the new constraints, with a defensive
  UPDATE prelude that rounds historical drift in signed columns
  (Step-a's prelude already rounded the always-positive surface).

Tests at `packages/server/src/__tests__/db-money-checks.test.ts`
extend the regression pin to precision violations on always-positive
AND signed columns. The server coverage suite stays green with both
invariants enforced.

`fiscal_documents`, `fiscal_document_items`, and `payment_outbox`
still carry no CHECK — same snapshot-chain reason as Step-a — and
will inherit both invariants when ENG-176b recreates them for
`currency_code`.

### Behavioural change in `insertCashMovement`

Step-b moved the positivity guard in
`services/cash-session.ts:insertCashMovement` from "raw input > 0" to
"rounded input > 0":

```ts
const amount = roundMoney(args.amount);
if (amount <= 0) {
  return null;
}
```

Before Step-b the guard ran against `args.amount` directly, which let
sub-cent positives (e.g. `0.001`) pass and reach the INSERT. With the
precision CHECK on `cash_movements.amount` those writes would crash;
collapsing them to `0` and skipping the row keeps the contract clean.
This is intentional — a cash movement smaller than one cent is not a
legal monetary event under the new "money columns are two decimals"
invariant. Callers that need sub-cent granularity must use a
different column type, not the `real` column under the precision
CHECK. No production caller is known to depend on the old behaviour
(every cashier UI rounds to cents before submit), but flagging here
in case a future integration is tempted to bypass `roundMoney` and
discovers the implicit drop.

## Decision

Puntovivo stores every monetary amount as a SQLite `REAL` (IEEE-754
double-precision float). Schema-level defence is layered on top via
`CHECK` invariants applied during the table-recreation pattern that
SQLite requires for adding constraints to existing columns. The
integer-minor-units alternative is documented as a future option but
not adopted today.

Step-a of this decision (ENG-176a, migration
`0035_eng176a_money_checks.sql`) shipped the `>= 0` invariant on
columns that have no legitimate negative semantics: totals, subtotals,
taxes, costs, prices, tips, service charges, opening floats, credit
limits, refund amounts. Step-b then landed the application-layer
`roundMoney()` sweep and migration
`0036_eng176a_rounding_precision.sql`, which restores the two-decimal
precision invariant (`round(col, 2) = col`) on the covered monetary
tables.

The currency exponent is hard-coded at two decimals across the
schema. ENG-176b will add `currency_code` columns to transactional
tables; at that point the precision invariant can refine to honour
`currency_catalog.decimals` per-row (JPY = 0, BHD = 3, etc.).

## Why real + CHECK and not integer cents today

The audit (`docs/AUDIT-2026-05-24.md §ENG-176`) accepts either path
for the acceptance criterion "money columns pinned by a CHECK
invariant". The trade-off the operator weighed:

| Dimension | real + CHECK (chosen) | integer minor units |
| --- | --- | --- |
| Storage layer defense against negatives | ✅ enforced | ✅ enforced |
| Storage layer defense against sub-cent drift | ✅ enforced on covered tables | ✅ enforced (type-system) |
| Blast radius across the codebase | schema + migrations only | every formatter, Zod schema, receipt renderer, ~100+ files |
| Backwards-compat with persisted data | trivial | requires lossless one-shot migration |
| Risk of regression on existing flows | minimal (recreations preserve data) | high (every monetary write touched) |
| Future path to the other approach | open — can migrate later if drift bugs surface | terminal |

For a multi-tenant LATAM POS that already ships, the lower-blast
choice ships ENG-176's storage-layer defenses without converting every
formatter, receipt renderer, or historical persisted value to integer
minor units in the same slice.

## Trade-offs

- **SQLite still stores money as IEEE-754 REAL.** The covered write
  paths now normalize values before persistence and the DB rejects
  sub-cent values on the covered tables. The remaining drift risk is
  concentrated in monetary tables deferred to ENG-176b and any future
  writer that bypasses the shared helpers.
- **A future regression that introduces a negative `total` or
  sub-cent covered money value is now blocked at the storage layer.**
  That is the concrete win Step-a plus Step-b deliver.
- **fiscal_documents, fiscal_document_items, and payment_outbox carry
  no `_nonneg` CHECK today** because the Drizzle snapshot chain
  (`meta/0001_snapshot.json` → `0035_snapshot.json`) does not list
  them — they were added by raw SQL migrations outside the snapshot
  lineage. ENG-176b will recreate these tables to add `currency_code`,
  and the CHECKs slot in at that point.
- **The bridge-build adoption shim** (`db/index.ts:ensureMigrationBaseline`)
  treats every prior migration as already applied on a legacy DB
  upgrade. This means ENG-176a's CHECKs land on FRESH installs and
  `:memory:` test DBs, NOT on existing dev/prod installations.
  Existing DBs continue to behave as before until a focused production
  rollout path applies the affected table recreations in place.
  Production rollout of ENG-176 remains gated on that bridge path —
  same gate ENG-167 carries.

## Future path: integer minor units

If sub-cent rounding bugs surface in production after the Step-b
application sweep, the next step is to migrate every monetary column
to `integer` storing cents (or the per-currency minor unit). The work
splits into:

1. Define `formatMinorAmount(value: number, currency: string): string`
   in `apps/web/src/lib/utils.ts`, replacing every direct
   `formatCurrency(value)` call site.
2. Replace `real('price')` with `integer('price_cents')` (or similar)
   across the schema; emit a one-shot migration that
   `UPDATE table SET col_cents = round(col_real * 100)` and then drops
   the legacy column.
3. Rewrite every Zod schema that validates a money input to accept
   either `value` (legacy) or `value_cents` (new) for a deprecation
   window.
4. Update receipt renderers / fiscal XML / reports to format from the
   cents column.

This is a multi-session ticket and not in scope for ENG-176 today.

## Alternatives Rejected

- **No CHECK invariants** — would leave the audit AC unmet and the
  storage layer with zero defence against negative totals.
- **Strict precision CHECK before the application sweep
  (`round(col, 2) = col`)** — caught the
  IEEE-754 drift produced by legitimate tax-exclusive math
  (`100 / 1.19 = 84.033...`) and broke 54 existing tests. Loosening
  to `abs(col - round(col, 2)) < 1e-9` still failed on 18 cases of
  legitimate non-terminating decimals from tax accumulation. Either
  form required the Step-b application sweep first.
- **TRIGGER-based enforcement instead of CHECK** — TRIGGERs add a
  per-write cost on every INSERT/UPDATE and need to be maintained
  separately from the schema. CHECK is declarative + zero-cost at
  read time, which fits Puntovivo's POS write rate.
- **Money as `text` (string of cents)** — readable but loses every
  numeric query path (`SUM`, `>`, `<`, indexes). SQLite affinity
  rules would also coerce numeric-looking strings to REAL anyway,
  defeating the contract.

## Implementation Notes

- Helpers in `packages/server/src/db/schema.ts`:
  - `moneyPositiveChecks(prefix, col)` emits both `>= 0` and
    two-decimal precision CHECKs per invocation. Used for ~40 columns
    across 17 tables.
  - `moneyTwoDecimalCheck(prefix, col)` adds only the precision CHECK
    for signed money columns where negative values are valid.
- Migration `0035_eng176a_money_checks.sql`:
  - Prelude: defensive `UPDATE` rounds historical values to two
    decimals so the companion precision migration can recreate tables
    without rejecting existing drift.
  - Body: drizzle-kit-generated table-recreation pattern, scoped to
    17 tables that own the non-negative CHECKs. The 12-step canonical
    `__new_X` → copy → drop → rename → recreate indexes pattern wraps
    around `PRAGMA foreign_keys = OFF/ON` to defer FK validation
    while the schema mutates.
- Migration `0036_eng176a_rounding_precision.sql`:
  - Adds the two-decimal precision CHECKs to the covered always-positive
    and signed money columns after the application sweep.
- Regression suite:
  `packages/server/src/__tests__/db-money-checks.test.ts` covers a
  negative reject on each always-positive category, precision rejects
  on covered always-positive and signed columns, signed negative
  allowance, and a happy-path full sale with discount + tax + tip +
  service charge.

## Forward References

- `BACKLOG.md` → `ENG-176b` (currency_code + exchange_rate on
  transactional tables).
- `BACKLOG.md` → `ENG-176c` (fiscal_identification_types catalog rename
  + `fiscal_documents.status` enum expansion).
