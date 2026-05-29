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
> ROADMAP with `Status: Shipped`), or deferred ENG tickets (those keep
> their row in ROADMAP with `Status: Deferred`).

## Conventions

- One bullet per item. Keep it short; if it needs more than two lines,
  it is already mature enough to graduate to ROADMAP.
- Tag items with `[domain]` so the list is scannable: `[fiscal]`,
  `[pos]`, `[inventory]`, `[ux]`, `[infra]`, `[bug]`, `[research]`.
- Dated captures welcome (`— 2026-04-23 (jy)`) so decay is visible.
- When you promote an item to ROADMAP, **delete the bullet here** in
  the same commit; do not leave stale duplicates.

## 1. Ideas without acceptance criteria

Product / strategic ideas that have not been sized. A human decides
whether they graduate to ROADMAP, die here, or stay pending more
research.

- `[fiscal][refactor]` Move `services/fiscal/cufe.ts` into
  `packs/co/cufe.ts` once ENG-021 lands the real Colombia adapter.
  The CUFE algorithm is Colombia-specific (SHA-384 over a fixed
  field order per Resolución DIAN 165/2023); leaving it at the root
  of `services/fiscal/` was a deliberate scope choice in ENG-034 to
  avoid 4 test import updates without a real driver. ENG-021 will
  swap `ColombiaMockAdapter` for `FactureAdapter` / `HkaAdapter`
  anyway and is the natural moment to relocate the helper. —
  2026-05-01 (jy)
- `[fiscal][money]` Per-country transactional rounding in the money
  path. Today `application/sales/completeSale.ts` rounds EVERY country
  through the uniform 2-decimal `roundMoney()` (`lib/money.ts`); there
  is no per-country branch. The only integer rounding is `roundClp`,
  exclusive to the Chile DTE XML serializer — it never touches the live
  POS money columns. The AUDIT §ENG-180 AC assumed CO 2-dec / CL
  integer peso / PE ICBPER per-bag in the transactional path; ENG-180
  documented the uniform reality and marked this as future work. When a
  CL/PE pilot needs it, this is a real code ticket: a country-aware
  rounding seam in `lib/money.ts` (CLP → integer, PE ICBPER per-bag
  surcharge) wired through completeSale + quotations, plus the
  storage-CHECK implications (integer CLP would need its own column
  precision rule). Sized when the operator opens a CL or PE market. —
  2026-05-28 (ENG-180 follow-up)
- `[security][deps]` Clear the 7 dev-only `pnpm audit` advisories (1
  moderate + 6 high) once upstream build tooling updates its transitive
  chains. All are build-time only — production audit (`pnpm audit --prod`,
  the `ci:audit` gate) is clean. (a) `tar` (GHSA-r6q2-hw4h-h46w) enters via
  `@electron-forge/cli > @electron/rebuild > @electron/node-gyp` (100 paths,
  all electron-forge packaging). (b) `esbuild` <=0.24.2 dev-server-CORS
  (GHSA-67mh-4wv8-2f99) enters via `drizzle-kit > @esbuild-kit/esm-loader`
  (a deprecated loader drizzle-kit still bundles). Forcing pnpm overrides on
  these deep transitives risks breaking electron-forge packaging /
  drizzle-kit migration generation for no production-security gain — revisit
  when @electron-forge bumps node-gyp's tar and drizzle-kit drops the
  deprecated @esbuild-kit chain. — 2026-05-28 (pnpm migration follow-up)
- `[perf][i18n]` **ENG-170b** — lazy-load the non-bootstrap i18n namespaces
  so the login/main bundle stops eagerly shipping all 37 locale namespaces
  (split out from ENG-170 item 2). The audit's literal `i18next-http-backend`
  is REJECTED: packaged Electron loads the renderer over `file://`, which
  cannot HTTP-fetch `/locales/<lng>/<ns>.json`, and there is no
  `@fastify/static` route on the embedded server — http-backend would break
  i18n in the primary (desktop) product. Electron-safe approach:
  `i18next-resources-to-backend` + non-eager `import.meta.glob` so each
  namespace becomes a dynamic-import JS chunk (works under `file://`), keep
  `common`/`auth`/`nav`/`errors` in the static bootstrap, and add the
  per-route Suspense boundary the components currently lack (all
  `useTranslation('fiscal'|'kds'|…)` call sites are synchronous today).
  AC tail: login bundle no longer contains `fiscal`/`kds`/`aiSettings`
  namespaces; `locale-parity.test.ts` stays green (it reads files via
  `import.meta.glob`, unaffected). — 2026-05-28 (ENG-170 follow-up)
- `[perf]` Further-split the eager `utils` vendor chunk. After ENG-170's
  manualChunks, rolldown still emits a ~121 KB gz vendor chunk for the
  non-route-specific deps that load on first paint (the `index` entry target
  was met, but this shared chunk is still part of the initial payload). Profile
  which packages dominate it (date-fns, zod, @tanstack, radix primitives are
  candidates) and decide whether a second manualChunks group or a route-level
  split lowers the real first-paint cost — measure before splitting, since
  over-splitting shared deps can hurt by adding request waterfalls. Distinct
  from ENG-171 (render hygiene) and ENG-172 (table virtualisation). The
  `perf-budget.json` `chunk` key is also approximate today (several `chunk-*`
  shared files strip to one budget name) — only a warning path, tighten if it
  starts masking a real regression. — 2026-05-28 (ENG-170 follow-up)
- `[fiscal][ux]` Admin card surfacing `listFiscalAdapterCountries()`
  readiness. La función shippea en ENG-034 con consumer parcial:
  ENG-035a usa el adapter MX directo en `CompanyMxFiscalCard`.
  Pendiente: una vista consolidada multi-país (mostrar simultáneamente
  CO + MX + CL con su readiness badge). Sized cuando el operador
  pida visibilidad multi-país. — 2026-05-01 (jy)
- `[fiscal][mx]` Catálogo SAT `claveProdServ` (50k+ entradas, productos
  y servicios). ENG-035a curó los otros 4 catálogos como TS modules
  pero `claveProdServ` requiere refresh dinámico desde la API del SAT
  (cambia varias veces al año). Decisión pendiente para ENG-035b: TS
  module gigante, DB table con seed + cron, o lazy-load on-demand.
  El mapeo entre `products.id` interno y `claveProdServ` también
  queda para ese ticket. — 2026-05-01 (jy)
- `[fiscal][cl]` Catálogo completo de comunas chilenas (~346 entradas
  vs las 35 curadas que ship en ENG-036a). Cuando ENG-036b modele el
  XML DTE va a necesitar match exacto de la comuna del lugar de
  emisión, así que ahí decidimos: TS module gigante o DB table con
  seed inicial desde la SUBDERE + refresh manual cuando publiquen
  cambios (raro, ~1 vez por década). — 2026-05-01 (jy)
- `[fiscal][refactor]` Separar `FISCAL_GIRO_INVALID` de
  `FISCAL_REGIMEN_INVALID` si el operator pide granularidad por país.
  ENG-036a reusa el code mexicano para giros chilenos (semánticamente
  cubre "el catálogo rechazó el código de actividad económica del
  emisor"). El frontend mapea via i18n key, así que el nombre
  interno no se ve; el costo del rename sería 1 error code + 1 i18n
  key par por país. Sized cuando el operator pida diagnóstico
  separado. — 2026-05-01 (jy)
- `[fiscal][refactor]` Rename `tenants.settings.fiscal_dian_enabled`
  to a country-agnostic `fiscal.enabled` flag (or per-country
  `fiscal.{co,mx,cl}.enabled` if granularity matters). Today the
  flag name is Colombia-specific in spirit but country-agnostic in
  semantics — ENG-034 dispatches via `countryCode` and treats the
  flag as a master kill-switch. ENG-035 / ENG-036 will need to
  decide whether each pack inherits the master flag or owns its own
  per-country flag. Capture the decision when the second pack
  lands. — 2026-05-01 (jy)

- `[i18n][infra]` Migrate raw `throw new TRPCError` calls in every
  router other than `sales.ts` to `throwServerError` + a stable
  `errorCode`, so user-facing messages always render in the active
  locale. Today ~170 raw throws are spread across purchases (35),
  geography (21), products (13), inventory + categories (9 each),
  sites + orders (8 each), locations (7), users + customerCatalogs
  (5 each), providers + customers (4 each), vatRates + units + sync
  + receiptTemplates (3 each), sequentials + quotations + logos +
  companies (2 each), transfers (1). The `sales.ts` router was
  migrated during ENG-018/019 as the canonical example. Batching
  the rest into one or two tickets is cheaper than drip-migrating —
  each router needs new codes in `server/src/lib/errorCodes.ts`,
  the matching entry in `web/src/lib/translateServerError.ts`, and
  en/es strings in `web/src/i18n/locales/*/errors.json`. — 2026-04-23 (jy)

- `[security][infra][trpc]` Replace the single global
  `100/min/IP` Fastify rate limit with tRPC-aware buckets before
  production scale: keep strict auth buckets, add tenant/site/user
  scoped buckets for sales mutations, separate read vs write traffic,
  and keep env overrides per deployment. The current global default is
  a useful safety net, but can throttle legitimate high-demand stores
  behind one NAT. — 2026-04-29 (jy)

- `[refactor][infra]` Migrate `apps/web/src/services/storage/offlineStorage.ts`
  Electron path from the `window.db.*` IPC bridge to dedicated tRPC
  procedures, then delete the bridge from preload + main. Closes the
  remaining structural risk left by `ENG-025` (which patches the
  bridge with a server-validated `desktopSession` singleton instead of
  removing it). Promote when the offline storage surface is next
  touched. Working title: `ENG-041`. — 2026-04-27 (jy)

- `[fiscal][oss]` Open-source the FISCAL-CORE engine + a country-pack
  template under Apache-2 license; keep proprietary packs internal.
  Validates certification, attracts integrator developers (model:
  Strapi / Supabase / Cal.com). Decision after `ENG-035` + `ENG-036`
  ship and run in production for at least one tenant per country.
  — 2026-04-27 (jy)

- `[receipts][ai]` Auto-generated receipt template per vertical
  (bakery / pharmacy / restaurant): the editor offers "starter
  templates" generated by `generateObject` against the existing
  `receipt_templates` Zod schema. Extends `ENG-016`. Sized after
  `ENG-016` item 8 (the parked low-priority sub-bullet) is
  reconsidered in the context of AI Wave 1. — 2026-04-27 (jy)

- `[infra][migrations]` Harden `ensureMigrationBaseline()` in
  `packages/server/src/db/index.ts` to handle the partial-adoption
  case: a DB with N rows in `__drizzle_migrations` whose hashes
  match the first N journal entries but where the journal has more
  entries than rows (e.g. the operator started development before
  migrations 0002+ were generated and the legacy raw-DDL bootstrap
  pre-created those columns). Today the shim short-circuits the
  moment any row exists, so `drizzleMigrate` then re-runs the
  remaining migrations and crashes on `duplicate column name`.
  Fix idea: walk both lists, verify the leading prefix hashes
  match, and seed the missing tail entries. Surfaced during the
  ENG-026 dev:desktop live smoke against an operator dev DB (path
  `~/Library/Application Support/@puntovivo/desktop/data/local.db`)
  whose `__drizzle_migrations` table held two rows — one matching
  the current `0000_0000_baseline.sql` hash and one stale hash for
  a pre-edit version of `0001_receipt_templates.sql`. Workaround
  used: backup + delete the local DB so the next boot reseeds.
  — 2026-04-27 (jy)

- `[server][testing]` Add a vitest harness hook that lets a test
  inject behavior between the outer `requireActiveCashSession`
  fast-fail and the inner `assertCashSessionStillOpen` re-check
  inside `sales.create` / `sales.returnSale` / `sales.completeDraft`
  transactions, so the ENG-042 close-out sales.ts TOCTOU defense gets
  direct race-window coverage. Today the throw branch is structurally
  pinned but not directly testable because better-sqlite3's
  synchronous transaction model collapses the window to a single
  callstack inside vitest. Options: (1) expose a private
  `__beforeTransaction` callback on the procedure for test-only
  injection; (2) refactor to take an injectable cash-session
  validator. Low priority — the defense-in-depth is correct by
  construction. — 2026-04-29 (jy)

- `[ai][docs]` Document the Anthropic billing-tier gotcha in
  `docs/AI-PROVIDERS.md` (or similar): an organization can show a
  positive credit balance in the Console while the API rejects calls
  with `invalid_request_error: Your credit balance is too low`. Seen
  during the ENG-030 live-smoke against an org with $75 of "Credit
  grant" status (mix of promotional + paid). Diagnostic checklist:
  capture the `anthropic-organization-id` response header, run
  `curl /v1/messages` to confirm the error is upstream, contact
  Anthropic support with the request_id + org-id. Worth a runbook
  entry so future operators don't repeat the diagnosis. — 2026-04-29 (jy)

- `[ai][ux]` Surface the Anthropic SDK error detail in the
  `AI_PROVIDER_ERROR` toast. Today the server catches the SDK throw
  and rewraps with a generic "Provider unavailable" message; the
  Anthropic-specific text ("credit balance too low", "invalid model",
  rate-limited, etc.) is preserved in `details.cause` of the
  `ServerErrorWithCode` but `translateServerError` does not surface
  causes. A two-line change in the renderer hint would tell operators
  WHY the provider rejected without making them dig through server
  logs. — 2026-04-29 (jy)

- `[ai][infra]` AI audit-log retention policy + cleanup sweep.
  `ai_audit_log` rows accumulate indefinitely as ENG-031 (co-pilot)
  and ENG-033 (semantic search) ramp call frequency. At
  ~5 cashier-days × 50 AI calls/day per tenant the table is fine for
  years, but a small archival/delete sweep keeps `currentMonthSpend`
  and `byBreakdown` queries fast at 100k+ rows. Sized when the first
  pilot tenant crosses 10k rows. — 2026-04-29 (jy)

- `[ai][ux]` Surface `ai.usageByBreakdown` in the admin UI. The tRPC
  procedure ships with ENG-030 but no card / tile renders it; the
  operator currently has to call it via tRPC directly to see which
  site / cashier / feature is burning the budget. Two natural homes:
  (a) expand `CompanyAISettingsCard` with a collapsible
  "Recent AI usage" section, (b) a dedicated tile on the admin
  dashboard. Sized once ENG-031 ships and there's actual usage
  data to render. — 2026-04-29 (jy)

- `[ai][infra]` Harden `services/ai/client.ts` failure-path
  `recordCall` invocation. Today the catch block runs
  `await recordCall(...)` followed by `throwServerError(...)`. If
  the audit-log insert itself fails (e.g. SQLite WAL lock during a
  degraded restart), that secondary exception escapes and replaces
  the original SDK error in the rethrow. Wrap the catch-block
  `recordCall` in its own try / catch that logs the secondary
  failure without losing the original error context. Low priority —
  this is a "two failures in a row" path that has not been observed
  in practice. — 2026-04-29 (jy)

- `[ai][testing]` Co-pilot WITH/CTE end-to-end execution is unproven.
  `validateReadOnlySQL` is unit-tested against a `WITH daily AS (...)
  SELECT * FROM daily` example, but no test calls `runReadOnlySQL`
  with a `WITH` query — only plain `SELECT` is exercised. The
  cap-wrapper `SELECT * FROM (${safeQuery}) LIMIT N` relies on
  modern SQLite accepting a CTE inside a subquery; works on
  better-sqlite3 v12 (SQLite 3.45+), but the path is unproven for
  this codebase. Add an end-to-end test that runs a CTE against the
  in-memory snapshot to lock the contract. — 2026-04-29 (review)

- `[ai][ux]` Co-pilot composer textarea has no Enter-to-send
  shortcut. `apps/web/src/features/copilot/CopilotPage.tsx` requires
  the operator to click the send button or Tab+Enter to submit;
  every other modern chat surface treats Enter as send and
  Shift+Enter as newline. Two-line change: capture `onKeyDown` on
  the textarea, dispatch the form submit on plain Enter (and skip
  on `event.shiftKey || event.isComposing`). — 2026-04-29 (review)

- `[ai][settings]` Per-tenant anomaly threshold tuning. ENG-032 hardcodes
  `MAHALANOBIS_THRESHOLD = 3.0` in `services/ai/anomalyDetection.ts`. Pilot
  tenants will eventually want to tune this — large multi-store retailers
  may want 2.5σ for tighter detection while small shops may want 3.5σ to
  reduce noise. Surface as an optional number input on the AI Settings card
  bound to `tenants.settings.ai.anomalyThreshold`; pass through
  `ai.anomalies.list` so the detector reads it. — 2026-04-30 (ENG-032)

- `[ai][algorithm]` Promote anomaly detection from z-score to isolation
  forest if pilot data warrants. Trigger criteria documented in
  `docs/AI-ANOMALY-DETECTION.md`: false-positive rate > 30% reported by a
  pilot tenant, or a confirmed false-negative (real fraud missed). Estimated
  ~150 LOC + tuning; the public `detectAnomalies()` interface stays the
  same. — 2026-04-30 (ENG-032)

- `[ai][ux]` "Investigate cashier" CTA on each row of `AnomalyDetailsModal`.
  v1 is read-only; the manager has to manually cross-reference
  `Configuración → Auditoría` and the sales reports filtered by cashier.
  v2 should add a button that pre-filters those views by the alert's
  `cashierId` and the time window of the anomaly. — 2026-04-30 (ENG-032)

- `[ai][algorithm]` Sweethearting detector — invert
  `ticketsPerHourSpike` to flag downward dips during high-traffic
  windows. Requires correlating cashier activity with store traffic
  (e.g. by averaging tickets/hour across all on-shift cashiers and
  flagging individuals far below). Captured separately because the
  v1 spike detector only catches upward outliers. — 2026-04-30 (ENG-032)

- `[fiscal][mx]` Catálogo `claveProdServ` completo (~50k entradas)
  como `ENG-035d`. ENG-035b shippeó un subset curado de 40 códigos
  + fallback `01010101`. El catálogo completo del SAT necesita o
  un seed-from-CSV en una tabla DB nueva (`sat_clave_prod_serv`)
  con índice por code + heurística más robusta, o un pull
  periódico del API SAT con cron job. Trigger: cuando un pilot
  con tenant MX reporta que un producto demo no encuentra match
  específico — hoy el fallback es válido SAT pero PAC puede pedir
  códigos más precisos para timbrado en producción. — 2026-05-01 (ENG-035b)

- `[fiscal][mx]` Migración de `fiscal_documents.xml_ref` de
  inline TEXT a object storage path. ENG-035b persiste el XML
  directamente en la columna text (~5-10kb por documento típico).
  Cuando ENG-035c traiga PDFs firmados + sello digital + posibles
  representaciones impresas, los XMLs firmados promedian >50kb y
  el SQLite text column se vuelve costoso. Modelo objetivo: una
  tabla `fiscal_xml_storage` con `(id, fiscal_document_id, kind,
  blob_path, hash, created_at)` apuntando a un directorio bajo
  `userData/fiscal/<tenant>/<year>/<month>/<uuid>.xml`. Migración
  defensiva: poblar la tabla nueva al timbrar y dejar `xml_ref`
  como fallback hasta que todos los pilots usen el nuevo path.
  — 2026-05-01 (ENG-035b)

- `[fiscal][mx]` XSD validation real en CI contra el schema
  oficial SAT del Anexo 20. ENG-035b verifica estructura via
  tests unitarios exhaustivos (presencia + atributos + ordering)
  pero no contra el XSD oficial — sin libxml2 nativo no podemos
  hacerlo en JS puro. Modelo objetivo: integrar `xmllint` via
  docker image en `ci:server` con un step opcional que pase los
  XMLs generados contra el XSD oficial SAT (descargable desde
  http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd). Trigger:
  cuando ENG-035c necesite verificar contra schema antes de
  enviar a PAC. — 2026-05-01 (ENG-035b)

- `[offline][peripherals]` ENG-088b — Live device capability probe.
  ENG-088 ships the V12 capability grid with a STATIC 6-card
  mapping (Vender → Disponible, Sumar puntos → Pendiente, etc.).
  The follow-up wires each card to a runtime probe so the status
  pill reflects the actual environment: (a) `Cobrar tarjeta` reads
  `trpc.peripherals.list({ kind: 'card_payment_terminal',
  active: true })` plus a heartbeat ping to the terminal; (b)
  `Recibo digital` checks the receipt-printer peripheral + the
  tenant's email-transport config; (c) `Sumar puntos` flips to
  Disponible the moment the loyalty module + customer
  `loyaltyProfile` schema land (currently always Pendiente);
  (d) `Ajustar inventario` reads `useModulesSnapshot().modules`
  to verify the `operations-center` module is on for the active
  user role. The static mapping stays as the fallback for any
  capability whose probe returns inconclusive. — 2026-05-18
  (ENG-088)

- `[devtools][offline]` ENG-088c — QueryClient debug handle for
  live-smoke screenshot evidence. ENG-088's live smoke could not
  capture a populated `OfflineSyncQueueList` screenshot because
  React Query's in-memory cache held the initial empty
  `sync.listQueue` response across the SQL-seed → reload cycle
  and the renderer exposes no debug handle to invalidate the
  cache from the browser console. Expose the QueryClient on
  `window.__PV_QUERY_CLIENT__` in dev mode only (gated by
  `import.meta.env.DEV`) so Playwright smokes can call
  `window.__PV_QUERY_CLIENT__.invalidateQueries(...)` to force a
  refetch without a full reload. Acceptance: smoke harness for
  any tRPC-backed surface can seed the DB + invalidate the
  cached query + capture a populated screenshot in one
  Playwright session. — 2026-05-18 (ENG-088)

- `[sales][credit]` Refund-of-partial-credit reversal flow. The
  defensive throw in `services/sales/refund.ts` blocks the path
  today. A future ticket builds operator-facing copy + transactional
  reversal of both the cash-session entry and the
  `customer_ledger_entries` row when a partial-credit sale is
  refunded. — 2026-05-23 (ENG-014 follow-up)

- `[sales][credit][ux]` Richer partial-credit receipt footer copy.
  V1 reuses the ENG-090 full-credit footer template
  ("Pagado a crédito · saldo posterior $X"). A richer template
  ("Cuota inicial: $X efectivo · A crédito: $Y · Saldo: $Z")
  makes the split tender legible on the printed receipt. Reuses
  the existing receipt-template engine; the new template variant
  is the deliverable. — 2026-05-23 (ENG-014 follow-up)

- `[sales][credit][sync]` Sync conflict semantics for
  partial-credit sales. When a central server eventually
  reconciles, the `customer_ledger_entries` row needs separate
  conflict handling from the sale row (the sale row may resolve
  via last-writer-wins while the ledger row needs an idempotent
  upsert by (saleId, tender_index)). Out of scope for V1 (local-
  store authority); revisit when the sync substrate ships
  (ENG-040 / ENG-164). — 2026-05-23 (ENG-014 follow-up)

- `[ai][infra]` Manager-without-siteId AI quota bypass. When
  `ctx.siteId` is null for a manager (rare — happens when an admin
  acts in a context that hasn't selected a site), the per-site
  quota check in `services/ai/quotas.ts` is skipped while the
  provider call still fires. The per-tenant USD budget gate
  (`AI_BUDGET_EXCEEDED`) still applies, so it is a defense gap,
  not a hole. A future ticket either throws a hard error or
  requires a site context for every manager-level AI call.
  — 2026-05-23 (ENG-102 follow-up)

- `[ai][infra]` UTC vs local-time month boundary in
  `services/ai/quotas.ts::monthBounds`. The current helper uses
  `new Date(now.getFullYear(), now.getMonth(), 1)` — local-time
  anchored, matching `currentMonthSpend`. In a cloud deployment
  the boundary would be UTC midnight on day 1 instead of local
  midnight, creating a window where "this month's spend" and
  "this month's quota usage" point at different definitions of
  "this month". Flip both helpers together. — 2026-05-23 (ENG-102 follow-up)

- `[ai][settings]` Runtime-tunable `AI_QUOTAS`. V1 hardcodes
  800 / 200 calls/month in `services/ai/quotas.ts`. Move to
  `tenants.settings.ai.quotas.{copilot,invoiceOcr}` so an
  operator can adjust per tenant without a rebuild. The web
  surface lives next to the existing AI Settings card.
  — 2026-05-23 (ENG-102 follow-up)

- `[offline][testing]` Drift detection between
  `OFFLINE_CAPABILITY_CATALOG` array (`OfflineCapabilityGrid.tsx`)
  and the audit-doc table in `WEBSITE-CAPABILITY-AUDIT.md`. Today
  only review catches a stale markdown table. A future test parses
  the `## Tile Catalog` MD table and compares against the exported
  constant. Low value/complexity ratio for a 6-row catalog —
  size when the catalog grows past 10 rows or a markdown-drift
  bug actually lands. — 2026-05-23 (ENG-100 follow-up)

- `[ux][testing]` Permanent responsive smokes at 768 / 390
  viewports for workspace navigation. ENG-131 slice A shipped
  the sidebar refactor without a Playwright spec exercising the
  mobile drawer + tablet break; slice C added an inline mobile
  resize check but no E2E coverage that survives across sessions.
  Future spec parametrizes the existing `business.spec.ts` or
  `a11y.spec.ts` route catalogue with `page.setViewportSize` at
  768 and 390 — same routes, different viewport, fresh DOM
  assertions on the workspace header + drawer overlay.
  — 2026-05-23 (ENG-131 follow-up)

- `[nav][ux]` CommandPalette `navigate.catalog` /
  `navigate.procurement` / `navigate.finance` actions. ENG-131c
  shipped the three landing routes but the palette has no entry
  for them — typing "catálogo" / "compras" / "finanzas" in `Mod+K`
  returns no result. Three new actions mirroring the ENG-131b
  pattern (label + description in en + es `palette.json` + role
  gating per `workspace.allowedRoles`, no module gate since the
  landing itself filters items). — 2026-05-23 (ENG-131c follow-up)

- `[observability][perf]` `withSpan` error path triggers two
  opt-in cache lookups on cold-cache (one via `captureException`,
  one via `maybeRecordSpan` in `packages/server/src/observability/capture.ts`).
  Benign because of the 60s cache, but could share a single
  resolution by passing the resolved opt-in flag from the outer
  to the inner call. Surfaced by the server reviewer as MEDIUM
  during ENG-135 review. — 2026-05-23 (ENG-135 follow-up)

- `[perf][ci]` `ci:server` could win another ~2x via `vitest run
  --pool=threads --no-isolate` (measured 18.6 s vs 35-45 s baseline).
  Blocker: `packages/server/src/__tests__/ai-vision.test.ts` and
  `ai-copilot-cache.test.ts` both register top-level `vi.mock('ai',
  ...)`. With isolation off, the first file's mock leaks into the
  second one and 7 cases fail with `AI_PROVIDER_ERROR` where they
  expect `AI_VISION_PARSE_FAILED`. Fix shape: refactor both files to
  use `vi.doMock` inside `beforeAll` (NOT hoisted), or carve them
  into their own vitest workspace project with `isolate: true`. ~2 h
  refactor + verify with `npx vitest run --pool=threads --no-isolate`.
  — 2026-05-24 (ci:server perf follow-up)

- `[perf][search]` `users.list` autocomplete still runs
  `or(like(users.name, '%${search}%'), like(users.email, '%${search}%'))`
  in `packages/server/src/trpc/routers/users.ts`. Both wildcards prevent
  any B-tree index from helping; on a tenant with 10 k+ users the query
  full-scans. The audit recommended switching to a SQLite FTS5 virtual
  table populated by triggers (alternative: prefix-only LIKE which
  breaks the substring UX operators rely on today). Apply the same lens
  to `customers`, `products`, and `providers` autocompletes once the
  approach is decided. Deferred from ENG-175 because the choice is a
  UX/architectural decision that warrants its own ticket. —
  2026-05-24 (ENG-175 follow-up)

- `[security][db] ENG-167b — SQLCipher migration UX + restore prompt
  + cross-OS validation`. Step-1 of ENG-167 (2026-05-25) shipped the
  library swap, the `safeStorage`-sealed key bootstrap, and the
  PRAGMA `key` plumbing. ENG-167b owns the three remaining pieces:
  (a) **one-shot migration of pre-Step-1 cleartext DBs on first boot
  of the upgraded build** — detect a cleartext header, mint the new
  key via `getOrCreateDbKey`, `ATTACH DATABASE` the cleartext source,
  copy every table into an encrypted target, swap atomically; surface
  an operator-visible progress banner because the copy is O(rows) and
  large tenants will see seconds-of-blocking; (b) **restore-from-different-device
  key prompt UX in `apps/desktop/src/main/backup/backup-bundle.ts`**
  — when `assertSqliteIntegrity` fails post-extraction (a backup
  sealed by a different machine's key), prompt the operator for the
  source key via an Electron dialog, retry the integrity check with
  the supplied key, persist the new envelope on success; (c) **cross-OS
  matrix validation** by running the manual
  [`.github/workflows/build-desktop.yml`](../.github/workflows/build-desktop.yml)
  on Linux + macOS + Windows to confirm the prebuilt SQLCipher binary
  loads under signed Electron 41 packages. Production rollout of
  Step-1 + Step-1b is gated on this ticket — until then, the
  encrypted code path runs in dev/CI but must not be advertised to
  end users (existing cleartext DBs would fail to open). — 2026-05-25
  (ENG-167 follow-up)

- `[migration-style][polish] ENG-176-prelude-drift-predicate`. Migration
  0035's defensive UPDATE prelude uses `WHERE round(col, 2) != col` for
  single-column tables but `WHERE 1=1` for multi-column tables (sales,
  sale_items, quotations, quotation_items, cash_sessions, purchases,
  purchase_items, orders, order_items, products). The 1=1 form is
  semantically safe (round on a 2-decimal value is a no-op and no
  triggers exist on these tables), but on a tenant with tens of
  thousands of sale_items it issues a full-table write that triggers a
  WAL flush during the migration window. When ENG-176b emits its own
  recreation prelude, use `WHERE round(a,2) != a OR round(b,2) != b OR
  ...` per table to skip the write on clean databases. Pattern
  recommendation only — no functional issue today. — 2026-05-25
  (ENG-176a polish)

- `[currency][customers][polish] ENG-176b-customer-currency-update-clobber`.
  `customers.update` in `trpc/routers/customers.ts:328-335` clobbers
  the operator-supplied `creditLimitCurrencyCode` whenever the
  `creditLimit` amount is mutated — the helper unconditionally writes
  `resolveTenantCurrency(ctx.db, ctx.tenantId)` when the new limit is
  positive, regardless of the prior currency. NOT a production bug
  today because no admin surface lets the operator pick a non-tenant
  currency for the limit, but the path will silently overwrite once
  ENG-156 ships the multi-currency credit-limit admin field.
  Mitigation: only stamp the currency when `existing.creditLimitCurrencyCode`
  is null OR `input.creditLimitCurrencyCode` is explicitly in the
  payload. — 2026-05-26 (ENG-176b follow-up, gated on ENG-156).

- `[currency][products][polish] ENG-176b-products-update-currency-override`.
  `products.update` in `trpc/routers/products.ts` does NOT accept a
  `currencyCode` field on the update Zod schema, so a product that
  was imported in USD cannot later be re-priced to COP without a
  manual SQL update. Create path stamps the tenant currency by
  default; update path leaves the column untouched. NOT a bug today
  (no UI to change product currency), but worth a small input-schema
  + handler patch when ENG-156's import-product flow lands. —
  2026-05-26 (ENG-176b follow-up, gated on ENG-156).
- **Remove the `apps/web/src/types/index.ts` re-export shim + finish the
  DTO → `inferRouterOutputs` migration.** ENG-179c split the monolith
  into `types/domain.ts` + `types/ui.ts` + `types/api.ts` and kept
  `index.ts` as a pure re-export shim for one release so the ~142
  `@/types` import sites resolved unchanged. Next release: migrate those
  import sites to the specific module (`@/types/domain`, `@/types/ui`),
  delete the shim, and move the hand-written domain DTOs that genuinely
  mirror a tRPC output to `inferRouterOutputs<AppRouter>[…]` in
  `types/api.ts` (skipped in ENG-179c because the domain models are also
  consumed by the offline / IndexedDB layer, so a wholesale migration
  risked coupling the offline buffer's types to the wire contract). —
  2026-05-28 (ENG-179c follow-up).
- **`ENG-177b` — soft-delete policy decision + columns.** ENG-177 part 2.
  Catalogs use `is_active`, transactions use a `status` enum, neither
  captures who/when. Decide: add `deleted_at` + `deleted_by_user_id` on
  the catalogs (preserving `is_active` as a derived view for one release)
  or drop soft-delete where it is not needed; document the chosen policy
  in `ARCHITECTURE.md`. Independent of the ENG-177a versioning work. —
  2026-05-28 (ENG-177a follow-up).
- **`ENG-177c` — `sales` cash-session CHECK constraint.** ENG-177 part 4.
  Add `CHECK (cash_session_id IS NOT NULL OR status = 'draft')` to `sales`
  so the `requireActiveCashSession` invariant is enforced at the DB layer,
  not only in application code. SQLite needs a full table rebuild for a
  table-level CHECK, so this rides its own migration with a defensive
  prelude that first verifies historical rows comply; pin it with a unit
  test that bypasses the application layer (raw INSERT) to prove the
  constraint fires. Carved out of ENG-177a because the `sales` rebuild is
  heavier/riskier than the additive `version` columns and deserves its
  own commit. — 2026-05-28 (ENG-177a follow-up).

## 2. Small bugs / polish

Cosmetic or low-severity issues that do not warrant a dedicated
`ENG-NNN` ticket. Group into a single `ENG-NNN` when you have ~5
and want to batch them into one sprint.

- `[inventory][testing]` Investigate the flaky E2E transfer-receipt
  path where `inventory.receiveTransfer` can surface `database is
  locked` under parallel Playwright load, leaving the "Receive
  transfer" modal open until the suite retry passes. `better-sqlite3`
  already defaults to a 5000 ms busy timeout, so the fix likely needs
  reducing writer contention or making the transfer receive path retry
  transient SQLite busy errors safely. Captured from
  `test:e2e:web` on 2026-04-29; first attempt failed, retry passed.
  — 2026-04-29 (jy)
- `[infra][locale]` Retire the legacy `tenants.settings` JSON blob
  fields `currency`, `timezone`, `dateFormat` now that ENG-017
  resolves locale through `tenant_locale_settings` + the global
  catalogs. The `DEFAULT_TENANT_SETTINGS` constant in
  `apps/web/src/features/auth/AuthProvider.tsx` and the
  `TenantSettings` interface in `apps/web/src/types/index.ts` still
  carry the stale currency/timezone/dateFormat fields; nothing reads
  them anymore. Either delete the fields (breaking type contract,
  needs a minor version bump) or keep them as type-only metadata
  marked `@deprecated`. — 2026-04-23 (jy)
- `[lint][bug]` `apps/web/src/features/company/CompanyLocaleSettingsCard.tsx:76`
  fails the `react-hooks/set-state-in-effect` lint rule ("Calling
  setState synchronously within an effect can trigger cascading
  renders"). Pre-existing on `main` at commit `9eadf62` — blocks
  `npm run ci:web`. Discovered while shipping ENG-020; scope kept
  clean. The fix is a one-file refactor: replace the
  `useEffect(() => { if (pickedCountry === null && current?.countryCode) setPickedCountry(current.countryCode); }, [...])`
  pattern with a functional setState, a ref guard, or a derived
  `useMemo`. — 2026-04-24 (jy)

- `[ux][a11y][nav]` ENG-131 a11y + DX polish batch. Seven micro-items
  surfaced by reviewers across ENG-131 slices A, B, and C that are
  too small for individual bullets but worth grouping for a single
  follow-up sprint: (a) `Sidebar.tsx` chevron carries
  `aria-label={title}` identical to its sibling Link text — refine
  to `${title} (sección)` or visually-hidden suffix so a screen
  reader announces the disclosure intent distinctly (not a WCAG
  fail because `aria-expanded` already disambiguates, but it is
  friction for screen-reader-only operators); (b)
  `WorkspaceLandingPage.test.tsx` (ENG-131c) should call
  `assertNoA11yViolations(container)` per the A11Y.md opt-in
  pattern, closing the axe loop on the new landing component;
  (c) when `docs/COMMAND-PALETTE.md` is eventually created,
  document the coupling between `lib/commandPaletteActions.ts`
  and `components/layout/workspaces.ts` so a future operator
  adding a surface remembers to update both; (d) extract the 5
  surface paths (`/touch`, `/kds`, `/customer-display`, `/m`,
  `/restaurants/tables`) into a shared constant consumed by
  palette + workspaces to prevent drift; (e) add a snapshot test
  of the entire palette catalogue
  (`expect(getCommandPaletteActions()).toMatchSnapshot()`) so an
  accidental action deletion fails CI; (f) document in JSDoc on
  `visibleItemsForWorkspace` (workspaces.ts) that
  `modules[item.requiredModule] === false` is the only state that
  hides an item — absent module keys default to "on" matching the
  `CLIENT_MODULE_DEFAULTS` fallback used in the sidebar, so a
  future maintainer adding a `requiredModule` item does not
  expect opt-in (default off) semantics; (g) consolidate the 3
  `lazyPage` wrappers (`CatalogLandingRoute` /
  `ProcurementLandingRoute` / `FinanceLandingRoute`) into a
  single `lazy(WorkspaceLandingPage)` invoked at route element
  level with the `workspaceId` prop, mirroring the cleaner
  `TouchVoiceRoute` pattern — eliminates 3 separate Suspense
  boundary instances for the same chunk. — 2026-05-23 (ENG-131 /
  ENG-131b / ENG-131c reviewer observations)

## 3. Spikes and research

Time-boxed exploration to decide something. Not implementation work.
Outcome is a recommendation or an ADR, not shipped feature code.

- _(none captured yet — candidates to capture here: Playwright Electron runner for E2E coverage, pt-BR locale bundle effort estimate. Note: libSQL/Turso feasibility was promoted to ENG-037 and shipped as a Defer-recommendation spike at `docs/SPIKE-LIBSQL-TURSO.md` on 2026-05-08.)_

## 4. Parked feature requests

Requests from operators or stakeholders that are real but not
currently prioritized. Note who asked and when so decay is visible.

- _(none captured yet)_
