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

- `[ecomm][bridge]` E-commerce sync bridge with Shopify + Tiendanube +
  VTEX: catalog + stock + price sync, plus emit fiscal documents from
  the e-commerce side via the FISCAL-CORE pack from `ENG-034`. Sized
  when `ENG-034` lands and the adapter contract is firm. — 2026-04-27 (jy)

- `[fiscal][oss]` Open-source the FISCAL-CORE engine + a country-pack
  template under Apache-2 license; keep proprietary packs internal.
  Validates certification, attracts integrator developers (model:
  Strapi / Supabase / Cal.com). Decision after `ENG-035` + `ENG-036`
  ship and run in production for at least one tenant per country.
  — 2026-04-27 (jy)

- `[ai][reporting]` Weekly executive report generator: LLM narrates
  KPI deltas using the `ai_audit_log` infrastructure from `ENG-030`,
  delivered as a Monday email + PDF. Sized after `ENG-031` lands and
  the conversational pipeline + tool-calling pattern are battle-tested.
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

- `[ai][products][ux]` Connect `products.suggestCategory` to the
  product create/edit modal. ENG-033 ships the backend constrained
  category suggestion and ENG-048 exposes semantic search +
  embedding regeneration on `ProductsPage`, but no UI calls
  `suggestCategory` yet. Expected shape: after name/description are
  present, request a suggestion, preselect when confidence is high,
  and show a lightweight suggestion chip when confidence is medium
  so the operator can accept or ignore it before saving. — 2026-04-30
  (ENG-048 review)

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

- `[ai][perf]` Anthropic prompt-cache hit rate likely zero on the
  co-pilot. `services/ai/copilot.ts::buildSystemPrompt` embeds the
  resolved analytics window (`from`/`to` ISO timestamps) and the
  active `siteId` directly into the system string, then sets
  `providerOptions.anthropic.cacheControl: { type: 'ephemeral' }`.
  Because the window defaults to "last 90 days from now", the
  timestamp changes on every call, so the cache key never matches
  the previous request. The ENG-030 cost-reduction claim ("~90% cost
  reduction on repeated system prompts") therefore does not apply
  to copilot calls in practice. Fix candidates: (a) keep the system
  prompt static and pass the window/site as a tool input, (b) round
  `to` to the day boundary so consecutive same-day calls share the
  cache, (c) keep the dynamic prompt as a tail message and cache
  only the static instructions. — 2026-04-29 (review)

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

## 2. Small bugs / polish

Cosmetic or low-severity issues that do not warrant a dedicated
`ENG-NNN` ticket. Group into a single `ENG-NNN` when you have ~5
and want to batch them into one sprint.

- `[sales][testing]` Add a dedicated component test file for
  `apps/web/src/features/sales/SuspendedSalesPanel.tsx`. The panel
  has a non-trivial discard-confirm flow (ConfirmModal → mutation →
  toast), a listDrafts query mapping, and a resume callback — all
  currently exercised only by the ENG-018b E2E round-trip. A
  focused unit test (empty state, draft cards render, discard
  confirm calls mutation, resume callback fires) would catch future
  regressions without needing a full browser. Flagged by the code
  review that landed ENG-018b. — 2026-04-23 (jy)
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

## 3. Spikes and research

Time-boxed exploration to decide something. Not implementation work.
Outcome is a recommendation or an ADR, not shipped feature code.

- _(none captured yet — candidates to capture here: Playwright Electron runner for E2E coverage, pt-BR locale bundle effort estimate. Note: libSQL/Turso feasibility was promoted to ENG-037 and shipped as a Defer-recommendation spike at `docs/SPIKE-LIBSQL-TURSO.md` on 2026-05-08.)_

## 4. Parked feature requests

Requests from operators or stakeholders that are real but not
currently prioritized. Note who asked and when so decay is visible.

- _(none captured yet)_
