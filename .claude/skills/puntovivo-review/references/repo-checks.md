# Repo-specific checks

Eleven invariants the review skills (`typescript-react-reviewer` / `node`) won't catch on their own because they're project-specific. Each one has an inline-fix recipe when applicable.

## a. Multi-tenant invariant

Every new query in a tRPC router or a service module MUST scope by `ctx.tenantId`. Tests cover cross-tenant isolation in `audit-logs.test.ts`, `receipt-templates.test.ts`, and others — never bypass them.

Reuse the existing building blocks:
- **Role guards** in `packages/server/src/trpc/middleware/roles.ts`: `adminProcedure`, `managerOrAdminProcedure`, or `createRoleGuard(roles, message)`.
- **Site-scope guard** `ensureTenantSite(ctx.db, ctx.tenantId, siteId)` in `packages/server/src/trpc/routers/inventory.ts`.
- **Cash session invariant** `requireActiveCashSession()` for sale-completion flows.

**Inline fix recipe**: if a `db.select(...).from(table).where(...)` lacks `eq(table.tenantId, ctx.tenantId)`, add it. If the query is `.get()` by id, add the tenant clause too — `WHERE id = ? AND tenant_id = ?`.

If the new procedure is admin-only and operates on global catalog tables (e.g. `dian_identification_types`, `country_catalog`), the tenant scope doesn't apply — that's by design. Verify via the procedure decorator.

## b. i18n parity + plurals

Every new key in `apps/web/src/i18n/locales/en/<ns>.json` must exist in `apps/web/src/i18n/locales/es/<ns>.json` with the same JSON path. The `locale-parity.test.ts` enforces this in CI but the human review catches translation quality.

Plurals use `_one` and `_other` suffixes — never ternaries in JSX:

```jsx
// Wrong:
<span>{count === 1 ? 'item' : 'items'}</span>

// Right:
// en: { "items_one": "item", "items_other": "items" }
<span>{t('items', { count })}</span>
```

**Inline fix recipe**:
- Key in en only → add to es with confident translation, or `TODO-es: <english>` if you can't.
- Voseo in new ES strings → replace per the table:

| Voseo | Neutral LATAM (`tú`) |
| --- | --- |
| `Retomalo` | `Retómalo` |
| `Seleccioná` | `Selecciona` |
| `Agregá` | `Agrega` |
| `Dejá` | `Deja` |
| `Creá` | `Crea` |
| `Ingresá` | `Ingresa` |
| `Guardá` | `Guarda` |
| `Verificá` | `Verifica` |
| `Indicá` | `Indica` |
| `Configurá` | `Configura` |
| `tenés` | `tienes` |
| `podés` | `puedes` |
| `querés` | `quieres` |
| `sos` | `eres` |
| `sabés` | `sabes` |

Audit regex (run on the staged diff):
```
git diff --cached -- apps/web/src/i18n/locales/es/ | grep -E "^\+" | grep -vE "^\+\+\+" | grep -oE "(tenés|podés|querés|sos\b|Retomá|Seleccioná|Elegí|Dejá|Creá|Ingresá|Guardá|Verificá|Indicá|Configurá|Agregá|Hacé|Decí)"
```

False positives: legitimate accented nouns (`categoría`, `línea`, `válida`, `política`, `ingresos`).

## c. Migrations idempotent

Drizzle migrations in `packages/server/src/db/migrations/*.sql` may be replayed against legacy DBs that pre-existed the migration system (the `runSchemaSync` raw-DDL bootstrap retired in ENG-002 Step 3). When the migration adds a column to a table that already has it from the legacy bootstrap, the `ALTER TABLE ADD COLUMN` crashes with `duplicate column name`.

**Inline fix recipe**: when Drizzle's SQLite dialect can't emit `IF NOT EXISTS` for the column, hand-append the SQL:

```sql
-- Drizzle's generated:
ALTER TABLE `sales` ADD COLUMN `suspended_at` text;

-- Hand-append fallback (idempotent):
ALTER TABLE `sales` ADD COLUMN IF NOT EXISTS `suspended_at` text;
```

Reference: `packages/server/src/db/migrations/0001_receipt_templates.sql` already uses the pattern.

## d. Audit log enum + i18n key

When the diff adds a new audit log action, it must:
1. Declare the enum value in `packages/server/src/db/schema.ts` (the `auditLogActionEnum` array).
2. Add the i18n key in `apps/web/src/features/auditLogs/AuditLogsTable.tsx` (or wherever `auditLog.action.<key>` is rendered) for both en and es.

**Inline fix recipe**: if the enum value is in the schema but the i18n key is missing, add it to both locale files. If the rendering site is missing a `case 'newAction':`, add it (mirror an adjacent action).

## e. Test edge cases (not just happy path)

Every new pure helper / component in the staged diff should have:
- **Pure helper**: empty input, invalid input, Unicode / surrogate pair if the helper handles strings, truncation boundary, round-trip.
- **Component**: initial render, happy path, error state, i18n fallback (locale switch should not crash).

**Inline fix recipe**: if the implementer added the helper but only tested happy path, add the obvious edge case test. Adding tests is a fix, not a feature.

If the test would require new fixture infrastructure (e.g. mocking a tRPC procedure that doesn't have a mock yet), report instead — it's design.

## f. Main ↔ renderer boundary (Electron)

`apps/web/src/**` is the renderer (sandboxed, no Node access). `apps/desktop/src/main/**` is the main process (Node, has fs/path/etc.). The bridge is:

```
renderer → window.api.* (preload contextBridge)
   → ipcRenderer.invoke('channel-name', args)
   → ipcMain.handle('channel-name', handler)
   → main does the Node work
   → returns to renderer
```

Forbidden in renderer (`apps/web/src/**` or `apps/desktop/src/renderer/**` if it ever exists):
- `import 'node:fs'` / `'node:path'` / `'node:crypto'` / etc.
- `require('fs')` / `require('path')` / `require('child_process')` / etc.
- `process.*` access (no `process.env`, `process.platform`, `process.cwd()`).

**Inline fix recipe**: identify which existing `window.api.*` capability covers the call. If one exists, route through it. If not, REPORT — adding a new IPC channel is a design decision (touches preload + main + types).

`window-config.test.ts` pins `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`. If the diff weakens any of these in `apps/desktop/src/main/window-config.ts`, **HARD STOP and report as security finding**.

## g. Offline-first

The Puntovivo runtime serves traffic from the embedded Fastify server. There should be no new `fetch(...)`, `XMLHttpRequest`, or `WebSocket` in runtime code that targets external URLs. The single legitimate exception is the Pyodide CDN load (already wired).

**Inline fix recipe**: if a `fetch('https://...')` snuck in, replace it with the equivalent tRPC procedure call. If the procedure doesn't exist yet, REPORT — adding it is design.

## h. React 19 + Zustand patterns

- **No `Date.now()` / `Math.random()` / `crypto.randomUUID()` during render**: under React 19 strict mode, render runs twice and the value churns, triggering infinite re-renders or non-deterministic behaviour. Move to `useEffect`, `useMemo`, or an event handler.
- **Zustand `persist` middleware needs `partialize`**: without it, the entire store (including transient state, error flags, etc.) is serialized to localStorage on every change. Always provide `partialize: (state) => ({ /* only what should persist */ })`.
- **`useEffect` deps must be stable**: object literals (`{ a: 1 }`), array literals (`[1, 2]`), or functions defined in render scope as deps cause the effect to re-fire every render. Either move them to module scope, wrap in `useMemo` / `useCallback`, or destructure the actual primitives.

**Inline fix recipe**: each of the above is a one-liner edit. Apply directly.

## i. Doc sync protocol

The implementer was responsible for updating documentation as part of the same staged commit. Verify:

- **`ROADMAP.md §3b`** — the row for the implemented ticket has `Status: Shipped` (or `Partial` with a freshened `Remaining:`). The Scope cell ends with a 2-3 line "Shipped:" summary. Pattern: `ENG-003` / `ENG-004` / `ENG-008`.
- **`SPRINT-PLAN.md §1`** — the row moved to the right section. If the ticket closed entirely, `§N` detailed spec shrunk to one line.
- **`PLAN.md`** — if the ticket invalidated a section claim, a `### §X.0 Status Update` was added under that section. Pattern: `§17.0` i18n.
- **`PLAN.md §18.1`** — if new `docs/*.md` files were created, registered there.
- **`PLAN-V2.md`** — for v2.0 tickets (`ENG-025..ENG-040`), the phase counter at the top of `§2 Phasing` updated (e.g. `Pending (3 / 16 closed)`).
- **`BACKLOG.md`** — if the implementer captured a new requirement, it's tagged `[domain]` with date and (optionally) a working-title `ENG-NNN`.

**Inline fix recipe**: if any of the above is missing, fix it inline. These are docs edits — add the Status flip with the summary, move the row, add the Status Update block. The implementer probably forgot in the time pressure of staging; the reviewer's job is to catch it.

If the diff is genuinely Status: Partial because real follow-ups remain, verify the "Remaining:" content matches the BACKLOG bullets (or that the BACKLOG has been updated to reflect the new "Remaining:").

## j. Native dep rebuild

If the diff bumps a native module (`better-sqlite3`, `argon2`) in `package.json`:

- `npx electron-rebuild -m apps/desktop` must have run (Electron 41, MODULE_VERSION 145).
- `node packages/server/scripts/rebuild-better-sqlite3-node.mjs` must have run (Node 22, MODULE_VERSION 137).

The dual-binary cache lives at `node_modules/.cache/puntovivo/native-binaries/`. The pre-flight script `scripts/ensure-native-runtime.mjs` swaps between them at startup.

**Inline fix recipe**: this is harder to verify retroactively — the rebuild artifacts don't appear in the diff. The signal is whether `ci:server` and `ci:desktop` both pass. If either fails with `NODE_MODULE_VERSION mismatch`, report — fixing requires running the rebuild scripts (operator's call, not reviewer's).

## k. Voseo audit (cross-cutting)

The Spanish dialect rule from `AGENTS.md`: every user-visible string in `es/**` uses neutral Latin American Spanish in the `tú` register. This applies to i18n locales, receipt / PDF / email templates, error messages surfaced to users.

Audit run:
```
grep -rnE "(tenés|podés|querés|sos|[A-Z][a-z]*á\b|[A-Z][a-z]*é\b|[A-Z][a-z]*í\b)" apps/web/src/i18n/locales/es/ packages/server/src/services/receipt-renderer.ts
```

False positives to ignore:
- Accented nouns: `categoría`, `línea`, `válida`, `política`, `ingresos`, `dirección`, `sección`, `máximo`, `mínimo`.
- Past participles ending in `-ido` / `-ado` (no voseo conflict).

**Inline fix recipe**: see the table in section (b). One-by-one replacement.
