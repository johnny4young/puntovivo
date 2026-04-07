# CLAUDE.md

Operational guidance for Claude Code sessions. Covers non-discoverable constraints, required workflows, and project conventions.

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
npm run test --workspace=@open-yojob/web     # React + Vitest (watch mode)
npm run test --workspace=@open-yojob/server  # Server + Vitest
```

## Native module rebuild (non-obvious requirement)

After `npm install`, you **must** rebuild native modules for Electron:

```
npx electron-rebuild -m apps/desktop
```

Or use the workspace shortcut: `npm run rebuild --workspace=@open-yojob/desktop`

If you see `NODE_MODULE_VERSION mismatch` errors on `better-sqlite3` or `argon2`, this is why.

Current desktop runtime is Electron `41.1.0`. If you pass `-v` to `electron-rebuild`, use `41.1.0`.

If Node-based server tests fail after an Electron rebuild, rebuild `better-sqlite3` for the current Node runtime:

```
node packages/server/scripts/rebuild-better-sqlite3-node.mjs
```

## Architecture landmine: embedded backend

The Fastify server runs **in-process** inside the Electron main process — it is NOT a spawned child process. `apps/desktop/src/main/` imports `@open-yojob/server` directly. Do not assume a separate server process exists.

## tRPC is the primary transport

`/api/trpc` is the canonical application API. `/api/health` remains as a compatibility health endpoint and `/api/realtime/*` remains for SSE. Do not reintroduce new REST route docs or code paths for auth, collections, or sync.

## Required review skills — mandatory before finalizing changes

These skills must be run before committing any changes in the listed areas. Treat their findings as mandatory, not suggestions.

| Area | Skill |
|------|-------|
| Any React or TypeScript in `apps/web` | `typescript-react-reviewer` |
| Any Node.js / backend in `packages/server` or `apps/desktop/src/main` | `node` |

Run both in parallel when a change touches both frontend and backend.

## Node.js version constraint

Root `package.json` enforces `>=22.0.0`. `packages/server` has `>=20.0.0` but the root constraint takes precedence. Use Node 22+.

## Stale files — do not rely on

- `.github/workflows/release.yml` backend job: Has been rewritten for Node.js but may still have edge cases. Verify before modifying.

## Desktop artifact uploads

CI only uploads desktop build artifacts on pushes to `main`. PRs and branch pushes skip desktop artifact upload — this is intentional, not a CI bug.

## Git conventions

Use Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `build:`, `chore:`). Scope with the module name: `feat(products):`, `fix(auth):`, etc.

## Adding new features — checklist

1. Schema change → update both `packages/server/src/db/schema.ts` (Drizzle) AND the raw DDL in `packages/server/src/db/index.ts`.
2. New tRPC procedure → add Zod schema in `packages/server/src/trpc/schemas/`, wire in router, update frontend type in `apps/web/src/types/index.ts`.
3. New frontend page → add route in `apps/web/src/App.tsx`, add sidebar entry in the layout component.
4. Run `typescript-react-reviewer` on frontend changes and `node` skill on backend changes before committing.
