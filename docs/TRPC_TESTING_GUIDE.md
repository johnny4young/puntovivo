# tRPC Testing Guide

**Language:** English · [Español](es/TRPC_TESTING_GUIDE.md)

> Updated: June 1, 2026

## Current Testing Approach

The fastest reliable way to validate tRPC behavior in this repo is:

1. focused server Vitest suites using `appRouter.createCaller(...)`
2. full or focused web Vitest runs
3. web production build
4. desktop typecheck when preload/main changes

## Prerequisites

### Node version

Use Node 24+ from the repo root requirement.

### Portable native verification

After install, verify the bundled Node-API prebuild; do not rebuild it:

```bash
pnpm --filter @puntovivo/desktop run native:ensure:electron
```

To prepare the current shell/runtime for server-side tests:

```bash
pnpm --filter @puntovivo/server run native:ensure:node
```

## Recommended Commands

### Focused server suite

```bash
pnpm --filter @puntovivo/server run test -- sales --reporter=dot
pnpm --filter @puntovivo/server run test -- purchases --reporter=dot
pnpm --filter @puntovivo/server run test -- dashboard sync --reporter=dot
```

### Full web suite

```bash
pnpm --filter @puntovivo/web run test -- --run
```

### Web production build

```bash
pnpm --filter @puntovivo/web run build
```

### Desktop typecheck

```bash
pnpm --filter @puntovivo/desktop run typecheck
```

## Preferred Server Test Pattern

Prefer direct caller tests for business logic:

```ts
const caller = appRouter.createCaller(context);
const result = await caller.sales.summary();
```

Why:

- faster than HTTP-level tests
- easier to control tenant/user/site context
- better for transactional business logic coverage

## Manual Request Checks

### Compatibility health

```bash
curl http://localhost:8090/api/health
```

### Canonical tRPC health

```bash
curl http://localhost:8090/api/trpc/health.check
```

### Explicit disposable-fixture login example

These credentials apply only to an explicitly seeded, owned disposable fixture.
Use the actual owner account for an interactive installation; see
[LOGIN_GUIDE.md](./LOGIN_GUIDE.md). The server uses plain JSON, not a transformer envelope.

```bash
curl -X POST "http://localhost:8090/api/trpc/auth.login?batch=1" \
  -H "Content-Type: application/json" \
  -d '{"0":{"email":"admin@localhost","password":"Admin123!Dev"}}'
```

### Hybrid auth smoke flow

```bash
# 1. Mint CSRF cookie
curl -i -c cookies.txt "http://localhost:8090/api/trpc/health.check"

# 2. Login and capture refresh cookie
curl -i -b cookies.txt -c cookies.txt \
  -X POST "http://localhost:8090/api/trpc/auth.login?batch=1" \
  -H "Content-Type: application/json" \
  -d '{"0":{"email":"admin@localhost","password":"Admin123!Dev"}}'

# 3. Read the updated CSRF token from the jar after login; refresh and save rotated cookies
curl -i -b cookies.txt -c cookies.txt \
  -X POST "http://localhost:8090/api/trpc/auth.refresh?batch=1" \
  -H "x-csrf-token: <csrf-token-from-cookie-jar>" \
  -H "Content-Type: application/json" \
  -d '{"0":null}'
```

## What to Validate for Typical Changes

### Server-only change

- focused server suite
- any directly impacted related suite

### Web UI change

- focused or full web suite
- web build

### Desktop bridge change

- desktop typecheck
- impacted web suite if renderer contract changed
- server suite if embedded-backend or sync behavior changed

## Current Known Build Noise

The web build still emits Vite large-chunk warnings.
Treat that as a performance backlog item, not an automatic failure, unless the build exits with an error.
