---
name: puntovivo-ship
description: Plan-mode-gated implementation flow for the Puntovivo POS monorepo (multi-tenant Electron + Fastify + tRPC + SQLite). Use this skill any time the operator asks to advance the engineering backlog — phrases like "implementa el siguiente paso", "el siguiente ticket pendiente", "ship the next ENG ticket", "what's next on the roadmap", "trabajo pendiente del repo", "pick up where we left off", or any context where the user wants forward motion against `docs/ROADMAP.md §3b`. Also triggers when the user provides a specific `ENG-NNN` reference and wants to ship it end-to-end, or when invoked explicitly via `/puntovivo-ship`. Always prefer this skill over ad-hoc execution when the user is operating inside the puntovivo repo. Skip only for explicit one-off bug fixes, research / exploration tasks, or refactors the user describes outside the ENG-NNN flow. The skill drives `EnterPlanMode` → write plan → `ExitPlanMode` for human Accept/Reject (the UI is the gate; never write "wait for my reply"), then full execution: ticket implementation, docs sync (ROADMAP / SPRINT-PLAN / PLAN.md / BACKLOG.md / PLAN-V2.md), CI gates (`ci:server` + `ci:web` + `ci:desktop`), review skills (`typescript-react-reviewer` + `node`), mandatory live smoke, and a single staged commit with a canonical Review Guide report.
---

# Puntovivo — ship the next ticket

Two-phase workflow with a visual gate between them. Phase 1 = research and plan in plan mode (read-only). Phase 2 = execute against the approved plan, with strict policies on git, collateral fixes, and reporting.

The gate is the Plan panel UI (Accept / Reject). Do not write "wait for my reply" — the UI handles the handshake. If the user clicks Accept, you receive `User has approved your plan` and Phase 2 starts on its own. If the user clicks Reject, wait for textual input.

## When to run

Trigger phrases (Spanish + English):
- "implementa el siguiente paso pendiente"
- "el siguiente ticket pendiente"
- "ship the next ENG ticket"
- "what's next on the roadmap"
- "trabajo pendiente del repo"
- "let's pick up where we left off"
- Specific `ENG-NNN` reference with intent to ship.
- Explicit slash invocation: `/puntovivo-ship`.

Skip when:
- The user names a specific bug fix or refactor outside the ROADMAP scope.
- The user wants research / exploration without intent to commit.
- The user describes a one-off experiment.

## Source-of-truth files

Always read against the live state of the repo, not memory from prior sessions:

| File | When to read |
| --- | --- |
| `AGENTS.md` (`CLAUDE.md` symlinks here) | Always — operational conventions, required checks, smoke-live invariant. |
| `docs/ROADMAP.md` §3b | Always — canonical `Status` column for ENG-NNN rows. |
| `docs/SPRINT-PLAN.md` | Always — iter-level execution detail; aligns 1:1 with ROADMAP. |
| `docs/PLAN-V2.md` | When the ticket is part of `ENG-025..ENG-040` (Phase 0..4 hardening + AI + fiscal + sync waves). |
| `docs/PLAN.md` | Only when the ticket touches architecture / fiscal / i18n / LATAM / multi-vertical. Cite the section read in the plan. Do NOT load the whole file. |
| `docs/BACKLOG.md` | Reference only if a backlog item crosses the in-flight ticket. NEVER pick a ticket from here. |
| `docs/DEV-SEED.md` | When you need seed credentials for the live-smoke step. NEVER invent credentials. |
| `docs/README.md` | Index of authority between the planning files when in doubt. |

When ROADMAP and PLAN disagree on Status, ROADMAP wins.

## Phase 1 — Plan (read-only)

### Step 1.1 Enter plan mode

First action of the turn: call `EnterPlanMode`. This locks the agent to read-only and surfaces the Plan panel for the user. If the tool is deferred, load it with:

```
ToolSearch query="select:EnterPlanMode,ExitPlanMode"
```

The plan artifact lives at `~/.claude/plans/<slug>.md` and is intentionally outside git. Do not copy it to `docs/` — Phase 2 docs sync writes the public summary into `ROADMAP.md` directly.

### Step 1.2 Pick the ticket

Pool = rows in `docs/ROADMAP.md §3b` with `Status` ∈ {Pending, Partial}. Skip Gated and Deferred.

Use the §3b Sequencing recommendation as the picker. Tiebreakers:
- For `Partial`, the implementable scope is the "Remaining:" tail at the end of the Scope cell.
- If multiple candidates, prefer `Partial` over `Pending` — existing scaffolding lowers risk.
- If a Pending depends on a non-Shipped ticket, skip it and document why in the plan.

If `docs/PLAN-V2.md` is the active phasing doc (typical for `ENG-025+`), let the v2.0 phase order bias the pick.

**ENG numbering**: confirm the next free ID across both `ROADMAP.md §3b` AND `SPRINT-PLAN.md §1`. Some tickets live in SPRINT-PLAN's iter table with reserved IDs that are not yet promoted to §3b — check both before taking the next number for collateral / out-of-band work. Working titles in `BACKLOG.md` (e.g. `ENG-041`, `ENG-043`) also reserve IDs.

### Step 1.3 Write the plan

Write the plan to BOTH the chat AND the plan file (ExitPlanMode reads the file). See `references/plan-template.md` for the canonical structure with example.

Required sections, in order:
- One-liner of purpose (copy from Scope cell verbatim).
- Status + Priority from ROADMAP.
- **Concrete scope**: 4-8 bullets for Pending; "Remaining:" copy + what you attack now for Partial.
- **Logical commit grouping**: mental organization only. Phase 2 ships as ONE staged commit covering everything — code, tests, i18n, docs sync, collateral fixes.
- **Files to create / modify**: paths grouped by directory.
- **Tests edge-case**: empty / loading / network / offline / invalid / permissions / i18n parity.
- **Coupled invariants** that may break: catalog counts, version pins, schema mirrors, locale parity, bundle-size budgets.
- **`PLAN.md` relevance**: yes/no. If yes, cite the section read.
- **Risks or open questions**: questions don't block Accept; they're context for the user. The user will decide before clicking.
- **Time estimate** with breakdown.
- **Restricciones entendidas**: explicit bullets from `AGENTS.md` + ticket AC + this skill (multi-tenant, no AI co-authorship, neutral LATAM Spanish, coverage floor, gates).

### Step 1.4 Exit plan mode

Last action of Phase 1: call `ExitPlanMode` with `allowedPrompts` describing the categories of bash actions the plan will need (e.g. "run npm install", "run ci:web / ci:server / ci:desktop", "boot dev:web + dev:server for live smoke", "git add and read-only git status / git diff").

The UI shows the plan with Accept / Reject. End the turn here. Do NOT add a closing message asking the user to approve — the UI is the gate.

## Phase 2 — Execute (only after Accept)

### Step 2.1 Open the turn

First line of the post-Accept turn:
```
Executing ENG-NNN — <one-liner>
```

### Step 2.2 Implement against the plan

Code, tests, i18n, docs sync, and any inline collateral fixes ship as ONE coherent staged block. Read `references/policies.md` for:
- Git policy (only `git add <paths>` is mutant; never commit / push / reset / checkout / restore).
- Collateral fixes policy (real bugs in adjacent code → fix inline; design changes / ambiguity / security → STOP and report).
- `BACKLOG.md` vs `ROADMAP.md` routing.
- Spanish dialect (neutral LATAM, `tú` register, never voseo).
- Commit message style (no backticks / double-quotes in body, hyphen bullets, no AI co-authorship trailer).

### Step 2.3 Sync docs (same diff as code)

Same staged commit covers:
- **`ROADMAP.md §3b`**: flip `Status` to `Shipped` (or update `Partial` with new "Remaining:") with a 2-3 line summary at the end of the Scope cell. Pattern: `ENG-003` / `ENG-004` / `ENG-008`.
- **`SPRINT-PLAN.md §1`**: move the row to the right section. Shrink §N detailed spec to one line if the ticket closed entirely.
- **`PLAN-V2.md`**: update phase counter (`Closed so far: ENG-XXX`) when the ticket is part of v2.0 plan.
- **`PLAN.md`**: only when the ticket invalidated a section claim. Add `### §X.0 Status Update` under the affected section. Pattern: §17.0 i18n.
- **`PLAN.md §18.1`**: register any new `docs/*.md` files created by the ticket.
- **`BACKLOG.md`**: ONLY for new requirements without acceptance criteria (ideas / features discovered as missing). Bugs are fixed inline, not captured. Working titles (`ENG-NNN`) help future agents pick clean IDs.

### Step 2.4 Run gates (this order, all green)

Run in parallel where possible:

1. `npm run ci:server` (when `packages/server/**` changed).
2. `npm run ci:web` (when `apps/web/**` changed; covers `locale-parity.test.ts`).
3. `npm run ci:desktop` (when `apps/desktop/**` changed or anything crossing the main / renderer boundary).

Coverage thresholds (post-ENG-003b): web ≥ 70/70/70/70 (statements / branches / functions / lines); server ≥ 80/63/77/80.

After CI gates: review skills over the still-unstaged diff.
- `typescript-react-reviewer` over `apps/web/**` + `apps/desktop/src/renderer/**` + tests.
- `node` over `packages/server/**` + `apps/desktop/src/main/**` + scripts.

HIGH findings → resolve inline. MEDIUM findings → list as "Follow-ups" in the Review Guide; the operator decides if they ride this commit or get deferred.

If a gate fails by ticket bug → fix in the same turn. By collateral bug → fix inline per policy. By design change / ambiguity / security → STOP and report before continuing.

### Step 2.5 Live smoke (mandatory for UI changes)

Per `AGENTS.md` UI-changes invariant: any user-facing change requires a running target validation, even if it looks small.

Smoke targets in priority order:
1. **Playwright MCP** — preferred. Boot `dev:server` + `dev:web` (or `dev:desktop`), drive the affected screen with `browser_navigate`, `browser_click`, `browser_evaluate`. Assert concrete user-visible strings + round-trip behavior.
2. **Embedded browser** validation when MCP isn't available.
3. **Computer-use / Safari** — last resort. Only when MCP browser flows are blocked or the check truly needs native visual interaction.

For Electron-boundary changes (preload, main IPC, sandbox): ALSO validate the Electron target via `dev:desktop`. The embedded Fastify is in-process; the renderer is a chromium webview. If Electron validation is infeasible (signed-build requirement, native module crash), declare it explicitly in the Review Guide as a verification gap.

Seed user: read `docs/DEV-SEED.md`. Never invent credentials.

If the entire smoke is impossible in the session (MCP blocked, dev server refuses to start), STOP and tell the user before declaring the task done. Do not let vitest coverage substitute for a live smoke.

### Step 2.6 Stage final

```
git add <ticket paths> <docs sync paths> <collateral fix paths>
git diff --cached --stat
```

Confirm the diff matches the plan scope plus any collateral fixes. Only `git add` is allowed. Never run `git commit`, `git commit --amend`, `git push`, `git tag`, `git reset`, `git restore --staged`, `git checkout` over modified files, `git branch`, or any PR creation.

### Step 2.7 Final report

Read `references/report-template.md` for the canonical Review Guide structure with example. Sections in this exact order:

1. **Estado del índice** — `git status --short` + `git diff --cached --stat`.
2. **Notas de verificación** — gates PASS/FAIL with test counters; locale-parity + review skills with residual blockers; live smoke result with explicit justification if not run; collateral fixes (one per line, or "Ninguno"); BACKLOG items captured (or "Ninguno").
3. **Review Guide — ENG-NNN** — automated gates copy-pasteable, prerequisite fixes, live smoke steps, code review focus (3-6 files ranked by criticality with cross-check checklist), docs sync checklist, rollback commands, follow-ups deferred.
4. **Commit message summary** — single Conventional Commits message that covers the entire staged universe (ticket + docs + collateral). No split version offered.

Commit message style:
- No backticks, no double-quotes in body.
- Hyphen bullets (`- foo`).
- No AI co-authorship trailer (no `Co-Authored-By: Claude`, no `Generated with Claude Code`, no watermarks). User's `~/.claude/CLAUDE.md` global preference enforces this.
- Scope per main module; multiple lines in the body if the diff spans several.
- At the end of body, bullets `- colateral: ...` for each fix outside the ticket scope.

## Constraints (both phases)

- **No feature scope expansion** beyond the approved plan. Real-bug collateral fixes don't count as scope creep.
- **No disabling, skipping, or weakening** existing tests or type rules. If a test breaks, fix the root cause, not the test.
- **Refactor only code touched by the ticket or by a real collateral fix**. No opportunistic style / naming / structure refactors elsewhere.
- **Git: only `git add <paths>` as mutant**. Read-only git is unrestricted (`status`, `diff`, `diff --cached`, `log`, `show`, `blame`, `grep`).
- **Multi-tenant invariant**: every new query scopes by `ctx.tenantId`. Reuse `adminProcedure` / `managerOrAdminProcedure` / `ensureTenantSite` / `requireActiveCashSession` — never write bespoke middleware.
- **Native rebuild after install**: when the ticket bumps a native dep (`better-sqlite3`, `argon2`), run `npx electron-rebuild -m apps/desktop` AND `node packages/server/scripts/rebuild-better-sqlite3-node.mjs` before gates. Both binaries are required because Electron 41 (MODULE_VERSION 145) and Node 22 (MODULE_VERSION 137) need separate compiled copies.
- **Background process cleanup**: `pkill -f "tsx watch.*standalone" ; pkill -f "vite$" ; pkill -f electron` at the end of any session that booted dev servers, so the next session starts clean. Never kill processes that don't belong to puntovivo.
- The Review Guide is mandatory even when live smoke wasn't possible — describe what the operator would have to run manually and explicitly flag what wasn't verified.

## When the user pivots mid-execution

If the user changes direction during Phase 2 (new instructions that contradict the approved plan), STOP, summarize the state of the staged work, and ask whether to:
- finish the original ticket and start a new plan for the new direction (preferred when the staged work is coherent),
- discard the current work and pivot,
- merge the new work into the current ticket — only if the new scope is genuinely coherent with the approved plan.

Never silently absorb new work into the current ticket.

## When the session was compacted (context truncation)

If your context was truncated and you're resuming mid-flow, before calling `EnterPlanMode`, run a recovery check:

```
git log --oneline -5            # what's already committed
git status --short              # working tree state
git diff --cached --stat        # what's already staged (if anything)
ls ~/.claude/plans/             # last approved plan, if any
```

Decision tree:
- **Working tree clean + staged empty**: start fresh. Call `EnterPlanMode`.
- **Staged or unstaged changes that match an in-progress ENG-NNN**: resume Phase 2 from where it left off. Don't re-enter plan mode.
- **Mixed / unclear state**: ask the user before doing anything mutant. Read-only inspection is always OK.

## References

- `references/policies.md` — git policy, collateral fixes, dialect, commit message style, native deps, multi-tenant invariant.
- `references/plan-template.md` — Phase 1 plan structure with worked example.
- `references/report-template.md` — Phase 2 Review Guide canonical structure with worked example.
