# Login and Access Guide

> Updated: September 6, 2026

## Authentication Model

Puntovivo uses:

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

## First-use ownership

A new interactive installation starts without a business or an administrator.
The login screen offers two steps: business/location/country/profile, then the
owner's name, email and strong password. The owner signs in through the same
normal authentication flow used by existing accounts.

- **Electron:** use the main Puntovivo window. Its narrowly scoped IPC bridge
  submits the fixed tRPC setup command; the installation secret never enters
  the renderer. Auxiliary windows, frames and remote Hub clients cannot claim
  an installation.
- **Standalone web:** run the server and open Puntovivo on that same computer.
  Enter the private 64-character installation code shown in the server's
  startup output. Remote HTTP setup is refused, even with forwarded headers.
  An operator-managed loopback tunnel is an administrative deployment concern,
  not a remote registration feature.
- Treat startup output containing this code as a credential. Restrict any
  supervisor stdout logs; never send it to telemetry, screenshots or support.
  A restart replaces an unused code, and successful ownership consumes it.
- Existing databases are adopted as already owned, without changes to accounts,
  passwords or tenant data. Deleting or deactivating an owner does not reopen
  setup. A missing completion marker fails closed.
- If setup committed but the response was lost, sign in with the chosen account.
  Do not delete a business database to recover a password. Use an existing
  authorized administrator. If none is available, contact the installation
  operator rather than recreating the database.

Creating ownership is **not** business readiness. Legal details, valid tax rates,
numbering, products, employees and cash configuration remain explicit setup
steps. The country selection provides catalog-backed currency and locale only;
no debts, stock, tax identifiers or regulatory authorizations are invented.

### Explicit development fixtures

The seed tooling and automated test templates can still create `admin@localhost`.
Their non-production default is `Admin123!Dev`, configurable before seeding with
`PUNTOVIVO_DEV_ADMIN_PASSWORD`. Interactive standalone and desktop entrypoints
never enable this fixture seed automatically. See [DEV-SEED.md](./DEV-SEED.md)
for disposable demonstration data, not production access recovery.

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
[roleAccess.ts](../apps/web/src/features/auth/roleAccess.ts)

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
[auth router](../packages/server/src/trpc/routers/auth/index.ts)

## Running the App

### Desktop

```bash
pnpm install
pnpm --filter @puntovivo/desktop run rebuild
pnpm run dev:desktop
```

### Web + standalone backend

```bash
pnpm run dev:web-stack
```

## Common Problems

### Invalid credentials

Check:

- you are using your actual owner account (or `admin@localhost` only in an explicitly seeded development fixture)
- the password is the one chosen during first-use setup
- `Admin123!Dev` applies only to explicitly seeded, disposable development fixtures
- the user account is active

### Cannot connect to server

Check:

```bash
curl http://localhost:8090/api/health
```

### Native module mismatch in desktop mode

Verify the portable Electron native runtime (do not rebuild it):

```bash
pnpm --filter @puntovivo/desktop run native:ensure:electron
```

If server tests later fail due to `better-sqlite3` mismatch in the current shell runtime:

```bash
pnpm --filter @puntovivo/server run native:ensure:node
```

## Explicit Development-Fixture Login Example

```bash
curl -X POST "http://localhost:8090/api/trpc/auth.login?batch=1" \
  -H "Content-Type: application/json" \
  -d '{"0":{"email":"admin@localhost","password":"Admin123!Dev"}}'
```

## Notes

- logout is effectively client-side token clearing plus a lightweight API call
- password changes and admin resets now invalidate older sessions through per-user session versioning
- tokens are also revoked when the signed-in user's `email` or `role` changes, or when the tenant is disabled
- site-aware business flows also depend on `x-site-id` once a site is selected in the app
