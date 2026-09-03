# 0019 — Pharmacy policy, evidence, and lot custody

> Status: Accepted
> Date: 2026-09-02

## Context

A pharmacy cannot be represented safely by a retail label alone. Medicine
identity, country policy, professional authority, prescription evidence,
physical lot state, recall scope, and the business date all participate in the
decision to dispense. Treating any of those as display-only metadata would let
an expired, quarantined, recalled, unsupported, or insufficiently documented
line reach an otherwise valid retail sale.

The local-first boundary also matters. Prescription details contain sensitive
data, while the current sync protocol cannot atomically apply a medicine,
policy identity, evidence, dispensations, recalls, and lot custody across
devices. Pretending partial replication is complete would be less safe than
keeping regulated aggregates local until that contract exists.

## Decision

### Profile and effective policy

- `pharmacy` is an explicit vertical preset over the retail kernel. Applying it
  changes the tenant's selected modules but never rewrites products or stock.
- Medicine fields live in the tenant-scoped one-to-one
  `pharmacy_product_profiles` extension. A medicine must track stock and lots,
  must not track serials, and cannot silently adopt pre-existing inventory,
  drafts, lot history, evidence history, or recall identity.
- Adding or removing a cold-chain requirement while stock or an open draft
  exists also fails closed. A catalog checkbox cannot claim that existing
  units had valid prior custody; a future guided adoption must quarantine and
  verify exact lots before release.
- `PharmacyPolicy` is effective by country, business date, and classification.
  Colombia v1 permits OTC, requires a valid customer, prescription evidence,
  and an effective professional approval for prescription medicines, and keeps
  controlled medicines disabled. Countries without a reviewed adapter permit
  OTC only; prescription and controlled sales fail closed.
- Calendar validity uses the tenant's server-resolved IANA business date. Every
  regulated write revalidates the locale version, effective country/timezone,
  and current local date after reserving SQLite's immediate writer, so a
  concurrent locale change or a queue crossing midnight cannot commit a
  decision made under stale policy.

### Minimal evidence and professional authority

- Prescription reference, prescriber fields, buyer document, and notes are
  stored only in an AES-256-GCM envelope. A domain-separated HMAC supports
  duplicate detection without exposing the reference. Ordinary lists, audit,
  and outbox payloads never contain the envelope, digest, or plaintext.
- Approval authenticates the envelope and its tenant/product digest, rechecks
  the current policy and required fields, and binds the decision to an active
  employee authorization effective for the country, site, and business date.
  The authorization also authenticates its sealed credential, country digest,
  and credential type. Periods may renew without overlap and a credential
  cannot move to another employee.
- When an employee has more than one effective credential, exact-site authority
  precedes tenant-wide authority; effective date, creation time, and id provide
  deterministic tie-breakers. A corrupt winning credential fails closed rather
  than silently falling back to broader authority.
- A completed sale authenticates selected evidence again, rechecks the frozen
  approver authorization, allocates approved quantity in deterministic expiry
  order, and advances each evidence row with a versioned write.
  `pharmacy_dispensations` freezes line, product, customer, policy,
  authorization, evidence, quantity, and business date inside the sale
  transaction. Drafts never consume evidence. If the frozen authorization is
  later revoked, expired, inactive, site-incompatible, or corrupt, the still
  valid prescription remains blocked until a currently authorized employee
  explicitly re-approves that same sealed row. Re-approval replaces only the
  approval binding, preserves the original reference and remaining quantity,
  and is audited; an effective approval cannot be redundantly re-approved.
- Checkout returns only the FEFO prefix needed by each regulated product. The
  projection and re-approval recovery list are bounded by the same 200-id
  transport contract enforced by sale completion; excessive prescription
  fragmentation fails closed instead of producing a preflight that cannot be
  committed. The hot lookup is backed by a tenant/customer/product/policy
  index.

### Lot state, recall, and custody

- A lot is sellable only while active and not expired on the tenant business
  date. `expired`, `quarantined`, `recalled`, and `depleted` are non-sellable;
  a return may restore quantity but never erase the stronger state.
- `inventory_lot_events` is append-only and records activation, quarantine,
  cold-chain incident, recall, release, destruction, supplier return, and
  relevant custody changes. Recall-state reconstruction reads the ledger in
  bounded newest-first pages and stops at the first proven underlying state.
  Destruction and supplier return preserve exact product, site, lot, quantity,
  and state.
- A recall freezes its product, lot, supplier-provenance, or normalized
  sanitary-registration scope and materializes affected lots. Transfer lineage
  propagates the scope across non-void custody edges. Closing a recall does not
  reactivate stock; a separate release is allowed only when no active recall
  still covers the lot.
- Purchases, supplier returns, transfers, sale returns, voids, and exact lot
  operations preserve non-sellable state and provenance. Ordinary retail
  transformations reject medicines until a separately reviewed regulated
  preparation workflow exists.

### Read, UI, search, and replication boundaries

- Product detail returns non-sensitive profile lock reasons so the editor can
  disable only identity changes that the authoritative mutation would reject.
  Checkout receives requirements and evidence ids, never prescription PII.
- Medicine search uses tenant-scoped exact and FTS5 lanes over commercial name,
  generic name, active ingredient, manufacturer, barcode, SKU, and sanitary
  registration. The 50,000-product profile remains a release gate.
- Managers and administrators operate lots, evidence, authorizations, and
  recalls. Recall contact PII is admin-only; managers receive operational ids
  and cashiers cannot open the recall investigation surface.
- A corrupt current-user credential disables professional approval and raises
  a visible integrity warning, but it does not take unrelated lot, recall, or
  authorization-recovery controls offline. Approval and checkout continue to
  fail closed until an administrator replaces the affected authorization and
  a professional explicitly re-approves each still-valid prescription that was
  bound to it. A missing process key uses a distinct recovery instruction: valid
  authorizations must not be revoked, because only restoring the protected
  local key/service can make their sealed credentials verifiable again.
- The preset controls defaults, not lifecycle visibility. The Inventory
  pharmacy surface remains discoverable whenever the tenant still owns a
  medicine profile, professional authorization, prescription evidence, or
  recall, even after selecting another vertical; its relevance projection is
  tenant-scoped and never infers that preserved regulated state was removed.
- Pharmacy profiles, authorizations, evidence, dispensations, recalls, and lot
  events are `local_only`. Remote apply remains blocked until one aggregate
  codec and key-exchange design can validate and commit the full regulated
  state atomically. These terminal outbox rows are support traces governed by
  the tenant retention policy; sweeping them never deletes the authoritative
  regulated tables, custody ledger, or audit evidence.

## Consequences

- A valid retail payment cannot override missing policy, evidence, authority,
  lot identity, or sellability. Any failure rolls back sale, stock,
  dispensation, audit, outbox, and command result together.
- Sensitive evidence is protected from normal reads and authenticated at each
  irreversible decision. Its portable key is still stored inside the encrypted
  SQLCipher database, so this does not claim resistance after the database key
  itself is compromised.
- Existing inventory requires a guided adoption workflow rather than an
  invented regulatory history. Regulated preparations and multi-product
  electronic prescriptions also remain separate future designs.
- The local contracts are operational evidence, not legal certification,
  clinical guidance, controlled-medicine authorization, registry integration,
  cold-chain hardware validation, or approval by INVIMA or another regulator.

## Alternatives rejected

- **Reuse the retail preset name:** cannot express policy, professional
  authority, prescription consumption, or recall state.
- **Store prescription fields in plaintext product or sale notes:** exposes PII
  to ordinary catalog, audit, sync, backup-inspection, and support reads.
- **Trust approval metadata without opening the envelope:** encryption at rest
  would not detect corrupted or substituted evidence at dispensing time.
- **Reactivate returned or transferred stock automatically:** makes recall,
  quarantine, or expiry disappear because custody changed.
- **Permit unsupported-country prescription sales with a warning:** turns the
  absence of reviewed policy into an unsafe operator override.
- **Replicate normalized rows independently:** a receiver could sell a base
  product before receiving its policy, lot, recall, or evidence constraints.

## Verification evidence

- `packages/server/src/__tests__/pharmacy-policy.test.ts`
- `packages/server/src/__tests__/pharmacy.test.ts`
- `packages/server/src/__tests__/pharmacy-keyring.test.ts`
- `packages/server/src/__tests__/inventory-lots-router.test.ts`
- `packages/server/src/__tests__/lot-procurement-transfers.test.ts`
- `packages/server/src/__tests__/inventory-transformations.test.ts`
- `packages/server/src/__tests__/perf-product-search-profile.test.ts`
- `packages/server/src/__tests__/migrations.test.ts`
- `apps/web/src/features/products/ProductFormModal.test.tsx`
- `apps/web/src/features/sales/SalePharmacyEvidenceSection.test.tsx`
- `apps/web/src/features/inventory/PharmacyOperationsPanel.test.tsx`
- migration `0057_pharmacy_policy_lot_recall.sql`

Live web and Electron smokes must additionally prove UI to tRPC to SQLCipher
round trips, reload persistence, bilingual copy, and a clean console. Physical
devices, legal review, registry providers, and production rollout remain
external gates.
