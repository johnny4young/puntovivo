# Puntovivo · Docs Index

This directory holds every prose source-of-truth for the project —
strategic plans, ticket index, sprint detail, runbooks, and design
docs. The agent and operator workflows reference specific files for
specific decisions; **read the right file for the question, not the
whole directory**.

When something is unclear or two docs seem to disagree, this README
is the authority on which file wins.

---

## 1. Planning hierarchy (read in this order)

| File | Scope | Read when |
| --- | --- | --- |
| [`PLAN.md`](./PLAN.md) | **Strategic** 12-36 month vision, fiscal engine design, multi-vertical analysis, hybrid-DB architecture | Architecture / fiscal / i18n / LATAM / multi-vertical decisions. Skip for simple features. |
| [`PLAN-V2.md`](./PLAN-V2.md) | **Tactical bridge** between PLAN.md and ROADMAP §3b — phasing of `ENG-025..ENG-040` by quarter, architectural decisions closed by 2026-Q2 audit | Cadence + sequencing of v2.0; when in flight on Phase 0..4 tickets. |
| [`PLAN-V3.md`](./PLAN-V3.md) | **Tactical bridge** for the World-Class LatAm POS wave — `ENG-103..ENG-165` across market objective, adoption, launch migration, cashier UX, loyalty, omnichannel, money trust, procurement, accounting, BI, KDS v2, public API delivery, supportability, privacy, AI automation, vertical-depth packs, information architecture simplification, progressive disclosure, performance budgets, accessibility AA, production observability, backup/restore, auto-update, subscription/billing, SSO/MFA, shift management, day-close report, loss-prevention rules, in-transit transfers, WhatsApp inbound commerce, tip pooling, recipe scaling, self-checkout, hardware compatibility matrix, shared peripherals, universal print server, chaos/DR, data portability, cohort/LTV/RFM, receipt branding, contextual help, multi-currency, public demo sandbox, tenant clone, data residency, Nómina Electrónica DIAN (Gated), pt-BR + NFe Brazil, hosted micro-storefront, and compliance readiness pack. Replaces H0..H4 horizons with a single flat priority list. | When promoting work beyond the shipped core toward best-in-LatAm commercial readiness. |
| [`ROADMAP.md`](./ROADMAP.md) | **Ticket index** — `ENG-NNN` rows with acceptance criteria, sequencing recommendation in §3b, machine-readable `Status` column | Pool discovery for the next ticket. **§3b is the canonical Status source — when ROADMAP and PLAN disagree, ROADMAP wins.** |
| [`SELLABILITY.md`](./SELLABILITY.md) | **Go/no-go sellability index** for Colombian retail pilots and production sales | When deciding whether Puntovivo is demo-ready, pilot-ready, or production-sellable. |
| [`SPRINT-PLAN.md`](./SPRINT-PLAN.md) | **Per-iter execution detail** — commit sequencing, draft commit messages, verification matrix per ticket | Daily execution; agent opens this next to ROADMAP when shipping. |
| [`BACKLOG.md`](./BACKLOG.md) | **Raw capture** — unsized ideas, small bugs, spikes, parked feature requests, follow-ups discovered mid-ticket | Idea capture before promotion to ROADMAP. **Do not pick work from here** — items mature to ROADMAP first. |

**Flow for new work**:

```
operator idea → BACKLOG.md (unsized)
   → matures (acceptance criteria clear, sized)
   → promoted to ROADMAP §3b as ENG-NNN with Status=Pending
   → scheduled for sprint
   → SPRINT-PLAN.md §N captures commit spec
   → agent executes via /puntovivo-ship
   → Status flipped to Shipped with summary in ROADMAP
```

---

## 2. Status column convention (`ROADMAP.md §3b`)

| Status | Eligible for pool? | Meaning |
| --- | --- | --- |
| `Pending` | ✅ yes | Never started; standard workflow. |
| `Partial` | ✅ yes | Some sub-steps shipped; the Scope cell ends with "Remaining:" listing what's left. |
| `Shipped` | ❌ no | Closed; Scope cell ends with "Shipped:" summary. |
| `Gated` | ❌ no | External dependency (hardware, contract, credentials) blocks start. |
| `Deferred` | ❌ no | Operator explicitly postponed. Do not re-prioritize without operator signal. |

---

## 3. Cross-doc map (specialty + reference)

### Architecture & stack

| File | Use |
| --- | --- |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Top-level Electron + Fastify + tRPC + SQLite layout. |
| [`architecture/`](./architecture/README.md) | **Architecture Decision Records (ADRs)** — locked decisions that gate work across multiple `ENG-NNN` tickets (Local Store Authority, Command Envelope, Outbox Taxonomy, Conflict Policy). Read when designing schema or service boundaries that touch sales / fiscal / cash / sync. |
| [`AUTHORITY-NODE.md`](./AUTHORITY-NODE.md) | Runtime-mode architecture for `device_local`, `site_hub`, and `hub_client`. Read before touching LAN Store Hub, device registration, central-server ingestion, or local authority semantics. |
| [`STACK-EVOLUTION.md`](./STACK-EVOLUTION.md) | Additive evolution rules — when each stack tier graduates (Ring 1..4). |
| [`SPIKE-LIBSQL-TURSO.md`](./SPIKE-LIBSQL-TURSO.md) | **Spike outcome** for ENG-037 — libSQL/Turso embedded replicas evaluated as a Phase 3 sync substrate. Recommendation: Defer. Read when reopening the Phase 10 hybrid-DB question or when an operator-pilot reports a `sync_outbox` shortcoming. |
| [`TRPC_ARCHITECTURE.md`](./TRPC_ARCHITECTURE.md) + [`TRPC_IMPLEMENTATION_PLAN.md`](./TRPC_IMPLEMENTATION_PLAN.md) + [`TRPC_TESTING_GUIDE.md`](./TRPC_TESTING_GUIDE.md) | tRPC procedure design, schema patterns, HTTP-less testing. |
| [`DESKTOP_RUNTIME_GUIDE.md`](./DESKTOP_RUNTIME_GUIDE.md) | Electron-specific runtime notes (sandbox, dual-binary native modules). |
| `architecture.mmd` + `architecture.svg` | Mermaid + rendered diagram of the system. |

### Fiscal engine (LATAM)

| File | Use |
| --- | --- |
| [`FISCAL-INTEGRATION.md`](./FISCAL-INTEGRATION.md) | DIAN-specific contract + gates + error map. |
| [`LATAM-EXPANSION.md`](./LATAM-EXPANSION.md) | Country-by-country fiscal effort + pricing strategy. |
| [`LOCALE-CURRENCY.md`](./LOCALE-CURRENCY.md) | `tenant_locale_settings` schema + per-tenant currency / format resolution (ENG-017). |

### Vertical scope

| File | Use |
| --- | --- |
| [`MARKET-SEGMENTS.md`](./MARKET-SEGMENTS.md) | Three-Rings retail / restaurant / services coverage. |
| [`FUTURE-VERTICALS.md`](./FUTURE-VERTICALS.md) | Backlog of vertical adapters not yet scoped. |
| [`PRODUCT-COMPOSITION.md`](./PRODUCT-COMPOSITION.md) | Product modeling for composite SKUs. |
| [`RESTAURANT-LIFECYCLE.md`](./RESTAURANT-LIFECYCLE.md) | Tables, KDS, modifiers — design for the restaurant pack (ENG-039). |
| [`MODULE-ACTIVATION.md`](./MODULE-ACTIVATION.md) | Per-tenant module gating. |
| [`HARDWARE-POS.md`](./HARDWARE-POS.md) | ESC/POS, cash drawer, scanner, peripherals (ENG-022). |

### AI features

| File | Use |
| --- | --- |
| [`AI-ANOMALY-DETECTION.md`](./AI-ANOMALY-DETECTION.md) | Local-only z-score detector design (ENG-032). |
| [`AI-SEMANTIC-SEARCH.md`](./AI-SEMANTIC-SEARCH.md) | OpenAI embeddings + cosine similarity (ENG-033). |

### UX & design system

| File | Use |
| --- | --- |
| [`UI-SURFACES.md`](./UI-SURFACES.md) | Inventory of admin surfaces + role gating. |
| [`SALES-COCKPIT.md`](./SALES-COCKPIT.md) | Operator UX guide for cashier speed, touch ergonomics, KDS readability, fiscal setup, recipes/BOM, quotations, and owner dashboards. |
| [`UI-REFRACTOR-V3.md`](./UI-REFRACTOR-V3.md) | Live-audit-backed information architecture and progressive-disclosure plan for reducing visible options per screen (`ENG-131`, `ENG-132`). |
| [`WALKTHROUGH.md`](./WALKTHROUGH.md) | Design handoff alignment for Sales Cockpit, surfaces, module activation, and the `ENG-103..ENG-165` roadmap mapping. |
| [`COMPONENTS.md`](./COMPONENTS.md) | Shared component catalog. |
| [`STYLING.md`](./STYLING.md) | Design system tokens + Tailwind primitives. |
| [`RECEIPT-TEMPLATES.md`](./RECEIPT-TEMPLATES.md) | Receipt template editor + renderer (ENG-016). |
| [`WEBSITE-CAPABILITY-AUDIT.md`](./WEBSITE-CAPABILITY-AUDIT.md) | Public-website claim audit against shipped product support and roadmap tickets. |

### Operations & runbooks


| File | Use |
| --- | --- |
| [`SELLABILITY.md`](./SELLABILITY.md) | Colombian retail pilot / production readiness checklist and blocker index. |
| [`DEV-SEED.md`](./DEV-SEED.md) | Seeded users, passwords, SEED_PRESET / SEED_RESET / SEED_COUNTRY env vars. **Never invent credentials — read this.** |
| [`LOGIN_GUIDE.md`](./LOGIN_GUIDE.md) | First-run login flow. |
| [`ENVIRONMENT_CONFIGURATION.md`](./ENVIRONMENT_CONFIGURATION.md) | Env vars catalog. |
| [`SECURITY.md`](./SECURITY.md) | Auth hardening, rate-limit policy, audit log catalog. |
| [`DEBUGGING.md`](./DEBUGGING.md) | Common dev gotchas. |
| [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) | Operator-facing recovery procedures. |
| [`TEST-PLAN.md`](./TEST-PLAN.md) | E2E test inventory + automation status. |
| [`PERF-BUDGETS.md`](./PERF-BUDGETS.md) | Performance budgets contract: bundle-size + tRPC p95 latency CI gates anchored on `perf-budget.json` (ENG-133). |
| [`A11Y.md`](./A11Y.md) | Accessibility contract: axe-core component helper, contrast CI gate on theme tokens, ARIA conventions (ENG-134). |
| [`OBSERVABILITY.md`](./OBSERVABILITY.md) | Production observability rail: sink interface + captureException/withSpan helpers, tRPC tracing middleware, per-tenant opt-in + audit, renderer-side captureRenderError; explains the adapter wiring recipe for the follow-up Sentry/GlitchTip install (ENG-135). |
| [`SHORTCUTS.md`](./SHORTCUTS.md) | Canonical keyboard-shortcut catalogue + global Command Palette UX. Declarative `SHORTCUTS` array in `apps/web/src/lib/shortcuts.ts`, `Mod+K` palette with role-filtered actions, `aria-keyshortcuts` contract for screen readers, and the recipe for adding new shortcuts or palette actions (ENG-105 slice A). |

### Long-term vision

| File | Use |
| --- | --- |
| [`LONG-TERM-VISION.md`](./LONG-TERM-VISION.md) | Platform-level themes 12-36m (accounting integrations, WhatsApp, mobile, public API, …). |

---

## 4. Authority resolution

When two docs disagree, the priority order is:

1. **`AGENTS.md` / `CLAUDE.md`** (root, symlinked) — operational
   conventions, gates, multi-tenant invariants. Top of stack.
2. **`ROADMAP.md §3b`** — `Status` column for any `ENG-NNN`.
3. **`SPRINT-PLAN.md`** — per-iter detail; aligns 1:1 with ROADMAP.
4. **`PLAN-V2.md`** — Phase 0..4 phasing for v2.0 tickets.
5. **`PLAN.md`** — strategic; cite the section read.
6. **Specialty docs** (per the tables above).
7. **`BACKLOG.md`** — never authoritative; idea capture only.

If the agent finds a contradiction, fix the lower-priority doc to
match the higher one in the same staged commit, and call it out in
the report.

---

## 5. Maintenance

When a ticket lands a new `docs/*.md` file, register it in the
right section of this README in the same commit. The skills
(`/puntovivo-ship`, `/puntovivo-review`) read this index to map
"what doc do I open for X" — drift here breaks agent navigation.
