# Review report — canonical structure

Eight sections, in this exact order. The operator pastes copy-pasteable commands verbatim, scans the verdict, decides whether to commit.

## 1. Review verdict

```
## Review verdict

**Ticket revisado:** ENG-NNN (+ ENG-YYY si aplica)
**Scope check:** OK / SCOPE CREEP (detalle) / OUT OF SYNC WITH APPROVED PLAN
**Veredicto:** READY TO COMMIT / NEEDS DESIGN DISCUSSION / BLOCKED
**Staging:** Intacto (política: no tocar git mutante)
**Unstaged:** N archivos con fixes del review
```

Verdict semantics:
- **READY TO COMMIT**: 0 HIGH findings, all gates green, all reviewer fixes inline, smoke ran or was explicitly skipped with reason. The operator can `git add -A && git commit` and ship.
- **NEEDS DESIGN DISCUSSION**: at least one finding under "Design / scope findings — NO fixeados" that requires the operator's input before commit. The implementer's work is otherwise sound.
- **BLOCKED**: a hard stop — security finding, scope creep so severe it changes the diff's identity, gate failure that the reviewer cannot fix because it requires design context. Do not commit until resolved.

## 2. Gates

```
## Gates

- npm run ci:server → PASS / FAIL (test counters: N test files, M tests passing; coverage X / Y / Z / W).
- npm run ci:web → PASS / FAIL (with bundle deltas if applicable).
- npm run ci:desktop → PASS / FAIL / NO APLICA.
- locale-parity.test.ts → PASS / FAIL / NO APLICA.
- typescript-react-reviewer → 0 HIGH, N MEDIUM (resolved inline / listed in Design findings), M LOW.
- node → 0 HIGH, N MEDIUM, M LOW.
- UI smoke → corrido (Playwright MCP / embedded browser) / no corrido (razón explícita).
```

Always include test counters. Vague "PASS" without numbers loses the operator's trust.

## 3. Bugs fixed inline

```
## Bugs fixed inline (unstaged, aparecen en git diff)

1. **<short title>** — `path/file.ts:L` — what broke → what the fix repairs.
2. **<short title>** — `path/file.tsx:L` — ...
3. ...
```

If none: `Ninguno — el diff del implementer pasó limpio.`

No severity split. Every inline fix lives in this single bucket. The operator scans for surprises.

## 4. Design / scope findings — NO fixeados

```
## Design / scope findings — NO fixeados (reportados para su input)

1. **<short title>** — `path/file.ts:L`
   Problema: <description>.
   Por qué no se fixeó: design decision / changes the approved approach / security / AC ambiguity.
   Qué se necesita de usted: <concrete ask>.
2. ...
```

If none: `Ninguno.`

Each finding ends with a concrete ask. "What do you need from the operator?" should be answerable in one sentence.

## 5. Out-of-scope requirements → BACKLOG.md

```
## Out-of-scope requirements → BACKLOG.md

- **[domain][sub-domain]** <one-line>. Motivo: outside the scope of ENG-NNN approved plan.
- ...
```

If you wrote to BACKLOG, the file appears in `git diff` (unstaged, like every reviewer edit). List what was added.

If none: `Ninguno.`

## 6. Doc sync checklist

```
## Doc sync checklist (verificación del trabajo del implementer)

- [x] ROADMAP §3b Status flipped with summary.
- [x] SPRINT-PLAN §1 + §N updated.
- [ ] PLAN.md §X.0 Status Update added (only if applicable).
- [ ] PLAN.md §18.1 docs registered (if applicable).
- [ ] PLAN-V2.md phase counter bumped (if v2.0 ticket).
- [ ] BACKLOG.md (if a new requirement was discovered).
```

Markers:
- `[x]` — already done by the implementer.
- `[ ]` — skipped because it doesn't apply.
- `✎` — reviewer fixed it inline (the implementer had missed it).

## 7. Commit message summary

```
## Commit message summary

<single Conventional Commits message covering EVERYTHING — implementer staged + reviewer unstaged. When the operator does `git add -A && git commit`, this message applies to the unified universe.>
```

Style rules:
- No backticks, no double-quotes in body.
- Hyphen bullets.
- No AI co-authorship trailer (no `Co-Authored-By: Claude`, no `🤖 Generated with Claude Code`, no watermarks). Per `~/.claude/CLAUDE.md` global preference.
- Scope per main module; multiple lines in body if the diff spans several modules.
- Body order:
  1. Implementer's main bullets.
  2. `- reviewer fix: <file>:<L> — what broke + fix` for each inline fix.
  3. `- backlog: captured N items in docs/BACKLOG.md` if applicable.

NO split version offered. One commit, one history.

## 8. Cómo sigue usted

```
## Cómo sigue usted

Staging intact with the implementer's work; unstaged with the reviewer's fixes. Read-only commands the operator can use:

- git diff --cached         → implementer's staged work
- git diff                  → reviewer's inline fixes (unstaged)
- git diff HEAD             → unified view (what would land in commit)
- git diff --stat           → summary of unstaged
- git diff --cached --stat  → summary of staged

Commit paths:
- git add -A && git commit -m "<suggested message>"  → everything together.
- git add <specific paths>                            → split selectively.
- git restore <path>                                  → discard a reviewer fix on one file.
- git restore --staged <path>                         → unstage something the implementer left.

If verdict is NEEDS DESIGN DISCUSSION: the design findings are above. Resolve with the operator before committing.
If verdict is BLOCKED: do not commit until the blocker is resolved.
```

The reviewer never recommends a mutant git command as part of their workflow — only listed as options for the operator.

## Worked example: ENG-042 review (sync resilience UX, abridged)

```markdown
## Review verdict

**Ticket revisado:** Sin ENG-NNN (sync resilience UX, no aparece en ROADMAP §3b ni BACKLOG ni PLAN-V2)
**Scope check:** OUT OF SYNC WITH APPROVED PLAN — el trabajo no está numerado
**Veredicto:** NEEDS DESIGN DISCUSSION — el código es sólido, el gap es workflow (no hay ENG numerado)
**Staging:** Intacto
**Unstaged:** 3 archivos con fixes del review

## Gates

- npm run ci:server → PASS (45 test files, 524 tests; coverage 84.12 / 68.43 / 80.7 / 85.02 sobre piso 80/63/77/80)
- npm run ci:web → PASS (typecheck + lint + test:coverage + build via Rolldown ~470 ms)
- npm run ci:desktop → PASS (typecheck + lint + 14 tests + build)
- locale-parity.test.ts → PASS (cubierto por ci:web; cero diff entre keys en/es)
- typescript-react-reviewer → 4 findings (2 fixed inline, 2 reported)
- node → 4 findings (2 reported, 2 LOW informativos)
- UI smoke → no corrido (sync conflicts requieren dataset artificial; declaré gap explícito)

## Bugs fixed inline (unstaged, aparecen en git diff)

1. **Stale i18n key removal** — apps/web/src/i18n/locales/en/settings.json:405 + apps/web/src/i18n/locales/es/settings.json:405 — la key company.sync.queue.entityId existía en ambos locales pero ningún consumer la referencia tras el rewrite a itemTitle (verificado con grep -rn "queue.entityId" apps/web/src → cero hits). Eliminada en ambos para mantener i18n parity tight.
2. **A11y aria-describedby para botones disabled** — apps/web/src/features/company/CompanySyncPreviewSections.tsx:127-148, 156, 196 — los botones Keep Local y Merge se desactivan cuando localRecordExists === false pero solo el <p> informativo cuenta el motivo. Agregué id={missingLocalNoticeId} al <p> y aria-describedby={missingLocalNoticeId} a los botones disabled. Screen readers ahora leen el motivo.

## Design / scope findings — NO fixeados

1. **Trabajo sin ENG-NNN canónico** — staging completo (~778 LoC + 25 archivos)
   Problema: el diff cubre un feature coherente pero no aparece en ROADMAP §3b, SPRINT-PLAN, BACKLOG ni PLAN-V2. Tampoco hay docs sync.
   Por qué no se fixeó: elegir el ENG ID y el destino (nuevo ENG-042 vs follow-up de ENG-007 o ENG-018b) es decisión del operador.
   Qué se necesita de usted: (a) abrir ENG-042 Sync resilience UX en ROADMAP §3b con el scope ya implementado y Status: Shipped; (b) anclar bajo ENG-007 / ENG-018b como follow-up; o (c) capturar como standalone polish sin ticket.

2. **TOCTOU race en sync.resolve** — packages/server/src/trpc/routers/sync.ts:637-657
   Problema: el findEntity guard corre ANTES del ctx.db.transaction(...). better-sqlite3 serializa writes per connection así que el riesgo práctico es bajo, pero un delete concurrente entre el check y la transaction body deja keepLocal/merged path resolviendo data stale.
   Por qué no se fixeó: cambia el approach del implementer (mover el check dentro del transaction callback usando el mismo tx handle).
   Qué se necesita de usted: confirmar si va inline en este commit o como follow-up bajo ENG-043.

3. **Error message no i18n-ready** — packages/server/src/trpc/routers/sync.ts:653-655
   Problema: el throw lanza prose "Cannot keep or merge local changes because the local record no longer exists. Accept remote..." como message. Cliente surfacea error.message vía translateServerError, así que un usuario ES ve el inglés.
   Por qué no se fixeó: el fix correcto requiere errorCode SYNC_LOCAL_RECORD_MISSING en server + locale copy en errors.json — diseño nuevo, no una reparación.
   Qué se necesita de usted: capturar como follow-up coherente con el TOCTOU finding (mismo módulo, misma sesión).

## Out-of-scope requirements → BACKLOG.md

Ninguno escrito por mí. Los findings 2-3 corresponden a un follow-up coherente que tú quizás quieras capturar como [infra][sync] en BACKLOG, pero no escribí al archivo para no añadir más diff unstaged sin tu confirmación del finding #1.

## Doc sync checklist

- [ ] ROADMAP §3b Status flipped — NO aplicado por el implementer; NO lo fixeé inline porque la elección del ENG-NNN es decisión tuya (finding #1).
- [ ] SPRINT-PLAN §1 + §N — mismo motivo.
- [ ] PLAN.md §X.0 Status Update — no aplica.
- [ ] PLAN.md §18.1 docs registered — no aplica.
- [ ] BACKLOG.md — pending until finding #1 resolves.

## Commit message summary

feat(sync): surface local-record state for stale sync conflicts

- sync.listConflicts and sync.pull now expose localRecordExists per
  conflict and per queued item by probing findEntity against the
  active tenant scope, so the renderer knows when a local row is
  gone before letting the operator pick a resolution.
- sync.resolve refuses keepLocal and merged when the local record
  is missing and steers the operator to acceptRemote (rebadged as
  Discard Local Change in the UI).
- companySyncDisplay.ts maps internal entity types and operations
  to localized labels.
- translateServerError gains isNetworkConnectivityError to detect
  Failed to fetch and similar messages across nested causes.
- AuthProvider boot path no longer logs raw fetch failures.

- reviewer fix: apps/web/src/i18n/locales/en/settings.json:405 and
  apps/web/src/i18n/locales/es/settings.json:405 dropped the dead
  company.sync.queue.entityId key.
- reviewer fix:
  apps/web/src/features/company/CompanySyncPreviewSections.tsx —
  the missing-local notice paragraph now carries an id and the
  Keep Local plus Merge buttons reference it via aria-describedby.

## Cómo sigue usted

git diff --cached --stat   # 25 files — implementer staged
git diff --stat            # 3 files — reviewer fixes
git diff HEAD --stat       # 28 files unified

Caminos:
- git add -A && git commit -m "<suggested message>"
- git add <specific paths> && git commit ...

Pendiente antes del commit: resolver finding #1 (elegir ENG-NNN destino).
```

## Anti-patterns to avoid in the report

- **Vague gate output**: "ci:web passed" without test counters or coverage. Always include numbers.
- **Hidden inline fixes**: every reviewer edit MUST appear in section 3 with file:line + reason. Otherwise the operator finds them in `git diff` and loses trust.
- **Optimistic verdicts when smoke didn't run**: `READY TO COMMIT` requires the smoke happened OR an explicit skip-with-reason. Don't paper over.
- **Mutant git commands as recommended action**: never recommend `git add` / `git commit` / `git restore --staged` as part of the review's "what's next". The reviewer's job ends with the report; the operator decides commit shape.
- **Mixing buckets**: section 3 (Bugs fixed inline) and section 4 (Design / scope findings) must stay separate. A finding is in ONE bucket, never both.
- **AI co-authorship leakage**: no `Co-Authored-By: Claude`, no `🤖 Generated with Claude Code` in the suggested commit message. The user's `~/.claude/CLAUDE.md` global preference forbids it.
