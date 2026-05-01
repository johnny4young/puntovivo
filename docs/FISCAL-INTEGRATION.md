# Fiscal Integration — Colombia DIAN

> Status: **Fase A shipped (ENG-020, April 2026)** — full data model,
> adapter interface, `MockAdapter`, sale lifecycle hooks, admin
> reports router, and architectural lint on `main`. **Fase B
> (ENG-021) still gated** on the 6 external dependencies listed
> below.
> Phase 11 of [ROADMAP.md](./ROADMAP.md), re-prioritized to P0 (Tier-1 3a).
> Created: April 21, 2026. Updated: April 24, 2026.

## Shipped in Fase A

The schema, adapter seam, CUFE compute, lifecycle hooks,
feature-flagged dev seed, and admin reports surface described in
this doc are **implemented and staged in the ENG-020 commit
bundle**:

- Global `dian_identification_types` catalog (10 DIAN codes) + seed.
- `fiscal_documents` / `fiscal_document_items` / `fiscal_numbering_resolutions` / `fiscal_certificates` tables with immutable buyer + line snapshot columns.
- `services/fiscal/cufe.ts` (pure SHA-384 helper), `FiscalAdapter` interface, `ColombiaMockAdapter`, country-pack registry factory, `emitFiscalDocument` orchestrator idempotent by `(tenantId, source, sourceId, kind)`.
- Hooks in `sales.create` (when `status='completed'`) / `sales.completeDraft` / `sales.void` / `sales.returnSale`, gated behind `tenants.settings.fiscal_dian_enabled`.
- `reports.fiscal.list` + `reports.fiscal.getByCufe` admin router + `architectural-lint.test.ts` enforcing that reports never join `customers` / `products`.
- Web UI placeholders: fiscal documents list page, fiscal reports page, habilitación wizard, and contingency indicator.

**What Fase B (ENG-021) still owes**: real XAdES-EPES signing in
a `FactureAdapter` / `HkaAdapter`, the contingency retry daemon
with backoff, and the real habilitación flow wired to the PT
sandbox. Everything else is in place and tested end-to-end against
the `ColombiaMockAdapter`.

## ENG-034 — pluggable adapter (April 2026)

Promoted `services/fiscal/registry.ts` from an implicit singleton
(`new MockAdapter()`) to a typed factory keyed by ISO 3166-1 alpha-2
`countryCode`. The Colombia adapter moved into a country pack at
`services/fiscal/packs/co/mock-adapter.ts` and was renamed
`ColombiaMockAdapter` (the CUFE algorithm IS Colombia-specific —
the old generic name was misleading). Mexico and Chile packs ship
as `NotImplementedAdapter` stubs that throw `FISCAL_PACK_NOT_AVAILABLE`
on `issue` / `voidDocument` / `fetchStatus` and report `validateConfig`
issues pointing at the gating tickets (ENG-035, ENG-036).

Surface added to the adapter contract:

- `validateConfig(input: FiscalAdapterConfig): Promise<FiscalAdapterValidationResult>`
  — pre-flight readiness check. Real adapters probe required settings
  (NIT for CO, RFC for MX, RUT for CL, certificate, resolution,
  environment) and report missing fields. The future fiscal-readiness
  admin card will surface a green/red badge per country based on this.
- `readonly countryCode: string` — every adapter declares which
  country it serves so the orchestrator can introspect.
- `NotImplementedFiscalAdapter` interface extends `FiscalAdapter` with
  `notImplemented: true` + `availableInTicket: string` so the registry
  can list parked packs without breaking the type contract.

Dispatch flow inside `sales.ts::safelyEmitFiscalDocument`:

```
const fiscalLocale = await resolveTenantLocale(ctx.db, ctx.tenantId);
adapter: getFiscalAdapter(fiscalLocale.countryCode),
```

`resolveTenantLocale` is the canonical reader for the tenant's
`countryCode` (lives in `services/tenant-locale.ts`). Its own
fresh-tenant fallback is US/USD; the fiscal registry then maps any
unsupported country code to its defensive default.

Unknown-country fallback: the registry routes any unknown country
(e.g. 'AR' before an Argentina pack ships) to `ColombiaMockAdapter`.
Reasoning: the orchestrator already gates fiscal emission on
`tenants.settings.fiscal_dian_enabled`. If an admin opts in for a
country that is not in the matrix yet, the fallback emits a
Colombia-shaped CUFE (wrong but non-breaking). The operator sees the
document in `/reports/fiscal-documents` and can disable fiscal until
the pack ships. A throw would silently fail the sale lifecycle path,
which is worse for pilot.

Discovery surface:
`listFiscalAdapterCountries(): ReadonlyArray<{ code, isImplemented, availableInTicket? }>`
returns one entry per registered country pack. Mirrors
`listProviders()` from the AI provider registry so the fiscal-
readiness card (BACKLOG follow-up) can render the same shape as
`CompanyAISettingsCard`.

## ENG-035a — Pack México fundación (mayo 2026)

Primer slice del pack México. ENG-035 completo (CFDI 4.0 + PAC +
firmado CSD + complemento Pago 2.0) es 2-3 semanas + depende de
contrato PAC y sandbox SAT — split en tres tickets para shippear
valor estructural sin esperar las dependencias externas.

**Shipped en ENG-035a**:

- **`MexicoCFDIAdapter`** reemplaza al stub
  `MexicoNotImplementedAdapter` de ENG-034. `validateConfig` ahora
  hace probe real de los settings MX (RFC, régimen fiscal, lugar
  de expedición, ambiente) en lugar de devolver
  `PACK_NOT_AVAILABLE`. `issue` / `voidDocument` / `fetchStatus`
  siguen tirando `FISCAL_PACK_NOT_AVAILABLE` apuntando a
  ENG-035b — la emisión XML real shipa ahí.
- **Validador RFC** (`packs/mx/rfc.ts`) — función pura que valida
  longitud (12 PM / 13 PF), estructura (3-4 letras + fecha AAMMDD
  + 3 alfanuméricos), fecha embebida (calendario válido), checksum
  de homoclave (algoritmo SAT módulo 11), lista negra de prefijos
  altisonantes, y atajo para los RFCs genéricos extranjeros del
  SAT (`XEXX010101000` PM, `XAXX010101000` PF). 17 tests cubren
  los caminos felices y de fallo.
- **Catálogos SAT** (`packs/mx/catalogs/`) como TS modules: 23
  regímenes fiscales (601 General PM, 612 PF Empresarial, 626
  RESICO, etc.), 24 usos CFDI (G03 Gastos, S01 Sin efectos
  fiscales, etc.), 22 formas de pago (01 Efectivo, 04 Tarjeta de
  crédito, etc.), 25 claves de unidad (H87 Pieza fallback, KGM
  Kilogramo, MTR Metro, etc.). El catálogo `claveProdServ` (50k
  entradas, requiere refresh desde API SAT) queda parqueado para
  ENG-035b.
- **Namespace `tenants.settings.fiscal.mx.*`** — aditivo al
  `fiscal_dian_enabled` heredado del pack CO. El rename a
  namespace country-aware (`tenants.settings.fiscal.{country}.enabled`)
  queda capturado para ENG-035c.
- **Router admin `fiscal.settings.{getByCountry, updateMx}`** con
  validación server-side de RFC + régimen contra catálogo antes
  del write. Re-corre `validateConfig` post-mutation para que la
  respuesta lleve el readiness fresco (la card evita un round-trip
  extra).
- **Tab `Fiscal`** en `/company` con `CompanyMxFiscalCard`
  (mirror del shape de `CompanyAISettingsCard` de ENG-030):
  readiness badge verde/rojo + form con RFC + régimen Select +
  lugar de expedición + ambiente. Cuando el `countryCode` del
  tenant es CO o CL, la card muestra placeholder apuntando al
  ticket que trae cada pack.
- **Error codes nuevos** `FISCAL_RFC_INVALID` +
  `FISCAL_REGIMEN_INVALID` registrados server + web con i18n
  en/es (neutral LATAM tú).

**Convención fiscal en español a partir de ENG-035a**: por
preferencia operativa (audiencia LATAM hispanohablante), todos
los comentarios JSDoc dentro de `services/fiscal/**` + el router
`fiscal-settings.ts` + las secciones nuevas de este doc se
escriben en español a partir de aquí. Identificadores de código
(clases, tipos, funciones, error codes) siguen en inglés porque
cruzan el boundary tRPC y se consumen desde el web.

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
  site_id TEXT NOT NULL,            -- one active range per site + kind
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
