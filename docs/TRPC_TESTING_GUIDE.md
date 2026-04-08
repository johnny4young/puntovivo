# Testing tRPC Endpoints - Quick Guide

## Current Baseline

Open Yojob now uses tRPC as its primary application API. The fastest way to test behavior is:

- server-side router tests with `appRouter.createCaller(...)`
- focused workspace tests with Vitest
- manual endpoint checks against `/api/trpc` when needed

The older “Phase 1 health-check only” guidance is obsolete.

## Prerequisites

### Node version

Use Node 22+, which is required by the repo root `package.json`.

### Native module rebuilds

After `npm install`, rebuild Electron native modules:

```bash
npx electron-rebuild -m apps/desktop
```

If server-side tests fail after an Electron rebuild because `better-sqlite3` was compiled for the
wrong runtime, rebuild it for Node as well:

```bash
node packages/server/scripts/rebuild-better-sqlite3-node.mjs
```

## Running the App for Manual Checks

### Backend only

```bash
npm run dev:server
```

### Web + backend

```bash
npm run dev:fullstack
```

### Desktop app

```bash
npm run dev
```

## Fast Manual Checks

### Compatibility health endpoint

```bash
curl http://localhost:8090/api/health
```

### Canonical tRPC health procedure

```bash
curl http://localhost:8090/api/trpc/health.check
```

## Current Router Coverage

The root router currently exposes:

- `health`
- `auth`
- `companies`
- `dashboard`
- `providers`
- `sequentials`
- `units`
- `vatRates`
- `categories`
- `products`
- `customers`
- `purchases`
- `sales`
- `inventory`
- `sites`
- `sync`
- `users`

Source:
[packages/server/src/trpc/router.ts](/Users/johnny4young/Personal/github/open_yojob/packages/server/src/trpc/router.ts)

## Recommended Test Paths

### 1. Focused server tests

Run only the domain suite you are changing:

```bash
npm run test --workspace=@open-yojob/server -- dashboard
npm run test --workspace=@open-yojob/server -- products
npm run test --workspace=@open-yojob/server -- inventory
npm run test --workspace=@open-yojob/server -- sales
npm run test --workspace=@open-yojob/server -- purchases
```

### 2. Web regression pass

```bash
npm run test --workspace=@open-yojob/web -- --run
```

### 3. Web production build

```bash
npm run build --workspace=@open-yojob/web
```

### 4. Desktop typing check when preload/main changes

```bash
npm run typecheck --workspace=@open-yojob/desktop
```

## Server Test Pattern

Prefer direct router-caller tests over HTTP injection for business logic:

```ts
const caller = appRouter.createCaller(context);
const result = await caller.products.list({ page: 1, perPage: 10 });
```

This keeps tests fast and focused on procedure behavior, validation, and database effects.

## Manual Authenticated Requests

For protected procedures:

1. Get a token through `auth.login`
2. Send it as `Authorization: Bearer <token>`
3. Include `x-site-id` when testing site-scoped behavior

Example login request:

```bash
curl -X POST "http://localhost:8090/api/trpc/auth.login?batch=1" \
  -H "Content-Type: application/json" \
  -d '{"0":{"json":{"email":"admin@localhost","password":"<password>"}}}'
```

## Troubleshooting

### Server tests fail with native module mismatch

```bash
npx electron-rebuild -m apps/desktop
node packages/server/scripts/rebuild-better-sqlite3-node.mjs
```

### Port already in use

```bash
lsof -i :8090
```

### Web build succeeds with chunk warnings

The current web build may still emit large-chunk warnings. Treat that as a packaging/perf follow-up,
not an automatic test failure, unless the build exits non-zero.

## Current Recommendation

Use `docs/IMPLEMENTATION_STATUS.md` for roadmap status and
`docs/TRPC_ARCHITECTURE.md` for the live transport architecture. Treat older phased migration notes
as historical context.
