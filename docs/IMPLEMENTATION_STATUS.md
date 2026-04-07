# Implementation Status

> **Updated:** April 6, 2026
> **Source of truth:** Repository scan of `apps/web`, `packages/server`, tests, and planning docs

This document reconciles the current codebase with the two planning documents:

- `docs/TRPC_IMPLEMENTATION_PLAN.md`
- `docs/MIGRATION_PLAN.md`

## Current State

### tRPC migration plan

| Phase | Planned state | Actual repo state |
| --- | --- | --- |
| Phase 1 | tRPC scaffolding only | Complete |
| Phase 2 | Auth router pending | Mostly complete |
| Phase 3 | Entity routers pending | Mostly complete |
| Phase 4 | Frontend page wiring pending | Partially complete |
| Phase 5 | REST removal pending | Mostly complete |

#### Evidence

- Root router includes `auth`, `categories`, `products`, `customers`, `sales`, `inventory`, and `sync` routers in `packages/server/src/trpc/router.ts`.
- Auth and collection tests were rewritten around `appRouter.createCaller(...)` in `packages/server/src/__tests__/`.
- Products, customers, sales, and inventory pages call tRPC queries directly in `apps/web/src/features/`.
- The old REST route files are gone from `packages/server/src/routes/`.

#### Remaining tRPC work

- Dashboard is still hardcoded in `apps/web/src/features/dashboard/DashboardPage.tsx`.
- Auth bootstrap is localStorage-based; it does not revalidate session via `auth.me` on startup and does not implement token refresh.
- `packages/server/src/index.ts` and `packages/server/src/standalone.ts` still expose or describe legacy transport assumptions (`/api/health`, `X-Tenant-ID`, old REST endpoint logging).
- Documentation still describes the repo as if Phases 2-5 were unstarted.

### Business migration plan

| Phase | Planned dependency | Actual repo state |
| --- | --- | --- |
| Phase 0 | Foundation and schema alignment | Incomplete |
| Phase 1 | Administration module | Not started in product terms |
| Phase 2 | Product pricing engine | Not started |
| Phase 3 | Inventory module | Not started beyond basic movements |
| Phase 4 | POS / sales | Not started beyond basic sales CRUD |
| Phase 5 | Purchases | Not started |
| Phase 6 | Reporting / polish | Not started |

#### Evidence

- `packages/server/src/db/schema.ts` still contains the initial compact schema only. The planned Phase 0 tables such as `providers`, `units`, `vat_rates`, `companies`, `sites`, and `sequentials` do not exist.
- `apps/web/src/features/tenant/TenantProvider.tsx` has no site selection logic.
- `apps/web/src/features/dashboard/DashboardPage.tsx` still uses mock data.
- Basic CRUD exists for categories, products, customers, sales, inventory, but the WinForms business model has not been migrated.

## Recommended Active Phase

The next phase to execute for the product roadmap is **Migration Phase 0**.

Reason:

- It is the first incomplete dependency in the business migration chain.
- Phase 1 and later depend on tables and concepts that do not yet exist.
- The tRPC transport migration is far enough along that it no longer blocks product work.

The current tRPC work should be treated as a **stabilization/cleanup track**, not as the main roadmap driver.

## Improved Task Breakdown

The existing migration tasks are directionally correct but too broad for execution. Use the breakdown below as the actionable backlog.

### Phase 0A: Stabilize current transport baseline

Goal: make the current tRPC-first baseline internally consistent before adding more product surface.

- Update stale docs and developer messages that still mention REST as the primary API.
- Remove legacy endpoint logging from `packages/server/src/standalone.ts`.
- Decide whether `/api/health` remains as a compatibility endpoint or is formally deprecated.
- Decide whether `X-Tenant-ID` remains supported for non-authenticated flows or should be removed from `packages/server/src/index.ts`.
- Fix the server test environment so `@open-yojob/server` tests run cleanly after native rebuild.

Exit criteria:

- Server tests pass in a correctly rebuilt environment.
- No production-facing docs claim the main API is REST-first.

### Phase 0B: Add missing foundation schema

Goal: add the minimum data model required to support the migrated WinForms workflows.

- Add tables: `providers`, `units`, `unit_x_product`, `vat_rates`, `companies`, `sites`, `sequentials`.
- Extend `products` with multi-price, VAT, provider, location, and initial-cost fields.
- Extend `sale_items` with unit and cost snapshot fields.
- Update relations in `packages/server/src/db/schema.ts`.
- Update raw DDL and database initialization in `packages/server/src/db/index.ts`.
- Update seed data in `packages/server/src/db/seed.ts`.

Exit criteria:

- New schema boots from scratch.
- Seeded database contains at least one company, one site, default VAT rates, default units, and sale/purchase sequentials.

### Phase 0C: Introduce site context

Goal: make inventory and document numbering site-aware before higher modules depend on it.

- Add current site selection to `TenantProvider`.
- Persist selected site in local storage.
- Surface the current site in the header.
- Thread `siteId` through the API context for queries and mutations that need it.
- Define fallback rules for users with a single site vs multiple sites.

Exit criteria:

- A user can switch sites from the app shell.
- Sales, inventory, and future purchases can resolve an active site deterministically.

### Phase 0D: Finish baseline live-data wiring

Goal: remove remaining mock data from the existing shell.

- Replace dashboard mock cards and lists with real aggregation procedures.
- Add explicit loading, empty, and error states to dashboard sections.
- Keep Products, Customers, Sales, and Inventory pages on tRPC, but replace placeholder action buttons with tracked follow-up tasks if forms are deferred.

Exit criteria:

- No dashboard business numbers are hardcoded.
- All currently shipped pages read from live or seeded data only.

## Phase 1 Preview

Once Phase 0 is complete, Phase 1 should be executed in this order:

1. Providers
2. VAT rates
3. Units
4. Company and sites
5. Sequentials
6. Users and customer enhancements

This order minimizes rework because products, sales, and purchases all depend on these entities.

## Known Gaps Blocking Later Phases

- No atomic sequential numbering implementation yet.
- No multi-unit stock model yet.
- No pricing engine yet.
- No purchase schema or routes yet.
- No reporting aggregation layer yet.
- No site-aware tenant context yet.

## Validation Notes

- `npm run test --workspace=@open-yojob/web -- --run` passes.
- `npm run test --workspace=@open-yojob/server -- --run` currently fails in this environment because `better-sqlite3` was built against a different Node module version. This is an environment/runtime issue, not a planning-document issue.
