# 0009 — Money storage and validation

> Status: Accepted
> Date: 2026-05-25

## Context

Puntovivo stores money in SQLite across sales, quotations, payments, cash,
inventory, fiscal documents, and customer credit. JavaScript floating-point
math and SQLite `real` columns can accumulate fractions below one cent unless
all write boundaries share a precision contract. The schema also needs explicit
currency metadata before multi-currency settlement can be supported safely.

## Decision

1. Prices and transactional amounts retain SQLite `real` values. Exact
   inventory carrying-value pools and their frozen movement/line snapshots
   additionally use integer cents; a rounded unit cost cannot reconstruct
   residual value after a fractional transformation.
2. Application write boundaries normalize values with the shared
   `roundMoney()` half-away-from-zero contract.
3. Database `CHECK` constraints enforce non-negative and two-decimal invariants
   where the domain requires them.
4. Sales, sale items, quotations, quotation items, products, and credit limits
   carry explicit currency metadata. Exchange rates must be positive.
5. `tenants.default_currency_code` references `currency_catalog`; application
   code resolves it through `packages/server/src/lib/currency.ts`.
6. Fiscal buyer identity uses the country-scoped
   `fiscal_identification_types(country_code, code)` catalog.
7. Fiscal adapters map provider-specific states to the canonical fiscal status
   union rather than expanding application logic per authority.

## Write-path invariants

- Round every line before accumulation and normalize headers before insert.
- Preserve signed semantics only for columns whose domain allows them.
- Parent and child rows use the same currency and settlement metadata.
- Cash balance updates use SQL rounding inside the write transaction.
- Tenant currency is resolved under the active tenant boundary; callers never
  infer it from another tenant or from renderer input.

## Current boundaries

The currency seam records denomination but does not yet provide exchange-rate
sourcing, operator FX workflows, spread accounting, or multi-currency reports.
CLP exponent handling and other non-two-decimal currencies also require a
currency-aware evolution of `roundMoney`. These gaps are recorded in
[`../PROJECT-STATUS.md`](../PROJECT-STATUS.md).

## Exact inventory values

Global product pools keep inventory valuation separate from commercial COGS;
lot and serial identities retain their own cost authority. Partial consumption
allocates the current pool and the final physical unit receives its remaining
cents. Frozen sale, return, transfer, procurement and count values preserve that
allocation instead of multiplying a mutable rounded unit cost later.

Stock rows and their all-pages total share the same rounded per-product value.
The expiry radar reads adopted lot cents, including known zero; only unknown
legacy values use the previous quantity-times-unit-cost calculation. Reading
either surface never adopts or rewrites historical cost evidence.

Changing stock, lot or serial tracking requires empty site balances,
reservations and value-owning identities. Zero tenant-wide stock is not enough:
offsetting site balances can still own inventory. The transaction rechecks this
boundary and rejects simultaneous anonymous stock when entering lot/serial
tracking or switching to a service.

Migration `0089_inventory_value_constraints.sql` adds row-local `CHECK`s to
the additive value fields: SQLite storage must be integer and within the exact
JavaScript integer range; revisions are non-negative safe integers; quantity
cursors are finite. Related nullable fields must be wholly unknown or wholly
present, and an explicitly empty pool cannot retain value. Historical NULLs
are not rewritten as zero. Signed global pools and movement deltas retain the
existing negative-stock policy; lot/serial values stay non-negative. The domain
transaction, not a cross-table CHECK, coordinates physical balances and pools.

SQLite rebuilds preserve product rowids, foreign-key children and the existing
search/custody triggers. Only external pharmacy FTS triggers that temporarily
refer to the rebuilt product table are removed and restored transactionally.
The migration wrapper disables FK enforcement before `BEGIN`, restores it
afterward and checks referential integrity. Invalid historical partial values
abort the migration; the application does not guess a repair or silently adopt
new financial meaning.

## Consequences

Keeping `real` for prices and existing transactional amounts preserves numeric
query ergonomics, but application rounding and database constraints must remain
aligned. Exact inventory snapshots are a bounded addition, not a general
currency-exponent migration or a rewrite of historical sales.

## Verification

The contract is pinned by the money, currency-seam, fiscal-catalog, fiscal
status, and database-check suites under `packages/server/src/__tests__/`, plus
the shared money tests in `packages/shared/src/`.
Inventory storage tests additionally execute the migrated CHECKs, preserve a
historical database with rowid gaps and child rows, exercise restored FTS and
custody triggers, and prove rollback on an incomplete historical value basis.

## Alternatives rejected

- **Unconstrained floating-point storage:** permits silent financial drift.
- **String money columns:** weakens range, aggregate, and ordering queries.
- **Immediate integer-minor-unit rewrite:** too much migration and compatibility
  risk before per-currency exponent support is complete.
- **Provider-specific fiscal status tables:** pushes authority vocabulary into
  every read surface instead of containing it in adapters.
