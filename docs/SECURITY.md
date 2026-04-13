# Security Notes

> Updated: April 10, 2026

## Current Security Posture

The project already includes the main baseline controls expected for the current app shape:

- Argon2 password hashing
- cryptographically generated seeded admin password
- hybrid auth with short-lived access JWTs and rotated refresh cookies
- CSRF protection on cookie-backed auth flows
- session invalidation on password change and admin password reset
- tenant isolation in request context
- role-based access control in tRPC middleware
- Fastify rate limiting
- context isolation in Electron
- disabled `nodeIntegration` in Electron windows
- allowlisted desktop DB and sync bridge instead of arbitrary SQL exposure

Key references:

- [index.ts](/Users/johnny4young/Personal/github/puntovivo/packages/server/src/index.ts)
- [auth.ts](/Users/johnny4young/Personal/github/puntovivo/packages/server/src/trpc/routers/auth.ts)
- [roles.ts](/Users/johnny4young/Personal/github/puntovivo/packages/server/src/trpc/middleware/roles.ts)
- [index.ts](/Users/johnny4young/Personal/github/puntovivo/apps/desktop/src/main/index.ts)
- [index.ts](/Users/johnny4young/Personal/github/puntovivo/apps/desktop/src/preload/index.ts)

## Strengths Already in Place

### Authentication and authorization

- password hashes use Argon2
- access JWTs are sent as bearer tokens and kept in memory on the web client
- refresh tokens live in an `httpOnly` cookie and are rotated through `auth.refresh`
- the same strong password policy is enforced for self-service changes, admin-created users, and admin resets
- JWT payload includes tenant and role context
- JWT payloads also include a per-user session version so password changes revoke prior sessions
- token verification also re-checks live `email`, `role`, and tenant active state so outdated claims lose access immediately
- server procedures rely on middleware for auth, tenant, and role enforcement
- cookie-backed auth flows require a matching CSRF cookie/header pair

### Multi-tenant isolation

- business data is modeled per tenant
- tenant guards exist in the tRPC layer
- site-scoped flows also carry `x-site-id`

### Desktop bridge hardening

- renderer access to native capabilities goes through preload
- raw Node access is not exposed to the renderer
- DB bridge uses allowlisted tables/fields and tenant-aware sync helpers

## Current Open Risks

### Electron sandbox

The hidden print window uses `sandbox: true`, but the main BrowserWindow still uses `sandbox: false`.
That remains a meaningful hardening gap.

### Auditability

The app would benefit from fuller audit logs for sensitive operations such as:

- backup restore
- sync conflict resolution
- sale refunds
- purchase voids
- user/role changes
- company settings changes

### Dependency review

Desktop packaging and export/reporting dependencies should continue to be reviewed during normal maintenance.

## Recommendations

Short-term:

1. enable sandbox for the main BrowserWindow if the remaining preload/renderer assumptions allow it
2. add auditable records for sensitive admin workflows

Medium-term:

1. add operator-facing security runbooks
2. add packaged desktop verification for update, tray, backup, and restore paths
3. keep dependency review part of release preparation

## Practical Verification

```bash
curl http://localhost:8090/api/health
curl http://localhost:8090/api/trpc/health.check
npm audit
```

Manual auth flow checks now need to account for the hybrid model:

1. call `health.check` once to mint the CSRF cookie
2. call `auth.login` to receive an access token and refresh cookie
3. send `Authorization: Bearer <accessToken>` on protected tRPC requests
4. send both the refresh cookie and `x-csrf-token` header when calling `auth.refresh` or other unsafe cookie-backed auth endpoints
5. after `auth.changePassword` or `users.resetPassword`, expect previously issued access and refresh tokens to stop working

For current product gaps and roadmap, see:
[ROADMAP.md](/Users/johnny4young/Personal/github/puntovivo/docs/ROADMAP.md)
