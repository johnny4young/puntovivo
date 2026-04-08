# Security Documentation

**Project:** Open Yojob POS System
**Last Updated:** 2026-04-07

---

## Security Posture Summary

The application underwent a comprehensive security review on 2026-02-03. Critical and high-priority fixes were applied in commit `ccd0552` on 2026-02-05.

| Category  | Found  | Fixed | Remaining |
| --------- | ------ | ----- | --------- |
| CRITICAL  | 1      | 1     | 0         |
| HIGH      | 4      | 3     | 1         |
| MEDIUM    | 8      | 2     | 6         |
| LOW       | 2      | 0     | 2         |
| **Total** | **15** | **6** | **9**     |

### What Is Already Secure

- Context isolation enabled in Electron
- Node integration disabled
- Drizzle ORM used everywhere (SQL injection protection)
- Argon2 for password hashing
- JWT-based authentication

---

## Fixes Applied (commit ccd0552)

### 1. Default Credentials (CRITICAL - FIXED)

**File:** `packages/server/src/db/seed.ts`

The hardcoded `admin123` password was replaced with a cryptographically secure random password generated at seed time using `crypto.randomBytes(16)`. The password is shown once in the console during initial setup.

### 2. JWT Secret Generation (HIGH - FIXED)

**File:** `packages/server/src/index.ts`

`Math.random()` was replaced with `crypto.randomBytes(32).toString('base64')` for JWT secret generation.

### 3. Authentication Rate Limiting (HIGH - FIXED)

**Files:** `packages/server/src/index.ts`, `packages/server/src/trpc/routers/auth.ts`

Added `@fastify/rate-limit` with:

- Global: 100 requests per minute
- Login endpoint: 5 attempts per 15 minutes

### 4. Password Policy (MEDIUM - FIXED)

**File:** `packages/server/src/trpc/routers/auth.ts`

Minimum password length increased from 6 to 12 characters. Added complexity requirements: uppercase, lowercase, number, and special character.

### 5. Tenant Isolation (MEDIUM - FIXED)

**File:** `packages/server/src/trpc/middleware/tenant.ts`

Changed tenant check from optional (`if (tenantId)`) to mandatory. Returns 403 if tenant context is missing for isolated collections.

---

## Remaining Vulnerabilities

### HIGH Priority

#### Dependency CVEs

These are in transitive dependencies of `@electron-forge` and have no upstream fix available:

| Package        | CVE                                                           | Issue                   |
| -------------- | ------------------------------------------------------------- | ----------------------- |
| `tar` <= 7.5.6 | GHSA-8qq5-rm4j-mr97, GHSA-r6q2-hw4h-h46w, GHSA-34x7-hfp2-rc4v | Path traversal (3 CVEs) |

**Note:** `@remix-run/router` XSS vulnerability (GHSA-2w69-qvjg-hvjx) was resolved by upgrading to React Router v7, which no longer depends on that package.

**Remediation:** Monitor `@electron-forge` releases for `tar` fixes. The 34 remaining npm audit vulnerabilities are all in `@electron-forge` transitive dependencies.

### MEDIUM Priority

#### Session Invalidation on Password Change

**File:** `packages/server/src/trpc/routers/auth.ts`

Old JWT tokens remain valid after a password change. Fix: add a `tokenVersion` field to the user schema and validate it during authentication.

#### DOMPurify XSS (GHSA-vhxf-7vqr-mrjg)

**Package:** `dompurify` < 3.2.4 (transitive dependency via `jspdf`)

Fix: Update `jspdf` to a version that ships `dompurify` >= 3.2.4.

#### esbuild Development Server (GHSA-67mh-4wv8-2f99)

**Package:** `esbuild` <= 0.24.2

Development-only vulnerability. Fix by updating `esbuild`, `vite`, and `drizzle-kit`.

#### Electron Sandbox Disabled

**File:** `apps/desktop/src/main/index.ts:36`

`sandbox: false` is set. Enable sandbox mode if application functionality permits.

#### Unused IPC Handlers

**File:** `apps/desktop/src/preload/index.ts:34-51`

Database and sync APIs are exposed via IPC but handlers are not implemented in the main process. Either remove them or implement with proper validation.

#### Missing Two-Factor Authentication

No 2FA support exists. Add TOTP support for admin accounts.

### LOW Priority

#### Sensitive Data in Logs

**File:** `packages/server/src/db/seed.ts:82`

Admin password is logged to console during seeding. Acceptable for initial setup but should be suppressed in production.

#### Development CORS Origins

**File:** `packages/server/src/index.ts:57-62`

Development origins (localhost:3000, localhost:5173) are always allowed. Add environment-based configuration for production.

---

## Verification Status

This document tracks the security review findings and follow-up actions. The exact total test count
changes over time, so use the current workspace test commands instead of relying on the historical
numbers from the original review.

---

## Verification Commands

```bash
# Test secure password generation
npm run dev  # Check console for random password

# Test rate limiting (6th attempt should return 429)
curl -X POST "http://localhost:8090/api/trpc/auth.login?batch=1" \
  -H "Content-Type: application/json" \
  -d '{"0":{"json":{"email":"admin@localhost","password":"wrong"}}}'

# Test password policy (should fail validation)
# Try setting password "weak123"

# Test tenant isolation (should return 403)
# Access collection without tenant ID

# Run dependency audit
npm audit
```

---

## Security Roadmap

### Completed

- [x] Replace default credentials with secure random generation
- [x] Fix JWT secret generation (use crypto.randomBytes)
- [x] Add rate limiting to authentication endpoints
- [x] Strengthen password policy (12+ chars with complexity)
- [x] Make tenant isolation mandatory

### Next Steps

- [ ] Update remaining dependencies with known CVEs (tar via @electron-forge, jspdf/dompurify)
- [ ] Add session invalidation on password change (requires schema migration)
- [ ] Enable Electron sandbox mode
- [ ] Remove or implement unused IPC handlers

### Future Enhancements

- [ ] Implement two-factor authentication (TOTP)
- [ ] Add audit logging for sensitive operations
- [ ] Add security headers (CSP, HSTS)
- [ ] Encrypt sensitive data at rest
- [ ] Regular penetration testing

---

## Critical Files for Security Review

```
packages/server/src/db/seed.ts              # Credentials and seeding
packages/server/src/trpc/routers/auth.ts    # Authentication logic
packages/server/src/index.ts                # JWT config, rate limiting
packages/server/src/trpc/router.ts          # Router registration
apps/desktop/src/main/index.ts              # Electron security settings
apps/desktop/src/preload/index.ts           # IPC handlers
```

---

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Electron Security Best Practices](https://www.electronjs.org/docs/latest/tutorial/security)
- [Fastify Security Guide](https://fastify.dev/docs/latest/Guides/Security/)
