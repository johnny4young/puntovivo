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

**Backend tRPC routers**: auth, companies, countries, identificationTypes, personTypes, regimeTypes, clientTypes, commercialActivities, dashboard, departments, cities, logos, providers, sequentials, units, vatRates, categories, products, orders, customers, purchases, sales, inventory, locations, sites, sync, users

**Web route modules**: Dashboard, Company, Sites, Sequentials, Locations, Customer Catalogs, Geography, Providers, Categories, Units, VAT Rates, Products, Orders, Purchases, Customers, Sales, Inventory, Users

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
| **3a** | **Colombia DIAN fiscal compliance** (DEE + Factura Electrónica via Proveedor Tecnológico) | **Legal blocker since May/July 2024.** Selling Puntovivo to a CO business without this creates fiscal exposure for the user and brand damage for us. See [FISCAL-INTEGRATION.md](./FISCAL-INTEGRATION.md). | **Phase 11 → now P0** |
| **3b** | **POS hardware basics** (ESC/POS printer, cash drawer, barcode scanner) | Operational blocker — real stores need a physical receipt with cut, a drawer that opens, and scan-to-add. See [HARDWARE-POS.md](./HARDWARE-POS.md). | **Phase 12 → now P0** |

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
- **Schema is bootstrapped via `CREATE TABLE IF NOT EXISTS` in `packages/server/src/db/index.ts`** and hand-mirrored in `packages/server/src/db/schema.ts`. There are **no versioned Drizzle migrations** under `packages/server/src/db/migrations/` — `drizzle-kit generate/migrate` is wired in `package.json` but unused. Any non-additive schema change (rename, type change, drop column) cannot be applied to existing installs safely today. (Ticket `DB-002` / `ENG-002`)

### Sync and Offline

- No formal hybrid data topology contract for local SQLite + remote authority. (Phase 10)
- Persistence is tightly coupled to SQLite-specific Drizzle and `better-sqlite3`. Repository interfaces are not yet extracted from router procedures. (Ticket `API-001` / `ENG-010`)
- Remote replication story is underspecified. (Phase 10)
- Structured logging is now in place across `packages/server` and the Electron main process, but request tracing / correlation IDs are still missing. (Follow-up to `ENG-006`)

### Security

- Main `BrowserWindow` in `apps/desktop/src/main/index.ts:1380` still runs with `sandbox: false`. Preload-API surface must be audited before enabling the sandbox. (Ticket `ENG-004`)
- `writeAuditLog` is wired into `transfers.void`, `quotations.delete`, and `quotations.updateStatus` only. `sales.void`, `sales.refund`, `purchases.void`, `users.disable`, role changes, and manual price overrides are **not** recorded. (Ticket `ENG-007`)
- Rate limiting is configured globally at the Fastify layer but not per-procedure; brute-force protection on `auth.login` is not explicit. (Ticket `ENG-008`)

### Testing

- Desktop features lean heavily on unit/type checks and manual verification. `apps/desktop` has **0 automated tests** today.
- There is not yet a **cross-surface E2E suite** across renderer + embedded backend + Electron bridge. A web-only Playwright smoke now exists for login, role gating, navigation, i18n, and responsive shell, but Electron and end-to-end POS transaction flows remain uncovered. (Ticket `ENG-001`)
- Coverage thresholds exist in `vitest.config.ts` (70%) but are **not enforced in CI** — `npm run test` runs without `--coverage` and without a gating threshold. (Ticket `ENG-003`)

### Build / CI

- Desktop packaging for `.dmg` (macOS) and `.exe` (Windows) is still exercised exclusively via the manual `release.yml` workflow. `ENG-005` now covers `ci:desktop` on Linux/macOS/Windows, but packaging/signing regressions can still hide until release time. (Ticket `ENG-005`)
- No dependency audit (`npm audit` / Dependabot alerts) gate is wired into CI. (Ticket `ENG-009`)

### Frontend Health

- Several feature components exceed 900 lines (`ProductFormModal.tsx`, `InventoryPage.tsx`, `SalesPage.tsx`) and mix data-fetch, state, and presentation. Candidates for extraction of subcomponents + custom hooks. (Ticket `ENG-011`)
- `zustand` is declared in `apps/web/package.json` but has **zero imports** in `apps/web/src/`. Either remove the dependency or adopt it for the few remaining Context-based stores. (Ticket `ENG-012`)

### Performance and UX

- Responsive/mobile refinement is weaker in admin/maintenance screens.
- Not every screen uses the same feedback quality level yet.

---

## 3b. Engineering Quality Backlog — Cross-Cutting

These tickets don't belong to any single vertical or commercial phase. They protect the app's long-term maintainability and scalability, and should be sequenced against Tier 1–3 work rather than deferred to "someday". Each ticket is actionable in isolation and has a clear acceptance test.

| ID | Title | Scope | Acceptance | Priority |
| --- | --- | --- | --- | --- |
| `ENG-001` | E2E test harness | Add Playwright against the web app + embedded backend in headless Electron. Cover: login → open cash session → create sale (split tender) → refund → close session. **Step 1 shipped**: `npm run test:e2e:web` now runs a real Playwright web smoke against the standalone backend and Vite app. The suite seeds an idempotent E2E baseline directly in the local SQLite DB (dedicated admin/manager/cashier/viewer users plus a second active site when needed), then validates admin navigation across every sidebar module, role-based route gating, Spanish localization of the main shell, and tablet-width shell behavior. A new transactional business batch now drives real sale creation, refund, void, and inventory adjustment flows through the UI, then asserts the resulting stock, site balances, and audit rows directly against SQLite using per-test isolated users/products/sessions so the suite stays parallel-safe. **Still pending**: Electron runner coverage, cash-session close / purchase / transfer transactional flows, CI integration, and artifact upload. | `npm run test:e2e` green in CI on Linux; screenshots on failure uploaded as CI artifact. | **High** |
| `ENG-002` | Versioned Drizzle migrations | Generate baseline migration from current schema. Replace `runSchemaSync()` raw DDL bootstrap with `migrate()` on startup. Retain `IF NOT EXISTS` only as a one-time adoption shim for existing installs. **Step 1 shipped**: baseline migration (`src/db/migrations/0000_0000_baseline.sql`) captures the full current schema with dynamic `(datetime('now'))` defaults; `initDatabase()` runs `drizzleMigrate()` at boot guarded by an `existsSync` check on `meta/_journal.json`; `ensureMigrationBaseline()` seeds `__drizzle_migrations` on pre-ENG-002 DBs so the baseline is not re-run against an existing schema. **Step 2 shipped**: `DatabaseOptions` / `ServerOptions` now accept a `migrationsFolder` override; `apps/desktop/forge.config.ts` ships `packages/server/dist/db/migrations` via `extraResource`; `apps/desktop/src/main/index.ts` passes `process.resourcesPath/migrations` when `app.isPackaged`, so packaged Electron builds exercise the real migrator end-to-end instead of the silent `runSchemaSync()` fallback. A new override-path integration test in `migrations.test.ts` locks the contract. `runSchemaSync()` is retained for one release cycle as an idempotent belt-and-suspenders. **Step 3 (follow-up)**: retire `runSchemaSync()` now that every boot path — dev, standalone server, packaged Electron — exercises `drizzleMigrate()` via the shared `migrationsFolder` plumbing. | Adding a column requires only editing `schema.ts` + `drizzle-kit generate`; re-running against an existing DB is a no-op. | **High** |
| `ENG-003` | CI coverage threshold | Run `vitest --coverage --run` in `ci:web` and `ci:server`. Fail the job below the thresholds declared in `vitest.config.ts`. Upload LCOV. **Shipped**: both workspaces now declare enforceable v8 coverage thresholds (server 80/80/77/63 statements/lines/functions/branches; web 65/65/68/60 — the web floor replaces the previously unenforced 70/70/70/70 declaration, because the suite had drifted below). `ci:web` and `ci:server` invoke the new `test:coverage` variant that passes `--coverage`, making thresholds actually gate. `lcov` reporter is wired into both configs and `.github/workflows/ci.yml` uploads `coverage/lcov.info` as an artifact for both jobs. Follow-up `ENG-003b` tracks raising the web floor back toward 70% via new component/route tests; it is a pure test-writing effort with no CI plumbing left to do. | PR lowering coverage below threshold fails CI. | **High** |
| `ENG-003b` | Raise web coverage back to 70% | The web floor landed at 65/65/68/60 in ENG-003 to match the actual state of the suite at the time. Write new component + route tests to bring every axis back to 70% (statements/lines/functions/branches) and then raise the thresholds accordingly in `apps/web/vitest.config.ts`. Scope is test-writing only; no CI or config plumbing change. | All four axes ≥ 70% in `apps/web/vitest.config.ts`. | **Medium** |
| `ENG-004` | Electron main window sandbox | Audit every `ipcMain` handler and preload export; remove Node-only APIs from the renderer path. Flip `sandbox: true` on the main `BrowserWindow`. **Shipped**: the security-critical webPreferences now live in `apps/desktop/src/main/window-config.ts` as a single-source-of-truth constant (`MAIN_WINDOW_WEB_PREFERENCES`), and `buildMainWindowWebPreferences()` constructs the exact `BrowserWindow` shape consumed by `main/index.ts`. The bridge audit confirmed every preload export is a pure `contextBridge → ipcRenderer.invoke` wrapper (four namespaces, 29 methods), so no preload refactor was needed. A node-test regression pin in `src/main/__tests__/window-config.test.ts` asserts `sandbox === true`, `contextIsolation === true`, `nodeIntegration === false`, and that the assembled `webPreferences` object passed to `BrowserWindow` keeps those flags intact; it is wired into `ci:desktop` — a tamper-check confirmed the test fails with a clear `ERR_ASSERTION` when any field is weakened. | App boots with `sandbox: true`; all renderer→main calls still pass; add regression test that asserts `webPreferences.sandbox === true`. | **High** |
| `ENG-005` | Desktop CI build matrix | Extend `ci.yml` to run `npm run ci:desktop` on `ubuntu-latest`, `macos-latest`, `windows-latest`. Packaging step may stay in `release.yml`, but typecheck + lint + unit tests must run on all three. **Shipped**: the `desktop` job in `.github/workflows/ci.yml` now uses `strategy.matrix.os` on all three runners with `fail-fast: false` so one OS's break does not mask the others. The other jobs (web, backend, release-automation) stay on `ubuntu-latest` because ENG-005 scopes the matrix specifically to desktop — where native modules compile per-platform and cross-OS regressions historically hid until release time. A cross-platform audit of every script that `ci:desktop` invokes (root `package.json`, server/web/desktop workspace scripts, `packages/server/scripts/copy-migrations.mjs`, `scripts/ensure-native-runtime.mjs`) found zero POSIX-only hazards — the repo was already path-portable and `ensure-native-runtime.mjs` has explicit `process.platform === 'win32'` handling. `better-sqlite3@12.8.0` and `argon2` ship prebuilt binaries for linux-x64, darwin-x64, darwin-arm64, and win32-x64, so `npm ci` does not need a native toolchain on any runner. Packaging itself (`electron-forge make`, signing) remains in `release.yml` because it needs signing material the CI runners do not carry. | CI badge reflects all three OS; a PR that breaks a Windows-only path fails CI. | **Medium** |
| `ENG-006` | Structured logging | Replace `console.log`/`console.error` calls in `packages/server` and `apps/desktop/src/main` with a `pino` logger, namespaced per module (`sales`, `sync`, `cash-session`, …). Redact PII (emails, passwords, tokens). **Shipped**: `packages/server/src/logging/logger.ts` exports `rootLogger` plus `createModuleLogger(name)` which returns a pino child tagged `module: <name>`. Redact covers `password`, `passwordHash`, `token`, `refreshToken`, `jwtSecret`, `email`, `authorization`, `cookie`, nested `headers.*` and one-level wildcards (`*.password`, `*.token`, etc.) — matches are replaced with `[Redacted]` before pino emits. 29 server console sites + 12 Electron main sites migrated to module loggers (`auth`, `db`, `seed`, `trpc`, `server`, `sse`, `standalone`, `electron-main`, `renderer`, `auto-updater`, `backup`, `print`). Fastify adopts the shared root logger when `verbose: true` so HTTP + app logs share one NDJSON stream. Two banner call sites keep plaintext on `process.stdout.write`: the standalone startup banner and the first-run admin credentials — both are one-shot operator UX and the credentials banner deliberately bypasses the structured stream so downstream aggregators cannot leak plaintext. No pino `transport` is configured (pino-pretty's worker threads don't resolve under Electron's CJS Vite bundle); developers pipe manually via `npm run dev:server \| pino-pretty`. `no-console` ESLint rule added to server workspace and scoped to `apps/desktop/src/main/**`; tests keep their existing console allowances. 14 new unit tests in `logger.test.ts` lock the redact policy + module propagation. Level driven by `PUNTOVIVO_LOG_LEVEL` env var with `info`/`debug` defaults by `NODE_ENV`. | Logs are single-line JSON in production; `logger.child({ module: 'sync' })` works; no raw `console.*` remains outside tests. | **Medium** |
| `ENG-007` | Audit trail expansion | Call `writeAuditLog` from: `sales.void`, `sales.refund`, `purchases.void`, `users.create/disable/changeRole`, manual price overrides in `sales.create`, and any change to `company_credit_settings`. Each entry records `before`/`after` JSON where applicable. **Substantially shipped**: `sales.void`, `sales.returnSale`, `cashSessions.close`, `inventory.adjustStock`, `purchases.void`, `users.create`, `users.update` (role / isActive only), and manual price overrides in `sales.create` now all emit audit rows inside their own transaction. Only `company_credit_settings` audits remain, deferred until the credit-sales feature (Phase 5 Ext) lands that table. | Unit test per site asserts an `audit_logs` row is written with the correct `action` + `resource_type`. | **High** |
| `ENG-008` | Auth hardening | Rate-limit `auth.login` specifically (per IP and per username). Lock-out escalation after N failed attempts. Document the policy in `docs/SECURITY.md`. **Shipped**: `packages/server/src/security/loginRateLimit.ts` carries two in-memory TTL buckets — 10 attempts per IP per 60 seconds and 5 failed attempts per username per 15 minutes. Both buckets increment on every unauthorized branch (user not found, disabled user, wrong password, disabled tenant); a successful login clears the username bucket while the IP bucket decays via TTL so a single legitimate login cannot amnesty a stuffing source. `auth.login` throws `TOO_MANY_REQUESTS` with `errorCode: AUTH_RATE_LIMIT_EXCEEDED` and `details: { kind, key, max, secondsUntilReset }` when either cap is hit. 14 new tests (10 service units + 4 integration scenarios incl. the 50-bad-logins acceptance gate) join the suite. `docs/SECURITY.md` documents policy, attack coverage, and future hardening tracked as `ENG-008b` for DB-backed persistence. | Load test: 50 bad logins from one IP returns `429` before the 60-second window completes. | **Medium** |
| `ENG-008b` | Persistent login rate-limit state | ENG-008 uses in-memory buckets; a server restart wipes counters. Promote the `loginRateLimit` service to read/write from a `login_attempts` Drizzle table so multi-tenant cloud deployments survive restarts and can observe attack telemetry historically. Keep the current in-memory fast path as a cache to avoid DB round-trips per login attempt. | Attacker tripping the username cap, server restart, next attempt still 429. | **Medium** |
| `ENG-009` | Dependency audit gate | Add `npm audit --production --audit-level=high` to `ci:web`, `ci:server`, and `ci:desktop`. Add a Dependabot config in `.github/`. **Shipped**: a new `ci:audit` script at the root runs `npm audit --production --audit-level=high` and is composed as the first step of every per-workspace CI script, so a new HIGH or CRITICAL CVE in any production dep fails CI immediately. Three pre-existing prod vulns (fast-jwt critical, fastify high, dompurify moderate) were cleared via a minimal `npm update fastify fast-jwt dompurify` bump that preserved npm workspace hoisting (the brute-force `npm audit fix` approach broke it). `.github/dependabot.yml` was rewritten to drop a stale `gomod` entry for the long-gone `/backend` module, and now opens grouped monthly npm PRs (production + development buckets; react / tanstack sub-groups) and weekly grouped github-actions PRs. Electron and `@electron-forge/*` are explicitly excluded from Dependabot because each bump requires a manual packaged smoke. Tamper-check against the pre-bump lockfile confirmed `npm run ci:audit` exits 1 with the three vulns — the gate fires, not just passes. `docs/SECURITY.md` carries the policy and threshold rationale. | A new transitive dependency with a known `high` CVE fails CI. | **Medium** |
| `ENG-010` | Repository interfaces (Phase 10 prep) | Extract persistence from routers into per-domain repository interfaces (`SalesRepository`, `InventoryRepository`, …) implemented today by a Drizzle-SQLite adapter. Keeps routers dialect-neutral. | All router procedures touch the DB exclusively through an interface; no router imports `better-sqlite3`. | **Medium** |
| `ENG-011` | Break up oversized components | Split `ProductFormModal.tsx` (960 l), `InventoryPage.tsx` (935 l), `SalesPage.tsx` (581 l), `QuotationCreateModal.tsx` (567 l), and `sales.ts`/`purchases.ts` server routers (1.4–1.6 k l) into focused subcomponents + custom hooks + per-sub-feature service files. No file over ~400 lines without justification. | Touched files drop below 400 l; behavior parity covered by existing + new unit tests. | **Medium** |
| `ENG-012` | Remove or adopt `zustand` | Zustand is declared in `apps/web/package.json` but has zero imports. Either delete the dependency or migrate the two Context providers (`AuthProvider`, `TenantProvider`) that would benefit from it. | Either `zustand` is gone from `package.json`, or both providers are refactored to a Zustand store with tests. | **Low** |
| `ENG-013` | Consolidate `CLAUDE.md` / `AGENTS.md` | The two files are byte-for-byte duplicates in spirit but evolve separately. Keep `CLAUDE.md` as canonical and make `AGENTS.md` a one-line pointer, or vice versa, to remove drift. | A single source of truth remains for operational guidance; CI fails if the two files diverge. | **Low** |
| `ENG-014` | Split payments — credit mix | Current `sale_payments` covers cash + card + transfer split tender. Extend to mix on-account installments with immediate tender (needed for layaway / "abono a crédito"). | `sales.create` accepts `credit` + `cash` in the same payload; the sale becomes partial-credit and the `credit_sales` ledger is created only for the credit portion. | **Medium** |

Sequencing recommendation: `ENG-002`, `ENG-003`, `ENG-007` **must** land before pilot deployment (they cover data safety, regression safety, and operational trust). `ENG-001` and `ENG-004` should land before the first externally-signed installer. The rest can interleave with Tier 2/3 commercial phases.

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
