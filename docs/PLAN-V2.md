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
| `ENG-037` | libSQL/Turso embedded replicas spike (1-week investigation + 3-4 week implementation if greenlit) — closes the multi-site sync gap referenced in PLAN.md §10 without migrating off SQLite |
| `ENG-038` | LATAM payment rails (Wompi + Bold + ePayco + Mercado Pago + Nequi/Daviplata) with AI-assisted nightly reconciliation |

### Phase 4 — Vertical specialization + AI Wave 2 (Q4 2027)

| Ticket | Scope summary |
| --- | --- |
| `ENG-039` | Vertical restaurant Mexico (tables, KDS, tips, modifiers + CFDI MX) — vector against SoftRestaurant's legacy stack |
| `ENG-040` | AI Wave 2 — provider-invoice OCR (vision) + voice ordering (Whisper transcript through `generateObject`) |

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
| libSQL/Turso embedded replicas | **Yes, prototype in F3** | The 2025 SQLite renaissance is real. Turso's embedded replica pattern fits POS exactly: local-first reads + cloud sync. Closes the multi-site gap without migrating off SQLite. |
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

Within Phase 2, `ENG-034` (FISCAL-CORE refactor) blocks `ENG-035` and
`ENG-036`. The two country packs can run in parallel once the
interface is in place.

Phase 3 and Phase 4 can run partially overlapped if a second
contributor joins; the natural critical path is F0 → F1 → F2 → F3 → F4.
