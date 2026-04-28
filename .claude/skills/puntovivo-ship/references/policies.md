# Policies — Puntovivo ticket execution

Read this when applying Phase 2 (execution). Each policy is non-negotiable; violations risk shipping debt the operator has to clean up by hand.

## 1. Git policy

The agent owns the staging area but never the commit. The operator commits manually at their own pace, sometimes splitting your single staged blob into two commits, sometimes not.

**Allowed mutant commands**:
- `git add <specific paths>` — at the end of Phase 2, ONLY for files in the approved plan scope plus docs sync plus collateral fixes.

**Forbidden mutant commands**:
- `git commit`, `git commit --amend`
- `git push`, `git tag`
- `git reset` (any variant)
- `git restore --staged <path>`, `git restore <path>` over modified files
- `git checkout <path>` (any variant)
- `git branch`, `git stash`
- `git clean`
- PR creation (`gh pr create`, etc.)

**Read-only is unrestricted**:
- `git status`, `git status --short`
- `git diff`, `git diff --cached`, `git diff HEAD`
- `git diff --stat`, `git diff --cached --stat`
- `git log`, `git log --oneline`, `git show`
- `git blame`, `git grep`

## 2. Collateral fixes policy

The codebase is the operator's, not a museum. If during Phase 2 you spot a real bug in code adjacent to the ticket, fix it inline without asking. There is no line / file count threshold.

### What counts as a real bug (fix inline, no permission needed)

- Path stale / reference to moved or deleted file / broken import.
- Config desynchronized with the actual repo state (e.g. `engines.node` not matching `@types/node` runtime).
- Test skipped / broken for reasons unrelated to the ticket — fix the root cause, NEVER delete or weaken the test.
- Type debt: leaking `any`, mis-propagated `never`, stale enum values, broken generics.
- Schema mirror / shim out of sync with the source of truth.
- Comment that describes behaviour the code no longer has.
- Observably incorrect behaviour in code adjacent to the ticket scope.
- Orphan deps in `package.json` (declared but with zero imports).
- i18n: key present in one locale but missing in the other; hardcoded user-facing string in a render path; plural without `_one` / `_other` suffixes.
- Accessibility: button without `aria-label`, incorrect `aria-disabled` on a toggle, duplicated `data-testid` in a list.
- React / Zustand: unstable dep array, persist without `partialize`, non-pure read during render.
- Main↔renderer boundary: `require('fs')` / `process.*` / `node:*` import in renderer code (rewrite via the existing IPC bridge, never expose Node directly).

### What does NOT count as a fix (do not touch)

- Style / naming / structure refactors driven by opinion.
- File reorganization without an observable bug.
- Performance improvements without a profile or benchmark.
- "I'd prefer this function had a different signature" — that is a design decision, not a fix.

### What requires STOPPING and reporting (don't fix inline)

- Design change: the approved Phase 1 approach no longer holds against reality.
- Ambiguity in the acceptance criteria that changes the interpretation of the ticket.
- Security / privacy issue — the operator decides the threat model.
- Mixed incidental + scope work where separating fix from feature is risky.

### Recording inline fixes

Every collateral fix is listed in two places before staging:
1. Review Guide section "Prerequisite fixes" with `path/file.ts:L` + what it broke + how the fix repairs it.
2. Commit message body, at the end, as `- colateral: <one-liner>` bullets, one per line.

## 3. BACKLOG.md vs ROADMAP.md routing

`BACKLOG.md` is for **new requirements without acceptance criteria** — ideas, features the agent discovered are missing, spikes worth scoping later. Bugs go inline; they are NEVER captured to backlog.

When promoting a backlog item to a ticket, give it a working-title `ENG-NNN` so future agents know which IDs are reserved. Pattern:

```
- `[infra][sync]` Close the two follow-ups left under ENG-042's
  Remaining bullet so the row can flip from Partial to Shipped.
  Working title: ENG-043. <details...>
  — 2026-04-28 (jy)
```

## 4. Spanish dialect (neutral LATAM, never voseo)

All user-visible Spanish strings under `apps/web/src/i18n/locales/es/**` and any receipt / PDF / email rendered in Spanish must use neutral Latin American Spanish in the `tú` register.

### Conjugations and imperatives

✅ Right (`tú` register):
- Imperatives end in `-a / -e / -i`: Elige, Selecciona, Agrega, Deja, Crea, Ingresa, Guarda, Verifica, Indica, Configura.
- Conjugations: tienes, puedes, quieres, eres, sabes.

❌ Wrong (voseo):
- Imperatives ending in `-á / -é / -í`: Elegí, Seleccioná, Agregá, Dejá, Creá, Ingresá, Guardá, Verificá, Indicá, Configurá.
- Conjugations: tenés, podés, querés, sos, sabés.

### Pronouns + nouns

- Prefer omitting the subject pronoun when natural; when explicit, use `tú` (never `vos`).
- Avoid `ustedes` for 2nd-person plural unless addressing a specific multi-user group.
- For words with regional variants (e.g. `ordenador` vs `computadora`, `ficha` vs `tarjeta`), match what the existing `es/` namespace already uses.

### Audit regex

When reviewing a diff, sweep:

```bash
grep -rnE "(tenés|podés|querés|sos|[A-Z][a-z]*á\b|[A-Z][a-z]*é\b|[A-Z][a-z]*í\b)" apps/web/src/i18n/locales/es/
```

False positives: legitimate accented nouns (`categoría`, `línea`, `válida`, `política`, `ingresos`). Distinguish by context.

## 5. Commit message style (Conventional Commits)

Single message covering the entire staged universe — feature + docs sync + collateral. Style rules from the operator's global preferences and `AGENTS.md`:

- **No backticks** and **no double-quotes** in the body. Single quotes are fine.
- Hyphen bullets (`- foo`), not `*` or `•`.
- Scope per main module: `feat(receipt-templates): ...`, `fix(security): ...`, `docs(roadmap): ...`. If the diff spans several modules, use multi-line body.
- **No AI co-authorship trailer**. The user's `~/.claude/CLAUDE.md` global preference enforces this. Never add:
  - `Co-Authored-By: Claude <noreply@anthropic.com>`
  - `🤖 Generated with [Claude Code]`
  - Any footer / signature / inline mention attributing the change to Claude / an LLM / an AI assistant
- At the end of the body, bullets `- colateral: <one-liner>` per inline fix outside the ticket scope.
- Single message. Never offer a split version.

## 6. Multi-tenant invariant

Every new query in a tRPC router scopes by `ctx.tenantId`. Tests cover cross-tenant isolation — never bypass them.

Reuse the building blocks instead of writing custom middleware:

- **Role guards** in `packages/server/src/trpc/middleware/roles.ts`: `adminProcedure`, `managerOrAdminProcedure`, or compose via `createRoleGuard(roles, message)`.
- **Site-scope guard** `ensureTenantSite(ctx.db, ctx.tenantId, siteId)` in `packages/server/src/trpc/routers/inventory.ts`.
- **Cash session invariant** `requireActiveCashSession()` for sale-completion flows.

When adding a new query that takes a `siteId` input, call `ensureTenantSite` so a user cannot operate on a site from another tenant.

## 7. Native dep rebuild

When the ticket bumps a native dep (`better-sqlite3`, `argon2`, etc.) the binary cache is invalidated. Rebuild both runtimes before running gates:

```bash
npx electron-rebuild -m apps/desktop                              # Electron 41 (MODULE_VERSION 145)
node packages/server/scripts/rebuild-better-sqlite3-node.mjs      # Node 22 (MODULE_VERSION 137)
```

Both binaries are required: `scripts/ensure-native-runtime.mjs` swaps between them at startup. Skipping one of the rebuilds causes `NODE_MODULE_VERSION mismatch` at server boot.

## 8. Date awareness

The session date can change between turns (long-running flows + scheduled wakeups). When writing changelog entries, BACKLOG dates, or commit messages, use the current `Today's date is ...` from the most recent system-reminder rather than a date carried from earlier in the conversation.

## 9. Tests are sacred

If a test fails, fix the cause, not the test. Specifically:

- Never `it.skip` or `describe.skip` an existing passing test to make CI green.
- Never weaken an assertion (`toBe(5)` → `toBeGreaterThan(0)`) to dodge a regression.
- Never delete a test that is failing — root-cause it.
- If the test was wrong (asserting a behaviour the spec never required), the fix lives in the test file with a comment explaining the spec change.

If the assertion change ripples outside the ticket scope, that is a design change — STOP and report.

## 10. Smoke live is mandatory for UI changes

Per `AGENTS.md`: any change touching user-facing UI must be validated in a running web (and / or Electron) target before the task is done. Component tests + unit tests are necessary but not sufficient — they cannot catch:
- Vite dev-server JSON cache staleness.
- Route mounting regressions.
- tRPC client-side cache invalidation gaps.
- i18n bootstrap order issues in the bundled app.
- Round-trip failures between mutations and their read-side surfaces.

The smoke obligation applies to:
- New React components, props, or layouts.
- New i18n keys consumed by a component.
- New or changed tRPC read / write paths.
- Routing, navigation, or permission gating changes.
- Visible copy / icon / order / option-set changes.

If the smoke is genuinely impossible in the session, declare it explicitly in the Review Guide before claiming "done". Vitest coverage does not substitute for a live smoke.
