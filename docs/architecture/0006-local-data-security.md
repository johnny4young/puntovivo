# 0006 — Local data security: backup, restore, and the "no PAN/CVV" invariant

> Status: **Accepted** ( 2026-05-07).
> Affects: backup/restore IPC handlers in `apps/desktop/src/main/`; `reports.diagnostics.export` payload sanitization; `db/schema.ts` column lint; future payment integration; future webhook foundation.
> Predecessor ADRs: 0001 (Local Store Authority), 0002 (Command Envelope), 0003 (Outbox Taxonomy), 0004 (Conflict Policy), 0005 (Sync Payload Contract).

## Threat model

Puntovivo POS deploys to retail terminals that range from a single owner-operated tablet to a multi-cashier desktop in a chain store. The local SQLite DB at `${userData}/data/local.db` plus the device identity at `${userData}/device-id.txt` together form the **authoritative store of operational state** (per ADR-0001). The threats this ADR addresses, and what each can or cannot see:

| Actor                                                                                          | Trusted?              | Sees                                                            | Cannot see (post-)                                                                                                       |
| ---------------------------------------------------------------------------------------------- | --------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Logged-in cashier on the box**                                                               | Yes (per role)        | All data their tRPC procedures expose                           | Data outside their tenant; admin-only diagnostics                                                                        |
| **Local admin user (OS account)**                                                              | Yes                   | Everything in `local.db` (the OS account is the trust boundary) | Encrypted-at-rest data — out of scope; v1 relies on OS user isolation                                                    |
| **Attacker with file-system read** (stolen disk image, careless backup, leaked support ticket) | No                    | Whatever is in `local.db` + the diagnostic export               | PAN/CVV (schema-banned); credentials (sanitized at export time)                                                          |
| **Ex-employee with a copy of disk image**                                                      | No                    | Same as the file-system attacker                                | Same                                                                                                                     |
| **External SaaS receiving a diagnostic ZIP**                                                   | No (least-privileged) | export payload, post-sanitization                               | All sensitive keys redacted by the sanitizer; the manifest's `redactedKeysByTable` tells the recipient what got stripped |

The "OS user account is the trust boundary" decision is consistent with how every retail POS we benchmarked (Square Terminal, Clover, Toast) handles local persistence: encryption at rest is offered as a paid tier, never as a baseline. stays at the baseline; encryption-at-rest can land in a follow-up if a customer-site requires it.

## Decision

Three structural guarantees, each with a concrete enforcement mechanism:

### 1. Atomic, integrity-checked backups

Backups produce a single ZIP file at the operator-chosen path. The ZIP contains:

- `local.db` — an atomic snapshot of the live SQLite DB. Cleartext legacy DBs
  use `better-sqlite3`'s online backup API; SQLCipher DBs use keyed
  `VACUUM INTO` so the staged file stays encrypted under the source
  installation key. No WAL/SHM sidecars travel.
- `device-id.txt` — the device identity from `${userData}/device-id.txt`. Travels with the data so a full-disk-failure recovery on new hardware can restore "the same device" from the server's perspective. Per ADR-0001's local-store-authority promise, the device IS the authoritative identity holder.
- `manifest.json` — `{schemaVersion, generatedAt, appVersion?, tenantSlug?,
dbBytes}`. Interactive restore treats it as operator metadata; automated
  restore drills and release rehearsals validate its supported schema, version,
  and byte evidence before claiming recovery readiness.

After either snapshot path produces the staging file, the helper runs keyed
`PRAGMA integrity_check` against the staging copy. If the result is not `ok`,
the helper throws and no ZIP is written. This catches the rare case where the
snapshot API succeeds but produces an inconsistent file.

The manual backup operation runs inside `runWithServerRestart` so embedded
Fastify is stopped while the operator-requested snapshot is created. Scheduled
snapshots instead serialize through the backup-operation queue and rely on the
snapshot helper's concurrent-write safety; they do not interrupt the embedded
server.

### 2. Validated restore with corruption rejection

Restore detects format from the first four magic bytes:

- `50 4b 03 04` → ZIP. Extract `local.db` + `device-id.txt` to a staging directory.
- `53 51 4c 69` → "SQLite format 3" header (legacy raw `.db` from before ). Treat as the DB to swap in; the destination's `device-id.txt` stays untouched.
- Anything else → reject as "Backup file format is unrecognized".

The staging DB MUST pass keyed `PRAGMA integrity_check` BEFORE the swap. A
bundle from another installation is first verified with the source backup key,
rekeyed in staging to the destination installation key, and verified again.
The source key must stop working after rekey. If any check fails, the live
state stays untouched and the operator sees a translated error toast.

For ZIP bundles, the bundled `device-id.txt` overwrites the destination's identity. For raw `.db` legacy bundles, the destination's identity is preserved (the legacy backup didn't carry one). This matches the operator intent: a ZIP bundle is "this is the device, now living on this hardware"; a raw `.db` is "I just want the data".

### 3. Diagnostic export sanitization

`reports.diagnostics.export` () returned raw `payload` / `summary` / `effectData` JSON blobs from `operation_events`, `operation_effects`, `sync_outbox`, `fiscal_outbox`, `hardware_outbox`. Any future writer that landed a JWT, an OpenAI API key, or a fiscal certificate path in any of those JSON columns would have shipped that secret to the support ticket.

splices a recursive sanitizer at the export boundary. The sanitizer walks each JSON-shaped column, replaces values whose KEY matches a denylist with the literal `'[REDACTED]'`, and aggregates the set of redacted keys per source. The bundle's manifest gains:

```json
{
  "sanitized": true,
  "redactedKeysByTable": {
    "operation_events": ["api_key"],
    "sync_outbox": ["password", "token"],
    "fiscal_outbox": ["clientSecret", "certificate"],
    "...": "..."
  }
}
```

The denylist (canonical names, lowercased + separator-stripped):

```
password, passwordhash, passwords,
token, accesstoken, refreshtoken, jwt, sessiontoken, cookie, cookies,
authorization, authheader,
apikey, apisecret, clientsecret, clientid, secret, secrets, privatekey, publickey, signingkey,
pan, cvv, cvc, cardnumber, primaryaccountnumber,
certificatepath, certpath, certificate, pfx, p12,
oauthtoken, paymenttoken, capturetoken, authorizationcode
```

Matching is **anchored**: `pan` matches `pan` exactly (after normalization) but NOT `pancake_count` or `panel_layout`. The sanitizer's `isSensitiveKey()` predicate uses a `Set` lookup against the canonicalized name, not substring matching.

The `[REDACTED]` literal does not match any pattern in the list, so re-applying the sanitizer to already-sanitized output is a no-op (idempotent).

**Extending the list**: when a customer-site reports a leak via a non-listed key, OR when a new payload writer lands a field the threat model classifies as sensitive, add the canonical (lowercased + de-separated) form to `SENSITIVE_KEYS` in `packages/server/src/services/diagnostics/sanitize.ts`. The lock test in `__tests__/diagnostics-sanitize.test.ts` asserts a minimum count so a silent removal triggers CI failure.

### 4. Schema-level "no PAN/CVV" invariant

`db/schema.ts` MUST NOT declare any column whose name matches the forbidden list:

```
pan, cvv, cvc, card_number, cardnumber, primary_account_number,
primaryaccountnumber, cardholder_name, cardholdername
```

Enforced by an architectural-lint test in `packages/server/src/__tests__/architectural-lint.test.ts`. The lint regex extracts every column name from `text(...)`, `integer(...)`, `real(...)`, `blob(...)`, `numeric(...)` declarations and fails CI when any match lands. Lookalike benign names (`panel_layout`, `pancake_count`, `password_hash`) pass.

The `sale_payments.reference` column stays as-is. It is documented as "free-form reference (e.g. card authorization code, transfer receipt number) — purely descriptive audit context" and never carries a PAN. 's payment integration (when it ships) MUST audit any new column it adds against this list before committing.

## Alternatives Rejected

- **Keep the OS user account as the only at-rest boundary.** Rejected by the
  later storage-hardening implementation: packaged databases and backup
  snapshots now use SQLCipher, while safeStorage protects the local key
  envelope. Recovery therefore requires explicit backup-key custody and
  cross-installation rekey rather than relying on filesystem permissions.
- **Allowlist-based sanitization (only these specific keys ship).** More conservative but requires per-table schemas and updates every time a new payload field lands. The denylist with anchored matching is the right v1; a future change can promote to allowlist if the denylist proves insufficient.
- **Skip the device-id.txt in backups; force re-registration on restore.** Considered for the "operator clones a device for a second register" use case. Rejected for the more common "full-disk failure → restore on new hardware" path. Operators who genuinely want to clone a device need a separate "Reset device identity" admin action — out of scope.
- **Implement per-OS keychain integration in this change.** Defer. (payment terminal adapter) is the first caller that needs persistent secrets (Bold OAuth tokens, Wompi credentials). The natural abstraction is `@node-gyp-build/keytar` which wraps macOS Keychain (Security.framework), Windows DPAPI, and Linux libsecret behind one API. Pinning the choice now without a caller risks the integration being wrong; picks.
- **Audit log entry on every backup.** The DB swap during restore is followed by a renderer reload; the audit row would have to be written to the _new_ DB with the _old_ user as actor, which means crossing a session boundary. v1 logs to the structured `backup` module logger only; can land an audit row when the renderer's first post-restore session arrives.

## Implementation Impact

### Files added

- `packages/server/src/services/diagnostics/sanitize.ts` — `sanitizePayload`, `sanitizeRows`, `isSensitiveKey`, `REDACTED_PLACEHOLDER`, denylist.
- `apps/desktop/src/main/backup/backup-bundle/` — bundle creation, extraction,
  SQLCipher integrity/rekey, format detection, allowlisted ZIP contents, and
  staging cleanup.
- `packages/server/src/__tests__/diagnostics-sanitize.test.ts` — 15 unit cases.
- `packages/server/src/__tests__/diagnostics-export-sanitization.test.ts` — 4 integration cases against the tRPC caller.
- `apps/desktop/src/main/__tests__/backup-restore.test.ts` — focused bundle,
  encryption, extraction, traversal, rekey, and staging-cleanup coverage.

### Files modified

- `packages/server/src/trpc/routers/reports/diagnostics.ts` — wire the sanitizer into `export`; manifest gains `sanitized: true` + `redactedKeysByTable`.
- `packages/server/src/__tests__/architectural-lint.test.ts` — extend with the PAN/CVV column scan.
- `apps/desktop/src/main/index.ts` — `handleCreateDatabaseBackup` + `handleRestoreDatabaseBackup` route through the new helpers.
- `apps/desktop/package.json` — adds `jszip`.

### Backwards compatibility

- **Restore is backwards-compatible**: a new desktop binary reads OLD raw `.db` backups (legacy format detected via the SQLite magic header).
- **Restore is forwards-incompatible**: an OLD desktop binary trying to restore a NEW ZIP backup will see the dialog's `extensions: ['db', 'sqlite', 'sqlite3']` reject the `.zip` selection, OR (if filtered out) `copyFile`-overwrite the live DB with the ZIP file → the next server restart fails with "file is not a database". The release notes for the version that lands must call this out.
- **Diagnostic export shape is additive**: existing consumers that don't read `sanitized` / `redactedKeysByTable` keep working unchanged. The `tables.*` row payloads carry `[REDACTED]` instead of the original sensitive value — this is a SEMANTIC change for any consumer that was relying on the original value, but no such consumer exists today (the bundle goes to support tickets).

## Implementation map

- ** (Payment terminal adapter, gated)** — when it ships, MUST add any new column to the architectural-lint forbidden list if applicable AND audit any new outbox payload through the sanitizer. The first caller of per-OS keychain integration is here; this change picks the abstraction (`@node-gyp-build/keytar` is the leading candidate).
- ** (Event-based public API + webhook foundation)** — when `webhook_outbox` lands, the diagnostic export must include it AND its payloads MUST flow through the sanitizer. The bundle's `manifest.counts` keyset already reserves `webhook_outbox: 0` per .
- ** (potential follow-up)** — audit log entry on backup/restore action, written to the post-restore DB with proper actor attribution. Out of v1 scope.

Updated: 2026-07-20 (SQLCipher backup and isolated cross-key restore evidence).
