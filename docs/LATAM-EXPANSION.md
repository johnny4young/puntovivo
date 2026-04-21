# LatAm Expansion — Fiscal Adapters per Country

> Status: vision document. Activated once Phase 11c (multi-currency +
> parametrizable fiscal rules) lands.
> Created: April 21, 2026.

## Goal

Puntovivo is 100% Colombia-hardcoded today. To sell in any other LatAm
country, two things must be generalized:

1. Currency, number format, tax rules — moved from constants to a
   `fiscal_profile` table loaded per tenant.
2. Fiscal document generation / transmission — abstracted behind the
   same `FiscalAdapter` interface as [FISCAL-INTEGRATION.md](./FISCAL-INTEGRATION.md),
   with a new adapter per country.

## Country matrix

| Country | Tax authority | Electronic fiscal document | Technical note | Adapter effort |
| --- | --- | --- | --- | --- |
| Ecuador | SRI | Factura electrónica + RIDE | Signed XML, pruebas vs producción | 3-4 weeks |
| Peru | SUNAT | Factura, Boleta, Notas | UBL 2.1 + OSE intermediary | 3-4 weeks |
| Chile | SII | Boleta/Factura/Guía de despacho | CAF token, folios, SII SOAP/REST | 4-5 weeks |
| Mexico | SAT | CFDI 4.0 | 20+ complement types, PAC required, IEPS | 6-8 weeks |
| Argentina | AFIP | Factura electrónica A/B/C | **Physical fiscal controller required** (hardware barrier) | 6-10 weeks + HW |
| Bolivia | SIN | Factura electrónica + QR | SIN authorization code | 3 weeks |
| Costa Rica | Hacienda | XML 4.3 | Sign + transmit in <1h | 3 weeks |
| Panama | DGI | FE (new, 2023-2024) | Still stabilizing | 3-4 weeks |
| Dominican Republic | DGII | e-CF | Gradual rollout 2024-2026 | 4 weeks |
| Guatemala | SAT | FEL | Signed XML | 3 weeks |
| Paraguay | SET | SIFEN | Recent rollout | 3-4 weeks |
| Uruguay | DGI | CFE | DGI as receiver | 3 weeks |

## Recommended rollout order

1. **Ecuador + Peru** — neighbors, similar regime, low incremental
   effort. Activates ~90M additional population.
2. **Chile** — most mature LatAm POS market, high willingness to pay.
3. **Mexico** — largest but most complex fiscally. Consider a local
   partner or acquiring an existing PAC.
4. **Argentina** — only with hardware capital for fiscal controllers.
5. Others by opportunity.

## Architecture impact

### Per-tenant `fiscal_profile`

```sql
CREATE TABLE fiscal_profiles (
  id TEXT PRIMARY KEY,
  country_code TEXT NOT NULL,         -- 'CO', 'EC', 'PE', 'CL', ...
  currency_code TEXT NOT NULL,        -- 'COP', 'USD', 'PEN', 'CLP', ...
  tax_rules_json TEXT NOT NULL,       -- country-specific rates, deductions, INC-like taxes
  numbering_rules_json TEXT NOT NULL,
  adapter_key TEXT NOT NULL,          -- maps to a FiscalAdapter impl
  created_at TEXT NOT NULL
);

ALTER TABLE tenants ADD COLUMN fiscal_profile_id TEXT REFERENCES fiscal_profiles(id);
```

### Adapter registry

`FiscalAdapter` is the same interface as in [FISCAL-INTEGRATION.md](./FISCAL-INTEGRATION.md).
Each country ships one or more adapter implementations. `adapter_key`
on `fiscal_profile` selects which one is loaded at runtime.

### Tax engine

Current hardcoded logic (VAT rates, INC, bags, tips Ley 1935/2018)
moves into a **profile-driven tax engine**:

```ts
// packages/server/src/services/tax/tax-engine.ts (planned)
export interface TaxEngine {
  computeLineTaxes(line: SaleLine, profile: FiscalProfile): TaxBreakdown;
  computeDocumentTaxes(sale: Sale, profile: FiscalProfile): DocumentTaxTotals;
  applicableWithholdings(customer: Customer, profile: FiscalProfile): Withholding[];
}
```

The default Colombia engine is one implementation; Ecuador, Peru, Chile,
etc. each provide their own.

## Testing plan per country

Every adapter ships with:

- Round-trip test: generate a sample document, submit to sandbox
  environment, parse the accepted response
- CUFE/CUDE equivalent hash verified against official vectors (if the
  country publishes them)
- XML schema validation (XSD) against the country's official schema
- Tax engine unit tests with canonical invoices from the country's
  fiscal manual

## Non-goals

- Puntovivo will not maintain its own certified PAC / OSE / PT in any
  country. Always integrate with a local authorized provider.
- Legal compliance reviews are performed by local counsel per country —
  not part of the codebase.
