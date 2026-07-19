# Changelog

All notable product changes to Puntovivo are documented here.

---

## [1.7.0](https://github.com/johnny4young/puntovivo/compare/v1.6.0...v1.7.0) (2026-07-19)


### Features

* **loyalty:** admin program card, customer ledger panel, and draft-completion customer attach ([#152](https://github.com/johnny4young/puntovivo/issues/152)) ([1aeecee](https://github.com/johnny4young/puntovivo/commit/1aeecee76a8d6180ebbbabe9e2a95ee2182297bd))
* NIT verification digit, vertical presets, schema-downgrade guard, and website SEO/lead capture ([#157](https://github.com/johnny4young/puntovivo/issues/157)) ([af2dedc](https://github.com/johnny4young/puntovivo/commit/af2dedc6d017c0fd3afbffe9792e849b5bee7d23))
* **sales:** iteration-2 band 3 — sell omnibox, cashier pace HUD, shareable day pulse (ENG-203/204/205) ([#150](https://github.com/johnny4young/puntovivo/issues/150)) ([00c4bbb](https://github.com/johnny4young/puntovivo/commit/00c4bbb3874e294080b255a4009742ae62cab3f7))
* **sales:** tunable expiry discount tiers, radar window selector, and points loyalty ([#151](https://github.com/johnny4young/puntovivo/issues/151)) ([f4ba437](https://github.com/johnny4young/puntovivo/commit/f4ba437f661adb18b1ff19a0489b88d2c48d884f))


### Bug Fixes

* **web:** server-side customer search, resilient credit-balance read, sticky virtualised header ([#153](https://github.com/johnny4young/puntovivo/issues/153)) ([c9b4a43](https://github.com/johnny4young/puntovivo/commit/c9b4a43e5826a99dc05650f943340f1a81c64332))
* **web:** translate shared components, drop dead locale fields, gate the migrations-bundle guard ([#154](https://github.com/johnny4young/puntovivo/issues/154)) ([6c250fe](https://github.com/johnny4young/puntovivo/commit/6c250fe9df1bf7a40aaff7fed8bfeb61f47dd8b7))

## [1.6.0](https://github.com/johnny4young/puntovivo/compare/v1.5.1...v1.6.0) (2026-07-12)


### Features

* ship world-class audit wave 2 ([#148](https://github.com/johnny4young/puntovivo/issues/148)) ([3851163](https://github.com/johnny4young/puntovivo/commit/3851163f49956549275fa47bc158919eb8e5a559))

## [1.5.1](https://github.com/johnny4young/puntovivo/compare/v1.5.0...v1.5.1) (2026-07-11)


### Refactors

* **ai:** migrate provider contracts to AI SDK 7 ([#144](https://github.com/johnny4young/puntovivo/issues/144)) ([234b09b](https://github.com/johnny4young/puntovivo/commit/234b09b616d1d581c8d08bfe4415b95ebe1e2d26))

## [1.5.0](https://github.com/johnny4young/puntovivo/compare/v1.4.0...v1.5.0) (2026-07-11)


### Features

* **ui:** improve responsive navigation, checkout, and accessibility ([#145](https://github.com/johnny4young/puntovivo/issues/145)) ([6751d8d](https://github.com/johnny4young/puntovivo/commit/6751d8d35f401aaf7d2101472e3d75699b3fc10c))

## [1.4.0](https://github.com/johnny4young/puntovivo/compare/v1.3.0...v1.4.0) (2026-07-10)


### Features

* **inventory:** actionable expiry radar — audited discount suggestions + POS badge (ENG-199) ([#140](https://github.com/johnny4young/puntovivo/issues/140)) ([a564fdd](https://github.com/johnny4young/puntovivo/commit/a564fddded2f0fe878b83c3b6e4732bf54517bb4))
* iteration-2 quick wins — lot sync fix, checkout sounds, live cash semaphore, margin traffic light, property tests (ENG-192..196) ([#134](https://github.com/johnny4young/puntovivo/issues/134)) ([09c020f](https://github.com/johnny4young/puntovivo/commit/09c020fdb03f3b8177263c6b1b6b456e90e2e769))
* **sales:** day-close ritual with real margin and balanced-streak (ENG-198) ([#139](https://github.com/johnny4young/puntovivo/issues/139)) ([0752509](https://github.com/johnny4young/puntovivo/commit/0752509863833a669b056e05501e0db4a552193e))
* **sales:** tenant-level blind cash close toggle (ENG-194b) ([#137](https://github.com/johnny4young/puntovivo/issues/137)) ([440ac1d](https://github.com/johnny4young/puntovivo/commit/440ac1ddc2dc87dea4c98aa8ef7eb5ba0d803d2b))


### Bug Fixes

* **sales:** harden day-close summary access ([#141](https://github.com/johnny4young/puntovivo/issues/141)) ([3bd6160](https://github.com/johnny4young/puntovivo/commit/3bd6160820de916b3d7d4900b70190e2f74074b0))


### Performance

* **inventory:** materialize the per-product stock rollup via 0008 triggers (ENG-197) ([#138](https://github.com/johnny4young/puntovivo/issues/138)) ([53b6438](https://github.com/johnny4young/puntovivo/commit/53b643808b3a2a97d78731332d49765bfd1925db))

## [1.3.0](https://github.com/johnny4young/puntovivo/compare/v1.2.2...v1.3.0) (2026-07-07)


### Features

* **inventory:** units/lots/FEFO + margin/COGS reporting core + deep-review hardening & auth rotation ([#132](https://github.com/johnny4young/puntovivo/issues/132)) ([583c9a4](https://github.com/johnny4young/puntovivo/commit/583c9a48e687012a3852a31da36b0afbb10e7c39))

## [1.2.2](https://github.com/johnny4young/puntovivo/compare/v1.2.1...v1.2.2) (2026-06-29)


### Bug Fixes

* **release:** correct web-job cache note and harden the desktop upload step ([#125](https://github.com/johnny4young/puntovivo/issues/125)) ([61dfc50](https://github.com/johnny4young/puntovivo/commit/61dfc50f51a5de929cf98ea8f8fffb973215f4e1))

## [1.2.1](https://github.com/johnny4young/puntovivo/compare/v1.2.0...v1.2.1) (2026-06-29)


### Bug Fixes

* **desktop:** forge cleanup, differential updates, smaller asar, website tests ([#123](https://github.com/johnny4young/puntovivo/issues/123)) ([31292e7](https://github.com/johnny4young/puntovivo/commit/31292e73fba045165b9852e74a90794b4f704197))

## [1.2.0](https://github.com/johnny4young/puntovivo/compare/v1.1.13...v1.2.0) (2026-06-28)


### Features

* **desktop:** auto-update via electron-updater instead of update-electron-app ([61c9474](https://github.com/johnny4young/puntovivo/commit/61c9474c60aa4a4916ee25a088796b5a7c6100db))

## [1.1.13](https://github.com/johnny4young/puntovivo/compare/v1.1.12...v1.1.13) (2026-06-28)


### Bug Fixes

* **desktop:** upload the desktop zip via gh from bash on every runner ([fe1c5f3](https://github.com/johnny4young/puntovivo/commit/fe1c5f3d7076fc10be36a5f641be9e39b8643f7c))

## [1.1.12](https://github.com/johnny4young/puntovivo/compare/v1.1.11...v1.1.12) (2026-06-28)


### Bug Fixes

* **desktop:** make the smoke asar check slash-agnostic on Windows ([98d8e27](https://github.com/johnny4young/puntovivo/commit/98d8e278a3c727425d12c9ca12ae70d8ae1d120b))

## [1.1.11](https://github.com/johnny4young/puntovivo/compare/v1.1.10...v1.1.11) (2026-06-28)


### Bug Fixes

* **desktop:** resolve the smoke repo root with fileURLToPath on Windows ([316d058](https://github.com/johnny4young/puntovivo/commit/316d058488d72b45f81fe6f483ca6cf2765caccb))

## [1.1.10](https://github.com/johnny4young/puntovivo/compare/v1.1.9...v1.1.10) (2026-06-28)


### Bug Fixes

* **desktop:** configure the github publish provider for electron-builder ([03fdf3f](https://github.com/johnny4young/puntovivo/commit/03fdf3f0bf29da7f9816e00cf7fcef34fecce85b))
* **desktop:** pin a flat electron-builder artifactName ([29b3025](https://github.com/johnny4young/puntovivo/commit/29b3025ecb118f3324c4287b73eae6cc12171a07))
* **desktop:** stop electron-builder from auto-publishing on CI ([2de712f](https://github.com/johnny4young/puntovivo/commit/2de712f306ed2e5652886373ff4c9d19a3466685))

## [1.1.9](https://github.com/johnny4young/puntovivo/compare/v1.1.8...v1.1.9) (2026-06-28)


### Bug Fixes

* **desktop:** skip @electron/get's hanging SHASUMS download in CI ([705f265](https://github.com/johnny4young/puntovivo/commit/705f265f3e2c8754c979f3d71d0dfbeb34bb2d08))

## [1.1.8](https://github.com/johnny4young/puntovivo/compare/v1.1.7...v1.1.8) (2026-06-28)


### Bug Fixes

* **desktop:** copy the native closure flat to stop the CI packaging hang ([3d06554](https://github.com/johnny4young/puntovivo/commit/3d065544207c8e1752ba0f5e17f7a3032c6286b3))

## [1.1.7](https://github.com/johnny4young/puntovivo/compare/v1.1.6...v1.1.7) (2026-06-28)


### Bug Fixes

* **desktop:** drop electronZipDir, let @electron/get fetch the packaging electron ([7ac0029](https://github.com/johnny4young/puntovivo/commit/7ac0029e7e6d72c06198d5d45fc16c27bb282eca))

## [1.1.6](https://github.com/johnny4young/puntovivo/compare/v1.1.5...v1.1.6) (2026-06-28)


### Bug Fixes

* **desktop:** package the native modules vite externalizes ([1d3775f](https://github.com/johnny4young/puntovivo/commit/1d3775fb84fc7d17d2958150ce650e9a72a2748a))

## [1.1.5](https://github.com/johnny4young/puntovivo/compare/v1.1.4...v1.1.5) (2026-06-28)


### Bug Fixes

* **desktop:** force exit after make and cap the job runtime ([be93eeb](https://github.com/johnny4young/puntovivo/commit/be93eebb414330efd1377f2bfcf3406b06b90ebd))

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
