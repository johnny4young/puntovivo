# Security Notes

> Updated: May 25, 2026 (ENG-166 + ENG-174 closure + ENG-167 Step-1)

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

### Persistence and restart behavior (ENG-008b)

Bucket state is persisted to the `login_attempts` table. The in-memory Maps
from ENG-008 are retained as a **write-through cache** — reads consult the
cache first and fall back to the DB row; writes mutate the DB first and
then mirror the state into the cache. A server restart therefore does not
wipe an active bucket: the embedded Electron server restarts every time
the operator relaunches the app, and a cloud deployment can hot-reload or
blue-green-restart without amnestying an ongoing attack.

The table is intentionally **NOT tenant-scoped**. Rate limiting applies
per-IP and per-(normalized email) across every tenant; an attacker hammering
multiple tenants from one IP must still trip the global caps. One row per
`(kind, key)` pair is enforced by the `idx_login_attempts_kind_key` unique
index.

Lazy eviction: expired rows are deleted on the next access to their key,
so there is no sweeper timer to unwind at shutdown. `warmCacheFromDb(db)`
at boot is an optimisation that avoids a first-request DB round-trip; the
lazy-load fallback also tolerates a cold cache.

Adopted-DB defense: if `ensureMigrationBaseline()` pinned the journal
before migration 0006 could run, `loginRateLimit` falls back to an
in-memory-only path and logs one warning (mirrors the `seedCatalogs`
pattern). Operators who skip the transitional release must run the
migration manually to recover persistence.

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

There is still no dedicated `security.login.rate-limit.hit` event today.
`ENG-006` landed the shared pino logger, so a future wrapper can emit a
specialized rate-limit record without more plumbing; the thrown error
already carries `details.kind` / `details.key` for that follow-up hook.

### Non-goals in this slice

- The 60-second `@fastify/rate-limit` global cap at 100/min stays as-is —
  it protects the rest of the tRPC surface but intentionally does not
  interact with the login-specific buckets.
- The 429 error message is English-only in the server response. Frontend
  localization keys on the `AUTH_RATE_LIMIT_EXCEEDED` error code via
  `apps/web/src/lib/translateServerError.ts`; see
  `apps/web/src/i18n/locales/**/errors.json` for the translation entries.

### Future hardening (tracked follow-ups)

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

## Structured logging + PII redaction (ENG-006)

`packages/server/src/logging/logger.ts` is the single entry point for
diagnostics across the server workspace AND the Electron main
process. `createModuleLogger(name)` returns a pino child tagged with
`module: <name>`, and pino's `redact` config censors PII at write
time (before any serialization), so every call site is automatically
safe:

| Redacted field           | Reason |
| ------------------------ | ------ |
| `password`               | plaintext secret |
| `passwordHash`           | argon2 output; reveals hash parameters |
| `token`                  | JWT access token |
| `refreshToken`           | rotated refresh token |
| `jwtSecret`              | server-side signing secret |
| `email`                  | PII / GDPR |
| `authorization`          | bearer-token HTTP header |
| `cookie`                 | session cookie (refresh, CSRF) |
| `headers.authorization`  | nested in request logs |
| `headers.cookie`         | nested in request logs |
| `*.password`             | one-level-deep credential fields |
| `*.passwordHash`         | one-level-deep hash fields |
| `*.token`                | one-level-deep token fields |
| `*.refreshToken`         | one-level-deep refresh fields |
| `*.email`                | one-level-deep email fields |

Every match is replaced with `[Redacted]` before pino emits the JSON
line. Changing this list is a security-relevant edit and must come
with a ROADMAP note.

Enforcement: `packages/server/eslint.config.js` + the `src/main/**`
override in `apps/desktop/eslint.config.js` both declare
`'no-console': 'error'`. A regression that introduces a raw
`console.log` / `console.error` fails `ci:server` or `ci:desktop` at
the lint step. Test files under `__tests__/` keep the existing
console spies allowed.

The only sanctioned plaintext-credential output path is the
`printCredentialsBanner` helper in `packages/server/src/db/seed.ts`,
which writes directly to `process.stdout` (bypassing the pino stream)
on first install so the operator can retrieve the generated admin
password once. A downstream log shipper will never see that line
because it is not part of the structured stream.

See `docs/TRPC_ARCHITECTURE.md` for the logger's module naming
convention, env-var controls, and the `| pino-pretty` dev ergonomics.

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

## Critical security closure (ENG-166)

Eleven findings from the 2026-05-24 cross-cutting audit
([AUDIT-2026-05-24.md](./AUDIT-2026-05-24.md)) shipped as a single
slice. Each item below is now pinned by a regression test under
`packages/server/src/__tests__/` or `apps/desktop/src/main/__tests__/`.

### Transport + headers

- **`@fastify/helmet` is registered** before CORS in
  `packages/server/src/index.ts`. The CSP allows Google Fonts hosts,
  inline styles, and `data:` images for receipt rendering; `script-src`
  drops to `'self'` in production and admits `'unsafe-inline'` +
  `'unsafe-eval'` only when `NODE_ENV !== 'production'` so Vite HMR
  works. `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy:
  same-origin` round out the headers. Strict-Transport-Security stays
  off because the embedded server runs on HTTP loopback; hosted
  deployments add HSTS at the CDN tier where TLS is terminated.
- **`apps/web/index.html` carries a matching `<meta http-equiv>` CSP**
  so a static-host deployment that strips response headers still has
  the same posture.
- **Electron renderer requests get the same CSP** via
  `session.defaultSession.webRequest.onHeadersReceived` in
  `apps/desktop/src/main/index.ts`. The hook skips API responses
  (helmet already wrote a CSP there) to avoid double-comma'd directive
  lists, which would invalidate every directive.
- **`trustProxy` is scoped to `site_hub` mode only**. On the Fastify
  factory it reads `resolvedRuntime.authorityMode === 'site_hub'`, so
  the embedded `device_local` loopback ignores `X-Forwarded-*` headers
  entirely (no spoofing surface) and the LAN-reachable Store Hub
  honors them. The per-IP rate-limit buckets (`auth.login`,
  `auth.refresh`, `auth.registerDevice`) therefore key on the actual
  socket address on a device_local install and on the originating
  client behind a reverse proxy on a site_hub. **Operator contract for
  site_hub**: only proxies you control may set `X-Forwarded-*` headers,
  and the operator-defined `PUNTOVIVO_ALLOWED_LAN_ORIGINS` already gates
  who can talk to the hub.

### Cookies

- `puntovivo_refresh` and `puntovivo_realtime` cookies promoted from
  `sameSite: 'lax'` to `'strict'`. Default web/dev traffic is same-site
  on loopback, and supported refresh flows do not rely on cross-site
  top-level navigations. Cross-origin `hub_client` refresh remains a
  documented Authority Node gap until a future HTTPS `SameSite=None`
  or Bearer-only refresh design lands.
- `puntovivo_csrf` stays `sameSite: 'lax'` and `httpOnly: false` on
  purpose — it is the double-submit cookie the renderer must read and
  echo back as `x-csrf-token`.

### Auth flow

- **SSE client id is now crypto-strong**:
  `sse_${randomBytes(16).toString('hex')}` replaces the previous
  `Math.random()` recipe. Pinned in `realtime-sse.test.ts`.
- **Login timing equalised on user-not-found**: the missing-user
  branch in `auth.login` calls `verifyPasswordSecurely(DUMMY_HASH,
  input.password)` so the response cost matches the password-check
  branch. The dummy hash is pre-computed at boot
  (`warmUpPasswordSecurity()`) so the first not-found attempt pays no
  extra latency.
- **Argon2 parameters pinned** in a single helper module:
  `packages/server/src/security/passwords.ts` exports
  `hashPasswordSecurely`, `verifyPasswordSecurely`, and `needsRehash`.
  The pinned params (argon2id, memoryCost=65_536, timeCost=3,
  parallelism=4) follow the OWASP Password Storage Cheat Sheet (2025).
  Existing user hashes upgrade lazily on the next successful login via
  `needsRehash`.
- **Per-procedure rate-limit caps** on the auth-critical subset live
  in `packages/server/src/trpc/middleware/procedureRateLimit.ts`:

  | Procedure              | Cap          | Window | Key by  |
  | ---------------------- | ------------ | ------ | ------- |
  | `auth.refresh`         | 30           | 1 min  | IP      |
  | `auth.changePassword`  | 5            | 15 min | userId  |
  | `auth.registerDevice`  | 10           | 1 h    | IP      |
  | `users.create`         | 20           | 1 h    | userId  |
  | `users.resetPassword`  | 10           | 1 h    | userId  |

  Stricter caps for the rest of the tRPC surface (and a tenant-scoped
  bucket plan) ship in ENG-165. The middleware bypasses entirely under
  `NODE_ENV === 'test'` so existing high-volume suites do not trip.

### Input boundary

- **Email normalisation** lives in a shared `emailField()` helper in
  `packages/server/src/trpc/schemas/common.ts`. Every auth and users
  schema runs `.trim().toLowerCase()` before the `.email()` check,
  preventing two operators from registering `Admin@x.com` and
  `admin@x.com` as different accounts (and pre-staging consistent
  keys for future SSO / IdP mappings).
- **Zod `.strict()`** added to every input schema in `auth.ts`,
  `users.ts`, `payments.ts`, plus every mutation input in `sales.ts`
  (`createSaleInput`, `updateSaleInput`, `voidSaleInput`,
  `returnSaleInput`, `suspendSaleInput`, `discardDraftInput`,
  `completeDraftInput`, `changeSaleTableInput`, `splitDraftInput`,
  `getForReprintInput`, plus nested `saleItemInput` and
  `salePaymentInput`). Extra keys raise a `ZodError` instead of being
  silently stripped. ENG-181 will roll this across the remaining
  schemas.

### Electron main process

- **Print receipt HTML is now sanitised** at the IPC trust boundary:
  `apps/desktop/src/main/print-html-sanitizer.ts` runs every
  `print-receipt` payload through `sanitize-html` with an allow-list
  tuned for receipt layout (block + inline + tables + inline `<style>`
  + `data:`-only image srcs). The ephemeral print window already ran
  `sandbox: true`; the sanitiser is defense-in-depth so a corrupted
  template is inert even if it slipped past the renderer.
- **`PUNTOVIVO_OPEN_DEVTOOLS` env var is gated by `!app.isPackaged`**
  so a staging deploy with a stray env var leak cannot expose DevTools.
  The existing `isDev` gate inside `createWindow` stays as the second
  layer.

### Peripheral TCP egress

- **ESC/POS TCP peripherals are LAN-only**. Printer and cash-drawer
  config validation accepts raw-print TCP targets only on private LAN
  addresses and ports `9100-9103`. Loopback, unspecified, link-local
  metadata ranges, multicast, and public IPs are rejected before the
  row is persisted. The transport repeats the policy immediately before
  `socket.connect`, and hostnames are resolved first so legacy or
  hand-edited configs cannot use DNS to reach public or metadata
  services from the POS host.

## SQLite tuning + WAL backup safety (ENG-174)

The local SQLite database is the durability anchor for every tenant's
sales, cash sessions, fiscal outbox, and audit log. ENG-174 closes three
gaps that the audit 2026-05-24 identified on the DB open path:

### PRAGMA cluster (concurrent read performance + WAL hygiene)

`packages/server/src/db/index.ts` now applies a pinned PRAGMA cluster
after `journal_mode = WAL` and `foreign_keys = ON`:

| PRAGMA | Value | Why |
| --- | --- | --- |
| `busy_timeout` | `5000` default | 5s wait instead of immediate error on lock contention. Five workers (HTTP, SSE, sync, hardware, fiscal, payment) routinely contend for the writer slot on a busy POS. High-contention dev/test harnesses can raise it with `PUNTOVIVO_SQLITE_BUSY_TIMEOUT_MS`. |
| `cache_size` | `-64000` | ~64 MiB page cache per connection. The negative `-N` convention means "N kibibytes". |
| `mmap_size` | `268435456` (256 MiB) | Memory-mapped I/O for hot reads (audit_logs listing, fiscal_outbox + payment_outbox polling). Reduces syscalls under concurrent load. |
| `temp_store` | `MEMORY` | Sort and intermediate index spills stay in RAM. |
| `wal_autocheckpoint` | `1000` | Checkpoint every ~4 MiB of WAL; explicit pin documents intent against silent default drift. |

The `busy_timeout`, `cache_size`, and `temp_store` apply to every
connection (including `:memory:` in tests). The `mmap_size` and
`wal_autocheckpoint` are skipped for `:memory:` (no underlying file
to map or checkpoint). Memory ceiling sized against the 4 GB-device
floor documented in [PERF-BUDGETS.md](./PERF-BUDGETS.md): 256 MiB
mmap + 64 MiB cache = ~320 MiB SQLite footprint, comfortable on a 4 GB
AIO.

### WAL flush before backup

`apps/desktop/src/main/backup/backup-bundle.ts::createBackupBundle`
now runs `PRAGMA wal_checkpoint(FULL)` and `PRAGMA synchronous = FULL`
through a short-lived writable source connection BEFORE calling
`sourceDb.backup(stagingDbPath)`. This needs a writable handle because
SQLite must merge WAL frames into the main DB file before the readonly backup
handle snapshots it. Without the checkpoint, a power loss
between when the online backup resolves and the OS finishes flushing
the bundle ZIP to disk could leave the source `.db` and its `.db-wal`
sidecar out of sync — and the integrity check after backup would
report a corrupt restore. The checkpoint is file-level so it works
even while the embedded server keeps its own writer connection open. The
post-backup `assertSqliteIntegrity` remains as a complementary
post-condition.

### Preflight guard: migrations bundled

New `scripts/ensure-migrations-bundled.mjs` verifies that
`packages/server/dist/db/migrations/` exists and carries a valid
`meta/_journal.json` plus every journal-referenced `.sql` migration BEFORE
Electron Forge packages the app or launches in dev. Exit 1 with
actionable remediation lines when any check fails. Wired in
`apps/desktop/package.json` as `electron:ensure:migrations` between
`prepare:server` and `electron:ensure:binary` in `preflight:desktop`,
`package:desktop`, and `make:desktop`. The CLI exports
`checkMigrationsBundle({migrationsDir})` so the colocated test can
drive every failure path directly.

## Database encryption at rest (ENG-167 Step-1)

Until now the embedded SQLite database under
`app.getPath('userData')/data/local.db` held every sale, customer,
fiscal document, and Argon2 hash in cleartext on disk. A stolen
laptop, a forensic disk image, or a backup left on shared storage
exposed the full tenant — running `sqlite3 local.db ".dump"` against
the file returned the entire table list. ENG-167 closes that hole
with SQLite3MultipleCiphers in SQLCipher v4 compatibility mode,
keyed from the OS keychain.

**Threat model defended.** Encryption at rest blocks two concrete
attacks: (1) **device theft** — a stolen device or recovered drive
no longer surrenders the DB without the OS user's keychain unlock,
and (2) **disk side-channel** — a forensic image or shared-storage
backup is unreadable without the matching `safeStorage` envelope. It
does NOT defend against a malicious agent inside the running
process: once Electron has the key in memory, anything attached to
that process can read it. Lateral process attacks are out of scope
for ENG-167 and remain the OS-level trust boundary.

**Wire path.** The Electron main process (`apps/desktop/src/main/index.ts`)
calls `getOrCreateDbKey(<userData>/data, safeStorage)` from
`apps/desktop/src/main/db-key-store.ts` BEFORE `createServer`. The
helper:

- Aborts the boot when `safeStorage.isEncryptionAvailable()` returns
  `false` (e.g. a Linux box without libsecret / gnome-keyring /
  KWallet). We refuse to write a cleartext fallback — an unreachable
  keychain is an operator-visible error, not a silent
  confidentiality downgrade.
- On first boot, mints a fresh 256-bit key with
  `crypto.randomBytes(32)`, seals it via
  `safeStorage.encryptString()`, and persists the envelope at
  `<userData>/data/.dbkey.enc` with `0600` permissions (POSIX best
  effort; Windows uses ACL semantics).
- On subsequent boots, reads the envelope and recovers the same hex
  via `safeStorage.decryptString()`.

The 64-character hex key flows into `createServer({ encryptionKey })`,
through `ServerOptions`, into `initDatabase({ encryptionKey })` at
`packages/server/src/db/index.ts:89`. The init code applies
`PRAGMA cipher='sqlcipher'`, `PRAGMA legacy=4`, and
`PRAGMA key = "x'<hex64>'"` **before** any other file-touching PRAGMA
so the ENG-174 cluster
(`journal_mode = WAL`, `foreign_keys`, `busy_timeout`,
`cache_size`, `mmap_size`, `temp_store`, `wal_autocheckpoint`) talks
to a keyed page cipher from the first read. `assertEncryptionKeyShape`
rejects truncated or non-hex keys at boot rather than at the first
SELECT.

**Native dependency.** `packages/server` (and transitively the
desktop bundle) now consumes `better-sqlite3-multiple-ciphers@^12.10.0`
under the `better-sqlite3` alias declared in
[`package.json`](../package.json) at root and in
[`packages/server/package.json`](../packages/server/package.json). The
fork preserves the synchronous better-sqlite3 API surface 1:1 and
ships prebuilds for Node v137 (Node 24) and Electron v145 (Electron
41) across `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`,
`win32-x64`, and `win32-arm64`. `scripts/ensure-native-runtime.mjs`
includes the package name in the cache key so the swap invalidates
stale plain-better-sqlite3 binaries automatically.

**Standalone server (`dev:server`).** The standalone binary reads
`process.env.PUNTOVIVO_DB_KEY` and forwards it as `encryptionKey`.
When unset the legacy cleartext path remains in effect — required
for the existing dev workflow against
`packages/server/data/local.db` until ENG-167b ships the one-shot
migration UX. Document this as a dev-only surface; production
Electron builds always encrypt because the main process never omits
the key.

**Tests.** Two regression suites pin the boot:
[`packages/server/src/__tests__/db-encryption.test.ts`](../packages/server/src/__tests__/db-encryption.test.ts)
covers the encrypted round-trip, SQLCipher mode selection, the
plain-open failure (`SQLITE_NOTADB`), wrong-key failure, key-shape
rejection, the `:memory:` skip path, and the ENG-174 PRAGMAs
co-existing with the keyed connection.
[`apps/desktop/src/main/__tests__/db-key-store.test.ts`](../apps/desktop/src/main/__tests__/db-key-store.test.ts)
covers the safeStorage stub on first boot vs reboot vs the
unavailable-keychain abort, plus the two error paths for a
corrupt envelope. `backup-restore.test.ts` also verifies that backup
ZIPs produced from encrypted DBs keep `local.db` encrypted.

**What Step-1 explicitly does NOT cover.** ENG-167b will land the
one-shot migration of pre-encryption cleartext DBs, the
restore-from-different-device key prompt UX, and cross-OS matrix
validation through
[`.github/workflows/build-desktop.yml`](../.github/workflows/build-desktop.yml).
ENG-167 stays in `Status: Partial` until those land. **Pre-Step-1
cleartext DBs on dev machines will fail to open on first boot
post-merge** — wipe the data directory or restore from a Step-1
backup. Production rollout is therefore gated on ENG-167b.

## Token + session lifecycle (ENG-168)

The session model bookends ENG-008 (login rate-limit) + ENG-025
(Electron session capabilities) + ENG-166 (Argon2 + timing equality)
with five lifecycle invariants:

- **Realtime token freshness** — the EventSource cookie (`puntovivo_realtime`)
  carries a 15-minute TTL (`REALTIME_TOKEN_MAX_AGE_SECONDS = 900` in
  `packages/server/src/security/authTokens.ts`). Every SSE connection
  receives a `token-refresh-needed` event on a 10-minute cadence; the
  renderer's `useRealtimeChannel` hook invokes
  `vanillaClient.auth.realtimeToken.mutate()` on that event to mint a
  fresh cookie on the same origin, so a long-lived SSE socket never
  drops because the bearer expired. Heartbeat (30 s) and the refresh
  signal (10 min) ride the same `setInterval` pattern in
  `packages/server/src/realtime/sse.ts`.
- **Device revocation invalidates active sessions** —
  `authority.revokeDevice` flips `devices.isActive=false` and, in the
  same transaction, bumps `users.sessionVersion` for
  `devices.registeredByUserId`. The next call to
  `verifyTokenWithServer` for that user fails because the recorded
  `sessionVersion` no longer matches the JWT payload. Audit metadata
  records `sessionVersionBumped: true` for forensics. Per-device (not
  per-user) session revocation requires a future `device_sessions`
  binding table; the current model is a "kick the device's
  registered owner out everywhere" approximation, which is the
  closest the data model supports without expanding scope.
- **Electron desktopSession clears post-logout** —
  `AuthProvider.logout` calls `window.session?.clear()` (the preload
  bridge exposed in `apps/desktop/src/preload/index.ts` to the
  `session:clear` IPC handler in `apps/desktop/src/main/index.ts`)
  inside a try/catch. The handler resets the
  `apps/desktop/src/main/session/desktopSession.ts` singleton so
  subsequent `db:*` IPC calls fail with UNAUTHORIZED. The optional
  chain leaves a pure-web logout silent.
- **login_attempts garbage collection** — the rate-limit buckets
  written by ENG-008 / ENG-166 used to grow monotonically. A new
  `services/cleanup/loginAttemptsCleanup.ts` worker runs every hour
  (and once at boot via `tickOnce`) and removes rows whose
  `expires_at` is older than 24 h. The 24-hour grace keeps recent
  buckets available for incident correlation without unbounded
  growth. Every run writes a global `system_audit_logs` row with
  `action = login_attempts.cleanup`, `resource_id = global`, and
  metadata `{ cutoff, deleted, staleAgeMs }`; cleanup failures write
  the same action with `status = error`. This deliberately does not
  use tenant-scoped `audit_logs` because the source table is global
  and has no actor.
- **Pairing claim audit row** — every successful
  `claimPairingCodeForDevice` emits a `device.pairing.claimed` audit
  entry inside the same transaction as the `devices` +
  `device_pairing_codes` mutations, scoped to the claiming
  `actorUserId` (the tRPC routers always pass `ctx.user.id`).
  Metadata carries `{ pairingCodeMasked: code.slice(-4), siteId,
  kind }` so device handovers leave a paper trail without leaking
  the full pairing secret.

Regression coverage lives in
`packages/server/src/__tests__/login-attempts-cleanup.test.ts` (4
cases) and the extended `authority-router.test.ts` (sessionVersion
bump + pairing audit emission).

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
