# Login and Access Guide

> Updated: April 9, 2026

## Authentication Model

Open Yojob uses:

- Argon2 password hashing
- JWT bearer tokens
- role-based route and procedure guards
- tenant isolation in server context

The canonical auth transport is tRPC on `/api/trpc`.

## Seeded Admin Account

On first database creation, the system creates an admin account:

- Email: `admin@localhost`
- Password: generated randomly and printed once in server output

If you miss the password, recreate the database for that environment and let seed run again.

## Roles

Current role set:

- `admin`
- `manager`
- `cashier`
- `viewer`

Current route defaults:

- `cashier` defaults to `/sales`
- everyone else defaults to `/dashboard`

Source:
[roleAccess.ts](/Users/johnny4young/Personal/github/open_yojob/apps/web/src/features/auth/roleAccess.ts)

## Auth Flow

1. User submits credentials on the login page.
2. The app calls `auth.login`.
3. The server validates the user, tenant, and password hash.
4. The server returns a JWT plus basic user and tenant info.
5. The client stores the token locally and uses it on future requests.
6. Protected routes and tRPC procedures enforce role and tenant access.

## Current Auth Procedures

- `auth.login`
- `auth.logout`
- `auth.refresh`
- `auth.me`
- `auth.changePassword`

Source:
[auth.ts](/Users/johnny4young/Personal/github/open_yojob/packages/server/src/trpc/routers/auth.ts)

## Running the App

### Desktop

```bash
npm install
npx electron-rebuild -m apps/desktop
npm run dev
```

### Web + standalone backend

```bash
npm run dev:fullstack
```

## Common Problems

### Invalid credentials

Check:

- you are using `admin@localhost`
- you copied the generated password exactly
- the database was actually seeded
- the user account is active

### Cannot connect to server

Check:

```bash
curl http://localhost:8090/api/health
```

### Native module mismatch in desktop mode

Rebuild Electron native modules:

```bash
npx electron-rebuild -m apps/desktop
```

If server tests later fail due to `better-sqlite3` mismatch:

```bash
node packages/server/scripts/rebuild-better-sqlite3-node.mjs
```

## Authenticated Manual Request Example

```bash
curl -X POST "http://localhost:8090/api/trpc/auth.login?batch=1" \
  -H "Content-Type: application/json" \
  -d '{"0":{"json":{"email":"admin@localhost","password":"<password>"}}}'
```

## Notes

- logout is effectively client-side token clearing plus a lightweight API call
- password change exists, but global token/session invalidation is still an open hardening item
- site-aware business flows also depend on `x-site-id` once a site is selected in the app
