# Puntovivo Project Status

> Updated: 2026-08-31. This is the public source of truth for shipped
> capabilities and release readiness. Internal prioritization, estimates, and
> execution notes stay in an ignored private planning artifact.

## Product position

Puntovivo is a local-first POS for Latin American retail. Its first production
wedge remains Colombian stores with one to ten sites. The application has a
strong, demonstrable retail core, but production sale is still gated by fiscal
certification and physical-hardware validation.

## Shipped capability baseline

The current validated candidate includes:

- barcode-first sales, suspended carts, split tenders, normalized full or
  partial returns by line and quantity, linked replacement sales for exchanges,
  customer store-credit issuance, voids, receipt reprints, credit sales,
  loyalty points, manager approval controls, and a
  human-controlled WhatsApp receipt handoff that renders text plus an optional
  local PNG without background delivery;
- operator-first task navigation, command search, guided business setup, and
  plain-language readiness and recovery surfaces for non-technical staff;
- active declarative receipt templates shared by live preview, browser/Electron
  system printing, server and hub-client ESC/POS output, with native QR/Code
  128 symbols, immutable fiscal evidence, sale-time display, business identity,
  template-layout, logo-source, and locale snapshots for ordinary reprints,
  configured printer code pages, and a safe legacy fallback for sales completed
  without a configured template;
- cash-session accountability, blind close, audited movements, day-close
  evidence, anomaly signals, and immutable manager sign-off;
- site-owned inventory, units, lots, FEFO, expiry suggestions, serialized
  products, warranty lookup, variant matrices, purchases, returns, and exact
  inter-site transfers. Managers can run site-scoped blind physical counts,
  submit discrepancies for explicit review, and approve them only while the
  original stock snapshot is still current. Minimum-stock shortages produce
  site-scoped replenishment suggestions; an operator chooses the supplier and
  creates a draft purchase order with no stock or payable effect, then submits
  it explicitly before receipt. Lot-tracked products remain blocked from this
  aggregate count and draft path until lot-aware procurement ships; no order is
  placed automatically. Purchase and inventory-order stock commands atomically
  bind their audit, sync outbox, canonical replay result, and idempotency
  completion; movement history defaults to the active site but can expose all
  sites plus honestly unattributed legacy rows. Service items round-trip through catalog imports and
  exports, remain sellable, and are excluded from inventory procurement at
  both search and server-write boundaries;
- customers, suppliers, quotations, catalog administration, launch imports with
  versioned profiles for locally tested Loyverse, Alegra, Siigo, and World
  Office export layouts plus fail-closed generic fallback, privacy
  export/anonymization, and data-retention controls. An accepted quotation can
  enter a term-locked POS workspace and convert exactly once through the normal
  sale transaction; the immutable quotation-to-sale link, inventory effects,
  status, and audit commit together. Supplier accounts expose
  explicit invoices, opening balances, due-date aging, fully allocated payments
  and credits, and a running statement to managers and administrators without
  widening supplier-catalog administration. Historical purchases never become
  debt through an inferred backfill. Importer names identify mapping fixtures,
  not certified acceptance by an external importer;
- country-aware demo tax catalogs and one to four tenant-owned tax components
  frozen on product, sale, quotation, and fiscal-document lines. Legacy summary
  columns remain readable, while receipts and the unsigned local Colombia UBL
  draft preserve IVA and INC even when both apply to the same line. Mexico and
  Chile reject combinations their draft serializers cannot represent instead
  of discarding evidence. This local model is not fiscal certification.
  Standardized product units and three-level pricing cover base and alternate
  units across sales, POS Touch, and quotations. Selecting
  a customer never changes an open ticket silently: the operator explicitly
  applies that customer's tier, and completed sales freeze the catalog grid
  used to judge later overrides. The tenant-scoped accountant bridge exports
  bounded, auditable period files;
- employee PIN switching, shifts, attendance corrections, breaks, overtime
  classification, and payroll/accounting evidence exports;
- encrypted desktop storage, fail-closed SQLCipher for production-like
  standalone deployments, encrypted backup bundles, scheduled snapshots,
  restore drills, a packaged-recovery rehearsal and evidence gate,
  S3-compatible cloud vault upload, and backup-protection attestation;
- tenant and site isolation, audit logs, role guards, device registration,
  local Authority Node modes, renewable Store Hub client sessions with
  main-process credential custody, fixed-destination API transport, and
  Authorization-authenticated realtime with replay, reconnect, and active
  revocation checks; a durable sync kernel and operational health surfaces;
- an installable, mobile-sized Companion for admin, manager, and viewer roles,
  backed by one module-gated tenant-safe read model and payload-free live
  invalidation. It exposes bounded sales/attention summaries and
  integrity-verified day-close signature metadata, caches only versioned app
  shell assets, and hides operational data offline instead of presenting a
  cached read as current. It is a read-only PWA, not an offline sales app;
- optional tenant-scoped outbound webhooks for a small versioned business-event
  contract, with fixed HTTPS destinations, encrypted one-time signing secrets,
  HMAC signatures, stable idempotency keys, bounded retry and dead-letter
  recovery, per-destination evidence, audited controls, and contract-tested
  integration guidance; this is not a general public REST API or a certified
  third-party connector catalog;
- tenant-scoped operational alert lifecycle for sync, fiscal, device, and
  payment incidents, with manager/admin acknowledgement, an explicitly
  provisioned signed-HTTPS receiver, bounded retry and dead-letter recovery,
  immutable attempt evidence, and retention enforcement; failed or missing
  external delivery never hides the in-product incident, and this software
  path is not a staffed monitoring service;
- tenant-scoped Co-pilot analytics over a bounded read-only snapshot, with an
  administrator-controlled choice between guided explanations and
  verified-results-only responses; both expose SQL, row counts, tables, and
  available deterministic charts, while results-only suppresses generated narrative and
  explicitly does not claim that valid SQL guarantees a correct business
  conclusion;
- a provider-neutral recovery ownership board for sync, fiscal, receipt
  hardware, payments, encrypted backup, and desktop updates, with explicit
  thresholds, responsible roles, response targets, recovery runbooks, and
  executable drill evidence; tenant-scoped incident counts poll and invalidate
  after recovery, and web clearly distinguishes server actions from
  desktop-only controls; guided lost-device and damaged-storage procedures lead
  administrators to the real revoke and encrypted backup/restore surfaces;
- Colombia fiscal foundations plus draft Mexico and Chile document packs. The
  Colombia mock can retain an unsigned, untransmitted local UBL 2.1 draft with
  the frozen UN/ECE unit code; this is development evidence, not a signed
  provider document. No pack is certified for production transmission yet;
- Electron 43 and browser targets sharing the same React, Fastify, tRPC, and
  SQLite application core.

## Readiness verdict

| Stage                          | Verdict                       | Evidence and remaining gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Development demo               | **Ready**                     | Eleven shift-defining browser journeys have an executable EN/ES and adaptive evidence index; ten are also target-agnostic Electron journeys. Store-scale read, import, encrypted-backup, queue, built-runtime launch, and opt-in long-shift renderer-memory budgets are automated.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Controlled internal beta       | **Ready with release checks** | v1.11.0 is published through the staged updater at 10 percent. The latest retained cross-platform packaging and packaged-recovery proof remains candidate `c6aebb8e` (v1.10.1) in [run 31264233582](https://github.com/johnny4young/puntovivo/actions/runs/31264233582): structure, runtime and renderer smoke passed on Linux, macOS and Windows over the retained 262,865-row profile. That older proof is a regression baseline, not evidence for the v1.11.0 binary. The repository provides a fail-closed, hash-bound representative-host evidence contract and a standalone Electron runner, but no approved v1.11.0 clean-install, production-updater upgrade, and real downgrade-refusal manifest is retained. Complete Gate 5 on representative machines before promoting the staged rollout beyond 10 percent. |
| Private Colombian retail pilot | **Not ready**                 | Requires a real fiscal provider path, contingency operation, signed fiscal receipt proof, and validation against the selected printer, drawer, scanner, and payment terminal.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Production sale                | **Not ready**                 | Requires fiscal certification, legal retention evidence, hardware support policy, a provisioned and observed external alert receiver, payment-terminal policy, and an observed pilot.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Remaining product gaps

### Release and operations

- Keep the v1.11.0 cross-platform packaging, runtime-smoke, signing,
  notarization, and staged-update evidence reproducible for every candidate.
  Two distinct checks sit behind that sentence and should not be conflated: the
  release pipeline owns signing and notarization, and the manual cross-OS
  workflow reproduces packaging, smoke and encrypted recovery on unsigned
  artifacts. The retained full matrix predates v1.11.0, so the current binary
  still needs fresh evidence. Clean installation of v1.11.0, upgrade from
  v1.10.0 through the production updater, and downgrade refusal on
  representative machines remain outstanding and are operator-run. The Gate 5
  collector hashes the signed
  installers, captures, canary exports, unchanged database pair, and standalone
  Electron report; its validator fails closed on candidate/host drift or a
  missing independent review.
- Keep the cross-platform packaged encrypted-recovery rehearsal reproducible
  for every candidate. Use the retained 262,865-row evidence as a baseline,
  then set operational recovery-time and recovery-point expectations from a
  representative pilot rather than treating one CI runner measurement as a
  universal service target.
- Validate the shipped fiscal, update, cloud-vault, lost-device, and
  damaged-storage runbooks against packaged release artifacts.
- Provision the shipped signed-HTTPS operational alert channel against the
  selected production receiver, verify receiver-side signature validation and
  alert ownership, and observe it during a pilot. The software delivery path is
  not a staffed monitoring service or response-time guarantee.

### Fiscal and payments

- Integrate and certify a Colombian technology provider using sandbox and
  production credentials.
- Complete contingency issuance, retry/dead-letter handling, signed XML
  retention, QR/identifier proof, and operator-visible recovery.
- Validate the payment-terminal adapter and offline-risk policy with a chosen
  provider and physical terminal.
- Treat Mexico and Chile packs as draft-only until signing, transmission,
  cancellation, certification, and authority-specific conformance pass.

### Hardware and store topology

- Certify representative ESC/POS printers, RJ11 drawers, USB HID scanners, and
  the supported network printing path in a physical lab.
- Implement or explicitly exclude direct USB and serial ESC/POS transports;
  today the safe production path is system or TCP printing.
- Observe multi-register Authority Node operation in a real store before
  promising satellite offline writes or remote multi-node replication.

### AI and integrations

- Reconcile the local monthly AI estimate with provider invoices and quotas in
  a real pilot. The guard now covers language, OCR, voice, semantic catalog,
  invoice-match, and per-query embedding calls; each embedding attempt records
  its tenant context and reports estimated, local-zero, unknown, or
  not-incurred cost explicitly. Provider-side limits remain the authoritative
  cap because Puntovivo cannot reserve or certify a third-party bill in advance.
- Validate generated accounting and launch-import files by uploading them to
  real Siigo, Alegra, and World Office accounts before advertising connector
  compatibility. Current fixtures prove local parsing, mapping, splitting,
  ZIP assembly, and round trips only; they do not prove that an external
  importer accepts the files.

### Business completeness

- Store-credit issuance and exchange linkage are shipped, but redeeming store
  credit as a tender, redeeming loyalty points, and the promotion stack remain
  incomplete. Refund destinations for external/card payments require operator
  evidence; Puntovivo records that evidence but does not claim that an external
  payment provider moved the funds.
- Model commissions and waste when a pilot requires them; day-close currently
  reports both capabilities as unavailable instead of inventing zero values.
- Supplier accounts are a local operational ledger. Bank/payment-rail
  initiation, statement ingestion, three-way matching, and posting into a full
  general ledger remain outside the current boundary and must not be inferred
  from a locally recorded payment.
- Supplier invoices, payments, and credits are append-only, but the current UI
  does not yet provide a dedicated void/reversal workflow or manual remittance
  allocation. It applies payments oldest-first; an incorrectly recorded source
  still requires controlled operator remediation rather than an invented
  compensating document.
- Add contract, wage, holiday, collective-agreement, and payroll-provider data
  before treating attendance classifications as payroll-final money.
- Complete a Windows NVDA accessibility sweep and keep real-device cashier
  ergonomics in the release checklist.
- Connect the shipped alert delivery evidence to the selected production
  receiver and ownership rotation; tenant error-rate and crash-free-session
  dashboards remain separate observability gaps.

## Release policy

A release may package functionality that is complete and truthfully labelled
without implying that the product is production-certified. A release does not
change the pilot or production verdict above unless every corresponding gate
has fresh evidence.

Any public release is appropriate only after its release candidate passes:

1. web, server, and desktop CI gates;
2. browser and Electron end-to-end suites;
3. database upgrade plus downgrade-refusal validation;
4. automated encrypted backup and isolated cross-key restore evidence, plus a
   packaged platform recovery check;
5. manual Linux, macOS, and Windows package validation;
6. a curated, human-first `docs/releases/vX.Y.Z.md` note that explains operator
   impact and preserves the fiscal, hardware, recovery, and support limitations
   above; `CHANGELOG.md` remains the technical commit history.

## Documentation ownership

- This file owns product status, shipped scope, and externally meaningful
  gaps.
- `ARCHITECTURE.md` and the ADRs own system invariants and design decisions.
- `TESTING.md` owns validation commands and coverage boundaries.
- Feature guides describe current behavior only; they must not contain planning
  state, ticket identifiers, or future-work queues.
- Detailed strategy and execution planning belongs in an ignored private
  planning artifact.
