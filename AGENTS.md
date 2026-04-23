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

Current desktop runtime is Electron `41.1.0`. If you pass `-v` to `electron-rebuild`, use `41.1.0` instead of older examples.

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
2. `scripts/ensure-electron-binary.mjs` runs as part of the desktop `preflight:desktop` script before Electron Forge boots. It checks `path.txt` + the executable under `dist/`; if anything is missing it re-runs `node_modules/electron/install.js` once to auto-heal. If the repair itself fails it prints the exact recovery commands and exits non-zero.
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

| Area                                                                  | Command                                             |
| --------------------------------------------------------------------- | --------------------------------------------------- |
| Any React or TypeScript in `apps/web`                                 | `npm run ci:web`                                    |
| Any Node.js / backend in `packages/server`                            | `npm run ci:server`                                 |
| Any Electron main-process code in `apps/desktop/src/main`             | `npm run ci:desktop`                                |

Run both `ci:web` and `ci:server` in parallel when a change touches both frontend and backend. Each script performs `typecheck + lint + test` (and `build` for the web/desktop workspaces). Treat their output as mandatory, not suggestions.

**Cross-platform desktop (ENG-005)**: `ci.yml` runs the `desktop` job on `ubuntu-latest`, `macos-latest`, and `windows-latest` with `fail-fast: false`. A change that works on your local macOS but breaks on Windows — a POSIX-only shell pipe in a script, a path assumption with literal `/`, a missing prebuilt native binary — fails the matrix before the release workflow signs it. Keep scripts invoked from `ci:*` portable (Node-based, `path.join`, explicit `process.platform === 'win32'` where needed). Packaging (`electron-forge make`) is still Linux-only in `release.yml` because the signing flow requires signing material the public runners do not carry.

If the `review` skill is available in the session, run it on the diff before finalizing a large change — it surfaces duplication, unused deps, and violations of the patterns in this file.

## Node.js version constraint

Root `package.json` enforces `>=22.0.0`. `packages/server` has `>=20.0.0` but the root constraint takes precedence. Use Node 22+.

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

1. Schema change → update both `packages/server/src/db/schema.ts` (Drizzle) AND the raw DDL in `packages/server/src/db/index.ts`. These two are hand-synchronized today; see ROADMAP ticket `DB-002` for the migration to versioned Drizzle migrations.
2. New tRPC procedure → add Zod schema in `packages/server/src/trpc/schemas/`, wire it in the router, and add a unit/integration test in `packages/server/src/__tests__/`. Frontend types are inferred end-to-end via the `AppRouter` export — only add entries to `apps/web/src/types/index.ts` for domain models that don't flow through tRPC.
3. New frontend page → add a lazy route in `apps/web/src/App.tsx`, add a sidebar entry in `apps/web/src/components/layout/Sidebar.tsx`, and wire any role gating through `ProtectedRoute`. All user-visible strings must live in `apps/web/src/i18n/locales/*` (an ESLint rule blocks hardcoded strings in `title`, `placeholder`, and `aria-label`).
4. Run `npm run ci:web` and/or `npm run ci:server` (see "Required checks" above) before committing.
