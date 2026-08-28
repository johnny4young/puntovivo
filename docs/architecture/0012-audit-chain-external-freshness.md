# 0012 — Audit Chain External Freshness

> Status: Accepted
> Date: 2026-08-28

## Context

An append-only hash chain stored entirely in the same SQLite database can prove
internal linkage, but it cannot detect a complete database rewind to an older,
self-consistent snapshot. Puntovivo also performs audited business writes
inside synchronous BetterSQLite3 transactions, supports encrypted restore, and
uses one shared development database from more than one local runtime. A useful
freshness anchor therefore has to survive outside the database without turning
an external keychain write into an uncommitted claim.

The chain is database-wide per tenant today. Sync can replicate ordinary
business records, but merging audit rows produced independently by several
devices would create branches unless device identity becomes part of the trust
model.

## Decision

The server defines an optional versioned per-tenant `AuditAnchorStore` outside
SQLite. Packaged Electron supplies the production implementation, seals its
envelope with `safeStorage`, and publishes it atomically with owner-only
permissions. External rewind detection applies only when that durable store is
configured; a standalone server with only an HMAC key retains linkage checks
but cannot claim freshness against a complete database rollback. The envelope
contains:

- one confirmed monotonic counter and chain head;
- at most one pending reservation for the next counter/head;
- a strict schema version and tenant-keyed records.

Every audited transaction follows one protocol:

1. reconcile the database head with the external confirmed/pending state;
2. reserve the next external counter before entering the business transaction;
3. include `anchorCounter` in the canonical head HMAC;
4. advance `audit_chain_heads` with a versioned compare-and-swap inside the
   same transaction as the audited business write;
5. confirm the external reservation only after the synchronous commit returns.

Recovery accepts only the bounded states created by a crash before commit or a
crash after commit but before confirmation. Once a tenant is adopted, missing,
rewound, divergent, malformed, or cross-tenant external state fails closed.
Rows created after the adoption timestamp must have chain fields.

Head compare-and-swap failure aborts the complete audited business transaction.
It is not retried as a head-only sub-operation because doing so would separate
the audit event from the state change it records. A future storage driver may
retry the entire application command at its transaction boundary.

Remote or merged application of `audit_logs` is rejected. It remains blocked
until a device-aware chain design defines device heads, merge evidence, and an
externally anchored reconciliation rule.

## Verification and scaling

Integrity verification starts from the authenticated head and follows
`idx_audit_logs_chain_hash` backwards in 512-row pages, selecting only the
canonical hash columns. It yields between pages and moves large hashing to a
short-lived worker. Calls are single-flight per database/tenant and
administrator starts are rate limited, but successful verdicts are not cached
across calls. The verifier rereads head, counter, version, adoption timestamp,
and row count before returning success so an external mutation cannot be hidden
behind an old result.

Privacy redaction keeps its complete chain rewrite in the caller's atomic write
transaction. Connection-local temporary tables and bounded pages replace an
all-history JavaScript snapshot. The 100,000-row serial profile owns elapsed
time, event-loop yield, index-plan, cleanup, and cumulative RSS budgets.

Required evidence:

- audit anchor/store, chain, crash-recovery, sync-block and migration tests;
- `pnpm run ci:server`;
- `pnpm run ci:desktop`;
- the `perf-budget.json::auditChainProfile` 100,000-row gate.

## Consequences

- A copied older database is no longer accepted merely because its internal
  chain is self-consistent.
- Restore must explicitly replace the trusted external anchor together with the
  validated database; ordinary startup cannot silently adopt a later chain.
- `safeStorage` availability and the anchor file become part of desktop data
  continuity and must be included in representative-machine recovery evidence.
- Verification work is bounded and non-blocking, but still performs a fresh
  read on every administrative request.
- Multi-device audit replication is intentionally unavailable rather than
  silently producing an unverifiable merged history.

## Alternatives Rejected

- **Store only the head in SQLite** — a database rewind restores both rows and
  head, so the chain remains self-consistent.
- **Write the external head only after commit without a reservation** — a crash
  leaves an ambiguous database advance that cannot be distinguished from
  tampering.
- **Write the final external head before commit** — a failed business
  transaction leaves an external claim for a head that never existed.
- **Cache a successful full-chain verdict** — an out-of-process database
  mutation after the first call could remain invisible.
- **Merge remote audit rows into the same chain** — ordering alone does not
  prove which device produced or anchored a branch.
