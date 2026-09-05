# Puntovivo Project Status

> Updated: 2026-09-04. This is the public source of truth for shipped
> capabilities and release readiness. Internal prioritization, estimates, and
> execution notes stay in an ignored private planning artifact.

## Product position

Puntovivo is a local-first POS for Latin American retail. Its first production
wedge remains Colombian stores with one to ten sites. Restaurant, ferretería,
carnicería, and pharmacy now have explicit operating-profile entry points over
that retail core, not separate claims of legal or vertical certification.
Production sale is still gated by fiscal certification and physical-hardware
validation.

## Shipped capability baseline

The current validated candidate includes:

- barcode-first sales, suspended carts, split tenders, normalized full or
  partial returns by line and quantity, linked replacement sales for exchanges,
  customer store-credit issuance and redemption, loyalty earning and
  redemption, voids, receipt reprints, credit sales, manager approval controls,
  server-authoritative percentage promotions with explicit lifecycle and
  frozen line evidence, and a
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
- site-owned inventory, units, lots, FEFO, expiry suggestions that remain
  informational until a manager converts them into an explicit lot-bound
  promotion, serialized products, warranty lookup, variant matrices, purchases,
  supplier returns, and exact inter-site transfers. Direct purchases and order
  receipts require complete concrete lot identity for lot-tracked lines;
  returns and voids debit only frozen receipt provenance, while transfers
  preserve batch, expiry, effective status, cost, destination layer, and
  explicit discrepancy. Stock, lot, and serial modes remain frozen while a
  deferred transfer holds physical custody in transit. A missing site balance
  means zero at that physical site; tenant-wide totals never seed another
  site's row. Normalized sale returns and full sale reversals restore the
  frozen lot cost into the current layer while preserving expiry or quarantine,
  including when a later receipt changed the batch's weighted cost. Purchase
  detail and its return composer distinguish the quantity not yet returned
  from the quantity physically available at the receiving site, including
  exact lot and serial provenance. Managers can run site-scoped blind physical
  counts for aggregate-safe products, submit discrepancies for explicit review, and
  approve them only while the original stock snapshot is still current. Lot
  and serial physical counts remain excluded because a scalar observation
  cannot reconstruct identity. Minimum-stock shortages produce site-scoped
  replenishment suggestions; an operator chooses the supplier and creates a
  draft purchase order with no stock or payable effect, then submits it
  explicitly before receipt. Lot- and serial-tracked drafts are allowed because
  the receiving command captures and revalidates their physical identity; no
  order is placed automatically. Purchase, inventory-order, transfer, and
  transformation stock commands atomically bind their audit, sync outbox,
  canonical replay result, and idempotency completion; movement history
  defaults to the active site but can expose all sites plus honestly
  unattributed legacy rows. Service items round-trip through catalog imports
  and exports, remain sellable, and are excluded from inventory procurement at
  both search and server-write boundaries;
- selectable hardware and butchery profiles that only shape module surfaces
  and never rewrite a tenant catalog. Explicit create-product templates cover
  length, serialized or lot-managed hardware and weighted or packaged butcher
  cuts by resolving existing units. Product, alternate-unit, sale, purchase,
  and order controls retain quantities down to `0.001`. Active-site keyboard-
  wedge scanners can map in-store prefixes 20–29 to weight or price, and the
  server—not the renderer—owns that interpretation. Missing maps preserve the
  historical layout and corrupt active maps fail closed to ordinary EAN lookup.
  Weight labels require a classified mass base unit, convert from kilograms to
  that unit, cannot silently resolve a packaging barcode, and accumulate
  successive weighed packages. Whole-package price labels retain different
  encoded prices as distinct sale lines through suspend/resume. A cashier must
  consume a manager grant bound to the exact checkout before completing any
  off-catalog price; the checkout preflight rereads the current tenant catalog
  or frozen draft snapshots instead of trusting renderer metadata. Manager/admin
  roles retain direct authority. Embedded GS1 interpretation is disabled when
  no active site exists;
- site-scoped reservations with capacity/overlap checks, explicit arrival and
  reservation-to-check seating without empty sales; versioned delivery creation,
  courier dispatch and cancellation from UI, with no implicit charge or refund;
  signed external-order intents with durable replay/cancellation evidence,
  administrator-managed sealed connectors, explicit local-price acceptance into
  suspended sales and operator-controlled reversal. These graphs remain local-only;
  the generic sender simulator does not establish real aggregator compatibility;
- restaurant table service backed by the ordinary sale kernel. Voice Ordering
  and the traditional POS can atomically open a table-linked draft together
  with one normalized service, independent check, bounded diners, course,
  submitted round, line assignment, and structured modifier snapshot. One
  table visit can expose every simultaneous check; the established guest count
  and table capacity are enforced server-side. Completion, discard, a whole
  unshared-service table move, and same-table check split keep sale and service
  state aligned under serialized writes; implicit party splitting or merging
  between tables fails closed. Settlement requires exact coverage of every
  frozen sale line, and splitting reconciles header adjustments, totals, and
  provisional payment rows without dividing loyalty or store-credit evidence.
  Price tier, stock, taxes, receipts, returns, cash session, and audit continue
  through the shared retail rules. Legacy open drafts on active tables,
  including drafts resumed when an upgrade occurs, are adopted conservatively
  without inventing diners or kitchen history; drafts
  attached to archived tables remain available through legacy recovery rather
  than silently reactivating the table. Dine-in cannot be disabled while open
  table work exists, and resume compensates a local hydration failure by
  restoring the original suspension. Same-site cashiers can take over and
  settle a normalized check while generic retail drafts remain private; the
  receipt and audit retain distinct opener and settlement identities. Table
  catalogs search on the server before deterministic pagination, the floor map
  reads the bounded complete active catalog, and suspended work pages through
  the complete recoverable result set instead of hiding excess rows. Fresh and
  resumed drafts record actor-and-device claims; every lifecycle mutation
  enforces the active actor, logout parks all actor claims, and staff switch
  parks only the current terminal before identity rotation. A monotonic
  per-device identity generation and the JWT session version are rechecked
  inside critical sale transactions, closing the in-flight switch/logout race.
  Ordinary registration cannot reclaim a terminal now bound to another active
  actor; logout and password rotation clear all bindings for the revoked actor
  and advance their generations.
  Legacy sales routes cannot assign, move, or split work onto tables while
  `dine-in` is disabled. Lost local state
  can recover the actor's durable claim, while a failed logout preserves its
  owner-keyed recovery copy. Mobile Waiter and
  Voice Ordering require their surface module plus `dine-in`;
- durable kitchen preparation with configurable site stations and product/category
  routing, immutable submitted lines, versioned preparation/recall, void events,
  current split/table destinations and same-ticket notification resend. The sale
  transaction persists preparation and its invalidation outbox together; worker
  restart retries notifications without creating another cooking ticket. The board
  identifies the site, refreshes peer configuration and disables stale/offline
  actions. This is local durable state, not guaranteed delivery to physical hardware;
- global or site-owned inventory recipes for assembly, disassembly, cutting,
  portions, and prepared products. Executions freeze exact actual inputs and
  lots, new output lots, primary/by-product/remnant roles, per-input and per-lot
  waste, deterministic cost distribution, both resulting product cost bases,
  actor, movements, audit, and replay evidence in one transaction. The same
  transformed cost basis feeds inventory list/count valuation after reload.
  Managers can inspect that snapshot and can void only while every output
  balance revision, both product costs plus their revision, and lot remain
  untouched;
- a selectable pharmacy profile with a tenant-scoped medicine extension,
  indexed commercial/generic/ingredient/manufacturer/registration search,
  server-effective country policy, professional authorizations, sealed minimal
  prescription evidence, deterministic quantity consumption, immutable
  dispensations, append-only lot-state events, quarantine, cold-chain incident,
  recall, release, destruction, supplier return, and affected-sale lookup.
  Colombia v1 permits OTC and requires current customer, evidence, and an
  effective authorized employee for prescription products. Controlled
  medicines and prescription operation in countries without a reviewed adapter
  fail closed. A still-valid prescription whose frozen professional approval
  expires or is revoked stays blocked until an authorized employee explicitly
  re-approves the same sealed evidence. Purchases, transfers, returns, voids,
  and sale completion preserve non-sellable lot state and exact custody;
  ordinary transformations reject medicines rather than inventing a regulated
  preparation workflow;
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
  Fiscal-enabled completed sales record an immutable emission intent in the
  same transaction as stock, cash, audit, synchronization, and command result.
  A restartable worker materializes the document, frozen line labels and tax
  components, consecutive advance, and provider outbox atomically; a lost
  post-commit wake-up no longer loses the fiscal obligation. Historical sales
  are not assigned invented intents.
  Standardized product units and three-level pricing cover base and alternate
  units across sales, POS Touch, and quotations. Selecting
  a customer never changes an open ticket silently: the operator explicitly
  applies that customer's tier, and completed sales freeze the catalog grid
  used to judge later overrides. The tenant-scoped accountant bridge exports
  bounded, auditable period files;
- employee PIN switching plus effective-dated employment terms, site and
  position assignments, approved absences, recurring availability, recurring
  schedule drafts, explicit publication and consent-bound shift exchanges.
  Employment reasons and compensation remain administrator-only; managers see
  a bounded assignment projection without private history or pay. Planned work
  is reconciled explicitly to correction-aware clock evidence or a confirmed
  no-show, freezes the scheduled snapshot, records tardiness and breaks, and
  exposes report-window-clipped regular operational cost only to administrators.
  Attendance classifications and accounting evidence exports remain operational
  inputs, not payroll-final or legally certified employment calculations;
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

- Store-credit issuance, customer-value tenders, promotion snapshots, return
  restoration, and exchange linkage are shipped. Refund destinations for
  external/card payments still require operator evidence; Puntovivo records
  that evidence but does not claim that an external payment provider moved the
  funds. Expiry-based promotion conversion remains disabled for pharmacy
  operation; no medicine discount is inferred from a nearing expiry.
- Operations Center lists unresolved pre-document fiscal intents with paginated
  access and safe reasons. Managers can inspect them; administrators can recheck
  the frozen contract with an audited action. Rechecking never substitutes a
  changed provider or numbering configuration. Invalid sale-time configuration
  still requires an explicit replacement/adoption workflow, which is not yet
  supported. This is not a claim of unattended fiscal recovery or certification.
- The pharmacy profile proves local software controls, not pharmaceutical
  compliance. Country legal review, INVIMA or equivalent registry integration,
  controlled-medicine authorization, electronic prescriptions, cold-chain
  sensors, physical pharmacy hardware, and a supervised real-store pilot remain
  external gates. Regulated aggregates remain local-only until sync can apply
  product identity, policy, evidence, recall, and lot custody atomically.
- Durable kitchen notification is at least once and requires polling/reconnect;
  a local broadcast acknowledgement is not proof of physical screen or printer
  delivery. The current restaurant line editor exposes one structured modifier even though persistence
  supports a bounded list. Its bounded free-form positive price is frozen but
  is not yet authorized by a manager-authored modifier catalog. Reservation scheduling
  cannot guarantee that a prior table service finishes on time. The signed external
  order adapter is generic sandbox-only, not certified provider compatibility;
  real aggregator mapping and reconciliation remain external requirements. A destructive client-storage loss after a
  resume commit is recoverable explicitly through the actor's durable claim;
  fully automatic background reclamation would still need a bounded device
  lease/heartbeat. Global server-startup parking remains intentionally unsafe
  when another terminal may be active.
- Model commissions and aggregate day-close waste when a pilot requires them;
  transformation-specific waste is frozen per execution, but day-close still
  reports general commissions and waste as unavailable instead of inventing
  zero values.
- Hardware and butchery profiles remain catalog/checkout entry points: applying
  one never creates a recipe or rewrites stock. The shared transformation
  engine now supports exact input-lot consumption, remnants, recipes, yield,
  waste, distributed cost, output-lot traceability, and guarded reversal, but
  it is not manufacturing planning, serial transformation, legal production
  certification, or lot/serial physical counting. An execution freezes its
  exact allocated cost, but a lot's unit cost remains a two-decimal value;
  fractional allocations that cannot be represented per unit are not yet
  qualified as exact cost accounting across a later chain of transformations.
  Physical scales, scanners, variable-measure label layouts, and legal metrology still require
  representative-device validation; country labels in configuration currently
  share the generic parser and do not certify a national convention. A scale's
  price payload must also be calibrated against the tenant's
  inclusive/exclusive pricing mode; software fixtures do not prove that a
  physical label's printed total has the same tax semantics.
- Supplier accounts are a local operational ledger. Bank/payment-rail
  initiation, statement ingestion, three-way matching, and posting into a full
  general ledger remain outside the current boundary and must not be inferred
  from a locally recorded payment.
- Supplier invoices, payments, and credits are append-only, but the current UI
  does not yet provide a dedicated void/reversal workflow or manual remittance
  allocation. It applies payments oldest-first; an incorrectly recorded source
  still requires controlled operator remediation rather than an invented
  compensating document.
- Add effective country holiday, overtime, premium, collective-agreement,
  statutory deduction and contribution policies, reviewed payroll runs, and a
  validated payroll-provider adapter before treating attendance classifications
  or operational labor cost as payroll-final money.
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
