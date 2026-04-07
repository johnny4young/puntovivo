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

Current desktop runtime is Electron `41.1.0`. If you pass `-v` to `electron-rebuild`, use `41.1.0` instead of older examples.

If Node-based server tests fail after an Electron rebuild, rebuild `better-sqlite3` for the current Node runtime too:

```
node packages/server/scripts/rebuild-better-sqlite3-node.mjs
```

## Architecture landmine: embedded backend

The Fastify server runs **in-process** inside the Electron main process — it is NOT a spawned child process. `apps/desktop/src/main/` imports `@open-yojob/server` directly. Do not assume a separate server process exists.

## tRPC is the primary transport

`/api/trpc` is the canonical application API. `/api/health` remains as a compatibility health endpoint and `/api/realtime/*` remains for SSE. Do not reintroduce new REST route docs or code paths for auth, collections, or sync.

## Required review skill for React/TypeScript work

For any React or TypeScript implementation, refactor, or review in `apps/web`, you **must** use the `typescript-react-reviewer` skill before finalizing changes. Treat its checks on derived state, effect abuse, type safety, and maintainability as mandatory, not optional.

## Stale files — do not rely on

- `.github/workflows/release.yml` backend job: Has been rewritten for Node.js but may still have edge cases. Verify before modifying.

## Desktop artifact uploads

CI only uploads desktop build artifacts on pushes to `main`. PRs and branch pushes skip desktop artifact upload — this is intentional, not a CI bug.

## Node.js version constraint

Root `package.json` enforces `>=22.0.0`. `packages/server` has `>=20.0.0` but the root constraint takes precedence. Use Node 22+.
