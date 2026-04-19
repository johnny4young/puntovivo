# AGENTS.md

Operational guidance for AI agents. Only non-discoverable constraints are listed here — do not add stack summaries or things readable from code/config.

## Commands

Run workspace commands from the repo root:

```
npm run dev              # Launch full desktop app (main dev entry)
npm run dev:web          # Web only on port 3000
npm run dev:server       # Backend only on port 8090
npm run dev:desktop-only # Electron only; expects web dev server on port 3000
npm run build            # Build web + create desktop packages
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

## Architecture landmine: embedded backend

The Fastify server runs **in-process** inside the Electron main process — it is NOT a spawned child process. `apps/desktop/src/main/` imports `@puntovivo/server` directly. Do not assume a separate server process exists.

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

## Node.js version constraint

Root `package.json` enforces `>=22.0.0`. `packages/server` has `>=20.0.0` but the root constraint takes precedence. Use Node 22+.

## Stale files — do not rely on

- `.github/workflows/release.yml` backend job: Has been rewritten for Node.js but may still have edge cases. Verify before modifying.

## Release workflow

Automatic CI only validates test, lint, and build flows. Desktop/web artifacts and GitHub releases are created exclusively through the manual `release.yml` workflow.

## Git conventions

Use Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `build:`, `chore:`). Scope with the module name: `feat(products):`, `fix(auth):`, etc.

## Adding new features — checklist

1. Schema change → update both `packages/server/src/db/schema.ts` (Drizzle) AND the raw DDL in `packages/server/src/db/index.ts`. These two are hand-synchronized today; see ROADMAP ticket `DB-002` for the migration to versioned Drizzle migrations.
2. New tRPC procedure → add Zod schema in `packages/server/src/trpc/schemas/`, wire it in the router, and add a unit/integration test in `packages/server/src/__tests__/`. Frontend types are inferred end-to-end via the `AppRouter` export — only add entries to `apps/web/src/types/index.ts` for domain models that don't flow through tRPC.
3. New frontend page → add a lazy route in `apps/web/src/App.tsx`, add a sidebar entry in `apps/web/src/components/layout/Sidebar.tsx`, and wire any role gating through `ProtectedRoute`. All user-visible strings must live in `apps/web/src/i18n/locales/*` (an ESLint rule blocks hardcoded strings in `title`, `placeholder`, and `aria-label`).
4. Run `npm run ci:web` and/or `npm run ci:server` (see "Required checks" above) before committing.
