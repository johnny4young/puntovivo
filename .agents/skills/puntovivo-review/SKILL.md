---
name: puntovivo-review
description: "External pre-commit reviewer for the Puntovivo POS monorepo. Use when the operator asks to review staged work before commit: revisa el staged, haz review antes de commitear, review pre-commit, valida lo staged antes de subir, audit the staged diff, review my changes, or asks whether staged work is correct. Preserve git diff --cached, fix objective bugs only as unstaged reviewer edits, run relevant gates and UI smoke, check Puntovivo invariants, and report READY TO COMMIT / NEEDS DESIGN DISCUSSION / BLOCKED."
---

# Puntovivo — pre-commit review

External reviewer skill that runs after the implementer has staged a diff and before the operator commits. The split is critical: **the reviewer is NOT a second implementer**. The implementer holds business context, design intent, and the operator's earlier guidance — none of which the reviewer can be sure about from reading the diff alone. So design changes, ambiguous AC, security tradeoffs, and scope decisions all go to the **report** for the operator to resolve. Only objectively-broken things get fixed inline.

The output of this skill is two physically separated buckets:
- **`git diff --cached`** — the implementer's staged work, untouched by the review.
- **`git diff`** — the reviewer's inline fixes, sitting unstaged on top.

The operator inspects both buckets in their IDE before committing. Mixing them would force the operator to do `git diff` archaeology on every review.

## When to run

Trigger phrases (Spanish + English):
- "revisa el staged"
- "review antes de commitear" / "review pre-commit"
- "valida lo staged antes de subir"
- "audit the staged diff"
- "second opinion on what I have staged"
- "review my changes"
- Explicit slash invocation: `/puntovivo-review`.

Skip when:
- `git status --short` shows no staged changes (`git diff --cached --stat` is empty). Tell the operator: "Nothing is staged. Run the implementer flow (`/puntovivo-ship` or staging) first."
- The operator is mid-Phase-2 of `puntovivo-ship` (still implementing). The reviewer role only applies once staging is the final state the implementer wants.

## Source-of-truth files (all in git, no per-machine state)

| File | When to read |
| --- | --- |
| `AGENTS.md` (`CLAUDE.md` symlinks here) | Always — operational conventions, required checks, UI verification hard-rules, commit rules. |
| `docs/ROADMAP.md` §3b | Always — canonical Status / Priority of the ticket the diff claims to close. |
| `docs/SPRINT-PLAN.md` | Always when the iter has a §N detailed spec — that's the commit shape the implementer should have followed. |
| `docs/PLAN.md` | Only via grep for the specific `ENG-NNN` if the ticket touches architecture / fiscal / i18n / LATAM / multi-vertical. NEVER load the whole file. |
| `docs/PLAN-V2.md` | When the ticket is `ENG-025..ENG-040` (Phase 0..4 of v2.0 plan). |
| `docs/BACKLOG.md` | Destination for out-of-scope findings. NEVER pick tickets from here; only append at the end (file lands unstaged like every reviewer edit). |
| Conversation chat (if available) | The Phase-1 plan approved before the implementer started. The staged diff MUST correspond to it; files outside the approved plan are scope creep — REPORTED, not fixed. |

When ROADMAP and PLAN disagree on Status, ROADMAP wins.

## Workflow

### Step 1 — Orient

```
git status --short
git diff --cached --stat
git diff --stat                      # any pre-existing unstaged work the operator left for you to see
git log --oneline -5
```

Read `.git/COMMIT_EDITMSG` if it exists — the implementer's draft commit message. Identify the `ENG-NNN` the diff claims to close.

Validate against `ROADMAP.md §3b`:
- Does the ticket exist?
- Is the Status `Pending` or `Partial`?
- Does the staged scope fall inside the Scope cell (Pending) or "Remaining:" tail (Partial)?

If `SPRINT-PLAN §N` has a per-iter commit spec, read it — that's the shape the implementer should match.

### Step 2 — Align with the approved plan

If the conversation chat has the Phase-1 plan from `puntovivo-ship`, compare each staged file against it:
- Files NOT in the plan → **scope creep finding** (report, do not fix).
- Files in the plan but absent from staging → **missing-file finding** (report).
- Logical units in unexpected order → reportable, but only if it actually impacts the review (e.g. tests written before code can mask regressions).

If no plan is available (compacted session, slash invocation without prior context), skip this step — derive the ticket boundary from the commit message + ROADMAP scope cell.

### Step 3 — Cheap gates (run all, report PASS/FAIL)

- `npm run ci:server` (when the diff touches `packages/server/**`).
- `npm run ci:web` (when the diff touches `apps/web/**`; covers `locale-parity.test.ts`).
- `npm run ci:desktop` (when the diff touches `apps/desktop/**` or anything crossing main↔renderer).

If a gate fails by **real bug** → fix inline per policy.
If a gate fails by **design / security** → STOP and report.

### Step 4 — Review skills in parallel over the staged diff

- `typescript-react-reviewer` over `apps/web/**` + `apps/desktop/src/renderer/**` + `tests/components/**` + E2E specs.
- `node` over `packages/server/**` + `apps/desktop/src/main/**` + `scripts/**` + `vite*.config.*`.
- Run BOTH if the diff crosses surfaces (e.g. a tRPC procedure + its renderer caller).

Consolidate findings:
- Real bugs → fix inline.
- Design / ambiguity → report.

### Step 5 — Repo-specific checks

Read `references/repo-checks.md` for the full list with examples. Highlights:

| Check | Fix inline policy |
| --- | --- |
| Multi-tenant invariant (every new query scoped by `ctx.tenantId`) | FIX inline if a `where(...)` is missing the scope. |
| i18n parity (en + es with same key tree, plurals via `_one`/`_other`) | FIX inline: add the missing key to the other locale, or mark `TODO-es` / `TODO-en` if you cannot translate. |
| Migrations idempotent (`IF NOT EXISTS` when table exists via `runSchemaSync`) | FIX inline (one-liner). |
| Audit log enum + i18n key in `AuditLogsTable` | FIX inline if enum present but i18n missing. |
| Test edge cases (empty / invalid / Unicode / boundary / round-trip) | FIX inline by adding the test. |
| Main↔renderer boundary (no `node:*`/`require('fs')`/`process.*` in renderer) | FIX inline by routing via the existing IPC bridge. |
| Offline-first (no new `fetch`/`XMLHttpRequest`/`WebSocket` in runtime) | FIX inline by routing via IPC. |
| React 19 + Zustand patterns (no `Date.now()` in render, persist with `partialize`, stable deps) | FIX inline. |
| Doc sync (ROADMAP §3b Status flip, SPRINT-PLAN §1 update, PLAN.md / PLAN-V2.md / BACKLOG.md as applicable) | FIX inline — it's a docs edit, not a code change. |
| Native dep rebuild (when the diff bumps `better-sqlite3` / `argon2`) | Report if the rebuild scripts were not run; fix inline only if it's a one-shot script invocation evident from the diff. |
| Voseo audit on new ES copy | FIX inline by replacing voseo imperatives (`Retomalo`, `Seleccioná`) with `tú` (`Retómalo`, `Selecciona`). |

### Step 6 — UI smoke (only when the diff is user-facing)

Per `AGENTS.md` UI-changes invariant. Targets in priority order:
1. **Playwright MCP** — preferred. Boot `dev:server` + `dev:web` (or `dev:desktop`), drive the affected screen with `browser_navigate` / `browser_click` / `browser_evaluate`. Assert concrete visible strings + round-trip.
2. **Embedded browser** when MCP isn't available.
3. **Computer-use / Safari** — last resort.

Flip locale to ES and re-verify. Console errors must remain at 0.

If smoke is impossible in the session (MCP blocked, dev server refuses to start, packaged-build requirement), declare it explicitly in the report. Do NOT fail the review just because the smoke didn't run — but flag the gap loudly.

Seed user from `docs/DEV-SEED.md`. NEVER invent credentials.

## Inline fix policy (summary)

Read `references/inline-fix-policy.md` for the full taxonomy. Quick tree:

**FIX inline (no permission needed):** typos, broken imports, stale path references, config drift, broken / weakened tests, type debt, schema mirror out-of-sync, comments describing removed behaviour, observably incorrect adjacent code, orphan deps, i18n parity gaps, accessibility issues, React/Zustand anti-patterns, main↔renderer boundary leaks, missing doc sync, voseo in ES copy.

**REPORT, don't fix:** design changes, scope creep, AC ambiguity, security/privacy issues, mixed incidental + scope where separating is risky.

**Don't touch:** style/naming/structure refactors by opinion, file reorg without a bug, performance without a profile, "I'd prefer a different signature" — those are design decisions belonging to the implementer.

When a fix you applied uncovers another bug, fix that one too. Cap: if the cascade reaches > 5 files outside the original ticket scope, STOP and report — that's a sign the diff has structural issues better resolved by the implementer.

## Report structure (canonical)

Read `references/report-template.md` for the full structure with worked example (the ENG-042 review). Sections in this exact order:

1. **Review verdict** — ticket, scope check, verdict (READY TO COMMIT / NEEDS DESIGN DISCUSSION / BLOCKED), staging state, count of unstaged reviewer files.
2. **Gates** — each gate PASS/FAIL plus review skills findings counters plus UI smoke status.
3. **Bugs fixed inline** — every inline fix with `path/file.ts:L` + what broke + how the fix repairs it. No severity split. If none: explicit "Ninguno — el diff del implementer pasó limpio."
4. **Design / scope findings — NO fixeados** — items that need the operator's input, with "why not fixed" explanation.
5. **Out-of-scope requirements → BACKLOG.md** — items written to BACKLOG (and the file lands unstaged like every reviewer edit).
6. **Doc sync checklist** — verification of the implementer's doc work, with `[x]` / `[ ]` / `✎` (reviewer-fixed-inline) markers.
7. **Commit message summary** — single Conventional Commits message covering staged + reviewer-unstaged. No split version offered.
8. **Cómo sigue usted** — read-only git commands the operator can use, plus the commit paths. Do NOT include any mutant git command in your report's recommended actions.

## Closing rule (no git mutation at end)

There is no closing step that touches git. Finish the report and stop. The staging stays intact with the implementer's work; reviewer fixes stay unstaged on top. The operator decides what enters the commit.

## When the session was compacted

If your context was truncated and you're resuming:

```
git status --short
git diff --cached --stat
git diff --stat
git log --oneline -5
cat .git/COMMIT_EDITMSG  # if exists
```

Decide:
- **Staging non-empty + COMMIT_EDITMSG exists**: orient from the message + ROADMAP scope cell. Proceed with the review.
- **Staging non-empty + no draft message**: derive the ticket from the diff itself (look for `ENG-NNN` references in code comments / doc edits). If no ticket signal at all, ask the operator before doing anything mutant.
- **Staging empty**: tell the operator there is nothing to review.

## Anti-patterns the reviewer must avoid

- **Becoming a second implementer**: rewriting the implementer's approach, restructuring code by opinion, demanding stylistic changes that aren't bugs. The implementer holds context the reviewer doesn't.
- **Hidden inline fixes**: applying fixes without listing them in the report. Every reviewer edit MUST appear in "Bugs fixed inline" with file:line + reason. Otherwise the operator finds them in `git diff` and loses trust.
- **Vague gate output**: "ci:web passed" with no test counters or coverage. The operator can't tell if a gate passed by skipping or by genuine green. Always include numbers.
- **Optimistic verdicts when the smoke didn't run**: `READY TO COMMIT` requires that the live smoke happened OR an explicit "smoke skipped because <concrete reason>" with what the operator must run manually. Don't paper over a missing smoke with a happy verdict.
- **Mutant git commands in the report**: never recommend `git add` / `git commit` / `git restore --staged` as part of the review's "Cómo sigue usted". The reviewer's job ends with the report; the operator decides commit shape.
- **AI co-authorship leakage** in the suggested commit message: no `Co-Authored-By: Claude`, no `🤖 Generated with Claude Code`. The user's `~/.claude/CLAUDE.md` global preference forbids it.
- **Confusing `git diff` and `git diff --cached`** in the report: be explicit about which bucket is which. The operator distinguishes by IDE colour; the report should match.

## References

- `references/inline-fix-policy.md` — full taxonomy of fix-inline vs report-only vs don't-touch with examples.
- `references/repo-checks.md` — the 11 repo-specific checks with examples and inline-fix recipes.
- `references/report-template.md` — canonical Review Guide structure with the ENG-042 worked example.
