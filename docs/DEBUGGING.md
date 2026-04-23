# Debugging Guide

> Updated: April 9, 2026

## Quick Start

### Full desktop app

```bash
npm run dev:desktop
```

### Web only

```bash
npm run dev:web
```

### Standalone backend only

```bash
npm run dev:server
```

## Desktop Debug Scripts

Desktop-specific debug scripts are exposed from the workspace, not the repo root:

```bash
npm run dev:desktop:debug --workspace=@puntovivo/desktop
npm run dev:desktop:debug-brk --workspace=@puntovivo/desktop
```

These start Electron with Node inspect enabled for the main process.

## What to Debug Where

### Electron main process

Use when debugging:

- embedded server startup
- IPC handlers
- backup/restore
- tray behavior
- print handling
- auto-update behavior

Relevant files:

- [index.ts](/Users/johnny4young/Personal/github/puntovivo/apps/desktop/src/main/index.ts)
- [auto-updater.ts](/Users/johnny4young/Personal/github/puntovivo/apps/desktop/src/main/auto-updater.ts)

### Preload bridge

Use when debugging:

- `window.electron`
- `window.db`
- `window.sync`
- desktop-only renderer integration bugs

Relevant file:
[index.ts](/Users/johnny4young/Personal/github/puntovivo/apps/desktop/src/preload/index.ts)

### Web renderer

Use when debugging:

- route guards
- TanStack Query / tRPC usage
- feature modules
- layout/feedback behavior

Relevant files:

- [main.tsx](/Users/johnny4young/Personal/github/puntovivo/apps/web/src/main.tsx)
- [App.tsx](/Users/johnny4young/Personal/github/puntovivo/apps/web/src/App.tsx)

### Server

Use when debugging:

- auth and role middleware
- DB transactions
- sync logic
- reporting
- router-level validation and business rules

## Practical Workflow

### Debug a renderer issue

1. run `npm run dev:web`
2. open the browser devtools
3. inspect network requests to `/api/trpc`
4. verify query invalidations and route guards

### Debug a desktop bridge issue

1. run `npm run dev:desktop:debug --workspace=@puntovivo/desktop`
2. set breakpoints in Electron main or preload
3. trigger the UI action from the desktop app

### Debug a server business rule

1. reproduce with a focused Vitest suite
2. if needed, add temporary logging under `VERBOSE=true`
3. inspect the affected router and transaction boundaries

## Useful Commands

```bash
npm exec --workspace=@puntovivo/server -- vitest run sales --reporter=dot
npm run test --workspace=@puntovivo/web -- --run
npm run typecheck --workspace=@puntovivo/desktop
```

## Frequent Causes of Confusion

- forgetting that Fastify runs inside Electron main in desktop mode
- expecting new app functionality under REST instead of tRPC
- changing `apps/web/.env` without restarting or rebuilding the web app
- hitting native module mismatch after switching between Electron and Node runtimes
