# tRPC Testing Guide

> Updated: April 9, 2026

## Current Testing Approach

The fastest reliable way to validate tRPC behavior in this repo is:

1. focused server Vitest suites using `appRouter.createCaller(...)`
2. full or focused web Vitest runs
3. web production build
4. desktop typecheck when preload/main changes

## Prerequisites

### Node version

Use Node 22+ from the repo root requirement.

### Native rebuilds

After install:

```bash
npx electron-rebuild -m apps/desktop
```

To prepare the current shell/runtime for server-side tests:

```bash
npm run native:ensure:node --workspace=@open-yojob/server
```

## Recommended Commands

### Focused server suite

```bash
npm exec --workspace=@open-yojob/server -- vitest run sales --reporter=dot
npm exec --workspace=@open-yojob/server -- vitest run purchases --reporter=dot
npm exec --workspace=@open-yojob/server -- vitest run dashboard sync --reporter=dot
```

### Full web suite

```bash
npm run test --workspace=@open-yojob/web -- --run
```

### Web production build

```bash
npm run build --workspace=@open-yojob/web
```

### Desktop typecheck

```bash
npm run typecheck --workspace=@open-yojob/desktop
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

### Authenticated login example

```bash
curl -X POST "http://localhost:8090/api/trpc/auth.login?batch=1" \
  -H "Content-Type: application/json" \
  -d '{"0":{"json":{"email":"admin@localhost","password":"Admin123!Dev"}}}'
```

### Hybrid auth smoke flow

```bash
# 1. Mint CSRF cookie
curl -i -c cookies.txt "http://localhost:8090/api/trpc/health.check"

# 2. Login and capture refresh cookie
curl -i -b cookies.txt -c cookies.txt \
  -X POST "http://localhost:8090/api/trpc/auth.login?batch=1" \
  -H "Content-Type: application/json" \
  -d '{"0":{"json":{"email":"admin@localhost","password":"Admin123!Dev"}}}'

# 3. Call auth.refresh with refresh cookie + matching CSRF header
curl -i -b cookies.txt \
  -X POST "http://localhost:8090/api/trpc/auth.refresh?batch=1" \
  -H "x-csrf-token: <csrf-token-from-cookie-jar>" \
  -H "Content-Type: application/json" \
  -d '{"0":{"json":null}}'
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
