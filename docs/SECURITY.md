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
Every reveal writes an immutable, tenant-scoped audit row before the key is
returned; when that evidence cannot be recorded, the key is withheld.

All db/sync bridge methods, workstation-settings writes, and device-id writes
authorize against the verified main-process desktop session before their
handler body runs. Renderer tenant values are ignored for authority. Bounded
pre-login reads support theme and device registration, while locale updates are
normalized to the supported language set and persist no database row. A lost
main-process session crosses IPC as a bounded code envelope and is shown as
localized re-entry UX; preload rejects locally, so Electron invoke details,
main-process stacks, and internal session codes are never rendered to the
operator.

Content Security Policy and renderer response headers are applied by main.
Production builds do not inherit development DevTools switches.

## Kitchen preparation

Kitchen reads and mutations are tenant/site scoped and module gated. Cashiers,
managers and admins may operate the board; only managers/admins can configure
stations and routing. Mutations verify the displayed generation under the same
writer that persists audit, immutable events and notification outbox. Malformed
snapshots fail closed per ticket without hiding unrelated valid preparations.

Kitchen DTOs intentionally omit financial, customer-record and pharmaceutical
fields. Free-form preparation notes and diner labels are plain text, not HTML;
operators must not enter unnecessary sensitive information in those fields.
Offline/stale board actions are disabled. Notification delivery is at least once
and does not assert external screen/printer receipt.

## Storage, secrets, and backup

- Packaged local databases use SQLCipher. Standalone production-like startup
  also requires SQLCipher and refuses to open or create a file-backed database
  without an explicit valid key.
- Desktop database keys are sourced through Electron secure storage;
  standalone operators provide `PUNTOVIVO_DB_KEY` through their deployment
  secret manager. Cleartext standalone files are development/test-only.
- Backup bundles carry the SQLCipher-encrypted database (under the install
  key) inside a ZIP alongside a cleartext manifest and device id; the whole
  bundle is integrity-checked on restore, and cloud-vault replication ships
  that same object over HTTPS to the operator's S3 destination.
- Backup v2 passphrase wrapping retains its exact N, r, p, salt, normalization,
  and 32-byte result, but derives through asynchronous scrypt behind a bounded
  queue so renderer and main lifecycle work are not synchronously blocked.
  Production creation and extraction stream through private temporary files;
  duplicate or unknown entries, traversal, symlinks, overlapping records,
  oversized metadata, truncation, CRC/hash/MAC disagreement, and unsupported
  ZIP features fail closed before an existing destination is replaced.
  The ZIP writer owns both file streams and waits for their closure after
  cancellation or an I/O failure before removing its temporary output; aborting
  the archive alone does not close a partially consumed source file.
  Stored ZIP payload extraction uses a fixed working buffer and completes all
  partial writes before reusing it; CRC, size limits and atomic publication
  apply equally to stored payloads and legacy deflated entries.
- Restore stages data before replacement and restarts the embedded server at a
  controlled boundary.
- Cloud-vault credentials are write-only from the renderer perspective and are
  stored through the desktop secret boundary.
- Logs and diagnostic exports redact passwords, tokens, authorization values,
  emails, card data, certificates, and credential-like fields.
- Puntovivo does not store PAN or CVV. Payment adapters persist provider-safe
  references and operational status only.

### Pharmacy evidence

- Prescription PII is stored only in a purpose-bound AES-256-GCM envelope.
  Ordinary reads, audit rows, and sync payloads expose bounded operational
  metadata but never the ciphertext, keyed digest, reference, prescriber,
  buyer document, or notes.
- Approval and dispensing authenticate the evidence envelope, bind its
  decrypted reference to the tenant/product HMAC, authenticate the sealed
  professional credential against its country digest and type, revalidate
  current country policy and authority, and fail closed with stable public
  errors on missing keys, malformed payloads, or tampering. If a frozen
  approval stops being usable, checkout does not substitute another credential
  silently: an effective professional must explicitly re-approve the same
  sealed evidence, preserving its reference and remaining quantity.
- The renderer clears prescription PII after commit and on subject changes,
  mirrors server length/date limits, and disables browser autocomplete and
  spellcheck assistance for prescription references, professional credentials,
  buyer documents, and restricted notes.
- The portable evidence key is wrapped inside the SQLCipher database so
  backup/restore remains self-contained. This separates ordinary data access
  but does not claim protection from an attacker who already possesses the
  database encryption key. External key wrapping requires a separately
  reviewed recovery design.
- Pharmacy aggregates and their PII are local-only. Remote apply is blocked
  until key exchange and a complete regulated aggregate codec exist; a base
  product row alone is never evidence that another device can dispense it.

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
- Companion grants viewer only a module-gated minimal snapshot and a
  payload-free invalidation stream. Its PWA worker caches a generated allowlist
  of versioned shell assets and never intercepts `/api/*`; authenticated totals
  are reset offline and after logout rather than treated as durable mobile
  data.

## Signed external-order inbox

External orders use a bounded, signed tRPC envelope. The server authenticates
the exact body before parsing it and revalidates credential version, site,
tenant and time window under the writer lock. Durable event receipts and
short-lived nonces prevent conflicting retries; a cancellation received before
creation cannot resurrect an order. Connector administration is admin-only;
order review requires manager/admin access to the owning tenant and site.

Connector keys are sealed with authenticated encryption bound to tenant and
connector identity. APIs, command results, audit metadata and notification
outboxes exclude those credentials. Recipient information remains in restricted
operational snapshots, not notification payloads. The standalone wrapping key
must be retained in the deployment secret manager; losing it prevents signature
verification. Development key availability is not a production encryption
exemption.

Receiving signed intent never charges, reserves stock or creates a sale.
Acceptance requires explicit confirmation of a fresh local-price quote and
atomically creates an unpaid draft through the existing sale writer. A later
source cancellation blocks checkout/dispatch but cannot silently refund money
or restore stock. The current adapter is a sandbox contract, not validation of
a commercial aggregator or its payment evidence. See
[the signed inbox boundary](architecture/0023-signed-external-order-inbox.md).

## Auditability

Sensitive actions record actor, tenant, site where relevant, resource,
operation, outcome, and safe before/after metadata. This includes authentication
changes, device pairing, approval grants, loss-prevention decisions, cash and
sale overrides, privacy disposition, retention, backup protection, and day-close
sign-off.

New sensitive administration must add audit evidence in the same transaction
when practical and must never include passwords, tokens, PINs, encryption keys,
or raw provider credentials.

Packaged Electron audit-chain freshness is anchored outside SQLite by a
versioned, `safeStorage`-sealed per-tenant counter/head envelope. The next
counter is reserved before an audited write advances its database head,
authenticated in the head HMAC, and confirmed only after commit. An ordered
candidate list preserves every point produced before transaction-boundary
settlement, so a committed write followed by an aborted write cannot erase the
recoverable intermediate head. Recovery accepts only the bounded pre-commit or
post-commit crash states; missing, rewound, or divergent external state after
adoption rejects verification. Head advancement uses a versioned write, and new
rows after the tenant adoption date cannot be silently unchained. A standalone
deployment without an `AuditAnchorStore` retains HMAC linkage but has no
external rewind detector and must not advertise one.

Verification is paged, yields the event loop, and moves large hashing to a
short-lived worker. Single-flight and an administrative start-rate limit bound
resource use, but a success is never cached across calls in a way that could
hide an external database mutation. Remote sync apply of audit rows remains
blocked until a device-aware chain design exists.

## Dependency and release controls

pnpm build scripts are allowlisted. Production dependency audit is part of every
workspace CI gate. Desktop artifacts require cross-platform validation, signing
and notarization where applicable, update-feed verification, and backup/restore
rehearsal before release.

### Update chain

The update feed is a self-hosted appcast on a GitHub Pages branch, and the only
integrity value inside it is a hash that lives in that same feed — so the feed
cannot vouch for itself. Whoever can write to that branch controls what every
install is offered. Two things constrain the damage:

- **Platform signature verification plus a sealed version floor** decide
  whether an update may install
  itself. macOS verifies: Squirrel.Mac refuses a package whose code signature
  does not match the running app, so a feed writer cannot substitute their own
  build. Note what that does and does not cover — it checks _identity, not
  version_. Puntovivo closes that gap for automatic updates with a monotonic
  version floor sealed by Electron `safeStorage` outside the mutable feed. The
  client keeps `allowDowngrade=false` and rejects every candidate below that
  floor, including a policy marked `rollback`. A persisted downloaded artifact
  is visible after restart but cannot install until the current process
  reconfirms its version and SHA-512 identity. Emergency rollback therefore
  requires a separately delivered manual installer and explicit operator
  approval; Pages alone cannot authorize it. Windows verifies only
  with an Authenticode identity, which requires a signing certificate Puntovivo
  does not have yet, and Linux AppImage updates carry no signature check at
  all. Where nothing verifies the package, the desktop app still downloads the
  update but never installs it on quit: applying it takes the operator's
  explicit action. `main/auto-updater/install-policy.ts` owns that decision and
  fails closed — re-opening a platform is a reviewed code change, deliberately
  not something a config value can flip.
- **Write access to the feed branch** is therefore a production credential, not
  a documentation detail. Protect the Pages branch (required review, no force
  push) and keep two-factor authentication on every account that can push to
  it or publish a release. Release packaging refuses to publish an unsigned
  macOS artifact or its feed entry, so a missing signing secret fails the
  release instead of shipping something no register can install.

Withholding the silent install is a mitigation, not the fix. Signed Windows and
Linux update chains remain required before an unattended rollout.

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

Do not publish exploitable details in a public issue. Two private channels
are available; use either:

- GitHub private vulnerability reporting on this repository (the
  Security tab -> Report a vulnerability; enabled 2026-08-22).
- Email to asesordeprogramacion@gmail.com, the same maintainer address
  published on the contact page.

Provide the affected version, platform, reproduction, impact, and any
evidence so containment and disclosure can be coordinated. A maintainer
answers personally; there is no security team behind the address.
