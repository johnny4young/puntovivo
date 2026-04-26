# Puntovivo Roadmap

> Updated: April 21, 2026
> Single source of truth for project status, priorities, and actionable work plan.
> Replaces: `IMPLEMENTATION_STATUS.md`, `OPEN_BACKLOG.md`, `MIGRATION_PLAN.md`
> Strategic reference: see [PLAN.md](./PLAN.md) for competitive analysis, academic frameworks, and detailed technical designs.
> Architecture diagram: [architecture.svg](./architecture.svg) (source: [architecture.mmd](./architecture.mmd))

---

## 0. MVP Colombia — Definition of Done

Concrete go/no-go checklist for declaring Puntovivo **ready to be sold to a
Colombian retail business**. Derived from the April 2026 audit of features,
DIAN regulation (Resolución 000165/2023), and hardware expectations of
neighborhood retail.

| # | Capability | Status | Blocking phase |
| --- | --- | --- | --- |
| 1 | Multi-tenant POS with cash sessions, sales, returns, voids, split payments, quotations | **Shipped** | Phase 0-5 done |
| 2 | Site-owned inventory + atomic transfers with discrepancy reporting | **Shipped** | Phase 2 done |
| 3 | Audit trail on sensitive actions (void, refund, cash close, stock adjust) | **Shipped** | Tier-2 #8 done |
| 4 | **Electronic invoicing (DEE + Factura Electrónica) via DIAN-authorized PT** | **Not started** | Phase 11 (was deferred, now **P0**) |
| 5 | **CUFE/CUDE generation + QR on printed receipt + XML ≥5-year retention** | **Not started** | Phase 11 |
| 6 | **Contingency mode** (offline → queued → sent when online) for fiscal docs | **Not started** | Phase 11 |
| 7 | **Barcode scanner support** (USB HID keyboard-wedge + EAN-13 checksum) | **Not started** | Phase 12 Hardware |
| 8 | **ESC/POS thermal printer driver + cash drawer opening via RJ11** | **Not started** | Phase 12 Hardware |
| 9 | **Payment terminal integration** (manual capture exists; Bold/Wompi adapter needed) | **Partial (manual only)** | Phase 12 Hardware |
| 10 | **Park-and-resume multiple carts** (suspended sales workspace) | **Partial (backend only)** | M2 improvement |

**Overall MVP Colombia retail readiness: ~71%**. See section "Market
Segments Coverage" below for the three-ring definition (retail →
restaurant/pharmacy → services). See [PLAN.md](./PLAN.md) §Colombia for
the detailed path to close items 4-10.

---

## 1. Current State — What's Done

The application is past early migration. The core POS surface is live and operational.

### Completed Phases

| Phase | Scope | Status |
| --- | --- | --- |
| Phase 0 | Foundation, schema, transport baseline | **Complete** |
| Phase 1 | Administration and master catalogs | **Complete** |
| Phase 2 | Product management and pricing | **Complete** |
| Phase 3 | Inventory | **Complete** |
| Phase 4 | Sales / POS | **Complete** |
| Phase 5 | Procurement | **Complete** |
| Phase 6 | Reporting, sync, desktop ops, UX polish | **Advanced** |

### Implemented Surface

**Backend tRPC routers** (31 routers): health, auth, companies, countries, identificationTypes, personTypes, regimeTypes, clientTypes, commercialActivities, dashboard, departments, cities, logos, providers, sequentials, units, vatRates, categories, products, orders, customers, purchases, sales, **cashSessions** (Phase 1), inventory, locations, sites, sync, **transfers** (Phase 2), **quotations** (Phase 5), **auditLogs** (Phase 8 / Tier-2 #8), users. For the authoritative list, see [packages/server/src/trpc/router.ts](../packages/server/src/trpc/router.ts).

**Web route modules**: Dashboard, Company, Sites, Sequentials, Locations, Customer Catalogs, Geography, Providers, Categories, Units, VAT Rates, Products, Orders, Purchases, Customers, Sales, Cash Sessions, Inventory, Transfers, Quotations, Audit Logs, Users

**Desktop features**: embedded backend lifecycle, receipt printing, backup/restore, tray/theme/update settings, sync status and trigger APIs, offline DB bridge

### Unique Differentiators

- True offline-first with local SQLite
- Desktop-native Electron (no competitor offers this)
- Open source, no subscription fees, self-hosted
- Colombian/LatAm focus
- tRPC-first transport with type safety end-to-end

---

## 2. What to Build Next — Priority Order

This is the recommended implementation sequence. Each item links to its detailed phase below.

### Tier 1: Deployment Blockers (must ship before pilots)

| # | Item | Why | Phase |
| --- | --- | --- | --- |
| 1 | **i18n foundation** (es-CO/es/en) | English-only UI blocks LatAm deployment. Every new feature adds more hardcoded strings. | Pre-Phase 1 — **Shipped** |
| 2 | **Integer → real migration** for stock/quantity | Blocks ferreterías (2.5m cable) and supermarkets (0.75kg produce). #1 schema blocker. | Phase 1 — **Shipped** |
| 3 | **Cash management and shift control** | Every competitor has this. No cash session = no accountability = no LatAm retail adoption. | Phase 1 — **Shipped** |
| **3a** | **Colombia DIAN fiscal compliance** (DEE + Factura Electrónica via Proveedor Tecnológico) | **Legal blocker since May/July 2024.** Selling Puntovivo to a CO business without this creates fiscal exposure for the user and brand damage for us. See [FISCAL-INTEGRATION.md](./FISCAL-INTEGRATION.md) and [RECEIPT-TEMPLATES.md](./RECEIPT-TEMPLATES.md) (QR + CUFE on the print representation). | **Phase 11 → now P0** |
| **3b** | **POS hardware basics** (ESC/POS printer, cash drawer, barcode scanner) | Operational blocker — real stores need a physical receipt with cut, a drawer that opens, and scan-to-add. See [HARDWARE-POS.md](./HARDWARE-POS.md). | **Phase 12 → now P0** |
| **3c** | **POS touch UI + multi-surface routes** | Retail stores with all-in-one touch terminals and restaurants with KDS / customer display / mobile waiter need variant UI over the same bundle. See [UI-SURFACES.md](./UI-SURFACES.md) and [RECEIPT-TEMPLATES.md](./RECEIPT-TEMPLATES.md) for the print-layout editor that ships alongside. | **Phase 6c → P1** |

### Tier 2: Core Commercial Gaps (competitive table stakes)

| # | Item | Why | Phase |
| --- | --- | --- | --- |
| 4 | Site-owned inventory + transfers | Stock must belong to a site, not the tenant. Transfer workflows need in-transit state. | Phase 2 |
| 5 | Split payments / multi-tender | Basic expectation: pay partially with cash and card. Foundation **shipped** (`sale_payments` table, split-aware `sales.create`, split-tender UI, cash-method-only cash-session accounting). Credit-mix is deferred to Phase 5 alongside on-account sales and abonos. | Phase 5 |
| 6 | Quotations / estimates | B2B, ferreterías, service businesses all need pre-sale conversion. **MVP shipped**: `quotations` + `quotation_items` tables, `quotations.create/list/getById/updateStatus/delete` tRPC, dedicated Quotations page with status badges and draft-only delete, Blob-URL printable receipt + Electron bridge, CSV/Excel/PDF history export, and the `accepted → converted` terminal close that lets an operator mark a quote as resolved once the corresponding sale has been completed through the regular POS. Version history, margin analysis, follow-up reminders, and an auto-prefill sale flow are deferred to later steps. | Phase 5 |
| 7 | Credit sales (ventas a crédito) | Deeply embedded LatAm practice — installments, abonos, contractor accounts. | Phase 5 Ext |
| 8 | Audit trail for sensitive actions | Required for operational trust — void, refund, price override, user change. Foundation **shipped**: `audit_logs` table + transactional `writeAuditLog` helper; admin-only `auditLogs.list` tRPC with filters (action / resourceType / resourceId / actor / date range); `/audit-logs` admin page with filter bar, translated action badges, per-action summary, CSV/Excel/PDF export. **Sensitive-action coverage expanded**: `sales.void`, `sales.returnSale` (refund), `cashSessions.close` (captures over/short), and `inventory.adjustStock` (no-op delta skipped) now emit audit rows alongside the existing `transfers.void`, `quotations.delete`, `quotations.updateStatus` (convert only). `AuditSummary` renders a per-action human string for every audited surface. Remaining gaps: price override, `purchases.void`, `user.disable` — addable by calling `writeAuditLog` from those services with no schema migration. | Phase 8 |

### Tier 3: Market Differentiation

| # | Item | Why | Phase |
| --- | --- | --- | --- |
| 9 | Outbound logistics (pick/pack/ship) | Needed for any store with delivery. | Phase 3 |
| 10 | Promotions / loyalty / gift cards | Behind mainstream POS expectations. | Phase 7 |
| 11 | Colombia DIAN fiscal compliance | DEE + factura electrónica mandatory. Siigo/Alegra own this today. | Phase 11 |
| 12 | Country-parametrizable fiscal rules | Current Colombia-hardcoded logic blocks any non-CO deployment. | Phase 11 Ext |

### Tier 4: Vertical Expansion (after platform is solid)

| # | Item | Phase |
| --- | --- | --- |
| 13 | Multi-vertical module activation system | Phase 0 Foundation |
| 14 | Product variants, serial/lot/batch/expiry | Phase 6 |
| 15 | Restaurant module (tables, KDS, modifiers, tips) | Phase 12 |
| 16 | Pharmacy module (Rx, controlled substances, INVIMA) | Phase 13 |
| 17 | Supermarket module (scales, PLU, perishables) | Phase 14 |
| 18 | Ferretería module (unit conversion, project quoting) | Phase 15 |

### Tier 5: Platform Maturity

| # | Item | Phase |
| --- | --- | --- |
| 19 | Advanced reporting / BI (GMROI, ABC, CLV) | Phase 9 |
| 20 | Hybrid SQLite + PostgreSQL data topology | Phase 10 |
| 21 | Public API, webhooks, integration ecosystem | Phase 11 |
| 22 | Employee shifts, commissions, time tracking | Phase 8 |
| 23 | Transport execution (dispatch, tracking, POD) | Phase 4 |

### Market Segments Coverage — Three Rings

Puntovivo's market strategy is organized into three concentric rings. Each
ring activates via the **module activation system** (see [MODULE-ACTIVATION.md](./MODULE-ACTIVATION.md))
so a minimarket does not carry restaurant or pharmacy code at runtime.

**Ring 1 — Generic retail MVP (target: 8-10 weeks)**
- Neighborhood store, minimarket, papelería, ferretería, boutique with
  variants, carnicería/fruver with scale integration, panadería, heladería.
- Prerequisites: Tier-1 items 3a (DIAN fiscal) + 3b (hardware) + product
  variants + scale.
- Coverage goal: ~80% of Colombian retail POS market.

**Ring 2 — Restaurant + Pharmacy (target: +8-10 weeks after Ring 1)**
- Restaurant: composition/BOM + preparation lifecycle (KDS + tables +
  modifiers) + touch UI + one delivery integration (Rappi). See
  [RESTAURANT-LIFECYCLE.md](./RESTAURANT-LIFECYCLE.md) and
  [PRODUCT-COMPOSITION.md](./PRODUCT-COMPOSITION.md).
- Pharmacy/droguería: batches + expiration (Phase 7) + INVIMA code
  validation + prescription workflow.
- Coverage goal: ~35% additional market (gastronomy + pharma chains).

**Ring 3 — Service verticals (target: +12 weeks after Ring 2)**
- Salons, barbers, spas, vet clinics, workshops: shared appointments
  module + services-as-products + commissions + client assets.
- Optional extensions: gyms (subscriptions), laundromats (tickets),
  motels (rooms).

**Beyond Ring 3**: future verticals (CO + LatAm), LatAm country fiscal
expansion, cross-cutting platform features (BI, franchises, public API,
AI). See [FUTURE-VERTICALS.md](./FUTURE-VERTICALS.md),
[LATAM-EXPANSION.md](./LATAM-EXPANSION.md), and
[LONG-TERM-VISION.md](./LONG-TERM-VISION.md).

---

## 3. Open Technical Risks

### Platform Foundation

- **Fiscal rules are Colombia-hardcoded** — IVA rates, INC, propina (Ley 1935/2018), DIAN endpoints, fiscal regime codes are constants. Must become profile-driven before non-CO deployment. (Phase 11 Ext)
- **No module activation system** — prerequisite for multi-vertical support. (Phase 0)
- **Credit sales (ventas a crédito) missing** — no installment schedules, no abono posting, no configurable credit settings per tenant/company/site. (Phase 5 Ext)
- **Schema changes now flow through versioned Drizzle migrations** after `ENG-002`. `runSchemaSync()` and the raw-DDL mirror in `packages/server/src/db/index.ts` are retired; new schema work edits `schema.ts`, generates a migration, and updates the Drizzle journal. Remaining risk: non-additive migrations still need careful hand-written transition scripts and upgrade testing for existing SQLite installs. (Follow-up: `TEST-002`)

### Sync and Offline

- No formal hybrid data topology contract for local SQLite + remote authority. (Phase 10)
- Persistence is tightly coupled to SQLite-specific Drizzle and `better-sqlite3`. Repository interfaces are not yet extracted from router procedures. (Ticket `API-001` / `ENG-010`)
- Remote replication story is underspecified. (Phase 10)
- Structured logging is now in place across `packages/server` and the Electron main process, but request tracing / correlation IDs are still missing. (Follow-up to `ENG-006`)

### Security

- ~~Main `BrowserWindow` still runs with `sandbox: false`~~ — **shipped as ENG-004** (see Tier-6 table below). The main window now runs under `sandbox: true` with `contextIsolation: true` and `nodeIntegration: false`; the invariant is pinned by `apps/desktop/src/main/__tests__/window-config.test.ts` and enforced in `ci:desktop`.
- ~~`writeAuditLog` wired into only three operations~~ — **substantially shipped as ENG-007**. `writeAuditLog` now fires transactionally from `transfers.void`, `quotations.delete`, `quotations.updateStatus` (convert only), `sales.void`, `sales.returnSale`, `sales.price_override`, `cashSessions.close`, `inventory.adjustStock`, `purchases.void`, `users.create`, and `users.update` (role/isActive changes). Remaining gap: `company_credit_settings` audit, deferred until the credit-sales feature (Phase 5 Ext) lands the table.
- ~~Rate limiting only global~~ — **shipped as ENG-008 + ENG-008b**. `auth.login` has dedicated rate limits (10/IP/60s, 5-failure/username/15min) with `AUTH_RATE_LIMIT_EXCEEDED` error codes and 14 tests from ENG-008; ENG-008b promoted the counters to a DB-backed `login_attempts` table with the in-memory Maps demoted to a write-through cache so a server restart no longer wipes the buckets mid-attack.

### Testing

- `apps/desktop` has a single automated test today (`src/main/__tests__/window-config.test.ts` pinning the sandbox invariant from ENG-004). Broader desktop unit coverage is still pending; most verification is manual.
- A cross-surface E2E suite against the renderer + embedded backend + Electron bridge is partially shipped. The web Playwright suite (`npm run test:e2e:web`) now covers login, role gating, every sidebar module, Spanish localisation, responsive shell, quotations, split-payment sale details, the full transactional lifecycle for sales (complete / refund / void), purchases (complete / return / void), stock adjustments, inter-site transfers (with and without discrepancy, plus the over-receipt client-side block), opening a cash session from zero, manual paid-in cash movements, and cash-session closures (overage, shortage, balanced). 25 tests run in parallel locally and the web suite runs in CI; the local-only Electron smoke (`npm run test:e2e:electron`) covers embedded-server boot, login, dashboard, and the zero-client-issue invariant. Remaining gap: Electron-in-CI. (Ticket `ENG-001`)
- Coverage thresholds are enforced in `ci:web` and `ci:server` via `vitest --coverage --run`. Web thresholds are now `70/70/70/70` after ENG-003b shipped the 13 new + 6 extended test files closing every axis. (Tickets `ENG-003`, `ENG-003b`)

### Build / CI

- Desktop packaging for `.dmg` (macOS) and `.exe` (Windows) is still exercised exclusively via the manual `release.yml` workflow. `ENG-005` now covers `ci:desktop` on Linux/macOS/Windows, but packaging/signing regressions can still hide until release time. (Ticket `ENG-005`)
- No dependency audit (`npm audit` / Dependabot alerts) gate is wired into CI. (Ticket `ENG-009`)

### Frontend Health

- Several feature components exceed 900 lines (`ProductFormModal.tsx`, `InventoryPage.tsx`, `SalesPage.tsx`) and mix data-fetch, state, and presentation. Candidates for extraction of subcomponents + custom hooks. (Ticket `ENG-011`)
- ~~`zustand` is declared in `apps/web/package.json` but has **zero imports** in `apps/web/src/`~~ — **adopted via ENG-018b's `useCartWorkspaceStore`**. Zustand is now a live, tested dependency backing the multi-cart sales workspace (ENG-012 is Shipped). Migrating the remaining Context providers (`AuthProvider`, `TenantProvider`) stays available as a future refactor if ever desired.

### Performance and UX

- Responsive/mobile refinement is weaker in admin/maintenance screens.
- Not every screen uses the same feedback quality level yet.

---

## 3b. Engineering Quality Backlog — Cross-Cutting

These tickets don't belong to any single vertical or commercial phase. They protect the app's long-term maintainability and scalability, and should be sequenced against Tier 1–3 work rather than deferred to "someday". Each ticket is actionable in isolation and has a clear acceptance test.

**Status values** (machine-readable pool discovery):

- `Pending` — never started; eligible for next sprint.
- `Partial` — some sub-steps shipped, remainder listed at the end of the Scope cell under "Remaining:". Still eligible; the agent executes the remaining items as the ticket scope.
- `Shipped` — closed; Scope cell ends with a "Shipped: …" summary. Excluded from pool.
- `Gated` — external dependency (hardware, contract, credentials) blocks start. The gate is documented inside Scope. Excluded from pool until gate clears.
- `Deferred` — explicitly postponed by the operator, not a blocker but not in the active sprint plan. Excluded from pool.

Agents picking the next ticket read this column first, then follow the sequencing recommendation at the end of the section. New tickets are created with `Status: Pending`.

| ID | Title | Status | Scope | Acceptance | Priority |
| --- | --- | --- | --- | --- | --- |
| `ENG-001` | E2E test harness | Partial | Add Playwright against the web app + embedded backend in headless Electron. Cover: login → open cash session → create sale (split tender) → refund → close session. **Step 1 shipped**: `npm run test:e2e:web` runs a Playwright web suite against the standalone backend and Vite app. Global-setup seeds an idempotent baseline (admin/manager/cashier/viewer template users plus a secondary active site) and prunes prior-run artefacts. **Step 2 shipped**: 16 business-flow tests cover sales (complete / refund / void + split-payment details), purchases (complete / return / void), stock adjustments, inter-site transfers (discrepancy + perfect-receipt + over-receipt-blocked), cash-session opening from zero, manual paid-in movements, and cash-session closures (overage / shortage / balanced). Together with the smoke and quotations slices the suite now runs 25 tests in parallel. Every test seeds unique actors and products (random UUID suffix on email, sku, register name) so the suite is fully parallelisable. Every test attaches a client issue tracker that fails the run on unexpected console errors / page errors / 4xx-5xx responses. A `data-row-id` attribute on DataTable rows lets tests pick specific rows deterministically under parallelism. See `e2e/README.md` for the operator guide. **Step 3 shipped**: baseline helpers extracted into `e2e/shared/baseline.ts` so both runners share the same user + site seeding; new `e2e/electron/` suite launches Electron via `_electron.launch()` against a pre-seeded tmpdir DB under `test-results/electron-userdata/` with a smoke test covering login → dashboard and zero-console-error invariant; new `playwright.electron.config.ts`; new root `test:e2e:electron` + `test:e2e` scripts; new `scripts/ensure-electron-main-build.mjs` guard fails fast with an actionable message when the Vite main bundle is absent. New `e2e-web` job in `ci.yml` runs the web suite on every PR with a cached Playwright browser binary keyed on the `package-lock.json` hash and uploads `playwright-report/web` always plus `test-results/playwright-web` on failure (traces, screenshots, videos; retention 7 days). **Remaining**: Electron-in-CI — requires xvfb on ubuntu + a packaged-binary build step that `ci:desktop` does not produce today. Captured as a follow-up; the Electron suite stays local-only until the first externally-signed installer approaches. | `npm run test:e2e` green in CI on Linux; screenshots on failure uploaded as CI artifact. | **High** |
| `ENG-002` | Versioned Drizzle migrations | Shipped | Generate baseline migration from current schema. Replace `runSchemaSync()` raw DDL bootstrap with `migrate()` on startup. Retain `IF NOT EXISTS` only as a one-time adoption shim for existing installs. **Step 1 shipped**: baseline migration (`src/db/migrations/0000_0000_baseline.sql`) captures the full current schema with dynamic `(datetime('now'))` defaults; `initDatabase()` runs `drizzleMigrate()` at boot guarded by an `existsSync` check on `meta/_journal.json`; `ensureMigrationBaseline()` seeds `__drizzle_migrations` on pre-ENG-002 DBs so the baseline is not re-run against an existing schema. **Step 2 shipped**: `DatabaseOptions` / `ServerOptions` now accept a `migrationsFolder` override; `apps/desktop/forge.config.ts` ships `packages/server/dist/db/migrations` via `extraResource`; `apps/desktop/src/main/index.ts` passes `process.resourcesPath/migrations` when `app.isPackaged`, so packaged Electron builds exercise the real migrator end-to-end. A new override-path integration test in `migrations.test.ts` locks the contract. **Step 3 shipped**: `runSchemaSync()` + the `ensureColumn()` / `createIndexIfColumnsExist()` helpers are gone; `packages/server/src/db/index.ts` shrank from 1,638 to 444 lines. `drizzleMigrate()` is now the single schema path — the missing-migrations-folder branch hard-throws an actionable error instead of silently falling back. Catalog seeds hoisted into a defensive `seedCatalogs()` hook gated by table existence, so adopted DBs that skip the transitional release log an actionable warning instead of crashing. A new `migrations-parity.test.ts` pins the invariant that `drizzleMigrate` alone produces the full schema; `migrations.test.ts` gained a missing-folder-throws assertion and an adopted-DB catalog-seed assertion; `db.seed.test.ts` legacy case rewritten to validate the adoption shim's column-preservation contract. | Adding a column requires only editing `schema.ts` + `drizzle-kit generate`; re-running against an existing DB is a no-op. | **High** |
| `ENG-003` | CI coverage threshold | Shipped | Run `vitest --coverage --run` in `ci:web` and `ci:server`. Fail the job below the thresholds declared in `vitest.config.ts`. Upload LCOV. **Shipped**: both workspaces now declare enforceable v8 coverage thresholds (server 80/80/77/63 statements/lines/functions/branches; web 65/65/68/60 — the web floor replaces the previously unenforced 70/70/70/70 declaration, because the suite had drifted below). `ci:web` and `ci:server` invoke the new `test:coverage` variant that passes `--coverage`, making thresholds actually gate. `lcov` reporter is wired into both configs and `.github/workflows/ci.yml` uploads `coverage/lcov.info` as an artifact for both jobs. Follow-up `ENG-003b` tracks raising the web floor back toward 70% via new component/route tests; it is a pure test-writing effort with no CI plumbing left to do. | PR lowering coverage below threshold fails CI. | **High** |
| `ENG-003b` | Raise web coverage back to 70% | Shipped | The web floor landed at 65/65/68/60 in ENG-003 to match the actual state of the suite at the time. Write new component + route tests to bring every axis back to 70% (statements/lines/functions/branches) and then raise the thresholds accordingly in `apps/web/vitest.config.ts`. Scope is test-writing only; no CI or config plumbing change. **Shipped**: 13 new test files + 6 extended existing files closed every axis. New: `roleAccess.test.ts`, `useElectron.test.ts`, `siteSelection.test.ts`, `siteStorage.test.ts`, `authStorage.test.ts`, `AuthProvider.test.tsx`, `TenantProvider.test.tsx`, `saleHistoryExport.test.ts`, `purchaseHistoryExport.test.ts`, `quotationHistoryExport.test.ts`, `useTableExport.test.ts`, `exportService.csv.test.ts`, `utils.test.ts`. Extended: `auditLogsExport.test.ts`, `pricing.test.ts`, `defaultLayouts.test.ts`, `providerState.test.ts`, `checkoutPayment.test.ts`, `saleCart.test.ts`. Final coverage 78.64 / 79.31 / 80.16 / 70.20 (statements / lines / functions / branches) — all four above the new 70/70/70/70 floor. Branches axis was the toughest gap (61.42 → 70.20) and drove most of the test surface. Pure test-writing per the AC; the only production-code change was a defensive collateral fix to `formatDate`/`formatDateTime` returning empty string on Invalid Date (their existing call sites would have thrown on null inputs, surfaced by the new export-utility tests). | All four axes ≥ 70% in `apps/web/vitest.config.ts`. | **Medium** |
| `ENG-004` | Electron main window sandbox | Shipped | Audit every `ipcMain` handler and preload export; remove Node-only APIs from the renderer path. Flip `sandbox: true` on the main `BrowserWindow`. **Shipped**: the security-critical webPreferences now live in `apps/desktop/src/main/window-config.ts` as a single-source-of-truth constant (`MAIN_WINDOW_WEB_PREFERENCES`), and `buildMainWindowWebPreferences()` constructs the exact `BrowserWindow` shape consumed by `main/index.ts`. The bridge audit confirmed every preload export is a pure `contextBridge → ipcRenderer.invoke` wrapper (four namespaces, 29 methods), so no preload refactor was needed. A node-test regression pin in `src/main/__tests__/window-config.test.ts` asserts `sandbox === true`, `contextIsolation === true`, `nodeIntegration === false`, and that the assembled `webPreferences` object passed to `BrowserWindow` keeps those flags intact; it is wired into `ci:desktop` — a tamper-check confirmed the test fails with a clear `ERR_ASSERTION` when any field is weakened. | App boots with `sandbox: true`; all renderer→main calls still pass; add regression test that asserts `webPreferences.sandbox === true`. | **High** |
| `ENG-005` | Desktop CI build matrix | Shipped | Extend `ci.yml` to run `npm run ci:desktop` on `ubuntu-latest`, `macos-latest`, `windows-latest`. Packaging step may stay in `release.yml`, but typecheck + lint + unit tests must run on all three. **Shipped**: the `desktop` job in `.github/workflows/ci.yml` now uses `strategy.matrix.os` on all three runners with `fail-fast: false` so one OS's break does not mask the others. The other jobs (web, backend, release-automation) stay on `ubuntu-latest` because ENG-005 scopes the matrix specifically to desktop — where native modules compile per-platform and cross-OS regressions historically hid until release time. A cross-platform audit of every script that `ci:desktop` invokes (root `package.json`, server/web/desktop workspace scripts, `packages/server/scripts/copy-migrations.mjs`, `scripts/ensure-native-runtime.mjs`) found zero POSIX-only hazards — the repo was already path-portable and `ensure-native-runtime.mjs` has explicit `process.platform === 'win32'` handling. `better-sqlite3@12.8.0` and `argon2` ship prebuilt binaries for linux-x64, darwin-x64, darwin-arm64, and win32-x64, so `npm ci` does not need a native toolchain on any runner. Packaging itself (`electron-forge make`, signing) remains in `release.yml` because it needs signing material the CI runners do not carry. | CI badge reflects all three OS; a PR that breaks a Windows-only path fails CI. | **Medium** |
| `ENG-006` | Structured logging | Shipped | Replace `console.log`/`console.error` calls in `packages/server` and `apps/desktop/src/main` with a `pino` logger, namespaced per module (`sales`, `sync`, `cash-session`, …). Redact PII (emails, passwords, tokens). **Shipped**: `packages/server/src/logging/logger.ts` exports `rootLogger` plus `createModuleLogger(name)` which returns a pino child tagged `module: <name>`. Redact covers `password`, `passwordHash`, `token`, `refreshToken`, `jwtSecret`, `email`, `authorization`, `cookie`, nested `headers.*` and one-level wildcards (`*.password`, `*.token`, etc.) — matches are replaced with `[Redacted]` before pino emits. 29 server console sites + 12 Electron main sites migrated to module loggers (`auth`, `db`, `seed`, `trpc`, `server`, `sse`, `standalone`, `electron-main`, `renderer`, `auto-updater`, `backup`, `print`). Fastify adopts the shared root logger when `verbose: true` so HTTP + app logs share one NDJSON stream. Two banner call sites keep plaintext on `process.stdout.write`: the standalone startup banner and the first-run admin credentials — both are one-shot operator UX and the credentials banner deliberately bypasses the structured stream so downstream aggregators cannot leak plaintext. No pino `transport` is configured (pino-pretty's worker threads don't resolve under Electron's CJS Vite bundle); developers pipe manually via `npm run dev:server \| pino-pretty`. `no-console` ESLint rule added to server workspace and scoped to `apps/desktop/src/main/**`; tests keep their existing console allowances. 14 new unit tests in `logger.test.ts` lock the redact policy + module propagation. Level driven by `PUNTOVIVO_LOG_LEVEL` env var with `info`/`debug` defaults by `NODE_ENV`. | Logs are single-line JSON in production; `logger.child({ module: 'sync' })` works; no raw `console.*` remains outside tests. | **Medium** |
| `ENG-007` | Audit trail expansion | Partial | Call `writeAuditLog` from: `sales.void`, `sales.refund`, `purchases.void`, `users.create/disable/changeRole`, manual price overrides in `sales.create`, and any change to `company_credit_settings`. Each entry records `before`/`after` JSON where applicable. **Substantially shipped**: `sales.void`, `sales.returnSale`, `cashSessions.close`, `inventory.adjustStock`, `purchases.void`, `users.create`, `users.update` (role / isActive only), and manual price overrides in `sales.create` now all emit audit rows inside their own transaction. Only `company_credit_settings` audits remain, deferred until the credit-sales feature (Phase 5 Ext) lands that table. | Unit test per site asserts an `audit_logs` row is written with the correct `action` + `resource_type`. | **High** |
| `ENG-008` | Auth hardening | Shipped | Rate-limit `auth.login` specifically (per IP and per username). Lock-out escalation after N failed attempts. Document the policy in `docs/SECURITY.md`. **Shipped**: `packages/server/src/security/loginRateLimit.ts` carries two in-memory TTL buckets — 10 attempts per IP per 60 seconds and 5 failed attempts per username per 15 minutes. Both buckets increment on every unauthorized branch (user not found, disabled user, wrong password, disabled tenant); a successful login clears the username bucket while the IP bucket decays via TTL so a single legitimate login cannot amnesty a stuffing source. `auth.login` throws `TOO_MANY_REQUESTS` with `errorCode: AUTH_RATE_LIMIT_EXCEEDED` and `details: { kind, key, max, secondsUntilReset }` when either cap is hit. 14 new tests (10 service units + 4 integration scenarios incl. the 50-bad-logins acceptance gate) join the suite. `docs/SECURITY.md` documents policy, attack coverage, and future hardening tracked as `ENG-008b` for DB-backed persistence. | Load test: 50 bad logins from one IP returns `429` before the 60-second window completes. | **Medium** |
| `ENG-008b` | Persistent login rate-limit state | Shipped | ENG-008 used in-memory buckets that a server restart wiped. Promote the `loginRateLimit` service to read/write from a `login_attempts` Drizzle table so multi-tenant cloud deployments survive restarts and can observe attack telemetry historically. Keep the current in-memory fast path as a cache to avoid DB round-trips per login attempt. **Shipped**: new `login_attempts` table (migration `0006_login_attempts.sql`) keyed on `(kind, key)` with an `expires_at` index — intentionally NOT tenant-scoped so one IP hammering many tenants still trips the global cap. `packages/server/src/security/loginRateLimit.ts` rewritten to accept a `DatabaseInstance` on every call, with the Maps demoted to a write-through cache (reads fall back to the DB, writes upsert the row first and then mirror the state). Adopted-DB safety: a table-existence check logs one warning and falls back to cache-only if `ensureMigrationBaseline()` pinned the journal before 0006 ran. 11 unit tests in `loginRateLimit.test.ts` exercise the full service against `:memory:`; new `loginRateLimit-persistence.test.ts` boots against a tmpdir file, saturates the username cap, restarts via `closeDatabase() + initDatabase()`, and asserts the next attempt still throws `AUTH_RATE_LIMIT_EXCEEDED`. `auth.test.ts` gains a DB-row assertion covering the persistence contract. Docs synced: `SECURITY.md` "Persistence and restart behavior" section describes the cache-plus-DB model; the hardening list drops the now-closed ENG-008b bullet. | Attacker tripping the username cap, server restart, next attempt still 429. | **Medium** |
| `ENG-009` | Dependency audit gate | Shipped | Add `npm audit --production --audit-level=high` to `ci:web`, `ci:server`, and `ci:desktop`. Add a Dependabot config in `.github/`. **Shipped**: a new `ci:audit` script at the root runs `npm audit --production --audit-level=high` and is composed as the first step of every per-workspace CI script, so a new HIGH or CRITICAL CVE in any production dep fails CI immediately. Three pre-existing prod vulns (fast-jwt critical, fastify high, dompurify moderate) were cleared via a minimal `npm update fastify fast-jwt dompurify` bump that preserved npm workspace hoisting (the brute-force `npm audit fix` approach broke it). `.github/dependabot.yml` was rewritten to drop a stale `gomod` entry for the long-gone `/backend` module, and now opens grouped monthly npm PRs (production + development buckets; react / tanstack sub-groups) and weekly grouped github-actions PRs. Electron and `@electron-forge/*` are explicitly excluded from Dependabot because each bump requires a manual packaged smoke. Tamper-check against the pre-bump lockfile confirmed `npm run ci:audit` exits 1 with the three vulns — the gate fires, not just passes. `docs/SECURITY.md` carries the policy and threshold rationale. | A new transitive dependency with a known `high` CVE fails CI. | **Medium** |
| `ENG-010` | Repository interfaces (Phase 10 prep) | Pending | Extract persistence from routers into per-domain repository interfaces (`SalesRepository`, `InventoryRepository`, …) implemented today by a Drizzle-SQLite adapter. Keeps routers dialect-neutral. | All router procedures touch the DB exclusively through an interface; no router imports `better-sqlite3`. | **Medium** |
| `ENG-011` | Break up oversized components | Pending | Split `ProductFormModal.tsx` (960 l), `InventoryPage.tsx` (935 l), `SalesPage.tsx` (581 l), `QuotationCreateModal.tsx` (567 l), and `sales.ts`/`purchases.ts` server routers (1.4–1.6 k l) into focused subcomponents + custom hooks + per-sub-feature service files. No file over ~400 lines without justification. | Touched files drop below 400 l; behavior parity covered by existing + new unit tests. | **Medium** |
| `ENG-012` | Remove or adopt `zustand` | Shipped | Zustand is declared in `apps/web/package.json` but has zero imports. Either delete the dependency or migrate the two Context providers (`AuthProvider`, `TenantProvider`) that would benefit from it. **Shipped (closed as a no-op during ENG-016 docs audit)**: the "zero imports" premise is stale — ENG-018b shipped `useCartWorkspaceStore.ts` with Zustand (`import { create } from 'zustand'` + `persist` middleware), actively consumed by `SalesPage.tsx`, `SuspendedSalesPanel.tsx`, `AuthProvider.tsx` (for `resetAllWorkspaces` on logout), and the store's own tests. The dependency is legitimately adopted, so the AC's "either delete or adopt" is satisfied by the adopt branch. The AuthProvider/TenantProvider context-based design still works fine today and does not block any operator workflow — migrating them to Zustand is now a future refactor ticket (if ever raised) rather than a gate on this one. | Either `zustand` is gone from `package.json`, or both providers are refactored to a Zustand store with tests. | **Low** |
| `ENG-013` | Consolidate `CLAUDE.md` / `AGENTS.md` | Shipped | The two files are byte-for-byte duplicates in spirit but evolve separately. Keep `CLAUDE.md` as canonical and make `AGENTS.md` a one-line pointer, or vice versa, to remove drift. **Shipped (closed as a no-op during ENG-016 docs audit)**: the consolidation is already in place — `CLAUDE.md` is a filesystem symlink to `AGENTS.md` (verified via `ls -la`; line 5 of `AGENTS.md` explicitly documents it: "`CLAUDE.md` is a symlink to this file, so both tools see the same source of truth. Edit `AGENTS.md` directly."). The symlink enforces single-source-of-truth at the filesystem level — a divergence would require actively replacing the symlink with a regular file, which shows up as a file-mode change in `git diff` and is caught at review time. A dedicated CI check is overkill given the symlink invariant; if stricter enforcement is ever desired it can be tracked as a new follow-up. | A single source of truth remains for operational guidance; CI fails if the two files diverge. | **Low** |
| `ENG-014` | Split payments — credit mix | Pending | Current `sale_payments` covers cash + card + transfer split tender. Extend to mix on-account installments with immediate tender (needed for layaway / "abono a crédito"). | `sales.create` accepts `credit` + `cash` in the same payload; the sale becomes partial-credit and the `credit_sales` ledger is created only for the credit portion. | **Medium** |
| `ENG-015` | Dev seed command | Shipped | Single command that loads a realistic multi-site / multi-user / multi-product dataset into a fresh dev install so QA, demos, and reproducible bug repros do not need manual catalog clicking. Detailed spec: [DEV-SEED.md](./DEV-SEED.md). Dev-only; refuses to run in production. **Shipped**: `seedDevData()` creates the `demo-co` tenant isolated from `default`, with 6 role-mixed users sharing `Admin123!Dev`, 2 sites with site-specific sequential prefixes (`VTA-N-` / `VTA-S-`), 50 products with 60/40 per-site stock, 30 Colombian customers, 3 receipt templates, and ~20 historical sales per cashier across a closed + an open cash session. CLI entry at `packages/server/src/scripts/seed-dev.ts` with production guard, `SEED_PRESET=default\|large`, `SEED_RESET=true`, and `SEED_TARGET=desktop` (resolves Electron userData for macOS/Linux/Windows). Tests cover row counts, stock = Σ(inventory_balances) invariant, argon2 login roundtrip, idempotent short-circuit, and cross-tenant isolation. | `npm run seed:dev` populates 1 tenant, 2 sites, 6 users, 50 products, 30 customers, 5 providers, ~40 historical sales, 6 purchases, 5 quotations, and 1 receipt template per kind. Idempotent without `--reset`. | **Medium** |
| `ENG-016` | Receipt templates editor UX pass | Partial | Follow-up improvements tracked in [RECEIPT-TEMPLATES.md](./RECEIPT-TEMPLATES.md) §Follow-up improvements after the Iter 2 release: drag-and-drop reorder with animation, `{{autocomplete}}` + syntax highlighting + auto-close pairs in `text.value`, template functions (`limit`, `max`, `currency`, `date`, …), bindings captions for `itemsTable` and `totalsBlock`, a Puntovivo-branded footer atomic block, explicit variable-resolution error markers in the preview, and block-move animation. Pulls design cues from JasperReports / Crystal / Siigo / Metabase. **Shipped (pass 1)**: items 4, 5, 6 landed together. Item #4 — bindings captions above `itemsTable` (permanent) and `totalsBlock` (collapsible explainer) keyed off new i18n strings under `receiptTemplates.editor.blockFields`. Item #5 — new `appFooter` atomic block type in the Zod discriminated union + renderer case (`services/receipt-renderer.ts APP_FOOTER_METADATA`) that emits `Puntovivo <version>`, URL, and support contact in HTML + ESC/POS; soft-hidden by `show: false`; included in every default preset (editor starter layouts + dev seed) with a toggle in the editor form. Item #6 — small framework-agnostic FLIP helper at `apps/web/src/lib/flipAnimate.ts` wired into `ReceiptTemplateEditor.moveBlock` so `↑`/`↓` presses animate each card to its new position over 180ms, short-circuits instantly under `prefers-reduced-motion: reduce`. 3 new server tests + 9 FLIP-helper tests + 2 defaultLayouts assertions + 5 editor component tests; en + es i18n updated in neutral LATAM Spanish. **Shipped (pass 2)**: item #1 — drag-and-drop reorder via `@dnd-kit/sortable`. Adopted `@dnd-kit/core` + `@dnd-kit/sortable` (~8kB gzipped) and wrapped the block list with `<DndContext>` + `<SortableContext>` (vertical strategy + `PointerSensor` with 4px activation + `KeyboardSensor` with `sortableKeyboardCoordinates`). New internal `SortableBlockRow` attaches the drag listeners to a dedicated `GripVertical` icon so the row title stays clickable and the `↑/↓` buttons + trash button keep working as the a11y fallback. `<DragOverlay>` portal renders the dragged-card clone for visual continuity. `onDragEnd` routes through a new `moveBlockTo(fromIndex, toIndex)` helper that captures a FLIP snapshot before the state mutation so pass-1's `flipAnimate` plays the post-drop landing transition. New i18n keys under `editor.dragAndDrop.*` (en + es neutral LATAM). Three new component tests pin grip aria-label presence, `data-flip-key` survival across the wrapper, and `↑/↓` button coexistence. **Shipped (pass 3)**: item #3 — template functions. New `services/template-expression.ts` ships a recursive-descent parser, AST evaluator, and 12-function whitelist (`currency`, `date`, `upper`, `lower`, `round`, `limit`, `concat`, `default`, `abs`, `max`, `min`, `sum`). `currency()` reuses the renderer's `formatReceiptAmount` so it inherits ENG-017's tenant-locale formatting; `date()` defaults to the tenant's `dateFormatShort` (now exposed on `ReceiptRenderLocale`) with a `yyyy MM dd HH mm ss` mini-DSL. Zod refinement walks the AST, rejecting unknown functions, wrong arity, unknown namespaces, and `concat("javascript:", …)` scheme bypasses on `qr.source`. Defense-in-depth: `lookupPath` swapped from `in` to `Object.prototype.hasOwnProperty.call` so prototype-chain segments cannot leak; the evaluator re-checks arity before dispatch; `currency`/`round` clamp decimals to 20 to keep `Math.pow(10, n)` finite. HTML escape boundary preserved (escape runs after concat). Editor: a collapsible `<details>` "Available functions" cheat-sheet now sits below the `text.value` textarea, listing each function's signature + translatable description + canonical example. 12 new server-rendering tests (HTML, ESC/POS, escape boundary, Zod rejections, default-preset regression) plus 46 expression-engine tests (tokenizer, parser, evaluator per function, validator per failure mode, prototype-chain / arity / decimals-clamp regressions) plus 2 new editor component tests. Conditional family (`if/eq/gt`) deliberately deferred per the spec's "(later)" tag. **Remaining**: items 2 (text authoring UX — autocomplete + pair-close + syntax highlighting; will introspect the same `FUNCTION_REGISTRY`), 7 (explicit error markers, builds on #2 — can highlight on `ValidationIssue.raw`). Item 8 covers low-priority ideas that stay parked. | All eight items in RECEIPT-TEMPLATES.md §Follow-up improvements land with the matching tests and i18n. | **Medium** |
| `ENG-017` | Country / locale / currency configuration | Shipped | `formatCurrency()` currently defaults to `USD` regardless of tenant locale, so a Colombian tenant sees totals render as `0,00 US$` instead of `$ 0 COP`. Build a global `country_catalog` + `currency_catalog` (seeded with LATAM + USA, 21 countries / 18 currencies) + per-tenant `tenant_locale_settings` that bundles language, currency, symbol, decimals, timezone, date format, first-day-of-week, and the locally-expected tax-ID types. Every formatter (`formatCurrency`, `formatDate`, receipt renderer, fiscal doc emitter, quotation PDF) reads the active tenant's resolved locale through one helper instead of using hardcoded defaults. Add an admin "Locale & currency" section on Company with a live-preview strip. Full spec + country matrix in [LOCALE-CURRENCY.md](./LOCALE-CURRENCY.md). **Shipped**: migration 0003 adds the 3 catalog tables, `services/tenant-locale.ts` resolves per-tenant locale with override-shadow logic + US/USD fallback, `receipt-renderer.ts` formats currency amounts through the resolved locale, `tenantLocale` tRPC router exposes `get`/`update`/`listCountries`/`listCurrencies`, `LocaleProvider` wires a module-level singleton that the ~140 call sites of `formatCurrency` pick up without touching each call site, `CompanyLocaleSettingsCard` ships the admin picker with country dropdown + overrides + live-preview strip. Dev seed sets `demo-co` to `countryCode='CO'`. 9 server resolver tests + 3 card tests + locale-parity green. | A tenant with `countryCode='CO'` renders all currency displays as COP with 0 display decimals and `dd/MM/yyyy` dates; `countryCode='US'` stays as USD / MM/dd/yyyy; switching the setting invalidates the resolver cache and propagates to every page without a reload. | **Medium** |
| `ENG-018` | Sales park-and-resume (Iter 6) | Shipped | Backend supports `status='draft'` on sales but the UI has no affordance. Build `sales.suspend`, `sales.resume`, `sales.listDrafts`, `sales.discardDraft` procedures with suspendedAt/suspendedBy/suspendedLabel columns and per-cashier lock (manager override). Add a Zustand `useCartWorkspace` persisted per user for multi-cart workflow, a `SuspendedSalesPanel`, a "Suspender" button in `SalesCheckoutPanel`, and `Ctrl+P` / `Ctrl+R` shortcuts with input-focus guard. Warn when closing a cash session with outstanding drafts. Full per-commit spec in [SPRINT-PLAN.md §3](./SPRINT-PLAN.md). **Shipped** across 5d8f720 (server procedures), 05eea2d (audit labels for park/resume), 38e2a47 (ENG-018c server — `completeDraft` + `discardDraft` stock reversal), and the ENG-018b diff (Zustand multi-cart workspace, `SuspendedSalesPanel`, Suspend / New sale buttons, `Ctrl+P` / `Ctrl+R` / `Ctrl+Shift+P` shortcuts, SalesHistoryTable row-selection, `CashSessionCloseModal` drafts warning, E2E round-trip covering cart A → suspend → cart B → charge B → resume A → charge A). | Cashier creates cart A, suspends, creates cart B, charges B, resumes A, charges A. Both complete. Stock decrements correctly per site. Two cashiers cannot resume the same draft concurrently. | **High** |
| `ENG-019` | Sales receipt reprint (Iter 7) | Shipped | Server `sales.getForReprint({ saleId, reason?, reasonDetail? })` landed in 5d8f720 with `reprintCount` / `lastReprintedAt` / `lastReprintedBy` columns, `sale.reprint` audit rows carrying reason + ordinal count in metadata, and role-aware permissions (cashier limited to active cash session, manager/admin unrestricted). UI ship in 05eea2d adds a prominent reprint action in `SaleDetailsModal` with a reason-picker modal (paper_out / customer_request / prior_print_error / other + free-text detail), a pluralised history banner when `reprintCount > 0`, and full en + es localisation. The admin audit viewer surfaces the new action with a one-line summary derived from metadata. Reuses the Iter 2 receipt renderer directly — no duplication. **Follow-up (optional)**: row-level `Reimprimir` action in `SalesHistoryTable` and the `Ctrl+Shift+P` shortcut depend on ENG-018's Ctrl-guard lift and will land together; the modal entry point already covers the operator flow. | Admin completes a sale, navigates to history, reprints; DB row shows `reprintCount = 1` and an audit row with `action = 'sale.reprint'` exists. Cashier cannot reprint another cashier's past-shift sale. | **High** |
| `ENG-018b` | Sales park-and-resume UI (follow-up to ENG-018) | Shipped | Deliver the operator-facing UX for ENG-018's server plumbing: Zustand `useCartWorkspaceStore` persisted per tenant+user, refactor `SalesPage.tsx` to read the active cart from the store, add a "Suspend" button + label prompt to `SalesCheckoutPanel`, build `SuspendedSalesPanel` with resume/discard actions, lift the `Ctrl`/`Meta` early-return in `useSalesKeyboardShortcuts.ts` so `Ctrl+P` (suspend), `Ctrl+R` (open resume panel), and `Ctrl+Shift+P` (reprint selected row in history) work alongside the existing Alt+X shortcuts, add a close-session prompt when drafts remain, and extend E2E in `e2e/web/business.spec.ts`. **Shipped**: Zustand store with `persist` middleware + ownerKey scoping, `SuspendedSalesPanel` with Retomar/Descartar actions + ConfirmModal, SalesPage integration with suspend orchestration (`sales.create(draft) → sales.suspend`), resume orchestration (`sales.resume → hydrateFromResumed`), resumed-cart banner with items-locked hint, Charge detection that routes resumed carts through `sales.completeDraft` (018c) while fresh carts stay on `sales.create`, `CashSessionCloseModal` suspended-drafts warning, row-selection in `SalesHistoryTable` + Ctrl+Shift+P that opens the Reprint modal for the focused row, hook tests + close-modal tests + store tests, and the E2E round-trip in `business.spec.ts`. | Cashier creates cart A, suspends, creates cart B, charges B, resumes A, charges A. Two cashiers cannot resume concurrently (one gets FORBIDDEN). Close-session dialog warns when ≥1 draft outstanding. Ctrl+P / Ctrl+R / Ctrl+Shift+P fire outside editable inputs and are suppressed inside them. E2E extension green on all three runners. | **High** |
| `ENG-018c` | Sales draft completion procedure + discardDraft stock reversal | Shipped | Server gap that surfaced during ENG-018b planning. Added `sales.completeDraft({ saleId, paymentMethod, paymentStatus, payments, amountReceived, notes })` that flips a non-suspended draft to `status='completed'`, inserts real `sale_payments` rows (replacing the placeholder rows created at draft time), posts the cash movement against the caller's active cash session (re-binds `cashSessionId` so cash reports aggregate on the physical landing session), and emits a `sale.complete` audit row inside the same transaction. Items stay locked at draft-create time so stock is never double-debited. `sales.discardDraft` fixed to mirror `sales.void`'s stock reversal: loop line items, restore `products.stock`, re-credit `inventory_balances` at the original cash session site, insert an `inventoryMovements` row of type `return`, and record `reversedItems` in the audit metadata. Ownership gate widened to accept `createdBy` so orphan drafts (suspend failed mid-flight) are discardable by the cashier without a supervisor override. **Shipped in 38e2a47**; tests extend `sales-park-and-reprint.test.ts` to 20 cases total (+7). | After ENG-018c ships, a cashier can create a draft via `sales.create({ status: 'draft' })`, optionally suspend + resume, and finalize with `sales.completeDraft` — the draft's sale row becomes `status='completed'` with payments and cash movement attached and zero extra stock movement. Discarding a draft with N items restores N units to inventory, matching the void semantics. No existing tests regress. | **High** |
| `ENG-020` | Fiscal DIAN data model + MockAdapter (Iter 3 Fase A) | Shipped | Prepare the whole fiscal DIAN domain without waiting for a Proveedor Tecnológico contract. Add global read-only `dian_identification_types` (seeded with 10 official DIAN codes), `fiscal_documents` / `fiscal_document_items` / `fiscal_numbering_resolutions` / `fiscal_certificates` tables with immutable buyer and line snapshots, a `FiscalAdapter` interface with a deterministic `MockAdapter` (canonical CUFE SHA-384 from Anexo 1.9 vectors), hooks in `sales.complete` / `sales.void` / `sales.return` that route through the adapter, and an architectural lint (vitest) that forbids `reports.fiscal.*` routers from importing `customers` or `products` so historical reports stay immutable. Depends on **ENG-017** landing first. Full spec (including the 5 modeling decisions) in [FISCAL-INTEGRATION.md](./FISCAL-INTEGRATION.md); per-commit breakdown in [SPRINT-PLAN.md §5](./SPRINT-PLAN.md). **Shipped**: migrations `0004_dian_identification_types.sql` + `0005_fiscal_documents.sql` land the global DIAN ID catalog and 4 tenant-scoped fiscal tables with the frozen buyer + line snapshot columns; `services/fiscal/cufe.ts` computes deterministic SHA-384 CUFEs per Resolución 165/2023; `MockAdapter` + `FiscalAdapter` interface + `registry.ts` adapter singleton; `orchestrator.emitFiscalDocument` is idempotent by `(tenant, source, sourceId, kind)` and wires into four sale lifecycle points (`sales.create` when completed, `sales.completeDraft`, `sales.void`, `sales.returnSale`) as a best-effort post-tx hook behind `tenants.settings.fiscal_dian_enabled` (default false for backward compat). `reports.fiscal.list` + `getByCufe` admin-only router reads the frozen snapshots without joining `customers` / `products`; `architectural-lint.test.ts` pins that invariant. Four UI placeholders — `FiscalDocumentListPage`, `FiscalReportsPage`, `FiscalHabilitationWizard`, `FiscalContingencyIndicator` — with en/es i18n namespaces and admin-only nav entries. Dev seed enables the flag for `demo-co` and inserts one DEE resolution per site + one placeholder certificate; the 20 seeded sales now emit 20 fiscal documents. 33 new tests (6 CUFE, 7 MockAdapter, 10 orchestrator, 7 reports router, 3 architectural lint) + extended seed-dev assertion for fiscal parity. `MockAdapter` swap to a real PT is the one-file change gated as ENG-021. | Selling a sale emits a `fiscal_document` with a frozen buyer snapshot; editing the customer row afterwards does not change the emitted document. Consumidor final sales (no `customerId`) use NIT 222222222222 without creating a fake customer. Report queries parse-lint clean (no joins with customers/products). | **High** |
| `ENG-021` | Fiscal DIAN PT integration (Iter 3 Fase B) | Gated | 🟡 **Gated**: requires signed contract with a Proveedor Tecnológico (Facture / HKA / Gosocket), sandbox + production credentials, the tenant pilot's DIAN digital certificate, DIAN numbering resolution associated with the software, a validated PT POC (DEE + FEV + NC + ND + fetchStatus out-of-repo), and an agreed PT error-code → `ServerErrorWithCode` map. Swap the `MockAdapter` from ENG-020 for `FactureAdapter` (or `HkaAdapter`), add real CUFE SHA-384 signing with the tenant certificate, XAdES-EPES, contingency daemon with retry backoff, and the habilitation wizard wired to the real adapter. No domain changes beyond the adapter file — the seams from ENG-020 hold. | Production habilitation completes the DIAN test set; a simulated PT 503 writes to the contingency queue and resends on recovery; adapter-swap test proves Facture ↔ HKA parity on canonical vectors. | **High (gated)** |
| `ENG-022` | Hardware POS base (Iter 4) | Gated | 🟡 **Gated**: requires physical test lab hardware (Xprinter / Epson / Bixolon 58mm or 80mm thermal printer, Honeywell / Zebra USB HID scanner, RJ11 cash drawer chained to the printer). Add `site_peripherals` table, `PrinterAdapter` interface with `system` (current `webContents.print()`) and `escpos` (new — node-thermal-printer or escpos) drivers, cash drawer kick (`ESC p m t1 t2`) before paper cut, `useBarcodeScanner` hook capturing HID keyboard-wedge bursts with EAN-13 checksum and prefix 20-29 price-embedded parsing, and a peripherals configuration page under Setup. Full spec in [HARDWARE-POS.md](./HARDWARE-POS.md). | Sale print emits valid ESC/POS bytes, drawer opens before the cut, scanner captures EAN-13 and adds the product to the cart within 100ms of Enter. | **High (gated)** |
| `ENG-023` | Bold payment terminal (Iter 5) | Gated | 🟡 **Gated**: requires Bold sandbox credentials + physical Bluetooth terminal for tests, AND depends on **ENG-022 commit 1** which installs the `PaymentTerminalAdapter` interface. Implement `BoldAdapter` with `charge(amount, reference)`, `void(txnId)`, `printSlip(txnId)` via the Bold Bluetooth SDK. Integrate into `SalePaymentModal` — when method `card` is selected and a Bold adapter is configured for the site, invoke the adapter and persist the returned `authCode` in `sale_payments.reference`. Keep `ManualAdapter` as the fallback. | Happy path: charge → approved → `authCode` persisted. Decline → sale remains unpaid with a clear translated error. Timeout (60s no response) falls back to manual entry. Cancel mid-transaction cleans up. | **High (gated)** |
| `ENG-024` | Inter-site transfer requests with reservation (Iter 8) | Deferred | ⚪ **Deferred proposal** raised by the operator as a concern, not a firm requirement. Extend `transferOrderStatusEnum` with `requested` / `approved` / `rejected`, add `initiatedBy` / `requestedBy` / `approvedBy` / `rejectedBy` / `rejectionReason` / `expectedArrivalAt`, and finally wire `inventory_balances.reserved` (currently always 0). State machine: `requested → approved → in_transit → completed`; `rejected` or `void` paths release the reservation. UI: `TransferRequestsInboxPage` for approvers, `TransferRequestCreatePage` for requesters, extended `TransferDetailsPage` with a lifecycle timeline, sidebar badge for pending requests in the active site. Full spec in [SPRINT-PLAN.md §9](./SPRINT-PLAN.md). | Cashier at Sede A creates a request for a SKU with no stock at A; manager at Sede B approves (stock shows as reserved at B); manager at B dispatches (B's `on_hand` debits, `reserved` decrements); cashier at A receives with a discrepancy line; both sites reconcile. | **Medium (deferred)** |

Sequencing recommendation:

1. **Infra + trust floor** (pre-pilot): `ENG-002`, `ENG-003`, `ENG-007` must land before pilot deployment (data safety, regression safety, operational trust). `ENG-001` and `ENG-004` should land before the first externally-signed installer.
2. **Quick UX wins, no external gates**: `ENG-015` (shipped), `ENG-018` sales park-and-resume, `ENG-019` sales reprint. These close daily-use gaps in <1 week each and unblock QA cycles.
3. **Locale foundation**: `ENG-017` — blocks `ENG-020` fiscal snapshots. Land before fiscal work starts in earnest.
4. **Fiscal modeling (ungated)**: `ENG-020` fiscal DIAN Fase A with MockAdapter. ~2 weeks, no external gates, leaves the domain ready for Fase B.
5. **Receipt templates polish**: `ENG-016` is a UX lift on an already-shipped feature — interleave after any Tier 1 blocker.
6. **Gated tickets** — only start when their gate is cleared: `ENG-022` hardware POS (test lab physical hardware), `ENG-021` fiscal PT integration (signed PT contract + 5 more gates documented in [FISCAL-INTEGRATION.md](./FISCAL-INTEGRATION.md)), `ENG-023` Bold datáfono (depends on `ENG-022` adapter interface + Bold sandbox).
7. **Deferred**: `ENG-024` inter-site transfer reservation — operator raised as a concern, not a firm requirement. Prioritize only if a specific multi-site tenant pushes for it.
8. The remaining engineering-quality tickets (`ENG-010..014`) interleave with Tier 2/3 commercial phases.

For sprint-level execution (per-commit sequencing, draft commit messages, per-iter verification matrix) see [SPRINT-PLAN.md](./SPRINT-PLAN.md).

---

## 4. i18n Plan — Pre-Phase 1

**Stack**: `i18next` + `react-i18next` — installed ✓
**Fallback chain**: `es-CO` → `es` → `en` — configured ✓
**Namespace splitting**: per feature area (common, auth, nav, sales, inventory, etc.)

**Why first**: English-only UI is a deployment blocker for LatAm. Every new phase adds more hardcoded strings. Foundation should land before cash management UI.

**Scope**: ~126 component files, ~300+ labels, ~137 toasts, ~187 form fields to extract.

### Progress

| Phase | Scope | Status |
| --- | --- | --- |
| i18n-1: Foundation | Install packages, scaffold `apps/web/src/i18n/`, wire in `main.tsx`, `en/` + `es/` stubs for `common`, `auth`, `nav` | **Done** |
| i18n-2: High-visibility surfaces | `LoginPage`, `Sidebar`, `Header` converted to `useTranslation` | **Done** |
| i18n-3: Full feature coverage | All feature modules (`sales`, `products`, `purchases`, `inventory`, `orders`, `customers`, settings screens) | Pending |
| i18n-4: Server + CI enforcement | Server error messages, Electron main process strings, CI lint rule blocking new hardcoded strings | Pending |

---

## 5. Technical Roadmap by Phase

Each phase includes DB, tRPC, UI, and Test tickets.

### Phase 0: Architecture Foundation and Multi-Vertical Module System

**Goal**: Prepare codebase for logistics, dual-database compatibility, multi-vertical modules, and compound tax.

**DB tickets**:
- `DB-001` Dialect-neutral schema conventions
- `DB-002` Replace raw schema bootstrap with versioned Drizzle migrations
- `DB-003` Money, quantity, and timestamp normalization rules
- `DB-004` Add `vertical` column to `sites` (enum: retail, supermarket, pharmacy, ferreteria, restaurant, etc.)
- `DB-005` Add `metadata` JSON column to `products` for vertical-specific attributes
- `DB-006` Add `settings` JSON column to `sites` for capabilities map
- `DB-007` Create `tax_groups` table (compound tax scenarios + mutual exclusivity)
- `DB-008` Create `tax_group_items` table (tax_type, rate, calculation_base, exclusive_with)
- `DB-009` Link products to tax_groups instead of single VAT rate

**tRPC tickets**:
- `API-001` Repository/service boundaries for core domains
- `API-002` Separate persistence concerns from router procedures
- `API-003` Sync acknowledgement contract
- `API-004` Module registry service: resolve site vertical → compute `SiteCapabilities`
- `API-005` Compound tax calculation engine
- `API-006` Module-conditional tRPC router composition

**UI tickets**:
- `UI-001` System diagnostics page for runtime topology
- `UI-002` Admin-facing sync topology indicators
- `UI-003` Vertical/module activation settings page with setup wizard
- `UI-004` `SiteCapabilities` React Context provider
- `UI-005` Capability-filtered sidebar navigation
- `UI-006` Checkout compound tax display (IVA, INC, impuesto saludable lines)

**Test tickets**:
- `TEST-001` Persistence contract tests reusable across dialects
- `TEST-002` Schema migration smoke tests
- `TEST-003` Sync contract tests
- `TEST-004` Compound tax: IVA 19% + INC 8% on same receipt
- `TEST-005` SiteCapabilities computed correctly per vertical
- `TEST-006` Module-conditional sidebar rendering

### Phase 1: Cash Management, Shift Control, and Fractional Quantity

**Goal**: Most critical missing commercial feature for LatAm retail + unblock fractional quantity sales.

**DB tickets**:
- `DB-050` **CRITICAL**: Convert `stock`/`quantity` from `integer` to `real` across ALL tables. Add `sell_by_fraction`, `fraction_step`, `fraction_minimum` flags.
- `DB-051` Create `cash_sessions` (register, cashier, site, opening_float, denominations, expected_balance, actual_count, over_short, status, timestamps)
- `DB-052` Create `cash_movements` (session_id, type [sale, refund, paid_in, paid_out, skim, replenishment], amount, reference, note)
- `DB-053` Create `denomination_templates` for standardized float breakdowns

**tRPC tickets**:
- `API-051` `cashSessions.open` with denomination counting and float validation
- `API-052` `cashSessions.close` with blind close support
- `API-053` `cashSessions.movements` for paid-in, paid-out, skim, replenishment
- `API-054` `cashSessions.report` with over/short history per cashier
- `API-055` Update `sales.create`/`sales.refund` to require active cash session

**UI tickets**:
- `UI-051` Cash session open dialog with denomination counting grid
- `UI-052` Cash session close dialog with blind close mode
- `UI-053` Cash session summary with movement timeline
- `UI-054` Cash management dashboard: active sessions, over/short trends
- `UI-055` Register assignment in POS checkout header

**Test tickets**:
- `TEST-051` Opening cash denomination count matches float
- `TEST-052` Sale increments session expected balance
- `TEST-053` Refund decrements session expected balance
- `TEST-054` Blind close hides expected amount until count submitted
- `TEST-055` Over/short calculation accuracy

### Phase 2: Site-Owned Inventory and Transfer Logistics

**Goal**: Make stock physically believable across sites and warehouses.

**DB tickets**:
- `DB-101` Create `inventory_balances` by product/site/location — **Step 0 shipped** at the (tenant, site, product) grain; location column deferred.
- `DB-102` Create `transfer_orders` and `transfer_order_items` — **Step 1 shipped** (immediate completion only — lifecycle states deferred).
- `DB-103` Create `transfer_shipments` and `transfer_receipts`
- `DB-104` Migrate tenant-wide stock to default site-owned balances — **Step 1 shipped** as a seed-only insert onto the earliest-created active site (balances are now authoritative).

**tRPC tickets**:
- `API-101` `inventory.listBalancesBySite` — **Done** (read-only).
- `API-102` `transfers.create`, `.ship`, `.receive`, `.void` — **Step 3 shipped**: `transfers.create` with optional `defer` flag (origin debited on create, destination credited on receive when `defer: true`), `transfers.list`, `transfers.receive` (completes an in_transit transfer), and `transfers.void` (reverses both completed and in_transit). `.ship` is collapsed into `.create({ defer: true })`; a standalone draft state remains deferred.
- `API-103` Update sales/purchases/orders to read/write site balances — **Step 4 shipped**: sales + purchases/order receiving + admin inventory tools now write through to `inventory_balances`, and `products.stock` is kept in lockstep as Σ(site balances). `applyInventoryBalanceDelta` recomputes and persists `products.stock` after every balance mutation via the new `syncProductStockFromBalances` helper, so the legacy tenant-wide field never drifts during normal operation. A new `inventory.reconcileBalances` (admin) mutation heals historical drift by recomputing `products.stock` for every product in the tenant. The site-resolution contract per mutation remains: `sales.create` debits the cash-session site; `sales.returnSale`/`sales.void` credit the ORIGINAL sale site; `purchases.create` credits the operator site; `purchases.createFromOrder` credits the order site; `purchases.returnPurchase`/`purchases.void` debit the original purchase site; `inventory.adjustStock` resolves the site via `input.siteId ?? ctx.siteId ?? primary` and applies the absolute delta; `inventory.recordEntry` writes through to the operator site, with `mode: 'initial'` crediting by `normalizedQuantity` and `mode: 'physical'` applying the absolute-count delta. A standalone draft transfer state remains deferred.

**UI tickets**:
- `UI-101` Inventory page: site/location balance tabs — **Done** (By Site tab in Inventory).
- `UI-102` Transfer Orders module — **Step 4 shipped** (Transfer stock button + modal with "Ship now, receive later" checkbox + transfer history table with Details/Receive/Void actions + confirmation modal + read-only detail drawer showing line items and lifecycle timestamps, all in the By Site tab; dedicated Transfer Orders page deferred).
- `UI-103` Transfer receive modal with discrepancy reporting — **Done**: receiving an in_transit transfer opens a modal that lists every line with an editable received-quantity input (defaulting to shipped), displays per-line variance badges, and reveals an optional discrepancy-notes textarea when any line diverges. The server credits the destination with the received quantity only (so the `shipped - received` delta shows up as shrinkage via the existing products.stock-in-lockstep invariant) and persists the per-line `received_quantity` + aggregate `discrepancy_notes` on the transfer. The history row renders a Discrepancy badge when present; voids debit the destination by `received_quantity` (coalescing to shipped for legacy rows) so partial-receipt reversals are symmetric. `received > shipped` is rejected up front (`TRANSFER_RECEIVED_EXCEEDS_SHIPPED`) — operators who genuinely received more should take the shipped quantity and post a separate `inventory.adjustStock`.

**Test tickets**:
- `TEST-101` Sales decrement active site only
- `TEST-102` Purchase receipts increment target site only
- `TEST-103` Transfer shipment creates in-transit without double counting
- `TEST-104` Transfer receipt resolves in-transit correctly

### Phase 3: Outbound Logistics Documents

**Goal**: Pick/pack/ship as first-class warehouse/store operations.

**DB**: `fulfillment_orders`, `pick_lists`, `packing_slips`, `delivery_notes`
**tRPC**: Fulfillment allocation, pick list generation/completion, packing slip, delivery note validation
**UI**: Fulfillment workbench, pick list barcode workflow, packing UI, delivery note printable
**Tests**: Pick respects balances, delivery note posts correct movement, partial shipment remains fulfillable

### Phase 4: Transport Execution and Tracking

**Goal**: Dispatch, transport, and delivery follow-through.

**DB**: `shipments`, `shipment_stops`, `drivers`, `vehicles`, `carriers`, `proof_of_delivery`, `delivery_exceptions`
**tRPC**: Dispatch assignment, shipment status transitions, POD mutation, exception handling
**UI**: Dispatch board, shipment timeline, driver POD screen, customer tracking stub
**Tests**: Status progression, POD closes shipment, exception consistency

### Phase 5: Payment Depth, Quotations, Layaway, and Credit Sales

**Goal**: Complex payment scenarios, pre-sale conversion, and LatAm credit practices.

**DB**: `quotations`, `sale_payments` (multi-tender), `customer_credit_accounts`, `gift_cards`, `store_credits`, `layaway_orders`, `special_orders`, `service_tickets`, company fiscal regime fields, `company_credit_settings`, `credit_sales`, `credit_installments`, `credit_payments` (abonos)
**tRPC**: Quotation CRUD/conversion, split payment processing, on-account sales, gift card/store credit, layaway/apartado workflow, special orders, service tickets, credit sale creation with installment schedule, abono posting, overdue scan, aging report
**UI**: Quotations module, multi-tender checkout dialog, credit account management, layaway management, credit sale checkout flow, abono screen, credit portfolio
**Tests**: Quote conversion preserves prices, split payment sum validation, credit limit enforcement, layaway inventory reservation, installment schedule accuracy, abono distribution to oldest installments

### Phase 6: Product Handling and Advanced Inventory

**Goal**: Broader product categories and operational complexity.

**DB**: `product_variants`, `serial_numbers`, `batches`/`batch_balances`, `bundle_components`/`recipes`, product weight/dimensions/shipping/reorder fields
**tRPC**: Variant-aware search, serial/batch assignment, FEFO allocation, bundle explosion, reorder alerts, ABC analysis, inventory aging, GMROI, cycle counting
**UI**: Variant matrix builder, serial/batch selector, expiry dashboard, bundle/recipe management, reorder dashboard, ABC view, aging heatmap, cycle count worksheet
**Tests**: Serialized capture, batch FEFO, bundle component decrement, reorder trigger, ABC distribution

### Phase 7: Loyalty, Promotions, and Commercial Expansion

**Goal**: Conversion, retention, omnichannel readiness.

**DB**: `promotion_rules`, `coupons`, `loyalty_accounts`, `loyalty_transactions`, `loyalty_tiers`, order channel/delivery mode
**tRPC**: Promotion engine (evaluate cart, apply best/stackable discounts), coupon validation, loyalty earn/redeem, points expiry, omnichannel fulfillment
**UI**: Promotion rule builder, coupon management, checkout auto-promotion, loyalty display/redeem, customer loyalty profile, omnichannel order queue
**Tests**: BOGO logic, promotion stacking, coupon single-use, loyalty refund reversal, tier upgrade

### Phase 8: Employee Management and Audit Trail

**Goal**: Employee lifecycle and operational accountability.

**DB**: `employee_shifts`, `employee_commissions`, `commission_rules`, `audit_logs`, `approval_policies`, `approval_events`
**tRPC**: Shift clock in/out, commission calc/clawback, audit log recording, approval workflows, employee performance metrics
**UI**: Shift management, commission config/reports, audit log viewer, approval inbox, employee dashboard
**Tests**: Clock timestamps, commission clawback on return, audit before/after state, approval blocking

### Phase 9: Advanced Reporting and BI

**Goal**: Actionable insights beyond basic views.

**DB**: `daily_sales_summary`, `daily_inventory_snapshot`, `customer_cohorts`
**tRPC**: Sales/Inventory/Customer/Employee KPIs, exception alerts, drill-down API, scheduled report export
**UI**: Executive dashboard with sparklines, operational dashboard, inventory intelligence, customer insights, exception alerts, drill-down navigation, report builder
**Tests**: Summary aggregation accuracy, GMROI formula, comp sales exclusions

### Phase 10: Hybrid Database Runtime

**Goal**: SQLite local + PostgreSQL-compatible remote truth.

**Recommended stack**: PowerSync for sync layer. Dual schema from shared types (near-term). PGlite evaluation for long-term.

**DB**: Dialect abstraction package, dual `sqliteTable`/`pgTable` variants, Postgres migration/bootstrap, operation log schema, boolean/timestamp/JSON/UUID normalization
**tRPC**: Repository interfaces for either dialect, remote sync/apply endpoints, conflict response model, capability negotiation
**UI**: Remote authority config, improved sync center, richer conflict resolution
**Tests**: Full contract suite against SQLite and Postgres, offline-then-reconnect replay, multi-client conflict scenarios

### Phase 11: Fiscal, Accounting, and Integration Layer

**Goal**: Market readiness for broader deployment, Colombia DIAN compliance first.

**Colombia DIAN**: DEE (mandatory since May-July 2024), Factura Electrónica (UBL 2.1), Nota Crédito/Débito, CUFE/CUDE (SHA-384), XAdES-EPES digital signature, SOAP web service, numbering range management, contingency mode.

**DB**: `fiscal_documents`, `fiscal_numbering_ranges`, `fiscal_certificates`, `credit_notes`/`debit_notes`, `fiscal_contingency_log`, `supplier_invoices`, `api_keys`, `webhooks`, `currency_rates`, `country_fiscal_profiles`, `company_fiscal_overrides`
**tRPC**: Fiscal adapter interface, Colombia DIAN adapter (UBL 2.1 XML), CUFE/CUDE service, XAdES-EPES signing, DIAN SOAP client, numbering range management, contingency mode, credit/debit note lifecycle, profile-driven tax engine, tip rules refactor, fiscal adapter factory, public API, webhooks, accounting events
**UI**: Fiscal document views, numbering range management, certificate management, DIAN habilitación wizard, contingency indicator, multi-currency settings, integration/webhook admin, API key management
**Tests**: CUFE/CUDE SHA-384 vs DIAN vectors, UBL XSD validation, XAdES-EPES validity, contingency activation, webhook signing, multi-currency accuracy

### Phase 12: Restaurant and Service Verticals

**Goal**: Restaurant, food service, and appointment-based businesses.

**Prerequisites**: Phase 0 (modules)

**DB**: `tables`, `table_sessions`, `kitchen_orders`, `product_modifiers`/`modifier_groups`, `appointments`, `tip_records`
**tRPC**: Table management (assign/transfer/merge/split), kitchen order routing, course firing, modifier application, split check, tip management (Ley 1935/2018), appointments, auto-86ing, daypart menus, combo engine, kitchen printer routing
**UI**: Floor plan editor, table status grid, KDS with timers, modifier selection, split check dialog, tip consent dialog, appointment calendar, combo builder
**Tests**: Table-sale link, kitchen status transitions, split check math, tip pool distribution, appointment conflict detection, daypart activation, combo pricing

### Phase 13: Pharmacy Vertical

**Prerequisites**: Phase 0, Phase 6 (lot/batch/expiry), Phase 11 (fiscal)

**DB**: `prescriptions`, `prescription_items`, `dispensation_records`, `controlled_substance_ledger`, `fne_reports`, `rips_records`, pharmacy product fields (INVIMA, controlled_schedule, INN/DCI, storage), `eps_contracts`, `equivalence_groups`
**tRPC**: Prescription CRUD with validity/partial dispensing, controlled substance ledger, FNE/RIPS/SISMED reports, regulated price ceiling enforcement, generic substitution, patient medication history, INVIMA recall processing
**Tests**: Controlled substance requires valid Rx, partial dispensing tracking, FNE ledger balance, expired Rx blocking, regulated price ceiling, RIPS format

### Phase 14: Supermarket Vertical

**Prerequisites**: Phase 0, Phase 1 (fractional qty), Phase 6 (lot/batch/expiry), Phase 7 (promotions)

**DB**: `scale_configurations`, `plu_codes`, supermarket `departments`, `shrinkage_records`, `dsd_receiving`, `vendor_promotions`, supermarket product fields
**tRPC**: Scale reading service, variable-weight barcode parsing, age restriction enforcement, department P&L, shrinkage tracking, DSD receiving, automated near-expiry markdowns, impuesto saludable
**Tests**: Variable-weight barcode decode, age restriction blocking, department shrinkage totals, impuesto saludable rates

### Phase 15: Ferretería Vertical

**Prerequisites**: Phase 0, Phase 1 (fractional qty), Phase 5 (quotations, credit)

**DB**: `product_sale_units` (multi-unit with conversion), `service_charges`, `project_templates`, FTS5 virtual table for product search
**tRPC**: Multi-unit sale with conversion, in-house barcode generation, project template management, service charges, partial-use returns, FTS5 search, bulk pricing auto-application
**Tests**: Unit conversion accuracy, barcode generation, template explosion, partial-use return

---

## 6. Competitive Context (Summary)

### What Puntovivo Has That Others Don't

| Capability | Puntovivo | Square | Shopify | Lightspeed | Odoo |
| --- | --- | --- | --- | --- | --- |
| True offline mode | **Strong** | Limited | Limited | No | No |
| Desktop native | **Yes (unique)** | No | No | No | No |
| Open source | **Yes** | No | No | No | Community |
| No subscription | **Yes** | No | No | No | No |
| Self-hosted | **Yes** | No | No | No | Yes |

### Biggest Competitive Gaps

| Gap | vs Colombia (Siigo/Alegra) | vs Global (Square/Shopify) | vs Open Source (Odoo/ERPNext) |
| --- | --- | --- | --- |
| Cash management | **Critical** | **Critical** | **Critical** |
| Fiscal compliance (DIAN) | **Critical** | N/A | Moderate |
| Split payments | High | **Critical** | High |
| Loyalty/promotions | Moderate | **Critical** | High |
| Credit sales (ventas a crédito) | **Critical** | N/A | Moderate |
| Omnichannel | Moderate | **Critical** | Moderate |
| Product variants | High | High | **Critical** |
| Lot/batch/expiry | N/A for retail | Low | **Critical** |
| Advanced reporting | Moderate | High | High |
| Public API/webhooks | High | **Critical** | High |

For detailed competitive capability matrices, payment ecosystem, hardware integration, LatAm integrations, multi-vertical readiness, and Colombian tax compliance status, see [PLAN.md](./PLAN.md) §6.3–6.8.

---

## 7. Reference Architecture Notes (summaries — full designs in PLAN.md)

### Credit Sales (Ventas a Crédito) Design

See Phase 5 Extension for full data model. Key concepts:
- **Cuotas**: Installment schedule generated at time of credit sale
- **Abonos**: Partial payments posted against oldest pending installments
- **Configuration**: per tenant → company → site (most specific wins)
- **Colombian legal**: Credit sales must generate Factura Electrónica (not DEE). Interest bounded by Superfinanciera usury rate.

### Country-Parametrizable Fiscal Rules Design

See Phase 11 Extension. Key architecture:
- `country_fiscal_profiles` table with JSON columns for tax, tip, e-invoicing, withholding, regime config
- `company_fiscal_overrides` for deviations from country defaults
- Fiscal adapter factory: `getFiscalAdapter(profile.adapter)` selects runtime adapter
- Tax engine becomes pure function: `computeTax(lineItems, profile)`
- Colombia behavior preserved as "CO" profile with zero behavior change

### Hybrid Data Architecture

Recommended: PowerSync for sync layer + dual schema from shared types (near-term).
- **Near term**: Keep SQLite local, formalize sync API, remove direct `better-sqlite3` dependency
- **Mid term**: PostgreSQL as remote truth, SQLite as offline working set
- **Long term**: Support standalone SQLite, managed remote SQLite, and PostgreSQL-backed topologies

### Multi-Vertical Module Architecture

Pattern: Configuration-driven module activation (not separate apps).
- `vertical` field on sites selects the active module
- JSON `metadata` on products stores vertical-specific attributes
- `SiteCapabilities` React Context drives conditional rendering
- Each module exports tRPC router + schema + capabilities declaration
- Checkout pipeline is configurable per vertical

---

## 8. Migration History

The migration from WinForms to Electron + React + Fastify is **functionally complete**.

**What was migrated**: desktop shell, embedded backend, tRPC transport, admin/catalog/product/pricing/inventory/sales/procurement/dashboard/export/reporting modules.

**What the current repo added beyond the original plan**: geography hierarchy, customer classification, locations, provider categories, orders with receive-into-purchase, tenant logo library, sale refunds, desktop backup/restore/tray/theme/update/print, merged sync conflict resolution.

When legacy references conflict with current repo: trust `apps/` and `packages/server/` code first, then this document.
