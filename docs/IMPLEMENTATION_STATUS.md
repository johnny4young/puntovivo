# Implementation Status

> Updated: April 10, 2026
> Source of truth: repository scan of `apps/web`, `apps/desktop`, and `packages/server`

## Executive Summary

The project is no longer in early migration. The application already runs with a broad live surface:

- tRPC-first transport is established and active.
- Core administration, catalog, product, inventory, sales, orders, and purchases flows are implemented.
- Desktop operations now include backup/restore, receipt printing, tray/theme/update settings, and sync controls.
- The remaining work is mostly hardening, deeper operational flows, performance, and edge-case coverage.

## Phase Status

| Phase | Scope | Status | Notes |
| --- | --- | --- | --- |
| Phase 0 | Foundation, schema, transport baseline | Complete | Multi-tenant schema, embedded backend, site context, and tRPC-first transport are in place. |
| Phase 1 | Administration and master catalogs | Complete | Company, sites, sequentials, users, providers, units, VAT, categories, customer catalogs, geography, locations, and logo library are implemented. |
| Phase 2 | Product management and pricing | Complete | Multi-tier pricing, product units, provider/location/VAT assignments, export support, and validated CRUD are live. |
| Phase 3 | Inventory | Complete | Stock view, movement history, adjustments, initial inventory, physical count, and low-stock reporting are implemented. |
| Phase 4 | Sales / POS | Complete | Checkout, receipt printing, responsive/mobile layout, keyboard shortcuts, void, refund, and history/detail flows are implemented. |
| Phase 5 | Procurement | Complete | Orders, partial order receiving into purchases, stock intake, supplier-side purchase returns, cost updates, and purchase void workflows are implemented. |
| Phase 6 | Reporting, sync, desktop operations, UX polish | Advanced / In progress | Dashboard reporting, exports, sync center, role guards, loading/error states, toasts, theme/tray/update settings, backup/restore, and offline UX are implemented. Remaining work is consolidated in `docs/OPEN_BACKLOG.md`. |

## Implemented Application Surface

### Backend

Current tRPC routers:

- `auth`
- `companies`
- `countries`
- `identificationTypes`
- `personTypes`
- `regimeTypes`
- `clientTypes`
- `commercialActivities`
- `dashboard`
- `departments`
- `cities`
- `logos`
- `providers`
- `sequentials`
- `units`
- `vatRates`
- `categories`
- `products`
- `orders`
- `customers`
- `purchases`
- `sales`
- `inventory`
- `locations`
- `sites`
- `sync`
- `users`

Source:
[router.ts](/Users/johnny4young/Personal/github/open_yojob/packages/server/src/trpc/router.ts)

### Web

Current route modules:

- Dashboard
- Company
- Sites
- Sequentials
- Locations
- Customer Catalogs
- Geography
- Providers
- Categories
- Units
- VAT Rates
- Products
- Orders
- Purchases
- Customers
- Sales
- Inventory
- Users

Source:
[App.tsx](/Users/johnny4young/Personal/github/open_yojob/apps/web/src/App.tsx)

### Desktop

Current desktop-only operational features:

- embedded backend lifecycle
- receipt printing bridge
- receipt print settings
- database backup and restore
- tray enablement and close-to-tray behavior
- persisted theme preference
- auto-update status, manual check, and install action
- tenant-aware sync status and trigger APIs
- allowlisted local DB bridge for desktop offline data access

## Notable Recently Landed Work

- country/department/city catalogs with provider integration
- customer commercial activity catalog
- provider category assignments
- tenant logo library with active company logo selection
- sale refunds via `sale_returns`
- revenue KPI exclusion for refunded sales
- sale detail refund UI and status display
- sync center snapshot-based UI and merged conflict resolution
- desktop backup, restore, update, tray, theme, and print settings
- purchase return history and quick-return actions from the purchases workflow
- route-level lazy loading for major web modules to reduce the initial renderer bundle
- export library splitting so Excel/PDF tooling loads on demand without tripping the previous Vite chunk warning
- sync center retry/failure metrics and oldest-queued visibility for faster operator triage
- order history receipt progress, quick receive actions, and staged-delivery guidance in order details

## Current Risks and Open Areas

The biggest remaining work is no longer CRUD coverage. It is concentrated in:

- deeper inventory modeling by site/location
- remote sync strategy hardening beyond the current retry/failure observability
- procurement edge cases beyond the live purchase-return flow and staged-delivery visibility
- desktop security hardening and operational verification
- ongoing performance cleanup and bundle hygiene
- deferred database runtime migration from `better-sqlite3` to `node:sqlite` once `node:sqlite` is no longer marked as `release candidate`
- broader integration/E2E coverage

### Deferred Technical Migration

- `better-sqlite3` to `node:sqlite` should be evaluated only after the Node API is marked stable and no longer `release candidate`.
- The server DB bootstrap in `packages/server/src/db/index.ts` would need to move away from `drizzle-orm/better-sqlite3` to the Drizzle driver/runtime that supports `node:sqlite` at that time.
- Desktop main-process code in `apps/desktop/src/main/index.ts` currently relies on the raw `$client` shape and `prepare(...).get()/all()/run()` access patterns exposed by the current SQLite client, so those direct bridge queries would need to be adapted together with the ORM migration.
- Runtime handling and docs added for dual Node/Electron native binary preparation can be removed only after the repo no longer depends on native `better-sqlite3` artifacts.

Those items are tracked in:
[OPEN_BACKLOG.md](/Users/johnny4young/Personal/github/open_yojob/docs/OPEN_BACKLOG.md)

## Validation Baseline

The current repo routinely validates changes with:

- focused server Vitest suites
- full web Vitest suite
- web production build
- desktop TypeScript typecheck

Representative commands:

```bash
npm exec --workspace=@open-yojob/server -- vitest run sales dashboard sync --reporter=dot
npm run test --workspace=@open-yojob/web -- --run
npm run build --workspace=@open-yojob/web
npm run typecheck --workspace=@open-yojob/desktop
```

The web build no longer emits the previous Vite large-chunk warning after the route-level lazy loading and export-library split work.
