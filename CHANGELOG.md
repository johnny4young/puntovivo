# Changelog

All notable product changes to Puntovivo are documented here.

---

## [1.1.4](https://github.com/johnny4young/puntovivo/compare/v1.1.3...v1.1.4) (2026-06-28)


### Bug Fixes

* **desktop:** keep the event loop alive so CI packaging completes ([d1a1bf0](https://github.com/johnny4young/puntovivo/commit/d1a1bf04b15d9990588886119afa6c268e5d86f3))

## [1.1.3](https://github.com/johnny4young/puntovivo/compare/v1.1.2...v1.1.3) (2026-06-28)


### Bug Fixes

* **desktop:** build packaged app in CI via electronZipDir ([57910a0](https://github.com/johnny4young/puntovivo/commit/57910a013e24e5d1d4ee75f4db95b9cc09e642e3))

## [1.1.2](https://github.com/johnny4young/puntovivo/compare/v1.1.1...v1.1.2) (2026-06-28)


### Bug Fixes

* **desktop:** build a portable zip on every platform via MakerZIP ([a50ac14](https://github.com/johnny4young/puntovivo/commit/a50ac14afa3c1c594bfe167972e5efead123e140))

## [1.1.1](https://github.com/johnny4young/puntovivo/compare/v1.1.0...v1.1.1) (2026-06-28)


### Bug Fixes

* **desktop:** load forge config from plain JS so make resolves makers in CI ([1924842](https://github.com/johnny4young/puntovivo/commit/1924842d8b3dbc8969bb4dddb69302d4be7ceca7))

## [1.1.0](https://github.com/johnny4young/puntovivo/compare/v1.0.0...v1.1.0) (2026-06-27)


### Features

* **website:** add marketing site with i18n, theme and Pages deploy ([7b585cc](https://github.com/johnny4young/puntovivo/commit/7b585cca721b54e6d6cae5fdf92bd5a4a554df94))
* **website:** add secondary pages with client-side routing ([67ba973](https://github.com/johnny4young/puntovivo/commit/67ba9734b729fbee8604635380574b5fc4ef55b3))
* **website:** pre-render routes to static HTML for SEO ([ebafe37](https://github.com/johnny4young/puntovivo/commit/ebafe378c369dad9f8bec8b2c59c012cf3b6a35d))
* **website:** rewrite content to reflect real project state ([fff7448](https://github.com/johnny4young/puntovivo/commit/fff74486228038985ffe6d187299937d8f63a66f))


### Bug Fixes

* **website:** add favicon so the browser tab shows the Puntovivo logo ([1002cdc](https://github.com/johnny4young/puntovivo/commit/1002cdc6ae2fe2f7c7e708677d5a56fc5193cce2))
* **website:** resolve nav and footer anchor links 404 under the Pages base ([5af4793](https://github.com/johnny4young/puntovivo/commit/5af47932c16076ee5e455abc7bd4f1f28678d909))

## [2026-04-22]

### Added
- Administrators can now create, edit, duplicate, activate, and set default receipt templates for sales receipts, quotations, and fiscal DEE documents.
- Receipt templates now support configurable sections such as logos, free text, item lists, totals, payment summaries, separators, QR codes, and barcodes.
- The receipt template editor now includes a live preview so layout changes can be reviewed before saving.

### Changed
- Receipt template previews and starter layouts now follow the active application language, keeping English and Spanish output consistent.
- The login and main navigation experience now have broader bilingual coverage in English and Spanish.

---

## [0.13.0] - 2026-04-11

### Added
- Purchase history now shows the latest return activity more clearly.
- Orders now show staged receiving progress and provide faster receiving actions.
- The sync center now gives clearer visibility into retries and failures.

### Changed
- Purchase activity views now make return accountability easier to track.

### Performance
- Export-heavy screens load more efficiently.
- Route loading was optimized to reduce the initial wait when opening the app.

---

## [0.12.0] - 2026-04-09

### Added
- Users can now change their own password from the application menu.
- Sessions now recover more smoothly when temporary access expires.
- Sensitive account actions now have stronger request protection.

### Changed
- Session handling is now more secure and more resilient across normal use.
- Password changes and administrative resets now invalidate older sessions.
- Account access reacts more safely to role or tenant status changes.
- Stronger password requirements now apply to user creation, resets, and self-service password changes.

---

## [0.11.0] - 2026-04-05

### Added
- The sales interface was redesigned for a cleaner and more structured day-to-day workflow.
- Purchases now support returns with stock restoration.
- Sales now support refunds with stock restoration and reporting-safe handling.
- Companies can manage and choose logos from a dedicated logo library.
- Sales and purchases now support void workflows with stock reversal.
- The POS now includes keyboard shortcuts and faster product search.
- The checkout flow now works better on tablet-sized screens.
- Orders now support partial receiving with per-line progress tracking.
- Purchase orders can now be received directly into stock purchases.
- Teams can manage purchase orders from the application.
- The desktop app now shows update status and install controls.
- The desktop experience now includes safer offline database and sync controls.
- The sync center now supports queue processing, pull snapshots, conflict review, and resolution flows.
- Backup and restore flows now include clearer confirmations.
- Company settings now include backup and receipt-print related controls.
- The app now shows offline sync status more clearly.
- Workstation theme preferences are now preserved.
- Shared notifications, loading states, retry states, and keyboard-friendly tables were expanded across the interface.

---

## [0.10.0] - 2026-03-25

### Added
- Sites can now manage their own assigned storage locations.
- Warehouses now support a location catalog tied to product lookup.
- Customers now support commercial activity classification data.
- Customer catalogs now include stronger classification handling.
- Providers can now be assigned to categories more directly.
- Country, department, and city management is now available.

---

## [0.9.0] - 2026-03-15

### Added
- Initial purchase order and purchase management.
- Inventory management with stock views, movements, and initial inventory.
- A cashier-focused sales terminal.
- Role-based access for administrators, managers, cashiers, and viewers.
- Multi-tenant and multi-site support.
- Cross-platform desktop operation with local-first behavior.
- More reliable local data handling for everyday operation.
