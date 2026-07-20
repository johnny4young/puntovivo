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

1. Monetary values remain SQLite `real` values for the current schema.
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

## Consequences

Keeping `real` minimizes migration risk and preserves numeric query ergonomics,
but application rounding and database constraints must remain aligned. A future
move to integer minor units is possible only through an additive migration,
dual-read verification, and explicit per-currency exponent support.

## Verification

The contract is pinned by the money, currency-seam, fiscal-catalog, fiscal
status, and database-check suites under `packages/server/src/__tests__/`, plus
the shared money tests in `packages/shared/src/`.

## Alternatives rejected

- **Unconstrained floating-point storage:** permits silent financial drift.
- **String money columns:** weakens range, aggregate, and ordering queries.
- **Immediate integer-minor-unit rewrite:** too much migration and compatibility
  risk before per-currency exponent support is complete.
- **Provider-specific fiscal status tables:** pushes authority vocabulary into
  every read surface instead of containing it in adapters.
