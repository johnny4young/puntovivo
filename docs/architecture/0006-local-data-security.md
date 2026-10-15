# 0006 — Local data security, recovery and card-data boundaries

**Language:** English · [Español](../es/architecture/0006-local-data-security.md)

> Status: Accepted
> Initial decision: 2026-05-07
> Current implementation reviewed: 2026-10-15
> Predecessors: ADR-0001 through ADR-0005

## Threat model

The operational database at `${userData}/data/local.db` and identity at
`${userData}/device-id.txt` belong to the local Authority Node. Protection must
cover a copied disk/backup, authorized role boundaries and support exports,
without claiming to defeat an attacker who has the running installation key.

| Actor                                                  | Access boundary                                                                                                                              |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Authenticated cashier                                  | Authorized tenant/role tRPC projections; not admin diagnostics or database/backup keys.                                                      |
| Privileged local OS account                            | Application files, process and key-store access depend on OS privileges; SQLCipher is not protection after the installation key is obtained. |
| File-system reader or former employee with a disk copy | Encrypted database/backup bytes; plaintext identity/manifest metadata can remain visible. Decrypting rows requires separate key custody.     |
| Support service receiving diagnostics                  | Sanitized exported projections only, not the database or a promise that arbitrary business content is anonymous.                             |

Packaged storage uses SQLCipher and Electron secure storage. Production-like
standalone startup requires the 32-byte raw-key contract through
`PUNTOVIVO_DB_KEY` and rejects a missing/malformed key before opening SQLite.
Only explicit development/test standalone operation permits an unkeyed file.
Legacy cleartext import is an upgrade boundary, not a silent production mode.

## Backup and integrity

A backup ZIP contains `local.db`, `device-id.txt` and `manifest.json`. The
SQLite file is an atomic snapshot: legacy cleartext uses the online backup API;
SQLCipher uses keyed `VACUUM INTO`, keeping the staged copy encrypted under the
source installation key. WAL/SHM sidecars do not travel.

The staging file must pass keyed `PRAGMA integrity_check` with `ok` before the
bundle is published. Current v2 manifest evidence includes hashes and an
installation-key MAC; an optional passphrase wraps the backup key rather than
making a plaintext database. Manifest/device identity are metadata, not secrets
that the ZIP necessarily encrypts. See [Security](../SECURITY.md).

Manual snapshots stop/restart embedded Fastify through `runWithServerRestart`.
Scheduled snapshots serialize through the backup-operation queue and rely on
concurrent-write-safe snapshot creation without stopping the server.
Creation/extraction stream through private staging files and bounded buffers.
Cancellation and I/O failure close owned streams before temporary-file removal;
partial output is not published as a successful backup.

## Restore and identity

`detectBackupFormat` recognizes ZIP magic `50 4b 03 04`, legacy raw SQLite magic
`53 51 4c 69`, or rejects an unknown format. A raw encrypted SQLCipher file does
not expose the SQLite magic and is not a supported standalone replacement for
a backup ZIP.

Extraction validates the archive directory and local headers before publication.
Duplicate/unknown entries, traversal, symlinks, overlap, unsupported ZIP features,
truncation and CRC/hash/MAC mismatches reject the bundle. Limits are explicit:
64 GiB database, 4 KiB device identity, 64 KiB manifest and 16 KiB key wrap.
Legacy compressed entries and current stored entries share integrity and atomic
publication requirements.

The staged database passes integrity before the live swap. Cross-installation
restore requires the source backup key or a valid passphrase wrap, verifies it,
rekeys only staging to the destination key and verifies again. The source key
must stop opening the rekeyed copy. Failure preserves the destination and returns
a translated error. ZIP restore restores the bundled device identity; raw legacy
`.db` restore preserves the destination identity. This is recovery, not a safe
way to clone a second independently selling register.

Restore drills validate metadata, integrity and tenant-scoped fingerprints
without replacing the live database. Representative signed-install, upgrade,
downgrade and cross-key recovery acceptance remains release-candidate evidence,
not something proved by unit tests alone.

## Diagnostic sanitization

`reports.diagnostics.export` sanitizes JSON-shaped `payload`, `summary` and
`effectData` from operation journals and outboxes at the export boundary.
`sanitizePayload`/`sanitizeRows` recursively replace sensitive-key values with
`[REDACTED]` and record stripped key names in `redactedKeysByTable`; the manifest
marks `sanitized: true`.

`isSensitiveKey()` normalizes case/separators and uses anchored `SENSITIVE_KEYS`
membership in `packages/server/src/services/diagnostics/sanitize.ts`. It does
not use substring matching: `pan` is sensitive, `pancake_count` and
`panel_layout` are not. Current keys cover authentication/PIN, provider secrets,
card values, fiscal certificates/software PIN and payment/OAuth credentials.
`sessionid` is intentionally retained because it denotes a cash-session business
identity here; authentication uses sensitive token keys. Reapplying the sanitizer
is idempotent. A new sensitive writer must extend the canonical key set and tests.
A denylist is bounded protection, not a proof that all free-form personal data
is absent from every export.

## Card-data policy and verification limits

No operational schema may store these card-data columns:

```
pan, cvv, cvc, card_number, cardnumber, primary_account_number,
primaryaccountnumber, cardholder_name, cardholdername
```

`packages/server/src/__tests__/architectural-lint.test.ts` extracts literal
names from `text(...)`, `integer(...)`, `real(...)`, `blob(...)` and
`numeric(...)`, rejecting exact forbidden names while allowing benign
`panel_layout`, `pancake_count` and `password_hash`.

Its current test reads only `db/schema.ts`, which is now an export barrel;
it does not recursively prove the split `db/schema/` modules. A separate
read-only source check performed for this documentation review found no
forbidden names in those modules, but the maintained regression gate still
needs that coverage. Do not advertise the existing test as complete schema
coverage. This is a verification gap, not evidence of stored card data.

`sale_payments.reference` is descriptive provider/transfer reference only,
never PAN/CVV. Payment adapters must retain token references and check every
new column and queue payload against this policy and export sanitization.

## Alternatives and consequences

- **OS account as the only storage boundary:** insufficient for copied files;
  SQLCipher plus key custody and explicit cross-installation rekey are required.
- **Allowlist-only diagnostics:** stronger but requires per-table projection
  maintenance. The current anchored denylist is the implemented boundary;
  adding fields must not silently weaken it.
- **Always regenerate device identity on restore:** loses full-device recovery.
  Cloning and identity reset require a separately designed administrative action.
- **Defer secure storage indefinitely:** superseded; Electron `safeStorage`
  already protects installation/vault envelopes.
- **Claim an authoritative audit row for every backup/restore:** not current
  behavior. Creation logs through the structured backup logger; post-restore
  actor attribution needs an explicit session-aware design. Key revelation
  has its own audited administrator boundary.

## Implementation and compatibility

- `apps/desktop/src/main/backup/backup-bundle/`: streaming ZIP, key wrap,
  authenticity, integrity/rekey, format detection, bounded extraction and cleanup.
- `apps/desktop/src/main/ipc/backup/`: authenticated backup, restore, key,
  schedule, vault and drill handlers; desktop sessions authorize these actions.
- `packages/server/src/services/diagnostics/sanitize.ts` and
  `packages/server/src/trpc/routers/reports/diagnostics/`: sanitizer and export wiring.
- `packages/server/src/__tests__/diagnostics-sanitize.test.ts`,
  `packages/server/src/__tests__/diagnostics-export-sanitization.test.ts` and
  `apps/desktop/src/main/__tests__/backup-restore.test.ts`: focused regression evidence.
- Old raw `.db` import remains supported; old binaries may not understand new
  ZIP/key-wrap formats. Never test downgrade by replacing a live database.
- Diagnostic metadata is additive, but sensitive values become `[REDACTED]`;
  consumers must not rely on receiving the original secret.
- Current export includes `webhook_outbox`; it is not an unimplemented placeholder.
  Physical recovery and production provider qualification remain separate from
  this software contract. Follow [Testing](../TESTING.md) and
  [Operations runbooks](../OPERATIONS-RUNBOOKS.md).
