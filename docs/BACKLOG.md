# Puntovivo — Backlog

> Raw capture for work that **is not yet a commitment**. Anything here has
> not been sized, has no acceptance criteria, or has no priority. It is
> the buffer between "somebody had an idea" and the formal engineering
> backlog in [`docs/ROADMAP.md §3b`](./ROADMAP.md).
>
> **Promotion flow**: when an item here matures — acceptance criteria
> clear, scope sized, priority agreed — move it to `ROADMAP.md §3b` as
> a new `ENG-NNN` row with `Status: Pending`, and delete it from here.
> That is the single migration direction. Items do not demote back.
>
> **What does NOT belong here**: work with clear acceptance criteria
> already (that is a ROADMAP ENG ticket), shipped work (stays in
> ROADMAP with `Status: Shipped`, with long history compacted into
> [`ARCHIVED.md`](./ARCHIVED.md)), or deferred ENG tickets (those keep
> their row in ROADMAP with `Status: Deferred`).

## Conventions

- One bullet per item. Keep it short; if it needs more than two lines,
  it is already mature enough to graduate to ROADMAP.
- Tag items with `[domain]` so the list is scannable: `[fiscal]`,
  `[pos]`, `[inventory]`, `[ux]`, `[infra]`, `[bug]`, `[research]`.
- Dated captures welcome (`— 2026-04-23 (jy)`) so decay is visible.
- When you promote an item to ROADMAP, **delete the bullet here** in
  the same commit; do not leave stale duplicates.

## ARCHIVED

Implemented, rejected, or superseded captures do not stay in the active
backlog. Move historical context to [`ARCHIVED.md`](./ARCHIVED.md), then
delete the active bullet here. This keeps the backlog limited to work that
could still mature into a future `ENG-NNN`.

## 1. Ideas without acceptance criteria

Product / strategic ideas that have not been sized. A human decides
whether they graduate to ROADMAP, die here, or stay pending more
research.

- `[ux][redesign][fiscal]` Honest empty state in Empresa→Fiscal tab: render `EmptyState` + "Configurar" CTA when fiscal config is null, instead of an empty form. — 2026-05-29 (rediseño visual, follow-up)
- `[ux][redesign]` Crear-producto modal: migrate the remaining Precios/Unidades/Proveedores sub-tabs from legacy `.input`/`.btn-outline` to pv-* recipes (FASE 4 only did General). — 2026-05-29 (rediseño visual, follow-up)
- `[infra][desktop]` Validate the `apps/desktop/src/main/index.ts` lifecycle fixes (DK-004..DK-007) in a live Electron target (dev:desktop / test:e2e:electron) — they cross the main/renderer boundary but weren't run there. — 2026-05-29 (rediseño visual, follow-up)
- `[ux][redesign]` Revisit deliberate cosmetic calls: (a) Empresa/Operations tab-bars kept as `segmented-control` not `.pv-tabs`; (b) 2 Operations labels keep the "sync" anglicism; (c) confirm the i18n consolidation's preserved 17 keys were intentional. — 2026-05-29 (rediseño visual, follow-up)
- `[ux][redesign][declutter]` POS: the manager open-drawer button (sales-kick-drawer) moved to SalesCheckoutPanel's cash block; for a strictly minimal POS, evaluate removing it + its dispatchDrawerKick chain. — 2026-05-29 (rediseño visual, declutter)
- `[fiscal][refactor]` Move `services/fiscal/cufe.ts` into `packs/co/cufe.ts` once ENG-021 lands the real Colombia adapter (CUFE is CO-specific; left at root in ENG-034 to dodge 4 test import updates). — 2026-05-01 (jy)
- `[fiscal][money]` Per-country transactional rounding seam in `lib/money.ts` (CLP integer, PE ICBPER per-bag) wired through completeSale + quotations; today all countries use uniform 2-dec `roundMoney()`. Size when a CL/PE pilot needs it. — 2026-05-28 (ENG-180 follow-up)
- `[security][deps]` Clear the 7 dev-only `pnpm audit` advisories (tar via @electron-forge, esbuild via drizzle-kit) once upstream bumps the transitive chains; production audit (`ci:audit`) is clean. — 2026-05-28 (pnpm migration follow-up)
- `[readiness][infra]` Backup-readiness signal: no backup subsystem exists (no table / service / last-backup timestamp), so ENG-184 could not gate on it. When a backup/restore subsystem lands, add a `backup` section to `setupReadiness` + a checkout reminder. — 2026-06-02 (ENG-184 follow-up)
- `[infra][desktop]` Extend the nativeBinding cache selection (db/native-binding.ts, shipped 2026-06-10 for Node runtimes) to the remaining direct better-sqlite3 consumers outside packages/server (e2e/web/global-setup.ts, e2e/web/support/db.ts, e2e/electron/global-setup.ts) so the e2e chain stops needing the native:ensure:node disk swap too; then evaluate retiring the swap entirely (desktop preflight would own the on-disk default unconditionally). — 2026-06-10 (auditoria follow-up)
- `[readiness][fiscal]` Real DIAN config validation at readiness: ENG-184 gates on config PRESENCE only (NIT / resolution / numbering captured). Once ENG-021 lands the real Colombia adapter, upgrade `validateCoFiscalConfig` (and the `setupReadiness.checkout` fiscal reminder) to verify certificate / CUFE signing / provider connectivity, not just presence. — 2026-06-02 (ENG-184 follow-up, ENG-021 dependency)
- `[readiness][fiscal]` QR/XML retention-path readiness: the scope named a QR/XML retention path signal; there is no configured artifact-storage path to probe today (`fiscal_documents.xmlRef` is provider-populated, ENG-021). Add a retention-path readiness check when the storage destination becomes configurable. — 2026-06-02 (ENG-184 follow-up, ENG-021 dependency)
- `[fiscal][ux]` Show the `FiscalMaturityBadge` (Demo/Draft) inside `SaleDetailsFiscalBlock` (the in-sale fiscal proof). ENG-185 labelled the fiscal document LIST + diagnostics + config cards, but the sale-detail summary does not carry `providerId`/`maturity` today; surfacing it there means widening the sale-read fiscal-document summary to include the provider id (or maturity). — 2026-06-02 (ENG-185 follow-up)
- `[perf]` Further-split the eager `utils` vendor chunk (~121 KB gz on first paint after ENG-170); profile dominant packages before splitting to avoid request waterfalls. — 2026-05-28 (ENG-170 follow-up)
- `[fiscal][ux]` Admin card surfacing `listFiscalAdapterCountries()` readiness as a consolidated multi-país view (CO + MX + CL badges). Size when the operator asks for multi-país visibility. — 2026-05-01 (jy)
- `[fiscal][mx]` SAT `claveProdServ` catalog (50k+ entries) needs dynamic refresh from the SAT API — decide TS module vs DB table+cron vs lazy-load (with `products.id`→clave mapping) for ENG-035b. — 2026-05-01 (jy)
- `[fiscal][cl]` Full Chilean comunas catalog (~346 vs the 35 curated in ENG-036a); decide TS module vs DB table seeded from SUBDERE when ENG-036b models the DTE XML. — 2026-05-01 (jy)
- `[fiscal][refactor]` Split `FISCAL_GIRO_INVALID` from `FISCAL_REGIMEN_INVALID` if the operator wants per-country granularity (ENG-036a reuses the MX code for CL giros). — 2026-05-01 (jy)
- `[fiscal][refactor]` Rename `tenants.settings.fiscal_dian_enabled` to a country-agnostic `fiscal.enabled` (or per-country) flag; capture the decision when the second fiscal pack lands. — 2026-05-01 (jy)
- `[i18n][infra]` Migrate the ~170 raw `throw new TRPCError` calls across non-sales routers to `throwServerError` + stable `errorCode` (sales.ts is the canonical example from ENG-018/019); batch into 1-2 tickets. — 2026-04-23 (jy)
- `[security][infra][trpc]` Replace the single global `100/min/IP` Fastify rate limit with tRPC-aware buckets (tenant/site/user scoped, read vs write split, env overrides) before production scale. — 2026-04-29 (jy)
- `[refactor][infra]` Migrate `apps/web/src/services/storage/offlineStorage.ts` Electron path from the `window.db.*` IPC bridge to dedicated tRPC procedures, then delete the bridge (closes ENG-025 residual risk). Working title ENG-041. — 2026-04-27 (jy)
- `[fiscal][oss]` Open-source the FISCAL-CORE engine + a country-pack template under Apache-2, keeping proprietary packs internal; decide after ENG-035 + ENG-036 run in production for one tenant per country. — 2026-04-27 (jy)
- `[receipts][ai]` Auto-generated receipt template per vertical (bakery/pharmacy/restaurant) via `generateObject` against the `receipt_templates` Zod schema; extends ENG-016. — 2026-04-27 (jy)
- `[infra][migrations]` Harden `ensureMigrationBaseline()` (`db/index.ts`) for the partial-adoption case where `__drizzle_migrations` has fewer rows than journal entries — walk both lists, verify leading prefix hashes, seed the missing tail. Surfaced in ENG-026 dev:desktop smoke. — 2026-04-27 (jy)
- `[server][testing]` Add a vitest harness hook to inject behavior between `requireActiveCashSession` and `assertCashSessionStillOpen` so the ENG-042 TOCTOU defense gets direct race-window coverage. — 2026-04-29 (jy)
- `[ai][docs]` Document the Anthropic billing-tier gotcha (positive Console credit balance but API returns `credit balance is too low`) as a runbook entry; seen during ENG-030 smoke. — 2026-04-29 (jy)
- `[ai][ux]` Surface the Anthropic SDK error detail (preserved in `details.cause`) in the `AI_PROVIDER_ERROR` toast so operators see WHY the provider rejected. — 2026-04-29 (jy)
- `[ai][infra]` AI audit-log retention policy + cleanup sweep for `ai_audit_log`; size when the first pilot tenant crosses 10k rows. — 2026-04-29 (jy)
- `[ai][ux]` Surface `ai.usageByBreakdown` in the admin UI (expand `CompanyAISettingsCard` or a dashboard tile); size once ENG-031 produces real usage data. — 2026-04-29 (jy)
- `[ai][infra]` Wrap the failure-path `recordCall` in `services/ai/client.ts` in its own try/catch so a secondary audit-log insert failure doesn't replace the original SDK error. — 2026-04-29 (jy)
- `[ai][testing]` Add an end-to-end test running a WITH/CTE query through `runReadOnlySQL` against the in-memory snapshot (only plain SELECT is exercised today). — 2026-04-29 (review)
- `[ai][ux]` Co-pilot composer: add Enter-to-send (Shift+Enter newline) `onKeyDown` on the textarea in `CopilotPage.tsx`. — 2026-04-29 (review)
- `[ai][settings]` Per-tenant anomaly threshold tuning — surface `tenants.settings.ai.anomalyThreshold` (hardcoded `MAHALANOBIS_THRESHOLD = 3.0` in `services/ai/anomalyDetection.ts`) on the AI Settings card. — 2026-04-30 (ENG-032)
- `[ai][algorithm]` Promote anomaly detection from z-score to isolation forest if pilot data warrants (trigger criteria in `docs/AI-ANOMALY-DETECTION.md`); `detectAnomalies()` interface stays the same. — 2026-04-30 (ENG-032)
- `[ai][ux]` "Investigate cashier" CTA on each `AnomalyDetailsModal` row that pre-filters audit + sales reports by `cashierId` and the anomaly time window. — 2026-04-30 (ENG-032)
- `[ai][algorithm]` Sweethearting detector — invert `ticketsPerHourSpike` to flag downward dips during high-traffic windows (needs cashier-vs-store-traffic correlation). — 2026-04-30 (ENG-032)
- `[fiscal][mx]` Full SAT `claveProdServ` catalog (~50k) as ENG-035d (seed-from-CSV table or cron pull from SAT API); ENG-035b shipped a curated 40-code subset + `01010101` fallback. — 2026-05-01 (ENG-035b)
- `[fiscal][mx]` Migrate `fiscal_documents.xml_ref` from inline TEXT to an object-storage path (`fiscal_xml_storage` table → `userData/fiscal/.../<uuid>.xml`) when ENG-035c brings signed >50kb XMLs. — 2026-05-01 (ENG-035b)
- `[fiscal][mx]` Real XSD validation in CI against the official SAT Anexo 20 schema via `xmllint` in a docker step on `ci:server`; trigger when ENG-035c needs schema verification pre-PAC. — 2026-05-01 (ENG-035b)
- `[offline][peripherals]` ENG-088b — wire each capability card to a runtime probe (card terminal heartbeat, receipt printer + email transport, loyalty module, operations-center module) instead of the static 6-card mapping. — 2026-05-18 (ENG-088)
- `[devtools][offline]` ENG-088c — expose the QueryClient on `window.__PV_QUERY_CLIENT__` in dev (`import.meta.env.DEV`) so Playwright smokes can invalidate cached queries and capture populated screenshots. — 2026-05-18 (ENG-088)
- `[sales][credit]` Refund-of-partial-credit reversal flow (transactional reversal of the cash-session entry + `customer_ledger_entries` row); blocked today by the defensive throw in `services/sales/refund.ts`. — 2026-05-23 (ENG-014 follow-up)
- `[sales][credit][ux]` Richer partial-credit receipt footer ("Cuota inicial / A crédito / Saldo") instead of reusing the ENG-090 full-credit template; reuses the receipt-template engine. — 2026-05-23 (ENG-014 follow-up)
- `[sales][credit][sync]` Sync conflict semantics for partial-credit sales — the `customer_ledger_entries` row needs idempotent upsert by (saleId, tender_index), separate from the sale row's LWW; revisit with the sync substrate (ENG-040/ENG-164). — 2026-05-23 (ENG-014 follow-up)
- `[ai][infra]` Manager-without-siteId AI quota bypass: the per-site check in `services/ai/quotas.ts` is skipped when `ctx.siteId` is null (per-tenant USD budget still applies). Require a site context or hard-error. — 2026-05-23 (ENG-102 follow-up)
- `[ai][infra]` UTC vs local-time month boundary in `services/ai/quotas.ts::monthBounds` vs `currentMonthSpend`; flip both helpers together for cloud deployment. — 2026-05-23 (ENG-102 follow-up)
- `[ai][settings]` Runtime-tunable `AI_QUOTAS` — move the hardcoded 800/200 calls/month to `tenants.settings.ai.quotas.{copilot,invoiceOcr}` on the AI Settings card. — 2026-05-23 (ENG-102 follow-up)
- `[offline][testing]` Drift-detection test parsing the `## Tile Catalog` MD table in `WEBSITE-CAPABILITY-AUDIT.md` against `OFFLINE_CAPABILITY_CATALOG`; size when the catalog grows past 10 rows. — 2026-05-23 (ENG-100 follow-up)
- `[ux][testing]` Permanent responsive smokes at 768/390 viewports for workspace nav — parametrize `business.spec.ts` / `a11y.spec.ts` with `page.setViewportSize` (ENG-131 shipped without persisted E2E coverage). — 2026-05-23 (ENG-131 follow-up)
- `[nav][ux]` CommandPalette `navigate.catalog`/`navigate.procurement`/`navigate.finance` actions (label+description in en/es `palette.json` + role gating); the three ENG-131c landings have no palette entry. — 2026-05-23 (ENG-131c follow-up)
- `[observability][perf]` `withSpan` error path does two opt-in cache lookups on cold-cache (`captureException` + `maybeRecordSpan` in `observability/capture.ts`); share one resolution by passing the resolved flag inward. — 2026-05-23 (ENG-135 follow-up)
- `[perf][ci]` Win another ~2x on `ci:server` via `vitest run --pool=threads --no-isolate`; blocked by `ai-vision.test.ts` / `ai-copilot-cache.test.ts` top-level `vi.mock('ai')` leaking — refactor to `vi.doMock` in `beforeAll` or a separate isolated project. — 2026-05-24 (ci:server perf follow-up)
- `[perf][search]` Replace the double-wildcard LIKE in `users.list` autocomplete (`trpc/routers/users.ts`) with a SQLite FTS5 virtual table; apply the same lens to customers/products/providers once decided. — 2026-05-24 (ENG-175 follow-up)
- `[security][db]` ENG-167b — SQLCipher follow-up: (a) one-shot first-boot migration of pre-Step-1 cleartext DBs; (b) restore-from-different-device key prompt in `backup/backup-bundle.ts`; (c) cross-OS matrix via `build-desktop.yml`. Production rollout of Step-1 is gated on this. — 2026-05-25 (ENG-167 follow-up)
- `[migration-style][polish]` ENG-176-prelude-drift-predicate: when ENG-176b emits its recreation prelude, use `WHERE round(a,2) != a OR …` per table instead of `WHERE 1=1` to skip the full-table write on clean DBs. Pattern recommendation, no functional issue. — 2026-05-25 (ENG-176a polish)
- `[currency][customers][polish]` ENG-176b-customer-currency-update-clobber: `customers.update` (`trpc/routers/customers.ts:328-335`) overwrites `creditLimitCurrencyCode` whenever the amount changes; only stamp when prior is null or explicitly in payload. Gated on ENG-156. — 2026-05-26 (ENG-176b follow-up)
- `[currency][products][polish]` ENG-176b-products-update-currency-override: `products.update` has no `currencyCode` field, so a USD product can't be re-priced to COP without raw SQL; add an input-schema + handler patch when ENG-156's import flow lands. Gated on ENG-156. — 2026-05-26 (ENG-176b follow-up)
- `[web][types]` Remove the `apps/web/src/types/index.ts` re-export shim and finish the DTO → `inferRouterOutputs` migration (ENG-179c split into domain/ui/api; ~142 `@/types` import sites to repoint, deferred because the offline/IndexedDB layer also consumes the domain models). — 2026-05-28 (ENG-179c follow-up)
- `[server][db]` ENG-177b — soft-delete policy decision: add `deleted_at` + `deleted_by_user_id` on catalogs vs drop soft-delete where unneeded; document in `ARCHITECTURE.md`. Independent of ENG-177a versioning. — 2026-05-28 (ENG-177a follow-up)
- `[server][db]` ENG-177c — add `CHECK (cash_session_id IS NOT NULL OR status = 'draft')` to `sales` (full table rebuild + defensive prelude + raw-INSERT unit test) so the cash-session invariant is enforced at the DB layer. — 2026-05-28 (ENG-177a follow-up)
- `[web][a11y]` Virtualised `DataTable` screen-reader row context: set `aria-rowcount` on the table + `aria-rowindex` per rendered `<tr>` when `isVirtual` so AT announces absolute position; pin with a virtual-only unit test. — 2026-05-31 (ENG-172 follow-up)
- `[observability]` Wire the real `tenant_plan` into `web_vital_samples` (today always `'unknown'`) by resolving it in `observability.reportWebVital` once ENG-138 billing ships a tier. — 2026-05-31 (ENG-173 follow-up)
- `[web][refactor]` Extract a generic `useResourceCrud` hook + grouped-prop dialogs (geography is the worst offender). — 2026-06-01 (codebase review follow-up)
- `[server][refactor]` Consolidate the duplicated journal-event lookup across sales aggregates + inventory router. — 2026-06-01 (codebase review follow-up)
- `[server][refactor]` Extract shared sequential-context + provider-validation helpers for orders/purchases. — 2026-06-01 (codebase review follow-up)
- `[server][refactor]` Extract apply/reverse purchase inventory-mutation helpers in `purchases.ts`. — 2026-06-01 (codebase review follow-up)
- `[web][consistency]` Standardize cache invalidation on `invalidateGroups` across the remaining ~16 feature files (ENG-181 continuation). — 2026-06-01 (codebase review follow-up)
- `[ux][design-system]` Unify divergent badge systems (CVA Badge vs `.badge-*` CSS) and the page-title heading scale. — 2026-06-01 (codebase review follow-up)
- `[web][architecture]` Invert the AuthProvider → sales-store logout-cleanup coupling via a lifecycle registry. — 2026-06-01 (codebase review follow-up)
- `[infra][desktop][updater]` When the source is released publicly: set `PUNTOVIVO_UPDATE_REPO_PRIVATE=false` to flip the updater from notify-only to auto-download (Squirrel / update.electronjs.org), then verify end-to-end that (a) `release.yml` un-drafts the release before the updater polls, (b) macOS builds are signed + notarized so Squirrel.Mac applies the update, (c) Windows Squirrel auto-update works against the public repo. — 2026-06-08 (auto-updater notify-only follow-up)
- `[infra][desktop][updater]` Provide/document a read-only `PUNTOVIVO_UPDATE_TOKEN` so the notify-only check can detect new versions against the PRIVATE repo during internal/QA builds; without it the check honestly reports "requires repo access" (GitHub returns 404 for a private repo with no auth). — 2026-06-08 (auto-updater notify-only follow-up)

## 2. Small bugs / polish

Cosmetic or low-severity issues that do not warrant a dedicated
`ENG-NNN` ticket. Group into a single `ENG-NNN` when you have ~5
and want to batch them into one sprint.

- `[tables][css]` Virtualised `DataTable` (ENG-172): only the dense `.pv-table` variant has a sticky `<thead>`, so an auto-virtualised `variant="default"` table scrolls its header out of view. Make it sticky or migrate to dense. — 2026-05-31 (ENG-172 follow-up)
- `[build][git]` `apps/web/tsconfig.node.tsbuildinfo` is committed despite `*.tsbuildinfo` being gitignored (leaked in `8f4fd5b`); untrack it in a standalone chore commit. — 2026-05-31 (ENG-172 follow-up)
- `[inventory][testing]` Flaky E2E transfer-receipt path: `inventory.receiveTransfer` can surface `database is locked` under parallel Playwright load; reduce writer contention or retry transient SQLite busy errors. — 2026-04-29 (jy)
- `[infra][locale]` Retire the stale `tenants.settings` blob fields `currency`/`timezone`/`dateFormat` (in `DEFAULT_TENANT_SETTINGS` / `TenantSettings`) now ENG-017 resolves locale via `tenant_locale_settings`; delete or mark `@deprecated`. — 2026-04-23 (jy)
- `[ux][a11y][nav]` ENG-131 a11y + DX polish batch (7 micro-items): (a) distinct chevron `aria-label` in `Sidebar.tsx`; (b) axe check in `WorkspaceLandingPage.test.tsx`; (c) document the `commandPaletteActions`↔`workspaces.ts` coupling in `COMMAND-PALETTE.md`; (d) share the 5 surface paths as a constant; (e) snapshot test the palette catalogue; (f) JSDoc the `visibleItemsForWorkspace` default-on semantics; (g) collapse the 3 landing `lazyPage` wrappers into one `lazy(WorkspaceLandingPage)`. — 2026-05-23 (ENG-131 reviewer observations)
- `[i18n]` Route shared-component English fallbacks through i18n: TableErrorState, QueryErrorState, ResourcePage, ConfirmModal, Select. — 2026-06-01 (codebase review follow-up)
- `[infra][test]` Wire `ensure-migrations-bundled.test.mjs` into a CI gate (ENG-174 follow-up). — 2026-06-01 (codebase review follow-up)
- `[web][test]` Consolidate the two overlapping `lib/utils` test files; decide fate of tested-but-unused helpers. — 2026-06-01 (codebase review follow-up)
- `[build]` Stop `tsc -b` re-emitting committed `apps/web/vite.config.js` + `vite.config.d.ts`; untrack them. — 2026-06-01 (codebase review follow-up)

## 3. Spikes and research

Time-boxed exploration to decide something. Not implementation work.
Outcome is a recommendation or an ADR, not shipped feature code.

- `[product][research]` Pilot evidence loop: define the 5-10 store-facing observations (time-to-first-sale, failed-checkout reasons, printer/scanner failure rate, DIAN retry rate, day-close variance, support tickets/store-day) that decide retail-vs-vertical focus. Outcome is a pilot scorecard. — 2026-05-31 (product-focus research)
- `[product][strategy]` Packaging/tier decision once Ring-1 is pilot-ready: are AI, restaurant surfaces, delivery, public API, and advanced BI paid add-ons, services, or hidden until needed? Do not implement gates until ENG-182..ENG-186 land. — 2026-05-31 (product-focus research)
- `[ux][research]` Field-test the Ring-1 screen focus pass with one cashier script (open session → scan/add → attach customer → split payment → print → refund → close day); record hesitation before more simplification tickets beyond ENG-186. — 2026-05-31 (product-focus research)
- `[infra][desktop][updater]` Cross-platform AUTO-download while the repo stays private (or Linux auto-update at all): today's auto path rides update.electronjs.org which only serves public-repo Squirrel (macOS/Windows) — Linux deb/rpm never auto-update. If wanted, evaluate a self-hosted feed (static storage in Squirrel format) or migrating Windows→NSIS / Linux→AppImage with electron-updater. Outcome is an ADR on the feed strategy, not code. — 2026-06-08 (auto-updater notify-only follow-up)

## 4. Parked feature requests

Requests from operators or stakeholders that are real but not
currently prioritized. Note who asked and when so decay is visible.

- _(none captured yet)_
