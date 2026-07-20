# Fiscal Integration

Puntovivo models fiscal documents as immutable operational evidence and keeps
country-specific behavior behind a typed adapter boundary. Fiscal maturity is
reported explicitly; a draft or mock pack must never appear certified.

## Current country packs

| Country  | Adapter maturity | Current capability                                                                                                                                                                         |
| -------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Colombia | Mock             | Tenant settings, numbering data, immutable document snapshots, CUFE-compatible local identifiers, outbox orchestration, reports, and readiness checks. No certified provider transmission. |
| Mexico   | Draft            | RFC validation, settings/catalogs, CFDI 4.0 draft XML, mappings, and error normalization. No PAC signing, stamping, cancellation, or production status polling.                            |
| Chile    | Draft            | RUT validation, settings/catalogs, DTE draft XML, CAF allocation, mappings, and error normalization. No production signature, SII transmission, cancellation, or status polling.           |

The adapter registry lives under
`packages/server/src/services/fiscal/registry.ts`. Stored fiscal documents also
carry provider maturity so historical rows remain labelled honestly even when
a tenant changes country or provider configuration.

## Core invariants

- A sale, numbering advance, immutable fiscal snapshot, and outbox enqueue are
  committed atomically.
- Tenant country and fiscal settings select the adapter. Unsupported countries
  skip fiscal emission instead of receiving a Colombia-shaped document.
- Network calls do not run inside the sale transaction. Provider transmission
  belongs to the outbox worker.
- Buyer and line data are snapshotted; reports do not reconstruct historical
  documents from mutable customer or product rows.
- Retry and duplicate delivery must remain idempotent.
- Mock and draft documents cannot be presented as accepted by an authority.
- Secrets, private keys, raw certificates, and provider credentials must never
  enter audit metadata or renderer-visible responses.

## Main implementation areas

- `packages/server/src/db/schema/fiscal.ts` — fiscal document, item,
  resolution, certificate, settings, and outbox persistence.
- `packages/server/src/services/fiscal/` — adapters, country packs,
  orchestration, identifiers, mappings, XML serializers, worker, and errors.
- `packages/server/src/trpc/routers/fiscal-settings.ts` — tenant-scoped
  administrative settings and readiness.
- `apps/web/src/features/fiscal/` — document and readiness surfaces.
- `apps/web/src/features/company/` — country-specific configuration cards.

## Production gate

No country pack is production-certified today. Colombian production readiness
requires all of the following evidence:

1. contract and credentials for an authorized technology provider;
2. certificate and numbering-resolution lifecycle per tenant and site;
3. sandbox and production issue, status, correction, and cancellation flows;
4. contingency issuance with retry, dead-letter handling, and operator
   recovery;
5. authoritative identifier and QR rendering on receipt and PDF;
6. signed XML plus authority acknowledgements retained for the legal period;
7. restart, timeout, rejection, duplicate-delivery, and large-queue tests;
8. backup and restore proof that includes documents, outboxes, identifiers, and
   retained artifacts.

The public readiness verdict is maintained in
[PROJECT-STATUS.md](./PROJECT-STATUS.md).
