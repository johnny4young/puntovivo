# Inline-fix policy — what to fix vs report vs leave alone

The reviewer's hardest job is calibrating what counts as "real bug" vs "design decision". Both extremes hurt the operator: if you fix too much, you stomp the implementer's intent and force the operator to undo your edits; if you fix too little, the operator commits debt. This guide is the calibration.

## The three buckets

### Bucket 1 — FIX INLINE (no permission needed)

Real bugs that any reasonable engineer would fix without asking. They are objectively broken: someone reading the code can point to the bug and the fix without negotiating intent.

#### Code-level

- **Typos** in comments, error messages, log strings, exported identifiers (when used elsewhere with the typo'd name — break the chain).
- **Broken imports**: import points at a renamed / deleted file, or pulls a symbol that no longer exists.
- **Stale paths**: hardcoded path strings to files that moved.
- **Type debt**: leaked `any` where a concrete type fits, mis-propagated `never`, stale enum values, broken generics that fail `tsc --noEmit`.
- **Test broken or weakened**: `it.skip` / `describe.skip` for a reason unrelated to the ticket, assertions changed from `toBe(5)` to `toBeGreaterThan(0)` to dodge a regression. **NEVER** delete or weaken — fix the cause.
- **Schema mirror out-of-sync**: a Zod schema that no longer matches the Drizzle column shape, a TS type that drifted from a JSON schema.
- **Comment describing removed behaviour**: comment says "X happens here" but the code no longer does X.
- **Observably incorrect adjacent code**: a `==` that should be `===`, a `??` reaching for a null that's actually `undefined`, a date-format mismatch in a test fixture.

#### Dependency / config

- **Orphan deps in package.json**: package declared but with zero imports across the monorepo. Remove from package.json.
- **Config drift**: `engines.node` in workspace `package.json` declaring `>=20` while root mandates `>=22`, `lib` in `tsconfig.json` missing the ES tier the codebase already uses (e.g. `Array.prototype.at` requiring ES2022).
- **Stale registered file in `PLAN.md §18.1`** when the file was deleted.
- **Unused entry in `auditLogActionEnum`** with no consumer left in the codebase.

#### i18n

- **Key in one locale only**: `en/common.json` has `foo.bar` but `es/common.json` doesn't, or vice-versa. Add the missing key. If you can translate confidently, do; otherwise mark `TODO-es: <english string>` or `TODO-en: <spanish string>` and let the operator review.
- **Plural without `_one` / `_other` suffixes**: `t('count.items', { count })` rendering as a ternary in JSX. Refactor to suffixed keys.
- **Hardcoded user-facing string**: a literal Spanish or English string in a render path that bypasses `t()`. Move to a key.
- **Voseo in ES copy**: imperatives ending in `-á / -é / -í` (`Retomalo`, `Seleccioná`, `Agregá`), conjugations like `tenés` / `podés` / `querés` / `sos`. Replace with `tú`-register equivalents (`Retómalo`, `Selecciona`, `Agrega`, `tienes`, `puedes`, `quieres`, `eres`). False positives: legitimate accented nouns (`categoría`, `línea`) — don't touch those.

#### Accessibility

- **Button without `aria-label`** on icon-only triggers.
- **`aria-disabled` incorrect**: button visually disabled but `aria-disabled` not set, or set without `disabled` attribute (mismatch).
- **Disabled button without explanation**: when a button is disabled in a non-obvious context (e.g. only when `localRecordExists === false`), add `aria-describedby` pointing at the explanation node.
- **Duplicate `data-testid`** in a list rendering — append the row id.

#### React / Zustand

- **Non-pure read during render**: `Date.now()`, `Math.random()`, `crypto.randomUUID()` called in the JSX body or directly in a hook factory. Move to `useEffect` / `useMemo` / event handler.
- **Persist without `partialize`**: a `create(persist(...))` Zustand store without an explicit `partialize` selector. Add one.
- **Unstable dep array**: `useEffect(() => {...}, [{ a: 1 }])` — the object literal recreates every render. Move to a `useMemo` or destructure.
- **Mutation in render path**: `setState` called directly in render (not in an effect or handler) without a guard.

#### Main ↔ renderer boundary (Electron)

- **`require('fs')` / `require('path')` / `import 'node:*'` in `apps/web/src/**`** or `apps/desktop/src/renderer/**`. The renderer is sandboxed; route the capability through `ipcMain.handle` → `contextBridge` → `window.api.*`. Existing bridge usually has the right primitive — pick it; if not, REPORT (adding a new IPC channel is a design decision, not a fix).
- **`process.*` access in renderer code** — same reasoning.

#### Offline-first

- **New `fetch(...)` / `XMLHttpRequest` / `WebSocket` in runtime code** that should be a tRPC call or IPC. The Pyodide CDN load is the only legitimate `fetch` in the codebase.

#### Documentation sync

- **Implementer forgot to flip ROADMAP §3b Status** from Pending/Partial to Shipped. Apply the flip with the standard 2-3 line summary at the end of the Scope cell (pattern: `ENG-003` / `ENG-004` / `ENG-008`).
- **Implementer forgot to update SPRINT-PLAN §1**. Move the row, shrink §N if the ticket closed.
- **PLAN-V2.md phase counter stale** (e.g. "Closed so far: ENG-025" when ENG-026 just shipped). Bump the counter.
- **PLAN.md §18.1 missing a registered new doc**. Add the entry.
- **Stale `.git/info/exclude` rule** that hides legitimate project files. Tighten the pattern.

### Bucket 2 — REPORT, don't fix

Things where the implementer's intent matters, the operator might disagree with you, or the fix changes the approach itself.

- **Design change**: the approved Phase-1 plan no longer holds against reality. The implementer might have reasons you don't see; flag the inconsistency for the operator.
- **Scope creep**: the diff touches files outside the approved plan. Even if those edits are correct, list them — the operator may want to split or revert.
- **AC ambiguity**: the ticket says "send a notification" but doesn't specify channel; the implementer picked email; you might think SMS was intended. Report; don't override.
- **Security / privacy**: a new endpoint that surfaces tenant-scoped data to a non-tenant role. Report — the threat model is the operator's call.
- **Mixed incidental + scope work**: the implementer fixed a real bug in the same diff as the feature, but separating them now would force you to undo half the diff. Report so the operator decides whether to keep the merge or split.
- **Performance regression suspected**: e.g. a new query inside a loop, but you don't have a profile. Report with the concern; let the operator decide if it warrants a refactor before commit.
- **API contract change** that affects consumers outside the diff (other apps, scripts, docs in other repos).

### Bucket 3 — DON'T TOUCH

Things that look fixable but actually belong to the implementer's discretion.

- **Style / naming / structure refactors by opinion**: renaming variables, splitting a function the implementer chose to keep monolithic, reordering imports outside the linter's enforcement.
- **File reorganization without a bug**: moving a helper from `lib/` to `utils/` because "it fits better there".
- **Performance speculation**: "this could be O(1) instead of O(n)" without a profile or benchmark.
- **"I'd prefer a different signature"**: design decision belonging to the implementer.
- **Cleanup of code unrelated to the ticket**: a TODO comment in an adjacent function, a magic number that's been there for two years.

## When a fix uncovers another fix (cascade)

Apply both. The reviewer's mandate is "no debt visible". If fixing the obvious typo reveals that the test was masking a deeper bug, fix the test too — and document both fixes separately in the report.

**Cap**: if the cascade reaches > 5 files outside the original ticket scope, STOP and report. That's a sign the diff has structural issues better resolved by the implementer with full context, not by the reviewer in isolation.

## When the diff is empty or trivial

- **Nothing staged**: tell the operator. The review doesn't apply.
- **Only `package-lock.json` staged**: review the lockfile only for unexpected new top-level deps. Don't deep-dive transitive trees — that's `npm audit`'s job.
- **Only `.gitignore` / `.git/info/exclude` staged**: verify the patterns match what the operator described. Skip the rest of the workflow.
- **Only docs staged**: skip CI gates (no code touched), but still verify ROADMAP / SPRINT-PLAN coherence and i18n parity if any localized copy moved.

## Examples calibrated against the policy

**FIX inline**:
- `apps/web/src/i18n/locales/es/settings.json` has key `company.sync.queue.entityId` referenced by no consumer (search returns 0 hits). Remove from both locales.
- `apps/desktop/src/main/index.ts:793` has `let rowTenantId: string | null = null;` and the next 3 reachable branches all reassign before read. typescript-eslint v8's `no-useless-assignment` will fire. Drop the initializer.
- A new logo upload path doesn't validate `imageUrl` scheme; renderer interpolates it into `<img src="...">`. Add the `RESOLVED_URL_SCHEME_BLOCKLIST` Zod refine + `escapeHtml` in the renderer.

**REPORT, don't fix**:
- The implementer added a `keepLocal` rejection path to `sync.resolve` but the throw uses prose `error.message` instead of an `errorCode`. Spanish operators see English. The fix requires a new errorCode in `lib/errorCodes.ts` + i18n keys — that's design / approach, not a typo. Report.
- A new tRPC procedure has a missing tenant scope in its `.where(...)`. **Wait** — that one IS a fix-inline (multi-tenant invariant). Add `eq(table.tenantId, ctx.tenantId)`. Reportable only if adding the scope changes the procedure's semantics in a way the implementer might want to reconsider.

**DON'T touch**:
- The implementer named a hook `useSomething` and you'd have called it `useSomethingElse`. Skip.
- A function has 80 lines and you'd have split it at line 40. Skip unless the function's complexity is the bug (e.g. it has 5 untested branches).
