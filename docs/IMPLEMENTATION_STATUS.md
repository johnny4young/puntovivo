# Implementation Status

> **Updated:** April 7, 2026
> **Source of truth:** Repository scan of `apps/web`, `apps/desktop`, `packages/server`, and focused test coverage

This document summarizes the current execution status of the migration roadmap in
`docs/MIGRATION_PLAN.md` and the transport migration in
`docs/TRPC_IMPLEMENTATION_PLAN.md`.

## Executive Summary

- The tRPC migration is effectively complete for production application flows. tRPC is the
  primary API transport on `/api/trpc`; `/api/health` remains as a compatibility endpoint and
  `/api/realtime/*` remains for SSE.
- The core product roadmap has advanced far beyond the original Phase 0 baseline. Foundation,
  administration, products, inventory, sales, and purchases are implemented.
- Phase 6 is in progress. The main reporting and access-control milestones are already shipped,
  while broader polish work remains.

## Phase Status

| Phase | Scope | Current status | Notes |
| --- | --- | --- | --- |
| Phase 0 | Foundation and schema alignment | Complete | Expanded schema, site context, live dashboard data, and tRPC-first transport are in place. |
| Phase 1 | Administration module | Complete | Providers, VAT rates, units, companies, sites, sequentials, users, and customer enhancements are implemented. |
| Phase 2 | Product management and pricing engine | Complete | Products support multi-price tiers, VAT/provider assignments, unit equivalence, and validated CRUD/search flows. |
| Phase 3 | Inventory module | Complete | Stock queries, movement history, adjustments, initial inventory, and physical count workflows are implemented. |
| Phase 4 | POS / sales module | Complete | Transactional sale finalization, unit normalization, VAT extraction, checkout flow, history, and receipt printing are implemented. |
| Phase 5 | Purchases module | Complete | Transactional purchase intake, purchase history, cost updates, and stock increments are implemented. |
| Phase 6 | Reporting, printing, access control, polish | In progress | Live dashboard reporting, exports, receipt printing, and role-based access control are implemented; broader UX/electron polish remains. |

## Current Implemented Surface

### Backend

- Root tRPC router assembles `auth`, `companies`, `dashboard`, `providers`, `sequentials`,
  `units`, `vatRates`, `categories`, `products`, `customers`, `purchases`, `sales`,
  `inventory`, `sites`, `sync`, and `users` in
  [packages/server/src/trpc/router.ts](/Users/johnny4young/Personal/github/open_yojob/packages/server/src/trpc/router.ts).
- Database schema and bootstrap include the migration-plan tables already in use:
  `companies`, `sites`, `providers`, `units`, `vat_rates`, `sequentials`,
  `purchase_items`, and `initial_inventory` in
  [packages/server/src/db/schema.ts](/Users/johnny4young/Personal/github/open_yojob/packages/server/src/db/schema.ts)
  and
  [packages/server/src/db/index.ts](/Users/johnny4young/Personal/github/open_yojob/packages/server/src/db/index.ts).
- Role enforcement is centralized in
  [packages/server/src/trpc/middleware/roles.ts](/Users/johnny4young/Personal/github/open_yojob/packages/server/src/trpc/middleware/roles.ts).
- Dashboard aggregates are live in
  [packages/server/src/trpc/routers/dashboard.ts](/Users/johnny4young/Personal/github/open_yojob/packages/server/src/trpc/routers/dashboard.ts).

### Web App

- The web app has live feature modules for `auth`, `dashboard`, `products`, `customers`,
  `providers`, `units`, `vat-rates`, `company`, `sites`, `sequentials`, `users`,
  `categories`, `inventory`, `sales`, and `purchases` under
  [apps/web/src/features](/Users/johnny4young/Personal/github/open_yojob/apps/web/src/features).
- Protected routing and menu visibility are role-aware through
  [apps/web/src/features/auth/ProtectedRoute.tsx](/Users/johnny4young/Personal/github/open_yojob/apps/web/src/features/auth/ProtectedRoute.tsx),
  [apps/web/src/features/auth/roleAccess.ts](/Users/johnny4young/Personal/github/open_yojob/apps/web/src/features/auth/roleAccess.ts),
  and
  [apps/web/src/components/layout/Sidebar.tsx](/Users/johnny4young/Personal/github/open_yojob/apps/web/src/components/layout/Sidebar.tsx).
- Export actions for core operational views are implemented through
  [apps/web/src/components/tables/TableExportActions.tsx](/Users/johnny4young/Personal/github/open_yojob/apps/web/src/components/tables/TableExportActions.tsx).

### Desktop

- The Electron preload and main process expose receipt printing through
  [apps/desktop/src/preload/index.ts](/Users/johnny4young/Personal/github/open_yojob/apps/desktop/src/preload/index.ts)
  and
  [apps/desktop/src/main/index.ts](/Users/johnny4young/Personal/github/open_yojob/apps/desktop/src/main/index.ts).
- Auto-update wiring exists in
  [apps/desktop/src/main/auto-updater.ts](/Users/johnny4young/Personal/github/open_yojob/apps/desktop/src/main/auto-updater.ts).

## Remaining Work

The largest remaining roadmap work is no longer core CRUD or transaction logic. The open items are
mostly Phase 6 polish and operational hardening:

- Error boundaries and richer retry UX on the web shell
- Toast/notification coverage across CRUD and workflow actions
- Additional loading-state polish beyond the currently implemented screens
- Desktop/system features such as system tray behavior, backup/restore UX, and print settings
- Ongoing documentation cleanup where older plan docs still preserve historical references

## Validation Snapshot

The latest implemented slices were already validated in this workspace with:

- `npm run test --workspace=@open-yojob/server -- dashboard`
- `npm run test --workspace=@open-yojob/server -- purchases`
- `npm run test --workspace=@open-yojob/server -- sales`
- `npm run test --workspace=@open-yojob/server -- inventory`
- `npm run test --workspace=@open-yojob/web -- --run`
- `npm run build --workspace=@open-yojob/web`
- `npm run typecheck --workspace=@open-yojob/desktop`

The web build still emits the existing large-chunk warning, but the recent feature work builds and
tests cleanly.
