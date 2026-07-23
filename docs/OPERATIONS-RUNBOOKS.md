# Operations Recovery Runbooks

These runbooks are the safe first response for signals shown in **Operations →
Needs attention**. They are intentionally provider-neutral: the application
names the first owner, the response target, and the recovery surface without
requiring database access or exposing raw business data.

## Operating rules

1. Preserve the sale, payment, fiscal document, or snapshot before retrying.
2. Reconcile provider and local state before repeating a money movement.
3. Use the in-product recovery surface; never edit the encrypted database.
4. Escalate to support when the same item crosses the response target, a retry
   remains terminal, integrity verification fails, or credentials are needed.
5. Export a redacted diagnostic bundle from **Operations → Diagnostics**. Do
   not send the database, encryption keys, credentials, or raw customer data.

## Service contract

| Service             | First owner   | Response target | Action threshold                                             | Recovery surface             |
| ------------------- | ------------- | --------------: | ------------------------------------------------------------ | ---------------------------- |
| Synchronization     | Store manager |          30 min | More than 25 queued items or any conflict                    | Company → Data               |
| Fiscal delivery     | Store manager |          15 min | One terminal outbox failure                                  | Operations → Fiscal          |
| Receipt hardware    | Store manager |          30 min | One failed, retrying, or dead-letter job                     | Operations → Devices         |
| Electronic payments | Store manager |          15 min | One declined, timed-out, retrying, or dead-letter operation  | Operations → Payments        |
| Encrypted backup    | Administrator |          60 min | Schedule off, failed snapshot, or no success within 30 hours | Company → Data               |
| Desktop updates     | Administrator |             4 h | Updater error or no completed check within 24 hours          | Company → Device             |

<a id="sync-recovery"></a>

## Synchronization — reconcile and resume

1. Open **Operations → Synchronization** to distinguish backlog from conflict,
   then use **Resolve synchronization** to continue in **Company → Data**.
2. If only the backlog threshold is open, keep the authority node online and
   allow the bounded queue to drain. Do not clear local state.
3. For a conflict, compare the visible versions and choose the documented
   resolution in **Company → Data**. Confirm that the pending and conflict
   counts fall.
4. Escalate when the conflict returns, the queue grows for 30 minutes, or the
   authority node cannot reconnect. Attach the redacted diagnostic bundle.

<a id="fiscal-recovery"></a>

## Fiscal delivery — verify, retry, preserve the sale

1. Open **Operations → Fiscal** and verify whether the document is in
   contingency or rejected state. The completed sale remains valid locally.
2. Confirm provider connectivity and credentials outside Puntovivo before
   retrying. Never create a duplicate sale or manually advance numbering.
3. Retry the existing document once from the panel and confirm that its state
   advances. Preserve the original document identity and audit trail.
4. Escalate immediately when numbering, signature, or authority validation is
   involved, or when the retry remains terminal after 15 minutes.

<a id="device-recovery"></a>

## Receipt hardware — test the path, then retry

1. Open **Operations → Devices** and identify the failed print or drawer job.
2. Confirm power, paper, connectivity, and the registered peripheral test.
3. Run the safe peripheral test before retrying the existing outbox job. Do not
   repeatedly open the drawer or print duplicate fiscal receipts.
4. Escalate when the peripheral test fails, the job reaches dead letter, or a
   supported transport cannot be restored within 30 minutes.

<a id="payment-recovery"></a>

## Electronic payments — reconcile before retry

1. Open **Operations → Payments** and compare the tender with the provider
   reference and reconciliation state.
2. Verify the provider portal or terminal before retrying. A timeout is not
   proof that the customer was not charged.
3. Mark settled only when provider evidence matches the local amount and
   reference. Retry only when the provider confirms no completed charge.
4. Escalate any ambiguous charge, amount mismatch, repeated decline, or item
   still unresolved after 15 minutes. Never create a compensating sale.

<a id="backup-recovery"></a>

## Encrypted backup — snapshot, vault, restore drill

1. An administrator opens **Company → Data** and checks the local schedule,
   latest successful snapshot, encryption attestation, and cloud-vault state.
2. If the schedule is off or stale, run a snapshot now. Confirm a successful
   timestamp and non-zero encrypted bundle size before testing the vault.
3. Run the non-destructive restore drill. It verifies integrity and compares
   tenant-scoped counts without replacing the live database.
4. For a cloud-vault failure, verify the normalized provider diagnostic,
   endpoint, bucket, region, and secure credential storage. Keep the successful
   local encrypted snapshot while remote delivery is recovered.
5. Escalate immediately on integrity failure or missing key custody. The
   release rehearsal records snapshot recovery point and elapsed restore time;
   retain its sanitized report with release evidence.

<a id="update-rollback"></a>

## Desktop updates — check policy, then roll back

1. An administrator opens **Company → Device** and records the installed
   version, latest check, rollout mode, target version, and updater error.
2. For a normal update, verify the signed release source before downloading or
   restarting. Do not bypass the rollout policy.
3. A rollback is valid only when policy pins the exact target at 100 percent.
   Back up first, then follow the managed rollback path; never replace binaries
   or downgrade the database manually.
4. After restart, verify version, database boot, sign-in, and one read-only
   operational surface. Escalate any signature, migration, or restart failure
   and retain the redacted updater state.

## Release evidence

The tenant-scoped attention queue polls every 15 seconds and is invalidated
immediately after sync, fiscal, hardware, or payment recovery succeeds. Its
buttons name the next operation rather than promising a generic recovery:
sync opens the conflict-resolution surface, while fiscal, hardware, and
payments open panels with audited retry controls. Backup and update controls
are explicitly marked as desktop-required when Operations is running in a web
browser.

The ownership contract is enforced by `scripts/check-operational-readiness.mjs`.
It fails when a service loses its owner, threshold, recovery anchor, or exact
executable drill evidence. `pnpm run rehearse:upgrade-recovery` additionally
records the encrypted snapshot recovery point and elapsed restore time in a
sanitized report. See [Testing and Release Validation](./TESTING.md).
