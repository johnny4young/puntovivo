# Fiscal Integration

**Language:** English · [Español](es/FISCAL-INTEGRATION.md)

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
- Authority verification links and QR codes are emitted only by certified
  packs. Mock and draft identifiers remain local diagnostic evidence.
- Secrets, private keys, raw certificates, and provider credentials must never
  enter audit metadata or renderer-visible responses.

## Colombia: equivalent document or electronic invoice

Every Colombian sale issues the documento equivalente electrónico tiquete POS
(DEE), whatever the amount. The sale issues a factura electrónica de venta (FEV)
only when the cashier marks that the buyer asked for one, and only then does
checkout ask for buyer data. There is no automatic 5 UVT threshold and no UVT
setting.

What the rules say, as read on the DIAN normograma (last updated 28 Oct 2026):

| Rule                                                                                                                            | Source                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The DEE may be issued "independientemente del valor de la operación"                                                            | [Res. DIAN 000227 of 23 Sep 2025](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0227_2025.htm), art. 1.5.1.3.2.1, parágrafo (formerly [Res. 000165 of 1 Nov 2023](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0165_2023.htm), art. 16)     |
| Same reading in DIAN doctrine                                                                                                   | [Concepto 1563 of 4 Mar 2024](https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_1563_2024.htm), question 2; [Concepto 23570 of 27 Dec 2024](https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_23570_2024.htm)                                                |
| A seller issuing equivalent documents may always issue an FEV instead                                                           | Res. 000227/2025, arts. 1.5.1.3.1.1 and 1.5.1.3.1.2, parágrafo; [Concepto 1874 of 12 Feb 2025](https://normograma.dian.gov.co/dian/compilacion/docs/oficio_dian_1874_2025.htm)                                                                                                             |
| The buyer may ask for an FEV, and then it must be issued                                                                        | [Estatuto Tributario](https://normograma.dian.gov.co/dian/compilacion/docs/estatuto_tributario.htm), art. 616-1, parágrafo 2 (Ley 2155 of 2021); [Decreto 1625 of 2016](https://normograma.dian.gov.co/dian/compilacion/docs/decreto_1625_2016.htm), art. 1.6.1.4.26 (Decreto 442 of 2023) |
| Buyer data is requested only when the buyer asks for a document in their name: name or business name, ID type and number, email | Res. 000227/2025, art. 1.5.1.12.3 and its parágrafo 1 (formerly Res. 165/2023 art. 69, added by [Res. 000202 of 31 Mar 2025](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0202_2025.htm)). Email is optional when the document is handed over as a printed graphic |
| A DEE without buyer identification ("consumidor final", 222222222222) does not support the buyer's costs or VAT credits         | Res. 000227/2025, art. 1.5.1.3.2.4, parágrafo 1                                                                                                                                                                                                                                            |
| The paper document used when the seller's systems fail has no amount rule                                                       | Res. 000227/2025, art. 1.5.1.5.7.1, numeral 2.2                                                                                                                                                                                                                                            |
| UVT 2026 is COP 52,374                                                                                                          | [Res. DIAN 000238 of 15 Dec 2025](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0238_2025.htm), replacing Res. 227/2025 art. 1.2.1                                                                                                                                  |

Where the 5 UVT figure comes from: the second paragraph of Estatuto
Tributario art. 616-1, parágrafo 2, still says the "tiquete de máquina
registradora con sistema POS" may be issued up to 5 UVT, and
[Res. 1092 of 1 Jul 2022](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_1092_2022.htm)
set the 2023 calendar for that cap.

Our reading: that cap governs the traditional, non-transmitted POS ticket. Res.
165/2023 replaced it with the DEE on the 2024 calendar, kept the old ticket
rules only until each taxpayer's date (art. 68), and its recitals list the 5
UVT limit among the traditional ticket's restrictions that the DEE removes.
DIAN doctrine agrees. The statutory sentence was not repealed, and no court
ruling against art. 1.5.1.3.2.1 is listed on the normograma, so this rests on
the regulation in force and DIAN doctrine. Revisit if either changes.

Behavior that follows:

- Checkout shows "Customer asked for an electronic invoice" when the Colombian
  pack is on and the site has an active FEV numbering range. Off by default.
- When it is on, checkout asks for the four fields above and nothing else. The
  data goes into the fiscal snapshot only; it does not create or edit a
  customer, and the document links to the sale's customer only when it names
  that customer.
- The FEV intent is written in the same transaction as the sale, like the DEE.
  A request the site cannot number is refused before the sale is written, so
  the cashier can charge with the DEE instead. A range that runs out after that
  check blocks the intent where operators can see it; the sale is never
  reverted.
- Voids and returns reference the original document: a credit note for an FEV,
  an adjustment note for a DEE.

## Receipt and operator proof

Sale details, fiscal reports, browser-print receipts, and ESC/POS receipts use
the same maturity boundary:

- mock and draft records show their pack mode, numbering resolution, local
  identifier, and an explicit not-transmitted notice;
- mock and draft records do not expose a DIAN, SAT, or SII verification link or
  QR code, even when their local lifecycle status is `sent` or `accepted`;
- certified records may expose the authority identifier and QR only after the
  provider returns a finalized identifier in a verifiable status.

This makes local troubleshooting and receipt reconstruction possible without
presenting preview evidence as tax-authority acceptance. It does not change the
production gate below.

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
