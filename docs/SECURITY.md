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

## auth.login rate limiting (ENG-008)

The `auth.login` tRPC procedure (`packages/server/src/trpc/routers/auth.ts`) is
gated by two independent in-memory TTL buckets declared in
`packages/server/src/security/loginRateLimit.ts`.

| Bucket   | Key                  | Cap | Window      | Purpose |
| -------- | -------------------- | --- | ----------- | ------- |
| IP       | client `request.ip`  | 10  | 60 seconds  | Stops brute-force from a single origin. |
| Username | normalized email     | 5   | 15 minutes  | Stops distributed credential-stuffing that rotates IPs against one account. |

Every failed attempt — wrong password, unknown user, disabled user, disabled
tenant — increments BOTH buckets. Counting attempts for unknown users is
deliberate: it prevents username-enumeration via brute-force timing.

Reset rules:

- A successful login clears the username bucket for that email only.
- The IP bucket is never reset on success; it decays via its 60-second TTL.
  A single legitimate login must not amnesty an active stuffing source.
- Email keys are normalized (`email.trim().toLowerCase()`) before lookup,
  so different casings of the same address share one bucket.

When either cap is exceeded, the procedure responds with:

- tRPC code `TOO_MANY_REQUESTS` (HTTP 429).
- Stable `errorCode: 'AUTH_RATE_LIMIT_EXCEEDED'` on the error `cause`.
- `details: { kind, key, max, secondsUntilReset }` so the frontend can
  render an accurate retry-after.

### Attack coverage

- **Single-IP brute-force against one account** — blocked by the username
  bucket at attempt 6 and by the IP bucket at attempt 11 (whichever lands
  first).
- **Credential stuffing from one IP across many accounts** — blocked by the
  IP bucket at attempt 11.
- **Distributed credential stuffing against one account** — blocked by the
  username bucket at attempt 6, regardless of origin IP.
- **Distributed credential stuffing across many accounts** — partially
  mitigated: each (IP, account) pair can still make up to 5 attempts
  before the username bucket for that account fires across all IPs. An
  acceptable residual for the embedded POS; see "Future hardening" below
  for the multi-tenant path.

### Persistence and restart behavior

Bucket state lives in two `Map<string, {count, firstAt}>` instances at the
module level. A server restart wipes the counters and every attempt starts
fresh. For the embedded Electron build this is acceptable (a restart is
rare and observable; the DB stays intact so actual account state is
unchanged). `ENG-008b` tracks DB-backed persistence for the multi-tenant
cloud deployment.

### Operations

Policy knobs are exported constants — changing any requires updating the
unit tests in `packages/server/src/__tests__/loginRateLimit.test.ts` and a
note in the ROADMAP explaining the trade-off:

```ts
export const LOGIN_RATE_LIMIT_IP_MAX = 10;
export const LOGIN_RATE_LIMIT_IP_WINDOW_MS = 60_000;
export const LOGIN_RATE_LIMIT_USERNAME_MAX = 5;
export const LOGIN_RATE_LIMIT_USERNAME_WINDOW_MS = 15 * 60_000;
```

No structured log is emitted when a bucket trips today. `ENG-006` will add
`security.login.rate-limit.hit` events once the `pino` logger lands; the
thrown error already carries `details.kind` / `details.key` for the
logger wrapper to read.

### Non-goals in this slice

- The 60-second `@fastify/rate-limit` global cap at 100/min stays as-is —
  it protects the rest of the tRPC surface but intentionally does not
  interact with the login-specific buckets.
- The 429 error message is English-only in the server response. Frontend
  localization keys on the `AUTH_RATE_LIMIT_EXCEEDED` error code via
  `apps/web/src/lib/translateServerError.ts`; see
  `apps/web/src/i18n/locales/**/errors.json` for the translation entries.

### Future hardening (tracked follow-ups)

- `ENG-008b` — persistent DB-backed tracking so server restarts do not
  amnesty attackers.
- Per-account exponential backoff (double the window for repeated locks).
- CAPTCHA challenge after N consecutive locks.
- IP allowlist / denylist for deployments that know their customer subnets.
- Optional multi-factor on the login procedure.

## Dependency audit gate (ENG-009)

Every CI script (`ci:web`, `ci:server`, `ci:desktop`) begins with a shared
`ci:audit` step defined in the root `package.json`:

```
"ci:audit": "npm audit --production --audit-level=high"
```

It runs before typecheck / lint / tests, so a new HIGH or CRITICAL
CVE in any **production** dependency — across all workspaces, because
the lockfile is shared — fails CI immediately. Development-time
dependencies (vitest, eslint, drizzle-kit, electron-forge tooling) are
intentionally excluded via `--production`; they do not ship to end
users and their patch cadence is slower.

Threshold knob:

- `high` is the enforced floor. MODERATE and LOW prod vulns are visible
  via local `npm audit` but do not gate CI — they are bumped through
  the normal Dependabot cadence described below.
- Raising the floor to `moderate` is a future hardening step. Adopt
  when the repo has cleared the current MODERATE backlog (the dev-dep
  ESBuild / http-proxy-agent advisories attached to drizzle-kit and
  @electron/node-gyp).

Dependabot (see `.github/dependabot.yml`) opens grouped PRs on a
monthly cadence for npm deps and a weekly cadence for GitHub Actions.
Grouping keeps the PR noise manageable by opening a small set of
shared-lockfile PRs (production, development, and focused groups such
as `react` / `@tanstack/*`) while still catching CVE fixes within a
week when GitHub publishes a new advisory. `electron` and
`@electron-forge/*` are excluded from the grouped PRs and must be
bumped manually — each Electron version change requires a packaged
smoke test, which lives outside the Dependabot automation surface.

### Tamper-check history (ENG-009 acceptance)

Before the ticket landed, the three prod vulnerabilities flagged by
`npm audit --production --audit-level=high` were:

| Package      | Severity | Advisory |
| ------------ | -------- | -------- |
| `fast-jwt <=6.2.0`     | critical | GHSA-hm7r-c7qw-ghp6, GHSA-mvf2-f6gm-w987, GHSA-rp9m-7r4c-75qg, GHSA-cjw9-ghj4-fwxf, GHSA-3j8v-cgw4-2g6q |
| `fastify 5.3.2-5.8.4`  | high     | GHSA-247c-9743-5963 |
| `dompurify <=3.3.3`    | moderate | GHSA-39q2-94rc-95cp |

All three were cleared by `npm update fastify fast-jwt dompurify`
(transitive-safe bumps that respect the existing version ranges): the
lockfile now resolves `fastify@5.8.5`, `fast-jwt@6.2.2`,
`dompurify@3.4.0`. Reverting the lockfile to the pre-bump state and
running `npm run ci:audit` produces exit code 1 with the three vulns
reported — proof the gate fires, not just passes.

## Current Open Risks

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

1. ~~enable sandbox for the main BrowserWindow if the remaining preload/renderer assumptions allow it~~ — **shipped as ENG-004**. The main window now runs under `sandbox: true`; the invariant is pinned by a `node --test` regression in `apps/desktop/src/main/__tests__/window-config.test.ts`.
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
