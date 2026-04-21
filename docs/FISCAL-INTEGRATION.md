# Fiscal Integration — Colombia DIAN

> Status: **Stub — design document, not yet implemented.**
> Phase 11 of [ROADMAP.md](./ROADMAP.md), re-prioritized to P0 (Tier-1 3a).
> Created: April 21, 2026.

## Goal

Enable every sale in Puntovivo to be a legally valid fiscal document
accepted by the Colombian tax authority (DIAN), and every void or refund
to emit the corresponding electronic credit/debit note, **without the
operator having to think about it**.

## Regulatory scope (April 2026)

- **Resolución DIAN 000165 de 2023** (modified by Res. 008/2024 and
  119/2024): consolidated framework for the Electronic Invoicing System
  (SFE).
- **Anexo Técnico 1.9** for Factura Electrónica de Venta (FEV).
- **Anexo Técnico 1.0** for Documento Equivalente Electrónico POS
  (DEE, mandatory since May-July 2024).
- **Conservation**: ≥5 years (Art. 632 E.T.), XML + graphic representation.

## Architectural decision

Puntovivo does **not** sign and transmit UBL 2.1 XML directly to DIAN.
Instead, it integrates with a DIAN-authorized **Proveedor Tecnológico
(PT)** via HTTPS REST.

Rationale:

- Building XAdES-EPES signing, UBL 2.1 generation, SOAP client, set of
  tests, and handling DIAN protocol changes: ~3-4 months senior fiscal
  dev time, ongoing maintenance.
- Integrating a PT: ~3-5 weeks, PT absorbs regulatory changes + SLA +
  certificate management.

### Candidate providers

| PT | Fit for Puntovivo | Notes |
| --- | --- | --- |
| **Facture S.A.S.** | High | Well-documented REST, competitive pricing |
| **The Factory HKA Colombia** | High | Most used by CO retail PYMEs |
| **Gosocket** | Medium | Multi-country LatAm (useful for expansion) |
| **Alegra** | Low | Also a competitor (ERP/facturador) |
| **Siigo / Carvajal** | Low | Enterprise pricing, heavier integration |

Initial target: **Facture** or **HKA**. Design is provider-neutral via
the `FiscalAdapter` interface.

## Module shape (planned)

### Server

```
packages/server/src/services/fiscal/
  FiscalAdapter.ts           # interface (port)
  FactureAdapter.ts          # concrete adapter (first impl)
  HkaAdapter.ts              # concrete adapter (second impl, parity test)
  fiscal-documents.ts        # domain service: issue, reissue, void, credit note
  cufe.ts                    # CUFE/CUDE SHA-384 hash per DIAN spec
  numbering.ts               # resolution + range + expiry management
  contingency.ts             # offline queue + deferred send + retry
```

### Schema additions

```sql
CREATE TABLE fiscal_certificates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  pfx_ref TEXT NOT NULL,            -- filesystem path or secret ref
  valid_from TEXT, valid_to TEXT,
  is_active INTEGER
);

CREATE TABLE fiscal_numbering_resolutions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('DEE', 'FEV', 'NC', 'ND')),
  resolution_number TEXT NOT NULL,
  prefix TEXT NOT NULL,
  consecutive_from INTEGER NOT NULL,
  consecutive_to INTEGER NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT NOT NULL,
  technical_key TEXT NOT NULL,      -- DIAN "clave técnica"
  is_active INTEGER NOT NULL
);

CREATE TABLE fiscal_documents (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source_id TEXT NOT NULL,          -- sale_id, purchase_return_id, etc.
  kind TEXT NOT NULL,               -- DEE, FEV, NC, ND
  cufe TEXT NOT NULL UNIQUE,
  xml_storage_ref TEXT NOT NULL,    -- filesystem or S3 ref
  status TEXT NOT NULL              -- pending | sent | accepted | rejected | contingency
    CHECK (status IN ('pending', 'sent', 'accepted', 'rejected', 'contingency')),
  provider_id TEXT,                 -- adapter identifier (facture, hka, ...)
  provider_txn_id TEXT,
  error_code TEXT, error_message TEXT,
  retries INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT, accepted_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_fiscal_documents_source ON fiscal_documents(source_id);
CREATE INDEX idx_fiscal_documents_status ON fiscal_documents(status);
```

### UI

```
apps/web/src/features/fiscal/
  FiscalHabilitationWizard.tsx     # certificate + PT creds + resolution
  FiscalContingencyIndicator.tsx   # appears in top bar when offline
  FiscalDocumentReissueModal.tsx
  CreditNoteModal.tsx              # wraps purchase returns / refunds
  FiscalSettingsPage.tsx
```

## Lifecycle

```
Sale completed
   │
   ▼
Emit DEE/FEV → [FiscalAdapter.issue(doc)]
   │
   ├── online → sent → accepted → store XML → print with CUFE+QR
   │
   └── offline → contingency → queue locally → retry with backoff
                                              → store XML once accepted
```

Void / refund emits a Nota Crédito referencing the original CUFE.

## Testing plan

- CUFE SHA-384 tested against DIAN vectors from Anexo 1.9
- UBL 2.1 XML validated against DIAN XSD
- Adapter integration tests hit PT sandbox (isolated test suite, not in CI main)
- Contingency: simulate offline → confirm queue + resend
- Retention: archive creation + >5y calculation + cleanup policy

## Open questions (to resolve before implementation)

- Final PT choice (Facture vs HKA) — based on pricing + onboarding friction
- Certificate storage: filesystem of main process vs OS keychain (macOS Keychain / Windows Credential Manager)
- XML retention target: local filesystem only, or sync to S3 when
  central server is available (Phase 10)
- Whether to implement the Colombia-only DEE-first MVP or already model
  the generic `FiscalAdapter` for LatAm expansion (decision: **yes,
  generic from day 1** per the Adapter-pattern principle in
  [ARCHITECTURE.md](./ARCHITECTURE.md))

## References

- [Anexo Técnico Factura Electrónica v1.9 (PDF DIAN)](https://www.dian.gov.co/impuestos/factura-electronica/Documents/Anexo-Tecnico-Factura-Electronica-de-Venta-vr-1-9.pdf)
- [Resolución DIAN 165 de 2023](https://normograma.dian.gov.co/dian/compilacion/docs/resolucion_dian_0165_2023.htm)
- [Proveedores Tecnológicos autorizados DIAN](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/proveedores-tecnologicos/)
