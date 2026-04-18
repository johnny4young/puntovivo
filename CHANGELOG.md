# Changelog

All notable changes to Puntovivo are documented here. Follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) conventions.

---

## [Unreleased]

### Added
- i18n foundation: installed `i18next` + `react-i18next`; scaffold at `apps/web/src/i18n/` with `resolveLocale.ts` and bundled locale files
- Locale files for `en` and `es` covering `common`, `auth`, and `nav` namespaces; fallback chain `es-CO` → `es` → `en`
- Converted `LoginPage`, `Sidebar`, and `Header` to `useTranslation` — all user-visible strings on the highest-traffic screens are now localizable
- HTTP-level regression test suite (`packages/server/src/__tests__/server.test.ts`) covering tRPC batch URL routing, the `maxParamLength: 1024` fix, legacy health endpoint, and CSRF protection
- Integration test for per-line discount VAT extraction in `sales.test.ts` (discount=10% applied to a 19% VAT product, verifying subtotal, taxAmount, change, and stock decrement)
- Launch configurations (`.claude/launch.json`) for dev server preview tooling

### Docs
- Updated `TEST-PLAN.md` with 2026-04-12 execution snapshot; SALES-14 and SALES-15 marked passed after Playwright web validation
- Consolidated work plan into `docs/ROADMAP.md`; removed `IMPLEMENTATION_STATUS.md`, `OPEN_BACKLOG.md`, and `MIGRATION_PLAN.md` (strategic `PLAN.md` retained as reference)
- Codebase-alignment audit: corrected obsolete claims in `ROADMAP.md` §3 (schema `stock`/`quantity` are already `real`; removed the blocker note), annotated every open risk with its ticket ID, and added a new `ROADMAP.md` §3b "Engineering Quality Backlog" (`ENG-001` … `ENG-014`) covering E2E coverage, versioned Drizzle migrations, CI coverage thresholds, Electron sandbox, desktop CI matrix, structured logging, audit-trail expansion, auth hardening, dependency audit gate, repository-interface extraction, oversized-component decomposition, unused `zustand`, `CLAUDE.md`/`AGENTS.md` drift, and split-payment credit mix
- Fixed absolute-path links in `docs/TRPC_IMPLEMENTATION_PLAN.md` (`/Users/johnny4young/...` → `./`)
- Corrected duplicate `## 18` section numbering in `docs/PLAN.md` (Sources renumbered to `## 19`)
- Replaced the placeholder "Required review skills" table in `CLAUDE.md` and `AGENTS.md` with the real per-workspace CI scripts (`ci:web`, `ci:server`, `ci:desktop`), since the named review skills don't exist in this repo

---

## [0.13.0] - 2026-04-11

### Added
- Purchase return audit: latest return actor exposed in purchase history and audit surfaces (`feat(purchases): expose return audit metadata`)
- Quick return actions in purchase history workflow
- Staged receipt progress and quick receive actions for orders (`feat(orders): add staged receipt progress`)
- Retry and failure observability in the sync center (`feat(sync)`)

### Changed
- Purchase audit surfaces updated to show the latest return actor (`feat(purchases): show latest return actor`)

### Performance
- Excel export runtime split to remove the remaining large chunk warning (`perf(web): split excel export runtime`)
- Route modules lazy-loaded; initial app bundle trimmed (`perf(web): lazy-load route modules`)

---

## [0.12.0] - 2026-04-09

### Added
- Self-service password change modal in the user menu (`feat(auth)`)
- Auto-refresh of expired access tokens with automatic tRPC request retry (`fix(auth): auto-refresh expired access tokens`)
- CSRF protection for all cookie-authenticated tRPC mutations (`fix(security): add CSRF protection`)

### Changed
- Auth switched to in-memory access JWTs with HTTP-only refresh-cookie rotation (`fix(auth): switch to in-memory access JWTs`)
- Auth sessions now revoked after password changes and admin resets (`fix(security): revoke auth sessions after password changes`)
- Stale sessions revoked after claim changes and tenant disablement (`fix(auth): revoke stale sessions after claim changes`)
- Strong password policy enforced for user creation and resets (`fix(auth): enforce strong password policy`)
- Auth moved to HTTP-only session cookies; SSE CORS tightened (`fix(security): move auth to http-only session cookies`)

---

## [0.11.0] - 2026-04-05

### Added
- POS UI redesigned with organized Tailwind design system architecture (`feat(web): redesign POS UI`)
- Purchase return workflow with stock restoration (`feat(purchases): add purchase return workflow`)
- Sale refund workflow with stock restoration and KPI exclusion (`feat(sales): add sale refund workflow`)
- Company tenant logo library and logo selection UI (`feat(company): add tenant logo library`)
- Sale void workflow with stock reversal (`feat(sales): add sale void workflow`)
- Purchase void workflow with stock reversal (`feat(purchases): add purchase void workflow`)
- POS keyboard shortcuts and quick product search (`feat(sales)`)
- Responsive tablet checkout layout for POS (`feat(sales): add responsive tablet checkout layout`)
- Partial receiving workflow with per-line receipt tracking (`feat(orders): add partial receiving workflow`)
- Receipt of purchase orders into linked stock purchases (`feat(purchases): receive purchase orders`)
- Purchase order workflow with tRPC router and web management UI (`feat(orders): add purchase order workflow`)
- Desktop auto-update status and install controls (`feat(company)`)
- Desktop safe offline DB bridge with tenant-aware sync IPC (`feat(desktop)`)
- Sync queue processing and admin conflict management (`feat(sync)`)
- Merged conflict resolution in the sync center (`feat(sync)`)
- Sync center pull snapshots UI (`feat(sync)`)
- Backup confirmation modals for restore and sync resolution (`feat(company)`)
- Desktop database backup and restore controls (`feat(company)`)
- Desktop backup and receipt print settings (`feat(company)`)
- Offline sync banner and desktop API bridge (`feat(shell)`)
- Persisted workstation theme settings (`feat(company)`)
- Shared toast notifications for CRUD workflows (`feat(web)`)
- Shared loading and error recovery UI (`feat(web)`)
- Shared skeleton loading states for table views (`feat(web)`)
- Shared retry states for table queries (`feat(web)`)
- Keyboard navigation for shared data tables (`feat(web)`)

---

## [0.10.0] - 2026-03-25

### Added
- Site-specific location assignment management (`feat(sites)`)
- Warehouse location catalog with product lookup integration (`feat(locations)`)
- Customer commercial activity catalog and classification selects (`feat(customers)`)
- Managed customer catalogs with validated classification selects (`feat(customers)`)
- Provider category assignment management and sync support (`feat(providers)`)
- Country, department, and city geography support (`feat`)
- Native module automatic rebuild preparation for web and Electron startup (`chore(dev)`)

---

## [0.9.0] - 2026-03-15

### Added
- Initial purchase order and purchase management
- Inventory management (stock view, movements, initial inventory)
- Cashier-scoped sales terminal (POS)
- Role-based access control (admin, manager, cashier, viewer)
- Multi-tenant multi-site architecture
- Electron desktop embedding with in-process Fastify backend
- tRPC transport as canonical API layer
- SQLite + Drizzle ORM with migration runner
