# Phase 2 — Review Guide canonical structure

After staging the final diff, the agent reports in this exact section order. The operator pastes the gates copy-pasteable verbatim, follows the smoke steps verbatim, and uses the focus list to direct their code review. Anything missing forces them to reconstruct the context — that's friction.

## Top-level section order (exact)

1. **Estado del índice**
2. **Notas de verificación**
3. **Review Guide — ENG-NNN**
4. **Commit message summary**

## Section 1 — Estado del índice

```
### Estado del índice

git status --short
<paste literal output>

git diff --cached --stat
<paste literal output>
```

## Section 2 — Notas de verificación

```
### Notas de verificación

- ci:server: PASS / FAIL (test counters: N test files, M tests passing).
- ci:web: PASS / FAIL (with coverage stats).
- ci:desktop: PASS / FAIL (or "no aplica — diff no toca apps/desktop").
- locale-parity.test.ts: PASS / FAIL (covered by ci:web).
- Review skills:
  - typescript-react-reviewer: 0 HIGH, N MEDIUM (resolved inline /
    listed as Follow-ups), M LOW.
  - node: 0 HIGH, N MEDIUM, M LOW.
- Smoke live: <corrido / "no se pudo verificar en esta sesión">
  with explicit justification if not run.
- Fixes colaterales aplicados:
  - <one per line, with file:line and one-liner>
  Or "Ninguno" if none.
- BACKLOG items capturados:
  - <one per line, with [domain] tag>
  Or "Ninguno" if none.
```

## Section 3 — Review Guide — ENG-NNN

The most important section. Seven sub-bullets, in this order:

```
### Review Guide — ENG-NNN

**1. Automated gates** (copy-pasteable):

```
npm run ci:server
npm run ci:web
npm run ci:desktop
npm run test --workspace=@puntovivo/server -- --run packages/server/src/__tests__/<file>.test.ts
npm run test --workspace=@puntovivo/web -- --run apps/web/src/<feature>/<file>.test.tsx
```

List the EXACT path of every test file the ticket added or changed.
The operator runs these to validate after pulling.

**2. Prerequisite fixes** (every collateral applied):

- `path/file.ts:L` — what broke + how the fix repairs it.
- ...

If none: "Ninguno".

**3. Live smoke**:

* Target: `npm run dev:desktop` / `npm run dev:web` + `npm run dev:server`.
* Seed user: email + password from `docs/DEV-SEED.md`. NEVER invent.
* Numbered steps: "1. Navigate to /X. 2. Click Y. 3. Wait for Z."
* SQL queries against `packages/server/data/local.db` if applicable.
* Electron vs web differences if any.
* Hard assertion: 0 errors in console logs.

If smoke was not possible in the session, say so and list what the
operator would have to run manually.

**4. Code review focus** — 3-6 files ranked by criticality:

1. `path/file.ts` — what to look at (e.g. verify `ctx.tenantId` in
   the query at line L; that `writeAuditLog` runs inside the tx).
2. `path/file.tsx` — ...
3. ...

Cross-check checklist (mark each):
- [ ] Multi-tenant: every new query scopes by `ctx.tenantId`.
- [ ] Permissions by role: cashier / manager / admin gating intact.
- [ ] i18n parity: every new EN key has an ES counterpart, no voseo.
- [ ] Snapshots immutable: report queries use frozen columns
  (per ENG-020 pattern).
- [ ] Sandbox: `apps/desktop/src/main/__tests__/window-config.test.ts`
  still pinning `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false`.
- [ ] Native rebuild: if a native dep changed, electron-rebuild
  AND better-sqlite3 Node rebuild ran cleanly.

**5. Docs sync checklist**:

- [x] ROADMAP §3b Status flip applied (Pending → Shipped /
  Partial with updated Remaining).
- [x] SPRINT-PLAN §1 row moved to closed section, §N detailed
  shrunk to one line.
- [ ] PLAN.md `### §X.0 Status Update` added (only if applicable).
- [ ] PLAN.md §18.1 docs registered (only if new docs created).
- [ ] PLAN-V2.md phase counter updated (only if v2.0 ticket).
- [ ] BACKLOG.md (only if a new requirement was discovered).

Mark `[x]` for everything applied, `[ ]` (skipped) when not
applicable, and `✎` for items the agent fixed inline that the
implementer had missed.

**6. Rollback rápido** (if you reject):

```
git restore --staged .
git checkout .
```

New files also need to be removed manually with `rm <path>`.
List any DB or filesystem state that needs additional cleanup
(e.g. backed-up local.db files).

**7. Follow-ups diferidos** (not staged):

- Requirements newly captured to BACKLOG today.
- MED findings from review without inline resolution (one line each).
- Out-of-scope ideas surfaced but not captured.

If none: omit the section.
```

## Section 4 — Commit message summary

```
### Commit message summary

<single Conventional Commits message that covers EVERYTHING staged
(ticket + docs sync + collateral). Style:
- no backticks / no double-quotes in body
- hyphen bullets
- no AI co-authorship trailer
- scope per main module; multi-line body if spans several
- end of body: bullets `- colateral: ...` per inline fix outside
  ticket scope>

NO offer of a split version. One commit, one history.
```

## Worked example: ENG-026 final report (abridged)

```markdown
### Estado del índice

git status --short
M  apps/desktop/package.json
M  apps/desktop/src/main/index.ts
M  apps/web/package.json
M  apps/web/tsconfig.json
M  docs/BACKLOG.md
M  docs/ROADMAP.md
M  docs/SPRINT-PLAN.md
M  package-lock.json
M  package.json
M  packages/server/package.json

git diff --cached --stat
 ... 10 files changed, 808 insertions(+), 286 deletions(-)

### Notas de verificación

- ci:server: PASS (45 test files, 524 tests; coverage 84.12 / 68.43 / 80.7 / 85.02 over 80/63/77/80 floor).
- ci:web: PASS (typecheck + lint + test:coverage + build via Rolldown ~470 ms).
- ci:desktop: PASS (typecheck + lint + 14 tests + build).
- locale-parity.test.ts: PASS (no i18n changes).
- Review skills: 0 HIGH, 1 MEDIUM resolved inline (engines.node drift).
- Smoke live: corrido. Vite 8 dev boot 291 ms; login round-trip OK; Electron embedded server boot 13 s with database initialized.
- Fixes colaterales aplicados:
  - apps/web/tsconfig.json:5 — lib ES2020 → ES2022.
  - apps/desktop/src/main/index.ts:793 — drop redundant let initializer.
  - apps/desktop/package.json:91 + packages/server/package.json:69 — engines.node >=20.0.0 → >=22.0.0.
  - apps/desktop/src/main/index.ts:103-110 — MIGRATIONS_PATH dev branch anchored to app.getAppPath().
- BACKLOG items capturados: [infra][migrations] Harden ensureMigrationBaseline() for partial-adoption.

### Review Guide — ENG-026

**1. Automated gates**:
npm run ci:web
npm run ci:server
npm run ci:desktop

**2. Prerequisite fixes**:
- apps/web/tsconfig.json:5 — Array.prototype.at usado en 5 call sites.
- apps/desktop/src/main/index.ts:793 — typescript-eslint v8 no-useless-assignment.
- engines.node bump >=22.0.0.
- MIGRATIONS_PATH dev branch fix for Rolldown.

**3. Live smoke**:
* Target: dev:desktop + dev:web + dev:server.
* Seed: admin@localhost / Admin123!Dev (per docs/DEV-SEED.md).
* Steps:
  1. Backup + delete local DB if legacy state.
  2. npm run dev:desktop. Wait for "embedded server started".
  3. Login as admin in Electron window.
  4. Navigate /receipt-templates — editor loads with autocomplete + linter.
  5. Navigate /sales — cart Zustand renders, no console errors.

**4. Code review focus**:
1. apps/web/tsconfig.json:5 — verify lib: ES2022 consistent.
2. apps/desktop/src/main/index.ts:793 — assertRowBelongsToActiveTenant intact.
3. engines.node — confirm >=22.0.0 matches root.
4. docs/ROADMAP.md ENG-025 + ENG-026 — Status: Shipped pattern.

Cross-check:
- [x] Multi-tenant: not affected.
- [x] Sandbox: window-config.test.ts still green.
- [x] i18n parity: no i18n changes.
- [x] Native rebuild: electron-rebuild + better-sqlite3 Node ran cleanly.

**5. Docs sync checklist**:
- [x] ROADMAP §3b: ENG-025 + ENG-026 → Shipped.
- [x] SPRINT-PLAN §1: Plan v2.0 row → Pending (2 / 16 closed).
- [ ] PLAN.md Status Update — no aplica.
- [ ] PLAN.md §18.1 — no docs nuevos.
- [x] BACKLOG.md: [infra][migrations] shim hardening capturado.

**6. Rollback**:
git restore --staged .
git checkout .

**7. Follow-ups diferidos**:
- BACKLOG [infra][migrations]: shim hardening for partial-adoption.
- LOW (Node review): packaged smoke not run in this session.

### Commit message summary

chore(deps): bump Vite 8 + plugin-react 6 + types/node 24 (ENG-026)

- Vite 7.3.x to 8.0.10 in apps/web and apps/desktop. Build runs
  through Rolldown now; npm run build --workspace=@puntovivo/web
  finishes in ~470 ms vs ~4-5 s on Vite 7.
- @vitejs/plugin-react 4.x to 6.0.1 in both workspaces.
- @types/node 22.19.x to 24.12.2 in root, apps/desktop, and
  packages/server.
- Bundle deltas within 1 percent of the ENG-016 pass 4 baseline.
- Live smoke through dev:web + dev:server + dev:desktop: all
  three boot cleanly, login round-trip OK, no console errors.
- ROADMAP and SPRINT-PLAN docs sync.
- BACKLOG captures one new requirement: harden
  ensureMigrationBaseline().
- colateral: apps/web/tsconfig.json lib raised from ES2020 to
  ES2022 to align with apps/desktop and packages/server.
- colateral: apps/desktop/src/main/index.ts:793 dropped the
  redundant let initializer for typescript-eslint v8.
- colateral: engines.node >=20.0.0 → >=22.0.0 in apps/desktop and
  packages/server.
- colateral: apps/desktop/src/main/index.ts MIGRATIONS_PATH dev
  branch anchors against app.getAppPath() because Vite 8 Rolldown
  rewrites import.meta.url.
```

## Anti-patterns to avoid

- **Vague gate output** — "ci:web passed" without test counters or coverage. The operator can't tell if a gate passed by skipping or by genuine green.
- **Missing live smoke justification** — claiming "smoke not possible" without explaining why. Acceptable reasons: native-signed-build requirement, MCP blocked, dev server boot failure (with logs). Unacceptable: "I forgot" or "no time".
- **Hidden collateral fixes** — fixes outside the ticket scope NOT listed in the report. The operator will discover them in `git diff --cached` and lose trust. Always list every collateral fix with file:line.
- **Optimistic time estimates** — "Total ~30 min" when the actual work has 4 gates + smoke + review + report. Be honest. Buffer for triage.
- **Split commit message offers** — "Here's a single commit, but here's also a split version in case you want it" is friction. The operator asked for one history; give one.
- **AI co-authorship leakage** — `Co-Authored-By: Claude`, `🤖 Generated with Claude Code`, or any "AI assistant" mention in the commit body. The user's global preference forbids it. Triple-check before staging.
