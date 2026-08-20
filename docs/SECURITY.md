# Security

Puntovivo protects local retail operations through tenant isolation, explicit
role and site guards, short-lived sessions, a sandboxed renderer, encrypted
storage, bounded external effects, and auditable administrative actions.

## Authentication and authorization

- Passwords use Argon2 and never enter logs or audit metadata.
- Login is rate limited by identity and origin with persistent attempt state.
- Access tokens are short lived; refresh tokens rotate in families and detect
  replay.
- Password reset and password change invalidate existing sessions.
- Unsafe cookie-backed requests require CSRF protection.
- Shared role middleware defines admin, manager, and cashier capability sets.
- Staff PIN switching is scoped, rate limited, audited, and cannot create a
  privilege level the acting terminal is not allowed to assume.
- Electron Store Hub clients keep rotating refresh and CSRF credentials in the
  main process, sealed by the OS keychain. The sandboxed renderer receives only
  short-lived access tokens. Hub API calls cross a fixed-destination `/api/*`
  proxy that strips renderer cookies and non-allowlisted request headers; the
  bridge cannot be repointed to an arbitrary origin. Realtime uses a separate,
  narrow `/api/realtime/subscribe` relay: main attaches the current Bearer,
  parses bounded SSE frames, and forwards typed events over IPC. It accepts
  only collection identifiers and a numeric replay cursor, never an arbitrary
  URL.

## Tenant and site isolation

Every authenticated tRPC context carries tenant identity. Queries and writes
must scope by that tenant. Procedures accepting a site identifier validate that
it belongs to the tenant before reading or mutating operational state.
Cross-tenant and role-boundary tests are required for every new administrative
surface.

## Electron boundary

The renderer uses context isolation, disabled Node integration, and Chromium
sandboxing. Navigation and window creation are restricted. Desktop capabilities
are exposed through narrow preload wrappers and validated main-process
handlers. The renderer cannot read the database key, cloud-vault secret,
filesystem, or native transport directly. The one deliberate exception is the
admin-gated backup encryption key: cross-device restore requires it, so an
authenticated admin can reveal it through a dedicated main-process handler.

Content Security Policy and renderer response headers are applied by main.
Production builds do not inherit development DevTools switches.

## Storage, secrets, and backup

- Packaged local databases use SQLCipher.
- Database keys are sourced through Electron secure storage.
- Backup bundles carry the SQLCipher-encrypted database (under the install
  key) inside a ZIP alongside a cleartext manifest and device id; the whole
  bundle is integrity-checked on restore, and cloud-vault replication ships
  that same object over HTTPS to the operator's S3 destination.
- Restore stages data before replacement and restarts the embedded server at a
  controlled boundary.
- Cloud-vault credentials are write-only from the renderer perspective and are
  stored through the desktop secret boundary.
- Logs and diagnostic exports redact passwords, tokens, authorization values,
  emails, card data, certificates, and credential-like fields.
- Puntovivo does not store PAN or CVV. Payment adapters persist provider-safe
  references and operational status only.

## Network and external effects

- Fastify CORS configuration is explicit; Store Hub LAN origins are allowlisted.
- TCP peripheral targets are validated to prevent arbitrary egress.
- Fiscal, payment, hardware, and sync network effects run through durable
  outboxes rather than inside business transactions.
- Retries are bounded and idempotent; terminal failure remains visible to an
  operator.
- Packaged Store Hub clients require HTTPS. Plain HTTP is accepted only for a
  loopback development hub; LAN credentials never receive a silent transport
  downgrade.

## Auditability

Sensitive actions record actor, tenant, site where relevant, resource,
operation, outcome, and safe before/after metadata. This includes authentication
changes, device pairing, approval grants, loss-prevention decisions, cash and
sale overrides, privacy disposition, retention, backup protection, and day-close
sign-off.

New sensitive administration must add audit evidence in the same transaction
when practical and must never include passwords, tokens, PINs, encryption keys,
or raw provider credentials.

## Dependency and release controls

pnpm build scripts are allowlisted. Production dependency audit is part of every
workspace CI gate. Desktop artifacts require cross-platform validation, signing
and notarization where applicable, update-feed verification, and backup/restore
rehearsal before release.

A flagged dependency is normally resolved by raising a narrow version floor in
the `overrides` block of `pnpm-workspace.yaml`. An advisory may be accepted
temporarily only when no compatible patched release exists and its vulnerable
code is unreachable from the shipped artifact. Each acceptance is recorded
individually in [`config/audit-dispositions.json`](../config/audit-dispositions.json)
with an owner, the reachability argument, the condition that removes it, and a
review deadline, so an exception expires instead of being inherited.

The acceptance is narrow by construction, and the audit verifies it rather than
trusting it:

- A disposition applies only to an advisory the audit's own production-graph
  classifier independently labelled not-runtime-reachable. A runtime-reachable
  or unknown advisory refuses its disposition and keeps failing the gate.
- The recorded package must match the advisory's package.
- A disposition whose advisory has left the report is stale and fails, so an
  acceptance cannot outlive the upstream fix.
- Review windows are bounded per category — 30 days for a build-only toolchain
  advisory, 14 days when a patched release is expected — and an expired entry
  fails closed with its date.

One limit is deliberate and worth stating plainly: the automated part of that
check is over the pnpm production manifest graph, not the built web bundle or
the packaged desktop asar, because the audit runs before any build. The
bundle-level and packaged-artifact argument is recorded as prose in
`reachabilityArgument` and is held accountable by the review deadline, not by a
machine proof. The file is expected to be empty in the steady state.

Run the relevant checks from [TESTING.md](./TESTING.md). Current unresolved
production gates are centralized in [PROJECT-STATUS.md](./PROJECT-STATUS.md).

## Security issue reporting

Do not publish exploitable details in a public issue. Provide the affected
version, platform, reproduction, impact, and any evidence through a private
maintainer channel so containment and disclosure can be coordinated.
