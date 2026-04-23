# Changelog

All notable product changes to Puntovivo are documented here.

---

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
