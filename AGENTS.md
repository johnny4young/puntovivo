# AGENTS.md

Operational guidance for AI agents working on this repo (Claude Code, Codex, Copilot, etc.). Only non-discoverable constraints are listed here — do not add stack summaries or things readable from code/config.

`CLAUDE.md` is a symlink to this file, so both tools see the same source of truth. Edit `AGENTS.md` directly.

## Commands

Run workspace commands from the repo root:

```
npm run dev:desktop      # Launch web dev server + Electron desktop
npm run dev:desktop-shell # Electron only; expects web dev server on port 3000
npm run dev:web          # Web only on port 3000
npm run dev:web-stack    # Web app + standalone backend
npm run dev:server       # Backend only on port 8090
npm run build:desktop    # Build web + create desktop packages
```

Run tests per workspace:

```
npm run test --workspace=@puntovivo/web     # React + Vitest (watch mode)
npm run test --workspace=@puntovivo/server  # Server + Vitest
```

## Native module rebuild (non-obvious requirement)

After `npm install`, you **must** rebuild native modules for Electron:

```
npx electron-rebuild -m apps/desktop
```

Or use the workspace shortcut: `npm run rebuild --workspace=@puntovivo/desktop`

If you see `NODE_MODULE_VERSION mismatch` errors on `better-sqlite3` or `argon2`, this is why.

Current desktop runtime is Electron `41.6.1`. The `rebuild` script no longer hard-codes `-v`; `electron-rebuild` picks the version from `apps/desktop/package.json` automatically. If you invoke `electron-rebuild` by hand and want to override the auto-detect, match the version in that package.json.

**Electron 42 is gated upstream**: `better-sqlite3` 12.10.0 (latest, 2026-05-15) does not compile against V8 14.x. The native code uses `External::Value()` / `External::New()` / `SetNativeDataProperty` shapes that V8 14 changed. Upstream tracking issue: [WiseLibs/better-sqlite3#1474](https://github.com/WiseLibs/better-sqlite3/issues/1474). Once `better-sqlite3` ships V8 14 support, bump `electron` to `^42.x` and re-run `preflight:desktop` — the rest of the upgrade (Electron-42-aware `ensure-electron-binary.mjs`, `@electron/fuses@^2.1.1` with `WasmTrapHandlers` + `GrantFileProtocolExtraPrivileges: false`) is already in place.

If Node-based server tests fail after an Electron rebuild, rebuild `better-sqlite3` for the current Node runtime:

```
node packages/server/scripts/rebuild-better-sqlite3-node.mjs
```

### Why two compiled binaries are needed

Electron 41 uses MODULE_VERSION 145 (its own embedded Node.js runtime). Standalone Node.js 24.x uses MODULE_VERSION 137. These are different runtimes — there is no public Node.js release with MODULE_VERSION 145, and you cannot make the system Node.js match Electron's internal version.

The `scripts/ensure-native-runtime.mjs` script handles this by caching both compiled versions of `better-sqlite3` under `node_modules/.cache/puntovivo/native-binaries/` and swapping between them automatically at startup. This cache can become stale if workspace symlinks break (e.g. after a fresh `npm install` with no rebuild). When that happens, re-run the rebuild commands above.

**Long-term fix to track:** Migrate `better-sqlite3` to a build that uses N-API. N-API is ABI-stable across Node.js and Electron versions, meaning a single compiled binary would work everywhere without the dual-binary swap. However, `better-sqlite3` v12 does not use N-API in its critical bindings — this depends on an upstream change in that library.

## npm install with `ignore-scripts=true` (silent onboarding failure)

A hardened global `~/.npmrc` containing `ignore-scripts=true` is a common supply-chain defence — but it disables **every** `postinstall`. Puntovivo genuinely needs three of those to run for a usable checkout:

- `node_modules/electron` → downloads the platform runtime (Electron.app / electron.exe / electron binary)
- `node_modules/better-sqlite3` → compiles the native SQLite binding for the host Node ABI
- `node_modules/argon2` → compiles its native password-hashing binding

Skipping them leaves `npm install` exiting green while `npm run dev:desktop` crashes later with `Error: Electron failed to install correctly` and the server dies with `NODE_MODULE_VERSION mismatch`. The project `.npmrc` now explicitly sets `ignore-scripts=false` + `foreground-scripts=true` to override the global and surface failures at install time, and `./scripts/check-setup.sh` flags the mismatch when it appears. If you see the failure mode, run `npm install --ignore-scripts=false` to recover.

## Electron runtime binary (non-obvious failure mode)

The `electron` npm package downloads its platform runtime (Electron.app on macOS, `electron.exe` on Windows, `electron` on Linux) from GitHub Releases during its `postinstall` hook. On a flaky network or a corrupt `~/Library/Caches/electron` entry the download can fail **silently** — the package stays on disk but `node_modules/electron/dist/` and `node_modules/electron/path.txt` are missing. Every subsequent `npm run dev:desktop` dies at:

```
An unhandled rejection has occurred inside Forge:
Error: Electron failed to install correctly, please delete node_modules/electron and try installing again
```

Three defences cover this:

1. Root `.npmrc` sets `foreground-scripts=true`. Any postinstall that exits non-zero now fails the whole `npm install`, surfacing the problem immediately instead of leaving a broken tree behind.
2. `scripts/ensure-electron-binary.mjs` runs as part of the desktop `preflight:desktop` script before Electron Forge boots. It checks `path.txt` + the executable under `dist/`, and on macOS also verifies the local app signature; if anything is missing or invalid it re-runs `node_modules/electron/install.js` once and applies local ad-hoc signing when needed. If the repair itself fails it prints the exact recovery commands and exits non-zero.
3. The `@puntovivo/desktop` package's `dev:desktop`, `dev:desktop:debug`, `dev:desktop:debug-brk`, `package:desktop`, and `make:desktop` scripts all chain through `preflight:desktop`, so every entry point sees the check.

If the auto-heal still loses (genuinely dead cache, offline box, proxy):

```
rm -rf node_modules/electron
rm -rf "$HOME/Library/Caches/electron"   # macOS
rm -rf "$HOME/.cache/electron"           # Linux
npm install
```

## Architecture landmine: embedded backend

The Fastify server runs **in-process** inside the Electron main process — it is NOT a spawned child process. `apps/desktop/src/main/` imports `@puntovivo/server` directly. Do not assume a separate server process exists.

## Renderer sandbox (ENG-004)

The main `BrowserWindow` runs with `sandbox: true`. Renderer code cannot `require('fs')`, spawn processes, or access Node globals. Every capability flows through `contextBridge` → `ipcRenderer.invoke` → `ipcMain.handle`. The invariant lives in `apps/desktop/src/main/window-config.ts`, which also builds the exact `webPreferences` object consumed by `BrowserWindow`, and is pinned by a `node --test` regression in `apps/desktop/src/main/__tests__/window-config.test.ts` that runs on every `ci:desktop`. When you add a new preload API, make it a one-line `ipcRenderer.invoke` wrapper and route it to an `ipcMain.handle` channel in `main/index.ts` — direct Node access from the preload will break at startup under sandbox.

## tRPC is the primary transport

`/api/trpc` is the canonical application API. `/api/health` remains as a compatibility health endpoint and `/api/realtime/*` remains for SSE. Do not reintroduce new REST route docs or code paths for auth, collections, or sync.

## Required checks before finalizing changes

Before committing, every change must pass the per-workspace CI script that corresponds to the area touched. These are the same commands CI runs, so local failures will fail CI:

| Area                                                                  | Command                                                                                                                     |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Any React or TypeScript in `apps/web`                                 | `npm run ci:web`                                                                                                            |
| Any Node.js / backend in `packages/server`                            | `npm run ci:server`                                                                                                         |
| Any Electron main-process code in `apps/desktop/src/main`             | `npm run ci:desktop`                                                                                                        |
| Anything under `e2e/web/` or the login / sales / inventory flows      | `npm run test:e2e:web` (runs in CI automatically via the `e2e-web` job, but keep it green locally when you touch the suite) |
| Anything under `e2e/electron/` or the Electron main-process bootstrap | `npm run test:e2e:electron` (local-only; prerequisite `.vite/build/` bundle — see `e2e/README.md`)                          |

Run both `ci:web` and `ci:server` in parallel when a change touches both frontend and backend. Each script performs `typecheck + lint + test` (and `build` for the web/desktop workspaces). Treat their output as mandatory, not suggestions.

**Cross-platform desktop (ENG-005 / ENG-046)**: `ci.yml` now runs the `desktop` job on `ubuntu-latest` only for every push and PR. Cross-OS desktop validation moved to the manual `.github/workflows/build-desktop.yml` workflow, where the operator can choose Linux, macOS, Windows, and validate-only vs package artifacts on demand. A change that works on macOS but breaks on Windows — a POSIX-only shell pipe in a script, a path assumption with literal `/`, a missing prebuilt native binary — must still be checked through that manual workflow before release or platform-specific changes. Keep scripts invoked from `ci:*` and `build-desktop.yml` portable (Node-based, `path.join`, explicit `process.platform === 'win32'` where needed). Signed release packaging still lives in `release.yml` because signing material is not available to ordinary CI runners.

If the `review` skill is available in the session, run it on the diff before finalizing a large change — it surfaces duplication, unused deps, and violations of the patterns in this file.

## Node.js version constraint

Root `package.json` enforces `>=24.0.0`. All workspaces (`apps/desktop`, `packages/server`) also pin `>=24.0.0`. Use Node 24+.

## Stale files — do not rely on

- `.github/workflows/release.yml` backend job: Has been rewritten for Node.js but may still have edge cases. Verify before modifying.

## Release workflow

Automatic CI only validates test, lint, and build flows. Desktop/web artifacts and GitHub releases are created exclusively through the manual `release.yml` workflow.

## Web UI validation order

For Web UI validation, prefer the cheapest and fastest path in this order: Playwright MCP snapshot/navigation, then embedded browser validation, and only use `computer-use`/Safari when MCP browser flows are blocked or the check truly needs native visual interaction.

## UI changes require a live smoke (MANDATORY)

**Any change that touches user-facing UI must be validated in a running web (and/or Electron) target before the task is considered done.** Component tests and unit tests are necessary but not sufficient — they cannot catch Vite dev-server JSON cache staleness, route mounting regressions, tRPC client-side cache invalidation gaps, i18n bootstrap order issues in the bundled app, or round-trip failures between mutations and their read-side surfaces.

The smoke check obligation applies to any of these, however small:

- New React components, props, or layouts.
- New i18n keys consumed by a component (keys only exercised by tests are NOT validated).
- New or changed tRPC read/write paths that a page depends on.
- Changes to routing, navigation, or permission gating.
- Changes to visible copy, icons, order of listed items, or filter/option sets.

Minimum acceptable proof:

1. Boot the relevant target (`npm run dev:web` + `npm run dev:server`, or the Electron dev entry).
2. Drive the affected screen through Playwright MCP (`browser_navigate`, `browser_click`, `browser_evaluate`). Assert the concrete user-visible strings and/or round-trip behavior — do not stop at screenshots.
3. For changes that cross the Electron main/renderer boundary, ALSO validate the Electron target (the embedded Fastify server is in-process; the renderer is a chromium webview). If Electron validation is infeasible (e.g. requires a native-signed build), declare it explicitly in the task report and flag the gap.

If the smoke is genuinely impossible in the current session (dev server refuses to start, MCP blocked, etc.), stop and tell the user before declaring the task done. Do not let vitest coverage stand in for a live smoke.

## Git conventions

Use Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `build:`, `chore:`). Scope with the module name: `feat(products):`, `fix(auth):`, etc.

## Adding new features — checklist

1. Schema change → update `packages/server/src/db/schema.ts` (Drizzle) and run `npx drizzle-kit generate` to emit a new `0NNN_<name>.sql` migration. Register the entry in `packages/server/src/db/migrations/meta/_journal.json`. Migrations are the single schema path (the raw-DDL mirror in `db/index.ts` was retired in `ENG-002` Step 3). **When Drizzle's SQLite dialect cannot emit what you need** (partial unique indexes with `WHERE`, dialect-specific defaults), hand-append the statement to the generated `0NNN_<name>.sql` with `IF NOT EXISTS` / `IF NOT EXISTS ... WHERE ...` so the migration is idempotent against DBs that already carry the target shape through the ENG-002 adoption shim. Example: `packages/server/src/db/migrations/0001_receipt_templates.sql`. Catalog data that must exist on every boot (DIAN identification types, country / currency catalogs) goes into `seedCatalogs()` in `db/index.ts` — table-existence-gated, `INSERT OR IGNORE` idempotent.
2. New tRPC procedure → add Zod schema in `packages/server/src/trpc/schemas/`, wire it in the router, and add a unit/integration test in `packages/server/src/__tests__/`. Frontend types are inferred end-to-end via the `AppRouter` export — only add entries to `apps/web/src/types/index.ts` for domain models that don't flow through tRPC.
3. New frontend page → add a lazy route in `apps/web/src/App.tsx`, add a sidebar entry in `apps/web/src/components/layout/Sidebar.tsx`, and wire any role gating through `ProtectedRoute`. All user-visible strings must live in `apps/web/src/i18n/locales/*` (an ESLint rule blocks hardcoded strings in `title`, `placeholder`, and `aria-label`). The parity test `apps/web/src/i18n/locale-parity.test.ts` blocks PRs that introduce a key in one locale without the other — add a new namespace by importing it in `apps/web/src/i18n/index.ts`, registering it in the `ns` array, and adding both `en/<ns>.json` and `es/<ns>.json`.
4. Run `npm run ci:web` and/or `npm run ci:server` (see "Required checks" above) before committing.

### Spanish copy dialect — neutral Latin American, never voseo

All user-visible Spanish strings under `apps/web/src/i18n/locales/es/**` and any receipt / PDF / email rendered in Spanish must use **neutral Latin American Spanish** in the `tú` register. Specifically: no voseo. This is an audience-wide choice — the product targets every LATAM market, not only the Rioplatense / paisa regions where voseo is native, and voseo reads as a regional accent to users from Mexico, Colombia (interior), Chile, Perú, Centroamérica, etc.

Concretely:

- Imperatives end in `-a / -e / -i`, never in `-á / -é / -í`:
  - ✅ Elige un país. Selecciona una opción. Agrega una etiqueta. Deja vacío para heredar. Crea tu primera plantilla. Ingresa tu correo. Guarda los cambios. Verifica los datos. Indica la razón. Configura el dispositivo.
  - ❌ Elegí, Seleccioná, Agregá, Dejá, Creá, Ingresá, Guardá, Verificá, Indicá, Configurá.
- Conjugations use `tú`, never `vos`:
  - ✅ tienes / puedes / quieres / eres / sabes.
  - ❌ tenés / podés / querés / sos / sabés.
- Pronouns: prefer omitting the subject pronoun when natural; when an explicit form is needed, use `tú` (never `vos`). Avoid `ustedes` for 2nd-person plural unless the copy is specifically addressing a multi-user group.
- Nouns + conjunctions: any word that the locale has regional variants for (e.g. `ordenador` vs `computadora`, `ficha` vs `tarjeta`) defaults to the LATAM variant — match what the existing es/ namespace already uses rather than importing peninsular Spanish.

When reviewing a diff: grep for the voseo imperatives + conjugations listed above (`grep -rnE "(tenés|podés|querés|sos|[A-Z][a-z]*(á|é|í)\\b)" apps/web/src/i18n/locales/es/` catches most of them, discounting legitimate accented nouns like `categoría`, `línea`, `válida`). This rule is enforced by review, not by a CI lint today — if voseo lands, fix it inline per the collateral-bug policy and flag it in the commit body.

## Multi-tenant invariants (non-obvious)

Every query in a tRPC router must scope by `ctx.tenantId`. Tests cover cross-tenant isolation — do not bypass them. Reuse these building blocks instead of writing custom middleware:

- **Role guards** live in `packages/server/src/trpc/middleware/roles.ts`. Use `adminProcedure`, `managerOrAdminProcedure`, or compose a new role set via `createRoleGuard(roles, message)`. Never write a bespoke middleware.
- **Site-scope guard** `ensureTenantSite(ctx.db, ctx.tenantId, siteId)` in `packages/server/src/trpc/routers/inventory.ts` — call it from any procedure that accepts a `siteId` input so a user cannot operate on a site from a different tenant.
- **Cash session invariant** — `sales.complete` requires an active cash session for the (tenant, site, cashier) triple. The helper `requireActiveCashSession()` throws `CASH_SESSION_REQUIRED` when absent. Tests and the dev seed open a session before creating historical sales; do the same in any new flow that completes a sale.

## Testing patterns (non-obvious)

Server tests are HTTP-less. They call routers directly via the tRPC caller API and use an in-memory SQLite DB — no network layer, no port allocation:

```ts
import { appRouter } from '../trpc/router.js';
import { createServer } from '../index.js';

const server = await createServer({ dbPath: ':memory:', verbose: false });
const caller = appRouter.createCaller(createTestContext());
```

Canonical patterns to copy: `packages/server/src/__tests__/audit-logs.test.ts` (multi-tenant + role guards), `packages/server/src/__tests__/receipt-templates.test.ts` (CRUD + partial unique invariants), `packages/server/src/__tests__/seed-dev.test.ts` (large data assertions).

Web component tests use the custom `render()` wrapper in `apps/web/src/test/utils.tsx` which pre-provisions `QueryClient` and `MemoryRouter`.

## Troubleshooting

- **Exit 137 (SIGKILL) when starting `tsx` or running tests**: almost always stale `tsx watch` processes from prior `npm run dev:server` sessions holding the SQLite WAL lock. Run `pkill -f "tsx watch src/standalone.ts"; pkill -f "dev-launcher.mjs server"` and retry. `lsof packages/server/data/local.db` lists the offenders. See [docs/DEV-SEED.md](./docs/DEV-SEED.md) §Troubleshooting.
- **`UNIQUE constraint failed: ...sale_number`** across multiple sites: sequentials are per-site but `(tenant_id, sale_number)` is tenant-unique. Sites must use different prefixes (e.g. `VTA-N-` vs `VTA-S-`). The dev seed does this automatically.

## Commit conventions (beyond the basics)

On top of the Conventional Commits format above:

- No backticks and no double quotes in the message body (operator convention). Hyphen bullets for body lists.
- No AI co-authorship trailer (user's global preference in `~/.claude/CLAUDE.md`).
- One commit per logical unit. Do not mix commits from different iters / tickets.

## Plan hierarchy

Five sources of planning live in this repo; know which one to read for what. The full navigation index lives in [`docs/README.md`](./docs/README.md):

- [`docs/PLAN.md`](./docs/PLAN.md) — **strategic**: competitive analysis, phases, fiscal engine design, LatAm expansion. Read when a ticket touches architecture, fiscal, i18n, LATAM, or multi-vertical decisions; skip for simple features.
- [`docs/PLAN-V2.md`](./docs/PLAN-V2.md) — **tactical bridge** between PLAN.md and ROADMAP §3b. Phases `ENG-025..ENG-040` by quarter (Phase 0 hardening → Phase 1 AI Wave 1 → Phase 2 multi-country fiscal → Phase 3 sync + payment rails → Phase 4 vertical + AI Wave 2). Architectural decisions closed by the 2026-Q2 audit.
- [`docs/ROADMAP.md`](./docs/ROADMAP.md) — **ticket index**: `ENG-NNN` rows with acceptance criteria and sequencing recommendation in §3b. Each row has an explicit `Status` column that drives pool discovery. **When ROADMAP and PLAN disagree, ROADMAP wins.**
- [`docs/SPRINT-PLAN.md`](./docs/SPRINT-PLAN.md) — **tactical**: iteration-level execution detail (per-commit sequencing, draft commit messages, verification matrix). This is what the agent opens next to ROADMAP when executing the next ticket.
- [`docs/BACKLOG.md`](./docs/BACKLOG.md) — **raw capture**: unsized ideas, small bugs, spikes, parked feature requests. **Do not** pick work from here — this is the buffer before something becomes an `ENG-NNN`. When an item matures (acceptance criteria clear, sized), promote it to ROADMAP and delete the bullet here in the same commit.

**Flow for new work**: operator idea → `BACKLOG.md` (unsized) → matures → promoted to `ROADMAP.md §3b` as `ENG-NNN Status=Pending` → scheduled for sprint → `SPRINT-PLAN.md §N` with commit spec → agent executes → `Status=Shipped` with summary in ROADMAP. Only the last two steps involve an agent; the first two are human-curated.

### Ticket Status convention

The `Status` column in `ROADMAP.md §3b` is the single source of truth for what to work on next. Values:

| Status     | Eligible for pool? | Meaning                                                                                                                             |
| ---------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `Pending`  | ✅ yes             | Never started; standard workflow.                                                                                                   |
| `Partial`  | ✅ yes             | Some sub-steps shipped; the Scope cell ends with "Remaining:" listing what's left. Execute the remaining items as the ticket scope. |
| `Shipped`  | ❌ no              | Closed; Scope cell ends with "Shipped:" summary.                                                                                    |
| `Gated`    | ❌ no              | External dependency (hardware, contract, credentials) blocks start. Do not attempt until the gate clears.                           |
| `Deferred` | ❌ no              | Operator explicitly postponed. Do not re-prioritize without operator signal.                                                        |

**Rules**:

- New ENG tickets are created with `Status: Pending` and a Scope cell that ends with the acceptance criteria. If the ticket needs >5 commits or >1 week of work, split it into `ENG-NNNa`, `ENG-NNNb`, … before handing to an agent.
- When closing a ticket, append `**Shipped**: <2-3 line summary>` to the end of the Scope cell AND change the Status column to `Shipped` in the same commit. Match the style of rows `ENG-003 / ENG-004 / ENG-008`.
- When closing a Partial ticket: if sub-steps remain and they're worth doing later, either promote the "Remaining:" list into a fresh `ENG-NNNb` with `Pending` (then mark original `Shipped`), or keep the parent as `Partial` with the updated "Remaining:" list. Do not leave unstated remainders.
- Agents skipping `Gated` / `Deferred` tickets report the gate back to the operator instead of guessing a workaround.
