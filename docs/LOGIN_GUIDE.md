# Login and Access Guide

> Updated: April 10, 2026

## Authentication Model

Open Yojob uses:

- Argon2 password hashing
- in-memory bearer access tokens
- rotated `httpOnly` refresh cookies
- CSRF protection for cookie-backed auth flows
- role-based route and procedure guards
- tenant isolation in server context

Password policy for user creation, reset, and self-service password change:

- at least 12 characters
- at least one uppercase letter
- at least one lowercase letter
- at least one number
- at least one special character

The canonical auth transport is tRPC on `/api/trpc`.

## Seeded Admin Account

On first database creation, the system creates an admin account:

- Email: `admin@localhost`
- Password in development/non-production: `Admin123!Dev`
- Password in production: generated randomly and printed once in server output

You can override the non-production default before first seed with:

```bash
OPEN_YOJOB_DEV_ADMIN_PASSWORD="your-dev-password"
```

If you miss the production password, recreate the database for that environment and let seed run again.

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
4. The server returns a short-lived access token plus basic user and tenant info, and sets a refresh cookie.
5. The client keeps the access token in memory and refreshes it when needed by using the refresh cookie.
6. Protected routes and tRPC procedures enforce role and tenant access.

## Self-Service Password Change

- Open the user menu in the header.
- Choose `Change password`.
- Submit your current password and a new password that meets the strength policy.
- After success, the app signs you out and older tokens stop working.

## Admin Password Management

- Admins must use the same strong password policy when creating users.
- Admin password resets also require the same strong password policy.
- If an admin resets their own password from the users screen, the app signs them out immediately.

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
- in development, try `Admin123!Dev` unless you overrode `OPEN_YOJOB_DEV_ADMIN_PASSWORD`
- in production, copy the generated password exactly
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
npm run native:ensure:electron --workspace=@open-yojob/desktop
```

If server tests later fail due to `better-sqlite3` mismatch in the current shell runtime:

```bash
npm run native:ensure:node --workspace=@open-yojob/server
```

## Authenticated Manual Request Example

```bash
curl -X POST "http://localhost:8090/api/trpc/auth.login?batch=1" \
  -H "Content-Type: application/json" \
  -d '{"0":{"json":{"email":"admin@localhost","password":"Admin123!Dev"}}}'
```

## Notes

- logout is effectively client-side token clearing plus a lightweight API call
- password changes and admin resets now invalidate older sessions through per-user session versioning
- tokens are also revoked when the signed-in user's `email` or `role` changes, or when the tenant is disabled
- site-aware business flows also depend on `x-site-id` once a site is selected in the app
