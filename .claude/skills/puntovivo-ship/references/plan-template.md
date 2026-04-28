# Phase 1 plan — canonical structure

The plan goes in BOTH the chat (so the user reads it inline) AND the file at `~/.claude/plans/<slug>.md` (so `ExitPlanMode` can serialize it for the UI).

## Structure (exact section order)

```
# Proposed: ENG-NNN — <one-liner from Scope cell>

## Context

<Why this ticket now. What position the repo is in. What earlier
tickets shipped that unblock this. What earlier discussion shaped
the approach.>

## Status / Priority

- ROADMAP `Status: <Pending | Partial>` → after this ticket ships:
  `<Shipped | Partial with reduced Remaining>`.
- Priority: <Low | Medium | High | Critical> (per ROADMAP).

## Scope concreto

<For Pending: 4-8 bullets summarising the Scope cell.>
<For Partial: copy the "Remaining:" verbatim, then a sub-section
  "What this iter attacks" with the specific subset.>

## Commits lógicos (organización mental — no se ejecutan)

<Per AGENTS.md and this skill, all changes ship as ONE staged
commit. The mental grouping is for sequencing inside Phase 2
only.>

1. `chore(deps): ...`
2. `feat(<module>): ...`
3. `docs(roadmap): ...`

## Archivos a crear / modificar

```
<grouped by directory>
apps/web/src/...                         EDIT  (...)
apps/web/src/.../newfile.ts              NEW
packages/server/src/...                  EDIT
docs/ROADMAP.md                          EDIT  (Status flip + summary)
docs/SPRINT-PLAN.md                      EDIT
```

<count: N NEW files, M EDITed files. Estimated diff ~X lines net.>

## Tests edge-case to verify

- Empty / clean install case.
- Loading state.
- Network failure / offline branch.
- Invalid input (Zod refusal).
- Permission failure (cashier rejected, manager rejected, admin OK).
- i18n parity (en + es match).
- <ticket-specific edge cases>

## Coupled invariants que pueden romper

- <e.g. bundle size budget — pin via post-build inspection>
- <e.g. multi-tenant scope on a new query>
- <e.g. test runner / framework compatibility with the bump>
- <e.g. native module rebuild required after dep change>

## docs/PLAN.md relevance

<"Not applicable" if the ticket does not touch architecture / fiscal
/ i18n / LATAM / multi-vertical.>
<Otherwise: cite the section read, e.g. "PLAN.md §10 hybrid DB
runtime, §13 fiscal rules — neither is invalidated by this work; no
Status Update needed.">

## Riesgos / preguntas abiertas

- **Q1**: <question that doesn't block Accept but the operator
  should know>
- <risk + mitigation>

## Tiempo estimado

- <step 1>: ~X min
- <step 2>: ~Y min
- ...

Total ~N h.

## Restricciones entendidas

- **Multi-tenant**: <state how this ticket respects ctx.tenantId>.
- **No git mutation beyond `git add <paths>`**.
- **No co-authorship trailer** in any commit message.
- **Spanish copy = neutral LATAM, never voseo**.
- **i18n parity** stays green.
- **Coverage floor stays ≥ 70/70/70/70** (web) and the server
  thresholds.
- **Live smoke is MANDATORY** per AGENTS.md UI-changes invariant.
- **Review skills** before staging: typescript-react-reviewer (web
  + renderer) + node (server + main). HIGH findings resolved
  inline.
```

## Worked example: ENG-026 (Vite 8 bump)

```markdown
# Proposed: ENG-026 — Vite 8 + plugin-react 6 + types/node 24

## Context

ENG-026 is the second item of Phase 0 hardening in PLAN-V2.md §2,
right after ENG-025 (security closure shipped in 5734d0a + 6471007).

The 2026-Q2 dependency audit identified three coordinated major
bumps that ride together because their peerDeps are entangled:
- vite 7.3.x → 8.x  (web + desktop workspaces)
- @vitejs/plugin-react 4.x → 6.x  (peer of vite; v4 caps at vite ^7)
- @types/node 22.19.x → 24.x  (root + apps/desktop + packages/server)

Pre-flight survey confirmed React Compiler stays OFF
(`babel-plugin-react-compiler` not installed; v6 is opt-in via that
package). Forge plugin-vite declares no peerDeps so no overrides
needed.

## Status / Priority

- ROADMAP Pending → after this ticket ships: Shipped.
- Priority: Low.

## Scope concreto (4 bullets)

1. package.json range bumps in 4 files (root, apps/web,
   apps/desktop, packages/server).
2. npm install to refresh package-lock.json. If Forge plugin-vite
   blocks at install, add an `overrides` block; if even that fails,
   defer the desktop bump to a follow-up.
3. Native rebuild (electron-rebuild + better-sqlite3 Node) + 3
   gates in parallel.
4. Docs sync (ROADMAP §3b, SPRINT-PLAN §1).

## Commits lógicos (organización mental — no se ejecutan)

1. chore(deps): bump Vite 8 + plugin-react 6
2. chore(deps): bump @types/node 24
3. docs(roadmap): mark ENG-026 shipped

When staging, all the diff lands together under one commit message
covering everything.

## Archivos a crear / modificar

```
package.json                       EDIT  (root, types/node bump)
package-lock.json                  REFRESH (npm install)
apps/web/package.json              EDIT
apps/desktop/package.json          EDIT
packages/server/package.json       EDIT
docs/ROADMAP.md                    EDIT  (ENG-026 → Shipped)
docs/SPRINT-PLAN.md                EDIT  (status row update)
```

0 NEW files, 7 EDITed files. Estimated diff ~50 lines net + lockfile.

## Tests edge-case to verify

- Empty / clean install: `rm -rf node_modules && npm install`
  yields the same lockfile state.
- Build output regression: `ReceiptTemplatesPage` stays in same
  order of magnitude (~480-510 kB raw, ~155-165 kB gzip). >20%
  jump triggers investigation.
- i18n parity: `locale-parity.test.ts` stays green.
- CodeMirror chunk integrity: receipt-templates lazy bundle still
  includes the `@codemirror/*` packages without inlining into
  index.js.
- Test runner compat: Vitest 4.1.5 successfully runs against Vite 8.
- Type strictness: `tsc --noEmit` passes with @types/node 24.

## Coupled invariants

- @electron-forge/plugin-vite peerDep cap (mitigated with overrides
  escape hatch).
- vitest.config.ts re-uses Vite resolver — Vitest 4 peerDeps
  flexible (>=5).
- vite.main.config.ts external array MUST stay external.
- Lazy chunk hashes change is expected and harmless.
- Native binary cache may need refresh.

## docs/PLAN.md relevance

Not applicable. Dependency bumps are not fiscal / i18n / LATAM /
multi-vertical decisions.

## Riesgos / preguntas abiertas

- **Q1**: @electron-forge/plugin-vite peerDep cap — handled by
  override-or-defer escape hatch.
- **Q2**: React Compiler activation — explicitly deferred.
- **Q3**: bundle-size budget regression — acceptance is "no
  regression in receipt-templates editor and lazy chunks" (per
  ROADMAP).

## Tiempo estimado

- Range bumps + npm install + lockfile refresh: ~30 min.
- Forge plugin-vite compat check + overrides decision: ~30 min.
- Native rebuild + 3 gates in parallel: ~15 min.
- Bundle-size comparison + live smoke: ~30 min.
- Review skills over the diff: ~30 min.
- Docs sync: ~30 min.
- Buffer for Forge incompatibility / regression triage: ~30 min.

Total ~3 h.

## Restricciones entendidas

- **Multi-tenant**: not affected (no new query surface).
- **No git mutation beyond `git add <paths>`** — single staged
  commit at the end.
- **No co-authorship trailer** in any commit message.
- **Spanish copy = neutral LATAM, never voseo** — no copy touched.
- **i18n parity** stays green — no new keys.
- **No new feature dependency** — only bumps.
- **Coverage floor stays ≥ 70/70/70/70**.
- **Live smoke is MANDATORY** even though this is a deps bump.
- **Review skills**: typescript-react-reviewer + node. HIGH
  findings resolved inline.
```

## Tips for writing strong plans

- **Be specific about file paths** — vague paths (`some web file`) lead to scope creep in Phase 2.
- **List risks honestly** — the operator wants to know what could blow up. A plan that pretends nothing is risky is a plan that breaks at gate time.
- **Explain the "why" behind constraints** — e.g. why ENG-NNN ties to ENG-MMM, why a particular invariant matters. This helps the operator decide before clicking Accept.
- **Time estimates with buffer** — actual work always takes longer than the happy path. Include explicit buffer for triage.
- **Restricciones entendidas as the closing section** — proves to the operator you read AGENTS.md and the prompt, and reduces the chance of forgotten gates in Phase 2.
