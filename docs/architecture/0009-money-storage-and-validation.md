# 0009 - Money Storage and Validation

> Status: Accepted
> Date: 2026-05-25 (Step-a) → 2026-05-25 (Step-b precision invariant reinstated) → 2026-05-26 (ENG-176b currency seam + fiscal CHECK coverage) → 2026-05-26 (ENG-176c fiscal identification catalog + status enum expansion — ENG-176 thread closed)
> Owner: ENG-176a / ENG-176b / ENG-176c
> Supersedes: none

## Status Update — 2026-05-26 (ENG-176c)

The fiscal identification catalog rename and status enum expansion
landed in migration `0038_eng176c_fiscal_identification_catalog.sql`,
closing the third and final axis of the ENG-176 thread that the audit
flagged: "the catalog is hard-coded to DIAN" + "the status enum is
closed to DIAN states". The ENG-176 story arc — money precision,
currency seam, and identification catalog — is now Shipped end-to-end.

What landed:

- **Catalog rename `dian_identification_types` → `fiscal_identification_types`**
  with composite primary key `(country_code, code)`. DIAN '13' (CC) and
  SUNAT '1' (DNI) and SAT 'RFC' coexist without collision because
  every row carries its issuing country. Legacy DIAN rows back-fill
  to `country_code = 'CO'` verbatim — code / abbr / names / natural_person
  preserved.
- **`fiscal_documents.buyer_country_code TEXT NOT NULL DEFAULT 'CO'`**
  with FK to `country_catalog`. The identification FK on
  `fiscal_documents` shifts from single-column
  `buyer_tax_id_type_code → dian_identification_types.code` to
  composite `(buyer_country_code, buyer_tax_id_type_code) →
  fiscal_identification_types(country_code, code)`. Legacy
  fiscal_documents rows back-fill `buyer_country_code = 'CO'`
  (single-country MVP era through ENG-176b).
- **Multi-country seed** in
  `packages/server/src/db/index.ts:seedFiscalIdentificationTypes()`.
  Total seed grows from 10 to 23 rows: CO/10 (DIAN preserved) +
  MX/4 (SAT — RFC, CURP, IFE, PA) + PE/5 (SUNAT — DNI, RUC, CE,
  Pasaporte, no domiciliado) + CL/4 (SII — RUT, RUN, EXT,
  Pasaporte). `INSERT OR IGNORE` keeps idempotent across reboots.
- **`fiscalDocumentStatusEnum` expansion from 5 to 8 values.** The
  DIAN-native subset (`pending`, `sent`, `accepted`, `rejected`,
  `contingency`) stays canonical; three new values cover the
  acknowledgement language of every LATAM authority Puntovivo plans
  to integrate: `voided` (SAT cancelación + SII anulación + NFe
  cancelamento — terminal), `notified_correction` (SAT acuse de
  notificación de corrección — action required), and `partial_send`
  (SUNAT envío parcial — non-terminal, batch with mixed acceptance).
  Adapters map their provider-specific code to the closest canonical
  value.
- **Frontend mirror**:
  `apps/web/src/components/fiscal/FiscalStatusBadge.tsx` extends the
  `FiscalDocumentStatus` union to 8 values with tone mapping
  (`voided` → danger, `notified_correction` → warning, `partial_send`
  → primary). EN/ES i18n keys land in `fiscal.json` under
  `status.*` (neutral LATAM register, no voseo — sustantivos /
  participios).
- **Adapter integration**: the single catalog-lookup site in
  `services/fiscal/orchestrator.ts` now filters by both
  `countryCode` and `code` against the composite PK. The orchestrator
  hard-codes `buyerCountryCode = 'CO'` until ENG-156 / ENG-161 wire
  per-tenant country routing through the adapter; the seam is in
  place so future tickets only need to pass the country through.
- **Regression coverage**:
  `packages/server/src/__tests__/fiscal-identification-types-catalog.test.ts`
  (11 cases: per-country counts, DIAN row preservation, composite PK
  no-collision, composite FK enforcement on `fiscal_documents`),
  plus `packages/server/src/__tests__/fiscal-document-status.test.ts`
  (sentinel + persist-all-8 happy path). Bridge fixture in
  `migrations.test.ts` updated for the renamed table shape.

### Why "expand the enum" and not "lookup table per country"

Two options were on the table for sub-issue (4). The enum-expansion
path won on minimal blast radius: extending the union by three values
touches the schema declaration, the `FiscalStatusBadge` mirror, three
i18n keys per locale, and the FiscalStatusBadge test — nothing else.
A per-country lookup table would have required a new schema, a join
on every fiscal-document read, and a refactor of every adapter call
site. The enum stays the single source of truth; adapters do the
provider→canonical mapping inside their pack (`packs/co/`, `packs/mx/`,
`packs/cl/`) when ENG-156 / ENG-161 land.

### What stays out of scope here

- **ENG-156 (multi-currency operations)** — actually using
  `settle_currency_code` and the per-row `currency_code` to sell in
  one currency and settle in another. The schema is ready; the UX
  + FX-spread accounting + reporting belong to that ticket.
- **ENG-161 (NFe Brazil)** — Brazil fiscal documents. The catalog
  now accepts BR-country rows; the adapter pack + fiscal seeds for
  Brazil belong to that ticket.
- **Per-country adapter routing** — the orchestrator's hard-coded
  `'CO'` is the minimum viable change. Multi-country emission needs
  tenant-locale → country resolution in
  `services/fiscal/registry.ts`.

## Status Update — 2026-05-26 (ENG-176b)

The currency seam landed in migration `0037_eng176b_currency_seam.sql`,
closing the second axis ADR-0009 had deferred ("which currency is this
amount denominated in?") and the third gap left over from Step-a/Step-b
(CHECK invariants on the three fiscal-domain tables the Drizzle
snapshot chain could not emit a recreation for).

What landed:

- **`tenants.default_currency_code`** — new column, `TEXT NOT NULL`,
  FK to `currency_catalog.code`, DEFAULT `'COP'`. Back-filled by the
  migration via a COALESCE chain that walks
  `tenant_locale_settings.currency_override` →
  `country_catalog.default_currency_code` via the tenant locale's
  `country_code` → `json_extract(tenants.settings, '$.currency')` →
  `'COP'`. After this migration application code never needs to parse
  the `tenants.settings` JSON on the hot path again.
- **`currency_code` + `exchange_rate_at_sale` + `settle_currency_code`**
  on `sales`, `sale_items`, `quotations`, `quotation_items`. Each
  table carries a `chk_<table>_exchange_rate_positive` CHECK so a
  zero or negative multiplier cannot silently zero out totals. Items
  store the same triplet as their parent (no cross-row CHECK; the
  invariant is enforced at the application layer because SQLite
  cannot express it efficiently).
- **`products.currency_code`** — NOT NULL, FK, DEFAULT `'COP'`. An
  imported product priced in USD can live inside a COP tenant.
- **`customers.credit_limit_currency_code`** — nullable, FK. Set only
  when `creditLimit > 0` (the legacy "sin cupo" sentinel of `0` keeps
  the column null to avoid misleading metadata).
- **Fiscal CHECK coverage** — `fiscal_documents`,
  `fiscal_document_items`, and `payment_outbox` get their `_nonneg`
  and `_2dec` invariants in the same recreation pass that adds the
  currency seam elsewhere, closing the snapshot-chain gap Step-a/b
  documented as deferred. The defensive UPDATE prelude rounds any
  historical drift on the four signed-by-convention columns
  (subtotal, tax, discount, total on fiscal_documents; the four
  money columns on fiscal_document_items; amount on payment_outbox).
- **Canonical helper `packages/server/src/lib/currency.ts`** —
  exports `resolveTenantCurrency(db, tenantId)` (single-query
  primary-key lookup, sync — `better-sqlite3` is sync) plus an
  ergonomic `withCurrency(amount, currencyCode)` builder. The helper
  is consumed by `application/sales/completeSale.ts` (stamps every
  `sales` + `sale_items` row), `services/quotations.ts` (header +
  every item), `trpc/routers/products.ts` (defaults at create),
  `trpc/routers/customers.ts` (sets the column in lockstep with
  `creditLimit`), and `trpc/routers/sales.ts:splitDraft` (inherits
  from the source draft so a split cannot silently cross
  currencies).
- **Regression coverage** —
  `packages/server/src/__tests__/currency-seam.test.ts` (11 cases:
  backfill defaults, explicit overrides, cross-currency settle pair,
  exchange-rate CHECK rejection, multi-tenant isolation). Plus 5 new
  fiscal-table rejection cases extending
  `db-money-checks.test.ts`, including the precision-invariant
  sentinel for `fiscal_documents`, `fiscal_document_items`, and
  `payment_outbox`.

### What stays out of scope here

- **ENG-156 (multi-currency operations)** — actually using the seam
  to sell in one currency and settle in another. The infrastructure
  is in place; the UX, exchange-rate sourcing, FX-spread accounting,
  and reporting belong to that ticket.
- **ENG-161 (NFe Brazil)** — Brazil fiscal documents emitted in BRL.
  The seam is the structural prerequisite; the fiscal adapter is the
  feature ticket.
- **Per-currency exponent in `roundMoney()`** — every LATAM currency
  Puntovivo ships uses 2 decimals; CLP (0) and BHD (3) belong to the
  same refinement window as ENG-156, where the helper signature can
  evolve to `roundMoney(value, currencyCode)` reading
  `currency_catalog.decimals`.

### Behavioural notes

- Application code that previously assumed "everything is in the
  tenant's default currency" now stamps that currency explicitly at
  every write boundary. Read paths that previously inferred currency
  from the tenant (`formatCurrency(amount, tenant.currency)`) can
  continue to do so — the per-row column is forward-looking and only
  matters once a tenant operates in more than one currency.
- Migration `0037` runs inside `PRAGMA foreign_keys = OFF/ON`; the
  `currency_catalog` table may be empty at migration time (the
  `seedLocaleCatalogs()` step in `db/index.ts` runs AFTER migrations
  on a fresh install). SQLite does not re-validate FKs at PRAGMA
  toggle time, so the deferred-validation pattern is safe; the seed
  populates the catalog right after migration finishes.

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
