# Locale, Currency, and Country Configuration

> Status: **Design document (follow-up captured April 23, 2026)**
> Not yet implemented — tracked internally as `ENG-017`.

## Why

Today `formatCurrency()` in `apps/web/src/lib/utils.ts:89` defaults
`currency = 'USD'`. The live-preview badge the admin sees for a
Colombian tenant therefore renders as:

```
TOTAL BORRADOR
0,00 US$
```

The digits are localized for `es-CO` (comma decimal, Colombian
conventions) but the currency symbol stays `US$` because `Intl`
honours the explicit currency argument. This is a symptom of a
deeper gap: **the app has no notion of "which country does this
tenant operate in"**, so every display that needs a currency falls
back to a global hardcoded default.

Fixing it surface by surface would be endless — the right fix is a
**country-level configuration** that bundles the things that actually
move together: language, currency, date format, number format,
timezone, and the locally-expected tax-ID types.

## Scope

- **In scope**: Latin America + United States.
- **Out of scope (deferred)**: Europe, Asia, Oceania; Portuguese-Brazilian
  (needs a `pt-BR` locale bundle before the country entry is usable).
  Captured in the country catalog but marked `uiLocaleReady=false` so
  the UI quietly refuses to pick them until the locale ships.

The user flow the design targets:

1. Admin opens **Setup → Company**, sees a new **Locale & currency**
   section.
2. Admin picks a country (e.g. Colombia). Everything derives from it:
   `defaultLocale=es-CO`, `defaultCurrency=COP`, date format
   `dd/MM/yyyy`, timezone `America/Bogotá`, first-day-of-week Monday,
   tax-ID types CC/NIT/CE/TI/PA.
3. Any of those derived values can be overridden per-tenant if the
   operator has a reason (e.g. a Colombian distributor that reports
   in USD for cross-border B2B).
4. Every display (`formatCurrency`, `formatDate`, receipt templates,
   quotations, totals, dashboard KPIs) reads the tenant's active
   settings via a React context + server-side equivalent, not from
   global defaults.

## Data model

### Country catalog (global, seeded, read-only)

A new `countries` table is already present in the schema for
geography-of-customers purposes (tenant-scoped, operator-created).
The locale/currency work needs a **global catalog** at a different
table, because:

- Country-level data (ISO code, default locale, default currency,
  timezone, tax-ID type list) is **not tenant-specific** — it's
  universal truth.
- Having the operator hand-enter Colombia's default locale would be
  error-prone and repetitive.
- The existing `countries` (tenant-scoped) keeps its current role as
  a customer-addressing catalog where the operator may add missing
  entries. The two tables link via ISO code.

**New table** `country_catalog`:

```ts
export const countryCatalog = sqliteTable('country_catalog', {
  code: text('code').primaryKey(), // ISO 3166-1 alpha-2 ('CO', 'US')
  nameEn: text('name_en').notNull(),
  nameEs: text('name_es').notNull(),
  defaultLocale: text('default_locale').notNull(), // BCP-47 'es-CO'
  generalLocale: text('general_locale').notNull(), // 'es', 'en', 'pt'
  defaultCurrencyCode: text('default_currency_code')
    .notNull()
    .references(() => currencyCatalog.code),
  additionalCurrencyCodes: text('additional_currency_codes', {
    mode: 'json',
  })
    .$type<string[]>()
    .default([]), // e.g. Panama: ['USD']
  defaultTimezone: text('default_timezone').notNull(), // IANA
  firstDayOfWeek: integer('first_day_of_week').notNull(), // 0=Sun, 1=Mon
  dateFormatShort: text('date_format_short').notNull(), // 'dd/MM/yyyy'
  dateFormatLong: text('date_format_long').notNull(),
  taxIdTypesHint: text('tax_id_types_hint', { mode: 'json' }).$type<string[]>().default([]), // which tax-id codes dominate
  uiLocaleReady: integer('ui_locale_ready', { mode: 'boolean' }).notNull().default(true), // false for BR until pt-BR ships
});
```

### Currency catalog (global, seeded, read-only)

Separate table so countries can share currencies (e.g. Ecuador, El
Salvador, Panama, Puerto Rico all use USD):

```ts
export const currencyCatalog = sqliteTable('currency_catalog', {
  code: text('code').primaryKey(), // ISO 4217 ('COP', 'USD')
  nameEn: text('name_en').notNull(),
  nameEs: text('name_es').notNull(),
  symbol: text('symbol').notNull(), // '$', 'S/', 'Bs'
  /** Legal decimals per ISO 4217 (usually 2; 0 for CLP/PYG/JPY). */
  decimals: integer('decimals').notNull(),
  /**
   * Practical display decimals. Colombia: 0 in most retail UX even
   * though ISO says 2. CLP/PYG: 0. Keep this distinct from `decimals`
   * so fiscal / accounting surfaces use `decimals` while POS display
   * uses `displayDecimals`.
   */
  displayDecimals: integer('display_decimals').notNull(),
});
```

### Tenant locale settings (derived from country, overridable)

Add a 1:1 table to avoid mutating `companies`:

```ts
export const tenantLocaleSettings = sqliteTable('tenant_locale_settings', {
  tenantId: text('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  countryCode: text('country_code')
    .notNull()
    .references(() => countryCatalog.code),
  // Overrides — null means "inherit from country"
  localeOverride: text('locale_override'),
  currencyOverride: text('currency_override').references(() => currencyCatalog.code),
  timezoneOverride: text('timezone_override'),
  firstDayOfWeekOverride: integer('first_day_of_week_override'),
  updatedAt: text('updated_at').notNull(),
});
```

Resolution helper (server + client share one function):

```ts
function resolveTenantLocale(settings, countryRow, currencyRow) {
  return {
    locale: settings.localeOverride ?? countryRow.defaultLocale,
    currency: settings.currencyOverride ?? countryRow.defaultCurrencyCode,
    currencySymbol: currencyRow.symbol,
    decimals: currencyRow.displayDecimals,
    timezone: settings.timezoneOverride ?? countryRow.defaultTimezone,
    firstDayOfWeek: settings.firstDayOfWeekOverride ?? countryRow.firstDayOfWeek,
    dateFormatShort: countryRow.dateFormatShort,
  };
}
```

## Country matrix — LATAM + USA

Data compiled from ISO 3166-1, ISO 4217, CLDR common-locale-data, and
IANA tzdata. All entries have `uiLocaleReady=true` except Brazil
(pt-BR).

| Code   | Name (es)       | Locale | General | Currency | Symbol | Legal dec. | Display dec. | Dec sep | Thou sep | Timezone                       | Week | Common tax-ID codes     |
| ------ | --------------- | ------ | ------- | -------- | ------ | ---------- | ------------ | ------- | -------- | ------------------------------ | ---- | ----------------------- |
| **CO** | Colombia        | es-CO  | es      | COP      | $      | 2          | 0            | ,       | .        | America/Bogota                 | Mon  | CC, NIT, CE, TI, PA     |
| **US** | Estados Unidos  | en-US  | en      | USD      | $      | 2          | 2            | .       | ,        | America/New_York               | Sun  | SSN, EIN                |
| **MX** | México          | es-MX  | es      | MXN      | $      | 2          | 2            | .       | ,        | America/Mexico_City            | Sun  | RFC, CURP               |
| **AR** | Argentina       | es-AR  | es      | ARS      | $      | 2          | 2            | ,       | .        | America/Argentina/Buenos_Aires | Mon  | DNI, CUIT, CUIL         |
| **CL** | Chile           | es-CL  | es      | CLP      | $      | 0          | 0            | ,       | .        | America/Santiago               | Mon  | RUT                     |
| **PE** | Perú            | es-PE  | es      | PEN      | S/     | 2          | 2            | .       | ,        | America/Lima                   | Mon  | DNI, RUC                |
| **EC** | Ecuador         | es-EC  | es      | USD      | $      | 2          | 2            | .       | ,        | America/Guayaquil              | Mon  | CI, RUC                 |
| **VE** | Venezuela       | es-VE  | es      | VES      | Bs. S  | 2          | 2            | ,       | .        | America/Caracas                | Mon  | V, E, J, G              |
| **UY** | Uruguay         | es-UY  | es      | UYU      | $U     | 2          | 2            | ,       | .        | America/Montevideo             | Mon  | CI, RUT                 |
| **PY** | Paraguay        | es-PY  | es      | PYG      | ₲      | 0          | 0            | ,       | .        | America/Asuncion               | Sun  | CI, RUC                 |
| **BO** | Bolivia         | es-BO  | es      | BOB      | Bs     | 2          | 2            | ,       | .        | America/La_Paz                 | Mon  | CI, NIT                 |
| **CR** | Costa Rica      | es-CR  | es      | CRC      | ₡      | 2          | 2            | ,       | .        | America/Costa_Rica             | Sun  | cédula, cédula jurídica |
| **PA** | Panamá          | es-PA  | es      | PAB\*    | B/.    | 2          | 2            | .       | ,        | America/Panama                 | Sun  | cédula, RUC             |
| **GT** | Guatemala       | es-GT  | es      | GTQ      | Q      | 2          | 2            | .       | ,        | America/Guatemala              | Sun  | DPI, NIT                |
| **SV** | El Salvador     | es-SV  | es      | USD      | $      | 2          | 2            | .       | ,        | America/El_Salvador            | Sun  | DUI, NIT                |
| **HN** | Honduras        | es-HN  | es      | HNL      | L      | 2          | 2            | .       | ,        | America/Tegucigalpa            | Sun  | DNI, RTN                |
| **NI** | Nicaragua       | es-NI  | es      | NIO      | C$     | 2          | 2            | .       | ,        | America/Managua                | Sun  | cédula, RUC             |
| **DO** | Rep. Dominicana | es-DO  | es      | DOP      | RD$    | 2          | 2            | .       | ,        | America/Santo_Domingo          | Sun  | cédula, RNC             |
| **CU** | Cuba            | es-CU  | es      | CUP      | $      | 2          | 2            | ,       | .        | America/Havana                 | Mon  | carné de identidad      |
| **PR** | Puerto Rico     | es-PR  | es      | USD      | $      | 2          | 2            | .       | ,        | America/Puerto_Rico            | Sun  | SSN                     |
| **BR** | Brasil          | pt-BR  | pt      | BRL      | R$     | 2          | 2            | ,       | .        | America/Sao_Paulo              | Sun  | CPF, CNPJ               |

\*Panama's legal currency is the Balboa (PAB) but USD circulates at
par — `additionalCurrencyCodes=['USD']`.

Dual-currency / dollarized notes:

- **Ecuador, El Salvador, Puerto Rico**: adopted USD as legal tender.
  `defaultCurrencyCode='USD'`.
- **Panama**: PAB pegged 1:1 to USD; both circulate. Default PAB but
  accept USD.
- **Venezuela**: the bolívar (VES) is the official tender; many
  operations run in USD de facto. Default VES, expose USD as an
  override.
- **Argentina**: ARS official but USD widely used (MEP dollar).
  Default ARS; USD as an override is pragmatic.

## Currency matrix (derived)

| Code | Name                | Symbol | Legal dec. | Display dec. | Used by                       |
| ---- | ------------------- | ------ | ---------- | ------------ | ----------------------------- |
| COP  | Peso colombiano     | $      | 2          | 0            | CO                            |
| USD  | US Dollar           | $      | 2          | 2            | US, EC, SV, PR (+ opt) PA, VE |
| MXN  | Peso mexicano       | $      | 2          | 2            | MX                            |
| ARS  | Peso argentino      | $      | 2          | 2            | AR                            |
| CLP  | Peso chileno        | $      | 0          | 0            | CL                            |
| PEN  | Sol peruano         | S/     | 2          | 2            | PE                            |
| VES  | Bolívar soberano    | Bs. S  | 2          | 2            | VE                            |
| UYU  | Peso uruguayo       | $U     | 2          | 2            | UY                            |
| PYG  | Guaraní             | ₲      | 0          | 0            | PY                            |
| BOB  | Boliviano           | Bs     | 2          | 2            | BO                            |
| CRC  | Colón costarricense | ₡      | 2          | 2            | CR                            |
| PAB  | Balboa              | B/.    | 2          | 2            | PA                            |
| GTQ  | Quetzal             | Q      | 2          | 2            | GT                            |
| HNL  | Lempira             | L      | 2          | 2            | HN                            |
| NIO  | Córdoba             | C$     | 2          | 2            | NI                            |
| DOP  | Peso dominicano     | RD$    | 2          | 2            | DO                            |
| CUP  | Peso cubano         | $      | 2          | 2            | CU                            |
| BRL  | Real                | R$     | 2          | 2            | BR (pt-BR pending)            |

## Implementation plan

### Phase A — model + seed (1-2 days, no UI change)

1. Add `country_catalog` and `currency_catalog` tables (Drizzle
   schema + generated migration `0003_locale_catalogs.sql`).
2. Seed both tables with the LATAM + USA matrix above. Seed runs on
   every DB boot (idempotent by `code` primary key).
3. Add `tenant_locale_settings` table (1:1 with tenants).
4. Update the dev seed to write `tenantLocaleSettings` for the
   `demo-co` tenant with `countryCode='CO'`.

### Phase B — formatter refactor (2-3 days)

1. Promote `formatCurrency` / `formatDate` in `apps/web/src/lib/utils.ts`
   into a small `i18n/format.ts` module that reads from an
   `ActiveLocaleContext` (React context populated by a tRPC query on
   app boot).
2. New tRPC query `tenantSettings.getLocale()` that returns the
   resolved `{ locale, currency, currencySymbol, decimals, timezone,
dateFormatShort, firstDayOfWeek }` for the active tenant.
3. Client-side caching: the query is infinite-staleTime until the
   tenant's settings are invalidated by an update mutation.
4. Server-side helper (`services/tenant-locale.ts`) that the fiscal
   document emitter, receipt renderer, and quotation PDF can call.
5. Every callsite of `formatCurrency(amount)` without an explicit
   `currency` argument picks it up from the context / helper.

### Phase C — admin UI (2 days)

1. New section on `CompanyPage` (or a dedicated `/setup/locale`
   route): country picker, currency override, locale override,
   timezone override, first-day-of-week override.
2. Preview strip that renders `formatCurrency(123456.789)` and
   `formatDate(new Date())` live with the picked settings — mirrors
   the receipt-template live-preview pattern.
3. i18n: new `localeSettings.*` namespace in `en` and `es`.
4. Admin-only (the setting affects every user in the tenant).

### Phase D — receipt template + fiscal document + quotation (1 day)

1. The `receipt-renderer` service already uses i18n labels from the
   editor; extend it to accept `locale` and `currency` as part of
   the render data so the HTML and ESC/POS branches both format
   money consistently.
2. Fiscal documents (Iter 3 Fase A snapshot) capture
   `buyerCurrencyCode` at emission — follow-up to the Iter 3 plan.
3. Quotation PDF export uses the tenant's currency, not a per-PDF
   hardcoded USD.

### Phase E — dev seed + demo updates (0.5 day)

1. Dev seed creates `demo-co` with `countryCode='CO'` → all displays
   show `COP` for that tenant.
2. Document how to spin up a USD-based demo (override
   `countryCode='US'` at seed time via a `SEED_COUNTRY=US` env var,
   tracked as the optional `--country` flag later).

## Tests

- **Schema**: `country_catalog` seeded with 21 rows; `currency_catalog`
  with 18; every `country_catalog.defaultCurrencyCode` resolves.
- **Resolver**: `resolveTenantLocale(settings, country, currency)`
  prefers `override` when set, falls back to country defaults
  otherwise (4 cases × 5 fields = 20 assertions).
- **Formatter**:
  - `formatCurrency(0, 'COP', 'es-CO')` → `$ 0` (no decimals)
  - `formatCurrency(1234.5, 'USD', 'en-US')` → `$1,234.50`
  - `formatCurrency(1000, 'CLP', 'es-CL')` → `$ 1.000`
  - `formatCurrency(1234.5, 'ARS', 'es-AR')` → `$ 1.234,50`
- **Integration**: creating a tenant with `countryCode='CO'` makes
  `formatCurrency` return `$ 0` for an empty sale (not `0,00 US$`).
- **Cross-tenant isolation**: setting `demo-co` to CO/COP does not
  change how `default` (USA/USD) renders.

## Out of scope (this ticket)

- **Multi-currency sales** — selling the same SKU in COP at one site
  and USD at another. Needs exchange rates, GL accounting, and fiscal
  implications; tracked separately under Phase 11c (multi-currency
  sub-ticket).
- **Per-site locale** — a Colombian tenant with a USA site needs a
  country-per-site instead of country-per-tenant. V2.
- **Portuguese (pt-BR)** — BR country row ships with
  `uiLocaleReady=false`. Enabling it requires adding the pt-BR locale
  bundle to `apps/web/src/i18n/locales/pt/*.json`, which is an
  iteration of its own.
- **Non-LATAM Spanish markets** (Spain, Equatorial Guinea,
  Philippines legacy). Can be added to the catalog later with one
  row each.
- **RTL languages, Arabic, Hebrew** — not in scope.

## Quick bug patch (before ENG-017 lands)

If the "0,00 US$" cosmetic issue needs to ship a fix before the full
ENG-017 lands, the minimum change is:

```ts
// apps/web/src/lib/utils.ts
export function formatCurrency(
  amount: number,
-  currency = 'USD',
+  currency: string | undefined = undefined,
   locale = getActiveLocale()
): string {
-  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount);
+  const fallbackCurrency = locale.startsWith('es-CO') ? 'COP'
+    : locale.startsWith('en-US') ? 'USD'
+    : 'USD';
+  return new Intl.NumberFormat(locale, {
+    style: 'currency',
+    currency: currency ?? fallbackCurrency,
+  }).format(amount);
}
```

That gets the Colombian tenant rendering `COP` without the full
country-configuration work. **But it does not scale** — every new
country needs a line, and the "configurable per tenant" part of the
user's request still requires ENG-017. Recommend skipping the patch
and jumping straight to ENG-017.
