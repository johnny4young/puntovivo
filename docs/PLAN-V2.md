# Plan v2.0 — Tactical bridge between PLAN.md and ROADMAP §3b

> Status: tactical plan, 6-12 months out.
> Created: April 27, 2026.
> Inputs: 2026-Q2 audits — security review, code-quality + dead-code audit, dependency audit, market intelligence + AI feature scan.

This document is the **tactical bridge** between [PLAN.md](./PLAN.md)
(strategic 12-36 month vision) and [ROADMAP.md §3b](./ROADMAP.md) (the
operational ticket index). It groups `ENG-025..ENG-040` into four
quarters and explains the architectural choices that the 2026-Q2 audit
made firm.

It is not a replacement for any existing strategic doc — every section
that already lives in [LONG-TERM-VISION.md](./LONG-TERM-VISION.md),
[STACK-EVOLUTION.md](./STACK-EVOLUTION.md),
[MARKET-SEGMENTS.md](./MARKET-SEGMENTS.md), or
[LATAM-EXPANSION.md](./LATAM-EXPANSION.md) is referenced, not duplicated.

---

## 1. Positioning

> **Serious LATAM-first desktop POS: native multi-country fiscal
> compliance + local-first conversational AI + real POS hardware,
> without the heaviness of accounting software or the fragility of
> web-only POS.**

The 2026-Q2 market scan confirmed a structural slot that no current
LATAM competitor occupies:

| Competitor | Strong | Weak | Gap Puntovivo can capture |
| --- | --- | --- | --- |
| Treinta (CO) | Mobile UX for tendero, free tier | Multi-site, hardware, serious reports | Real desktop POS without losing the simplicity floor |
| Alegra | DIAN / CFDI / Bsale on a single cloud, multi-country fiscal | Web-only POS, weak cash flow, accountant UX | Desktop offline-first robust + multi-tenant audit |
| Siigo | NIIF accounting depth | Heavy ERP, expensive, accountant-first | POS-first with a thin accounting bridge |
| Bsale (CL) | SII-certified, fixed pricing | Chile-centric | Multi-country LATAM from day one |
| Loyverse | Free, polished, multilingual | No LATAM fiscal | Loyverse-class UX + native fiscal |
| Square | Hardware ecosystem | Has not landed fiscally in LATAM | Open flank while Square delays |
| Toast (US restaurants) | Toast IQ AI assistant | US only | LATAM restaurant vertical with AI from day one |
| Lightspeed | Multi-site, multi-channel | Expensive, per-register fee, confusing UX | Clear UX, on-prem desktop, no per-terminal fee |

The strongest moat is the **multi-country fiscal engine**: 2025-2026
brings simultaneous mandatory changes in Colombia (DIAN POS electronic
expansion under Resolución 165/2023 amended by 202/2025), Mexico (CFDI
4.0 catalog refresh January 2026, suspension causal updates), Chile
(SII boleta digital delivery March 2026), Argentina (ARCA RG 5616
threshold cuts), Peru (SUNAT SIRE June 2026 expansion), and Brazil
(NF-e/NFC-e v1.34 with Reforma Tributária IBS/CBS fields). Whoever
ships a clean pluggable fiscal adapter captures all of them.

---

## 2. Phasing — `ENG-025..ENG-040` by quarter

### Phase 0 — Hardening (2 weeks)

Closes audit findings before any new feature lands. No revenue surface
moves; the goal is to stop bleeding before pouring.

| Ticket | Scope summary |
| --- | --- |
| `ENG-025` | Critical security closure: 1 HIGH (IPC `db.*` bridge bypass) + 3 MED (rate-limit gap on `/api/trpc/*`, `logoDataUrl`/`imageUrl` XSS, logout missing `sessionVersion` bump) |
| `ENG-026` | Vite 7 → 8 + `@vitejs/plugin-react` 4 → 6 (peer) + `@types/node` 22 → 24 (no jump to 25) |
| `ENG-027` | Dead code + dependency hygiene (~12 unused exports + drop `@tanstack/react-virtual`) |
| `ENG-028` | Cross-cutting helpers (`invalidateGroups`, `sumBy`, `useMutationWithErrorToast`) |
| `ENG-029` | Hotspot file split — defensive, only when those files are next touched |

### Phase 1 — AI Wave 1: conversational co-pilot (Q1 2027, ~6-8 weeks)

The visible v2.0 differentiator. One foundation ticket plus three
high-value-low-effort features. Provider-agnostic via Vercel AI SDK v6,
default `@ai-sdk/anthropic` (Sonnet 4.7); no second provider configured
at launch — operator decision. Local Ollama support is parked for
Phase 4.

| Ticket | Scope summary |
| --- | --- |
| `ENG-030` | AI-FOUNDATION — Vercel AI SDK + Anthropic provider + audit log table + per-tenant feature flags + monthly USD budget + Settings UI |
| `ENG-031` | AI conversational analytics co-pilot ("¿cuánto vendí ayer en Sur?" with tool-calling against a tenant-scoped read-only view) |
| `ENG-032` | AI anomaly + fraud detection (local-only z-score / isolation-forest, no LLM dependency) |
| `ENG-033` | AI semantic product search + auto-categorization (embeddings via AI SDK + cosine index in SQLite) |

Status: 4 / 4 Phase 1 tickets shipped — Phase 1 complete. `ENG-030` established the AI
foundation; `ENG-031` added the manager/admin `/co-pilot` route with
server-side tool calling, bounded tenant-scoped SQLite `:memory:`
analytics snapshots, SQL guardrails, and inline SQL/table/chart UI;
`ENG-032` added the local-only anomaly + fraud detector with four
sub-detectors (`ticketsPerHourSpike`, `voidRate`, `refundAmount`,
`noSaleSessions`), z-score with leave-one-out, dashboard tile +
drill-down modal, and a dedicated Spanish-language design doc
(`docs/AI-ANOMALY-DETECTION.md`). Last Phase 1 ticket open is
`ENG-033` (semantic search + auto-categorization), unblocked by the
out-of-band `ENG-044` activation of OpenAI as a chat provider.

### Phase 2 — Multi-country fiscal engine (Q2 2027, ~10-12 weeks)

Where the moat lives. The Colombia adapter migrates first to validate
the new contract.

| Ticket | Scope summary |
| --- | --- |
| `ENG-034` | FISCAL-CORE refactor — pluggable `FiscalAdapter` interface; CO adapter migrates first |
| `ENG-035` | Pack Mexico CFDI 4.0 (Jan-2026 catalogs + RFC validation + PAC scaffold) |
| `ENG-036` | Pack Chile SII (boleta + factura, mar-2026 digital delivery, jan-2026 timbre rule) |

Argentina, Peru, Brazil packs are out of scope for Q2; they enter the
queue once Mexico + Chile are in sandbox-validated state.

### Phase 3 — Multi-channel + local-first sync (Q3 2027, ~8 weeks)

| Ticket | Scope summary |
| --- | --- |
| `ENG-037` | libSQL/Turso embedded replicas spike (1-week investigation + 3-4 week implementation if greenlit) — closes the multi-site sync gap referenced in PLAN.md §10 without migrating off SQLite. **Shipped 2026-05-08** as spike report at `docs/SPIKE-LIBSQL-TURSO.md`. Recommendation: **Defer (revisit after Phase 4)** — legacy Embedded Replicas are cloud-primary by default and conflict with ADR-0001, current Turso Sync is still a beta surface whose documented conflict model is Last-Push-Wins, and the native package story does not yet prove a simpler Electron / Node runtime than `better-sqlite3`. Reopen triggers in spike §2; implementation acceptance preserved in spike §12. |
| `ENG-038` | LATAM payment rails (Wompi + Bold + ePayco + Mercado Pago + Nequi/Daviplata) with AI-assisted nightly reconciliation. **Partial 2026-05-11**: slice 1 shipped rail manifest + deterministic adapters, `payment_outbox`, read-only `payments.*` tRPC and `/operations?tab=payments`. Slice 2 (same day) shipped the tenant credential model — optional `validateConfig` on `PaymentRailAdapter`, per-rail `CREDENTIAL_FIELDS_BY_RAIL` descriptor, masked storage helpers under `tenants.settings.payments.<railId>.credentials.*`, admin `paymentSettings.{getAll, updateRail}` namespace and a new `/company?tab=payments` card with readiness badges + password inputs + Show/Hide toggle. **Slice 3 (ENG-038c, 2026-05-13)** closes the matcher half of the AC: new `payment-worker.ts` (Timer A outbox housekeeping every 30s + Timer B statement import every 2h + explicit catch-up on boot against `lastImportedAt`); new `runReconciliationPass` extends the classifier with an `ambiguous` kind and writes matched outbox rows to `status='settled'`; new `ai-tiebreak.ts` hands ambiguous candidates to the configured provider via `generateObject` with graceful degradation; three new error codes (`PAYMENT_RECONCILIATION_*`); new mulberry32-seeded 30-day fixture (6 rails × 30 days × 6 settlements/day = 1068 rows, 5% controlled mismatches); operator-runnable `benchmark:payment-reconciliation` script proves 96.63% match rate against the seed=7 fixture (above the 95% AC threshold). Rail-specific live API clients/workers and the admin retry/requeue UX (carved out as `ENG-065d` closeout) remain. |

### Phase 4 — Vertical specialization + AI Wave 2 (Q4 2027)

| Ticket | Scope summary |
| --- | --- |
| `ENG-039` | Vertical restaurant Mexico (tables, KDS, tips, modifiers + CFDI MX) — vector against SoftRestaurant's legacy stack. Umbrella ticket; first actionable slice is `ENG-039a`; `ENG-039b` adds the table catalog, while the `sales.tableId` FK, open-table state machine, KDS, modifiers, tip/service charge, course timing, and CFDI MX issuance stay in later child slices. |
| `ENG-039a` | Restaurant voice-ordering MVP — dedicated `/touch` and `/m` surfaces with push-to-talk, transcript review, cart-command parsing, existing sales draft save via `suspendedLabel`, and no new restaurant-table/KDS schema. **Shipped 2026-05-12** — real surfaces replace the ENG-069 placeholders via the shared `apps/web/src/features/restaurants/VoiceOrderingScreen.tsx`; parser schema gained optional per-item `note` (sin queso modifier round-trips); 15 new web tests + 10 new server tests; both CI gates green. Live smoke captured 7 inline screenshots end-to-end. |
| `ENG-039b` | Restaurant table catalog — persistent `(tenantId, siteId)` physical-table catalog with admin CRUD, audit logging, partial-unique active names, `/restaurants/tables`, and a dropdown fallback on `/touch` + `/m`. **Shipped 2026-05-14** — keeps `sales.suspendedLabel` as the persisted draft label; no `sales.tableId` FK or table state machine yet. |
| `ENG-039c` | Restaurant `sales.tableId` FK + open/transfer semantics — turns the ENG-039b label into a real FK with `sales.changeTable` transfer mutation, `restaurantTables.listWithDraftStatus` occupancy read surface, and a `MapPin` badge on `SuspendedSalesPanel`. **Shipped 2026-05-14** — split-bill + a dedicated transfer-CTA UI surface stay deferred to ENG-039c2; KDS / modifiers / tips / CFDI MX remain in their own child slices. |
| `ENG-040` | AI Wave 2 — provider-invoice OCR (vision) + voice ordering (Whisper transcript through `generateObject`). **Shipped 2026-05-13** (closes Phase 4). Slice 1 (ENG-040a) shipped the vision pipeline — AIProvider `visionModel?` for Anthropic + OpenAI, `services/ai/vision/invoice-ocr.ts`, `ai.extractInvoiceLines` (managerOrAdmin), three new error codes, and a read-only `<InvoiceOcrPreviewModal>` on `PurchasesPage`. Slice 1b (2026-05-11) shipped line-to-product matching + cart pre-fill — `ai.matchInvoiceLines` reuses ENG-033 embeddings to return top-1 product per line above the 0.3 cosine floor; modal grew a similarity-badge column + "Crear compra con coincidencias" CTA that pre-fills the purchase cart. ENG-040b slice 1 (2026-05-12) shipped Ollama provider activation — `services/ai/providers/ollama.ts` rewritten from stub to a real `AIProvider` backed by `ollama-ai-provider-v2@^3.5.0`, both chat and vision routed through `createOllama({ baseURL })` with `OLLAMA_BASE_URL` env override defaulting to `http://localhost:11434`. Zero-cost pricing, unconditional `isConfigured()`, no API key surface. ENG-040b slice 2 (2026-05-12) added Ollama embeddings — new `defaultEmbeddingModelId?` field on `AIProvider` (OpenAI=`text-embedding-3-small`, Ollama=`nomic-embed-text`), `ollamaProvider.embeddingModel` wired through the SDK's `.embedding(modelId)` factory, `embedText` + `embedTexts` resolver reads per-provider default. ENG-033 semantic search now has a fully-offline option for Ollama tenants. Embedding-model drift admin banner (2026-05-12) added: new `resolveActiveEmbeddingModelId(db, tenantId)` helper, new `products.embeddingHealth` query, new `<EmbeddingDriftBanner />` on `/products` that warns when `products.embedding_model` rows don't match the active provider default and surfaces an admin-gated "Regenerar embeddings" CTA — closes the operator-side gap left by the provider switch. ENG-040c slice 1 (2026-05-12) shipped the Whisper transcription pipeline — `AIProvider` gains optional `transcriptionModel?(modelId)` + `defaultTranscriptionModelId?` + per-minute `transcriptionPricing?` slots; OpenAI activates `whisper-1` (default, $0.006/min) plus the `gpt-4o-transcribe` family, Anthropic + Ollama leave it undefined so the capability gate surfaces `AI_VOICE_NOT_AVAILABLE` cleanly. New `services/ai/voice/transcribe.ts` + `ai.transcribeAudio` (managerOrAdmin) reuse the AI gating chain + audit log (feature `voiceTranscribe`, audio seconds overloaded into `input_tokens`). Three new error codes en + es (neutral LATAM tú). ENG-040c slice 2 (2026-05-12) shipped the operator-facing audio capture UI — `ai.settings.get` exposes `transcriptionAvailable`; new `useVoiceRecorder` hook wraps MediaRecorder with MIME negotiation + 30s auto-stop + 3 error modes; new `blobToBase64` helper; `CompanyAISettingsCard` gains a "Probar transcripción" button with countdown + inline transcript panel (transcript + language + duration + cost). ENG-040c slice 3 (2026-05-12) shipped the voice cart-command parser + shared modal — new `services/ai/voice/parse-cart-command.ts` (ADD-only Zod schema; resolves `productHint` via the ENG-033 embeddings stack), new `ai.parseCartCommand` mutation under `tenantProcedureWithModule('semantic-search')` that returns `mode='parsed' | 'unrecognized'`, `ai.transcribeAudio` widened to the same `tenantProcedureWithModule` so cashier callers drive it; `useVoiceRecorder` + `blobToBase64` promoted to `apps/web/src/features/voice/`; new `VoiceCartCommandModal.tsx` ships idle/recording/transcribing/parsing/reviewing state machine + `onApply(VoiceCartItem[])` callback; new `voice.json` i18n namespace (en + es ~28 keys); 8 server tests + 4 web cases. **No SalesPage mount** — modal is reusable infra that `ENG-039a` will mount on the restaurant `/touch` + `/m` shells. Final slice **ENG-040d (2026-05-13)** closes the AC: new `packages/server/__fixtures__/invoice-ocr/` directory with 10 HTML+PNG+JSON fixture triples (MX/CO/CL/PE verticals, 51 ground-truth lines), Playwright fixture-render helper, operator-runnable `npm run benchmark:invoice-ocr` harness that boots an in-memory SQLite, seeds one tenant with OpenAI provider, walks every fixture through `extractInvoiceFromImage`, scores via the new `services/ai/vision/benchmark-scoring.ts` (Sørensen-Dice over alphanumeric-stripped bigrams at 0.7 threshold + exact qty + ±1% unit-price tolerance + greedy assignment), prints a table report, exits non-zero below 0.80. The OCR system prompt was upgraded with a LATAM number-format hint (COP/CLP/ARS/PYG dot-as-thousand-separator vs MXN/PEN/USD dot-as-decimal) — unlocked 76.47% → **100% (51/51 lines, $0.0090 / 60s** on real OpenAI gpt-4.1-mini vision). `<InvoiceOcrPreviewModal>` gained a second "Tomar foto" CTA with `capture="environment"` + the explicit JPG/PNG/WebP whitelist (HEIC filtered at the chooser); both CTAs share `handleFileChange`. 22 new server scoring tests + 3 new web cases; ci:server 84.78/71.02/80.81/85.92, ci:web 79.04/70.66/76.69/80.27. Live smoke captured 2 inline Playwright proofs (desktop side-by-side, Pixel 7 stacked). Phase 4 now 2/2 closed (`ENG-039a` + `ENG-040`). |

Local Ollama provider lands here as the second provider option for
`ENG-030` if the operator pulls it in.

---

## 3. AI catalog priority matrix

Twelve ideas selected from the 30-idea brainstorm; ordered by value /
effort. The full brainstorm is preserved in the audit report; this
matrix is the actionable subset.

| # | Feature | Value | Effort | Provider | Phase |
| --- | --- | --- | --- | --- | --- |
| 1 | Conversational analytics ("¿cuánto vendí ayer?") | High | M | Anthropic | F1 |
| 4 | Refund fraud detection | High | S | Local | F1 |
| 5 | Per-cashier anomaly detection | High | S | Local | F1 |
| 8 | Stock-out prediction | High | S | Local | F1 |
| 25 | Semantic product search | High | S | Local embeddings | F1 |
| 7 | Auto-categorization at product create | High | S | Local + LLM | F1 |
| 24 | Auto-fill RUT/CFDI/RFC at customer create | High | S | Public APIs + LLM | F2 |
| 16 | Wompi/Bold/Nequi reconciliation assistant | High | M | Local + LLM tie-breaker | F3 |
| 23 | Mispricing detection ("sold below cost") | High | S | Local + LLM | F3 |
| 21 | LATAM fiscal RAG assistant | High | S | Anthropic + RAG | F2 |
| 11 | Provider-invoice OCR | High | M | Anthropic vision | F4 |
| 2 | Photo-to-product-card | High | M | Anthropic vision | F4 |

---

## 4. Architectural decisions closed by the 2026-Q2 audit

| Decision | Verdict | Justification |
| --- | --- | --- |
| Migrate Electron → Tauri | **No** | Tauri 85k DL/wk vs Electron 1.66M; Tauri success cases are API-tooling apps, not POS with ESC/POS + RS-232 balances. Cost: rewriting `better-sqlite3` + `argon2` bridge in Rust for marginal runtime benefit on an embedded POS. |
| Bun runtime for the server | **No** | Fastify on Bun still has open issues (`fastify/fastify#5981`); Bun 1.2+ is production-ready in general but not specifically for Fastify. |
| Rust + Axum for hot procedures | **No** | An embedded POS is not throughput-bound. Marginal win, large cost. |
| Drizzle vs Prisma 7 vs Kysely | **Stay on Drizzle** | Drizzle crossed Prisma in weekly DLs in 2025; PlanetScale acquired the core team in March 2026. Decision aged well. Use Kysely punctually for complex CTEs. |
| libSQL/Turso embedded replicas | **No, defer after Phase 4** | ENG-037 closed this as a spike on 2026-05-08. Legacy Embedded Replicas are cloud-primary by default and conflict with ADR-0001 Local Store Authority, current Turso Sync is still beta with Last-Push-Wins conflict handling, and the native package story does not yet prove a simpler Electron/Node runtime than `better-sqlite3`. Revisit only if the ENG-037 reopen triggers fire. |
| Authority Node / Store Hub Mode | **Yes, add early** | Keep `device_local` as the default, but add explicit `site_hub` and `hub_client` support before multi-register stores are considered sellable. This preserves the local-first moat while allowing one site hub to centralize 10 cashier terminals on the LAN. See ADR-0008 and `docs/AUTHORITY-NODE.md`. |
| Edge runtime (Workers / Deno Deploy) | **No** | Local-first IS the moat. Moving to edge invalidates the privacy + latency story. |
| OSS the FISCAL-CORE engine | **Consider after F2** | Releasing the engine + a country-pack template under Apache-2 (with proprietary packs) attracts integrator developers. Decision after `ENG-035` + `ENG-036` ship — model: Strapi / Supabase / Cal.com. Captured in BACKLOG. |

---

## 5. Cross-doc map

| Document | Scope | When to read |
| --- | --- | --- |
| [PLAN.md](./PLAN.md) | Strategic 12-36m vision, fiscal engine design, multi-vertical analysis, hybrid-DB architecture | Architecture / fiscal / LATAM / multi-vertical decisions |
| [LONG-TERM-VISION.md](./LONG-TERM-VISION.md) | Platform-level themes 12-36m (accounting integrations, WhatsApp, mobile, public API, …) | Cross-cutting feature ideas that span verticals |
| [STACK-EVOLUTION.md](./STACK-EVOLUTION.md) | Additive evolution rules — when each stack tier graduates | Stack changes (Ring 4+ triggers) |
| [MARKET-SEGMENTS.md](./MARKET-SEGMENTS.md) | Three-Rings retail / restaurant / services coverage | Vertical scoping decisions |
| [LATAM-EXPANSION.md](./LATAM-EXPANSION.md) | Country-by-country fiscal effort + pricing strategy | Adding a new country pack |
| [FISCAL-INTEGRATION.md](./FISCAL-INTEGRATION.md) | DIAN-specific contract, gates, error map | DIAN PT work |
| [ROADMAP.md §3b](./ROADMAP.md) | Live ticket index with `Status` column | Pool discovery for next ticket |
| [SPRINT-PLAN.md](./SPRINT-PLAN.md) | Per-iter execution detail (commits, verification, smoke) | Daily execution |
| [BACKLOG.md](./BACKLOG.md) | Unsized ideas, small bugs, spikes, parked feature requests | Idea capture before promotion |
| **PLAN-V2.md** (this) | Phasing of `ENG-025..ENG-040` by quarter, architectural decisions closed by 2026-Q2 audit | Cadence + sequencing of v2.0 |

---

## 6. What this plan does NOT cover

- **Ring 1-3 commercial gaps** outside the v2.0 set (they continue
  through the existing tier roadmap in `ROADMAP.md §2`).
- **`ENG-021`, `ENG-022`, `ENG-023`** which are gated on external
  contracts / hardware (DIAN PT, hardware test lab, Bold sandbox) —
  they remain in their gated state and trigger when their gate
  clears.
- **`ENG-024`** (inter-site transfer reservation) which is operator-
  deferred and not part of v2.0.
- **The OSS decision for FISCAL-CORE** — listed as a BACKLOG item;
  the ticket only opens after Mexico + Chile packs are in sandbox.

---

## 7. Sequencing principle

`ENG-025` is **first and unconditional**: closing the SEC-1 HIGH
finding (IPC bridge bypassing tenant scope) is a precondition for
shipping any new feature that touches user data. Phase 0 ships before
Phase 1 starts.

Within Phase 1, `ENG-030` (AI-FOUNDATION), `ENG-031` (conversational
analytics co-pilot), and `ENG-032` (local-only anomaly detection) are
closed. The remaining ticket is `ENG-033` (semantic product search +
auto-categorization), with `ENG-044` (out-of-band) already reducing
provider risk by activating OpenAI as a live chat fallback. The
embedding model wiring itself still lands in `ENG-033`.

Within Phase 2, `ENG-034` (FISCAL-CORE refactor) is **closed**:
`services/fiscal/registry.ts` is now a typed factory dispatching by
`tenantLocaleSettings.countryCode`, with Colombia migrated into
`packs/co/` (`ColombiaMockAdapter`) and Mexico + Chile parked as
`NotImplementedAdapter` stubs in `packs/mx/` + `packs/cl/`. The
adapter contract gained `validateConfig` (pre-flight readiness) and
`countryCode` (introspection).

`ENG-035` (Pack México CFDI 4.0) se hizo split en tres slices por
tamaño + dependencias externas:

- **ENG-035a** (Shipped) — Fundación: validador RFC + catálogos
  SAT + ajustes admin + adapter `validateConfig` real. Sin emisión
  XML.
- **ENG-035b** (Shipped) — Modelado XML CFDI 4.0 + emisión sin
  firmar. Nuevo serializer `cfdi40-xml.ts` con Anexo 20 completo
  (root + Emisor + Receptor + Conceptos + Impuestos consolidados
  + CfdiRelacionados); nuevo catálogo curado `claveProdServ` 40
  entradas + fallback; nuevo `mappings.ts` con helpers puros para
  FormaPago / ClaveUnidad / ClaveProdServ / Traslado;
  `MexicoCFDIAdapter` salió del stub y ahora retorna
  `{cufe:uuid, status:'pending', xmlRef:<xml>}`; UI
  `FiscalDocumentXmlModal` admin-only para copiar + descargar
  `.xml`; nueva dep `fast-xml-parser` JS puro. Persiste el XML
  inline en `fiscal_documents.xml_ref` con `status='pending'`.
- **ENG-035c** (Pending) — PAC integration + firmado CSD +
  complemento Pago 2.0. Necesita contrato PAC + sandbox SAT +
  certificados CSD de prueba (dependencias externas operativas).

`ENG-036` (Pack Chile SII) también se hizo split en tres slices,
espejo estructural de ENG-035:

- **ENG-036a** (Shipped) — Fundación: validador RUT + catálogos
  SII curados (tipoDte 7, giroComercial 26 CIIU.cl, comuna 35
  SUBDERE) + ajustes admin + `ChileSIIAdapter` con `validateConfig`
  real. Sin emisión XML.
- **ENG-036b** (Shipped) — Modelado XML DTE 1.0 + emisión sin
  firmar + manejo CAF. Nueva migración `0019_fiscal_cafs.sql` con
  partial unique idx `(tenant_id, tipo_dte) WHERE status='active'`;
  servicio `caf-allocator.ts` atómico (avanza cursor + flippea
  exhausted en último folio); nuevo serializer `dte10-xml.ts`
  (~450 LOC, espejo de cfdi40-xml.ts) emite DTE 1.0 con namespace
  SII v1.0 + Encabezado/IdDoc/Emisor/Receptor/Totales + Detalle +
  Referencia para NC + TED.DD completo (RE/TD/F/FE/RR/RSR/MNT/IT1/
  CAF<DA>/TSTED) y FRMT placeholder. ChileSIIAdapter.issue() real
  retorna `{cufe='sii-cl:<RUT>:<TipoDTE>:<F>', status='pending',
  xmlRef=string}`. Documento persiste en `fiscal_documents.xml_ref`
  con `status='pending'` hasta ENG-036c.
- **ENG-036c** (Pending) — Certificación SII + firmado XAdES +
  entrega digital obligatoria (mar-2026) + eliminación de timbre
  impreso (1-jan-2026). Necesita certificado digital del emisor +
  acceso al ambiente de certificación SII.

Las fundaciones de ambos países (ENG-035a + ENG-036a) y los slices
de modelado XML (ENG-035b + ENG-036b) ya shippearon. ENG-035c y
ENG-036c quedan parqueados por dependencias externas (contrato
PAC SAT para MX, certificado del emisor + sandbox certificación
SII para CL).

Phase 3 and Phase 4 can run partially overlapped if a second
contributor joins; the natural critical path is F0 → F1 → F2 → F3 → F4.
