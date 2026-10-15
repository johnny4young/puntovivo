# Receipt Templates — Visual Editor and Runtime Printing

**Language:** English · [Español](./es/RECEIPT-TEMPLATES.md)

> Status: **Shipped**
> Current contract reviewed: October 15, 2026

Lets an administrator visually choose and edit the layout of POS receipts,
quotations, and fiscal DEE/FEV print representations — without touching code
or CSS.

## Why

- Different tenants have different branding (logo, colours, footer message).
- Paper width varies by hardware (58mm vs 80mm thermal vs letter PDF).
- Optional sections come and go: tenders block, per-line VAT column,
  authority-verification QR when a fiscal pack is certified, suggested tip
  (restaurants).

## Design principle: declarative layout, no free HTML

The template is a **structured JSON** (`ReceiptLayout`), not a blob of
HTML. Every visible element is one of a fixed set of **atomic blocks**
with its own validated options. The renderer
(`packages/server/src/services/receipt-renderer/`) builds HTML (for
`webContents.print`) and an ESC/POS byte stream (for the thermal driver) from
the same layout.

Security:

- The layout schema is a Zod discriminated union. There is no string
  field that round-trips into HTML without first passing through
  `escapeHtml`.
- Values referenced via `{{namespace.path}}` are HTML-escaped at the
  same call site that resolves them — there is no code path that
  concatenates raw user input into HTML.
- Variable namespaces are whitelisted: `company.*`, `sale.*`, `item.*`,
  `fiscal.*`, `tender.*`. Anything else fails Zod validation.
- `qr.source` rejects URLs with `javascript:`, `data:`, `vbscript:` or
  `file:` schemes so a maliciously configured QR cannot hijack a
  scanner-equipped client.
- The editor preview renders inside a sandboxed `<iframe srcDoc>` so
  the receipt's CSS cannot affect the host page (and vice versa), and
  scripts inside the preview cannot run.

## Atomic blocks

Each block is one entry in `ReceiptLayout.blocks` (max 50 per layout).
The discriminator is `type`.

| Block          | Fields                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------ |
| `logo`         | `align?`, `maxHeightMm?`                                                                                     |
| `text`         | `value` (≤ 500 chars), `style?` (`title` / `subtitle` / `normal` / `muted` / `monospace`), `align?`, `bold?` |
| `itemsTable`   | `columns` (1-6 of `name` / `qty` / `unitPrice` / `taxPercent` / `discount` / `total`), `showHeader?`         |
| `totalsBlock`  | `show` (1-5 of `subtotal` / `discount` / `taxTotal` / `tip` / `grandTotal`)                                  |
| `tendersTable` | `showChange?`                                                                                                |
| `qr`           | `source` (whitelisted vars only, no JS schemes), `sizeMm?` (10-60)                                           |
| `separator`    | `char?` (default `-`, max 4 chars)                                                                           |
| `barcode128`   | `source` (whitelisted vars only), `heightMm?` (8-40)                                                         |
| `appFooter`    | `show?`, `align?` (`left` / `center` / `right`)                                                              |

QR blocks render a real inline SVG in HTML and a real `GS ( k` sequence in
ESC/POS. Barcode-128 blocks render a real monochrome SVG in HTML and native
Code 128 function-B commands in ESC/POS. Both scanner blocks retain a
human-readable fallback when their source is empty, cannot be encoded, or
would consume the printer's required quiet zones.

## Whitelist of variables

Only these namespaces can be interpolated in `text.value`, `qr.source`,
or `barcode128.source`:

- `company.*` — `name`, `taxId`, `address`, `phone`, `email`, `city`
- `sale.*` — `saleNumber`, `cashier`, `site`, `customer`, `customerTaxId`,
  `createdAt`, `subtotal`, `discount`, `taxTotal`, `tip`, `grandTotal`,
  `changeDue`, `notes`
- `item.*` — only meaningful inside `itemsTable` (rendered per row)
- `fiscal.*` — `cufe`, `qrUrl`, `resolution`, `documentNumber`
- `tender.*` — only meaningful inside `tendersTable` (rendered per row)

Any other variable fails Zod validation at save time. Variables that
resolve to `undefined` render as the empty string (so a partially
configured tenant — e.g. `fiscal.cufe` not yet set — still prints
cleanly).

## Domain

### Schema

`packages/server/src/db/schema/config.ts` declares:

```sql
CREATE TABLE receipt_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL,            -- 'sale' | 'quotation' | 'fiscal_dee'
  name TEXT NOT NULL,
  paper_width TEXT NOT NULL DEFAULT '80mm',
  layout TEXT NOT NULL,          -- JSON, ReceiptLayout shape
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  updated_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_receipt_templates_tenant ON receipt_templates (tenant_id);
CREATE INDEX idx_receipt_templates_tenant_kind ON receipt_templates (tenant_id, kind);
CREATE INDEX idx_receipt_templates_tenant_active ON receipt_templates (tenant_id, is_active);
-- Partial unique: at most one default per (tenant, kind)
CREATE UNIQUE INDEX idx_receipt_templates_tenant_kind_default
  ON receipt_templates (tenant_id, kind)
  WHERE is_default = 1;
```

The partial unique index is declared with Drizzle's
`uniqueIndex(...).where(...)` API and is present in the squashed
`0000_baseline.sql` migration. The service layer additionally enforces the
invariant inside transactions: any insert/promote that would create a second
default first demotes the prior one in the same transaction.

### tRPC procedures (admin only)

```
trpc.receiptTemplates.list({ kind?, includeInactive? })
trpc.receiptTemplates.getById({ id })
trpc.receiptTemplates.create({ kind, name, layout, isDefault?, isActive? })
trpc.receiptTemplates.update({ id, name?, layout?, isActive? })
trpc.receiptTemplates.delete({ id })
trpc.receiptTemplates.setDefault({ id })
trpc.receiptTemplates.duplicate({ id, name? })
trpc.receiptTemplates.renderPreview({ id?, layout?, kind? })
```

`renderPreview` accepts either an inline `layout` (used by the editor's
live preview, no save round-trip) or an `id` to render an existing row.
It returns `{ html, escposByteLength }`. The renderer is the same code
path used at print time. Printer-width overrides and operating-system
settings still apply at delivery; preview agreement is not physical-printer
qualification.

### Renderer service

`packages/server/src/services/receipt-renderer/` exports
`renderReceipt(layout: ReceiptLayout, data: RenderData): { html, escpos }`.
The renderer is pure, deterministic, and has no I/O. It is used by the editor
preview and by the server-side runtime context that feeds browser/Electron
system printing, server-attached ESC/POS printers, and hub-client ESC/POS
bytes.

`buildPreviewData(kind)` synthesizes a deterministic mock dataset so
the editor preview is stable across reloads.

## UI

`/receipt-templates` — admin only (registered in `App.tsx` with
`adminOnlyRoles`, sidebar entry under **Setup**).

The page has two modes kept in local state:

1. **List** — paginated table grouped by kind, with per-row actions:
   _Edit_ (opens the inline editor in mode 2), _Set as default_
   (mutates the selected row to `isDefault=true` atomically),
   _Duplicate_ (creates a copy with " (copy)" suffix, never inheriting
   the default flag), _Delete_ (modal confirmation; refuses when the
   row is the last template for its kind).
2. **Editor** — two-pane inline editor:
   - **Left**: list of blocks. Each block can be moved up/down and
     removed. Tapping a block expands an inline form for its
     type-specific fields. New blocks are added via the button row at
     the top of the panel.
   - **Right**: **live preview** rendered inside a sandboxed iframe.
     Updates 200ms after the layout changes (debounced) by re-running
     the server `renderPreview` procedure. The web client supplies the
     currently active i18n labels for item columns, totals, and tender
     headers so the preview language matches the admin UI instead of
     freezing English strings into Spanish sessions. On screen, the generated
     document contracts to the available pane width so all receipt columns
     remain visible on smaller workspaces. Thermal HTML uses physical
     printable widths (48 mm on a 58 mm roll, 72 mm on an 80 mm roll),
     independently of head dots. Print media removes preview padding and
     contracts to the available page area without shrinking the font.

### Constraints (Zod + UI)

- ≤ 50 blocks per template.
- Flat layout, no nesting.
- ≤ 500 characters per text block.
- ≤ 200 characters per QR / barcode source.
- Paper width ∈ `{ '58mm', '80mm', 'letter', 'a4' }`.
- At least one column required for `itemsTable`; at least one line
  required for `totalsBlock`.

## Data bindings — where do blocks get their values?

Two blocks sometimes confuse first-time operators because their data
source is implicit, not picked in the editor. The current contract is:

### `itemsTable`

- The rows are **always the line items of the current sale being
  printed** (`RenderData.sale.items[]`). There is no "choose a data
  source" control — a sale receipt by definition prints the sale's
  items. In the editor the operator only picks WHICH columns (name,
  qty, unitPrice, taxPercent, discount, total) render and in what
  order.
- For the editor preview the items come from
  `buildPreviewData(kind)` in `receipt-renderer.ts`, which ships a
  mocked 4-item sale (Café 250g, Pan artesanal, Empanada de carne,
  Botellón de agua) with split payments so the preview exercises
  every column.
- At real print time the server builds `RenderData` from the posted sale and
  payment records. Completed sales freeze customer, site, cashier, product
  name/SKU, company name/tax/contact, and customer tax-ID values for ordinary
  reprints. They also freeze the selected ordinary template layout, company
  logo source, and BCP-47 receipt locale. Separate snapshot-version markers
  preserve fields or a missing template that were deliberate at checkout;
  rows created before the snapshot migrations fall back to current related
  records and presentation. Fiscal receipts additionally replace buyer, line,
  total, currency, locale, and emission-time values with immutable
  fiscal-document snapshots.
- The editor surfaces this binding directly above the block controls so an
  operator does not have to infer where the rows come from.
- Tender values use customer-facing labels (`Cash` / `Efectivo`, `Card` /
  `Tarjeta`, and equivalents) selected from the receipt locale. Unknown future
  provider codes remain visible verbatim instead of disappearing.

### `totalsBlock`

- The block renders N labelled lines, one per entry in its `show`
  array (any subset of `subtotal`, `discount`, `taxTotal`, `tip`,
  `grandTotal`). Each label is a translated string from the
  `editor.totalsLines.*` i18n namespace; each value comes from the
  corresponding scalar on the current sale snapshot:

  | Line         | Source field      |
  | ------------ | ----------------- |
  | `subtotal`   | `sale.subtotal`   |
  | `discount`   | `sale.discount`   |
  | `taxTotal`   | `sale.taxTotal`   |
  | `tip`        | `sale.tip`        |
  | `grandTotal` | `sale.grandTotal` |

  These values are computed by the application and read from the runtime sale
  context. The renderer formats them; it never recomputes a sale's tax,
  discount, tip or total. This includes frozen fiscal-document totals when
  applicable. Header pricing is owned by
  [pricing.ts](../packages/server/src/application/sales/pricing.ts), not the
  visual receipt layout.

- The editor includes a collapsible explanation of these sources next to the
  totals controls.

## Default presets

`apps/web/src/features/receipt-templates/defaultLayouts.ts` ships
ready-to-use presets per kind so the editor never starts blank:

- `sale` — 80mm thermal layout (logo + company header + items + totals
  - tenders + thank-you footer).
- `quotation` — letter layout with discount column and itemized totals.
- `fiscal_dee` — 80mm thermal with QR and fiscal-identifier fields. Authority
  verification data remains empty unless the active provider pack is
  certified.

When an admin opens **New template** the editor loads the preset for
the selected `kind`, localized to the active app language at creation
time. Switching `kind` on an already-edited template
preserves the in-progress layout (the operator may have a valid reason
to start from one preset and reclassify it later).

## Tests

Server (`packages/server/src/__tests__/receipt-templates.test.ts`):

- Zod whitelist rejects unknown variable namespaces, JS-scheme QR
  sources, > 50 blocks, > 500-char text, zero-column items table.
- Renderer escapes HTML special characters injected via tenant data and
  literal template text — `<script>` round-trips as `&lt;script&gt;`.
- Renderer handles empty itemsTable, unknown variables (resolve to
  empty string, not literal `undefined`), and produces narrower
  ESC/POS lines for 58mm vs 80mm paper.
- CRUD via tRPC: first template per kind is auto-promoted to default;
  setDefault flips atomically; duplicate creates a non-default
  " (copy)" sibling; delete refuses the last template for a kind and
  promotes a sibling when the deleted row was the default.
- Cross-tenant: templates from a foreign tenant invisible in
  list/getById.
- Permissions: manager and cashier callers receive `FORBIDDEN`.
- Runtime receipts keep completed-sale display and identity snapshots after
  customer, product, site, cashier, or company edits. Ordinary receipts also
  keep their sale-time layout, logo source, and locale after template/default,
  logo, or locale changes; a sale completed with no active template keeps
  legacy output. Pre-migration rows retain current-record and
  current-presentation fallback behavior.

Web (i18n parity + lint + build).

## Files

```
packages/server/src/db/schema/config.ts                          # receiptTemplates table + indexes
packages/server/src/db/migrations/0000_baseline.sql              # current baseline migration
packages/server/src/db/migrations/0028_sale_display_snapshots.sql # ordinary receipt labels
packages/server/src/db/migrations/0029_receipt_identity_snapshots.sql # receipt identity
packages/server/src/db/migrations/0030_receipt_presentation_snapshots.sql # layout, logo source, locale
packages/server/src/db/migrations/0095_mighty_raza.sql            # cash handover snapshots
packages/server/src/application/sales/receipt-snapshots.ts       # tenant-scoped snapshot capture
packages/server/src/lib/errorCodes.ts                            # RECEIPT_TEMPLATE_* codes
packages/server/src/services/receipt-templates/                  # CRUD + default-flip transactions
packages/server/src/services/receipt-renderer/                   # preview + runtime renderers
packages/server/src/services/receipt-renderer/sale-context.ts    # runtime sale-to-template read model
packages/server/src/trpc/schemas/receiptTemplates.ts             # Zod ReceiptLayout
packages/server/src/trpc/routers/receiptTemplates.ts             # admin tRPC procedures
packages/server/src/trpc/routers/peripherals/                    # HTML/ESC-POS runtime delivery
packages/server/src/trpc/router.ts                               # registration
packages/server/src/__tests__/receipt-templates.test.ts          # tests
apps/web/src/features/receipt-templates/
  defaultLayouts.ts
  ReceiptTemplatesPage.tsx
  ReceiptTemplateEditor.tsx
  ReceiptTemplatePreview.tsx
apps/web/src/App.tsx                                             # /receipt-templates lazy route
apps/web/src/components/layout/Sidebar.tsx                       # Setup section entry
apps/web/src/i18n/index.ts                                       # receiptTemplates namespace
apps/web/src/i18n/locales/{en,es}/receiptTemplates.json
apps/web/src/i18n/locales/{en,es}/nav.json                       # items.receiptTemplates
apps/web/src/i18n/locales/{en,es}/errors.json                    # RECEIPT_TEMPLATE_* messages
apps/web/src/lib/translateServerError.ts                         # KNOWN_SERVER_ERROR_CODES
```

## Current print integration

- A thermal item keeps its full description and shows its configured numeric
  fields on labelled lines. Long identifiers wrap instead of expanding a
  table beyond the printable area; totals move to another line when needed.
  Receipt fonts stay at their physical point sizes rather than scaling an
  oversized pixel layout down to fit the roll.
- In **Devices**, a system printer or an ESC/POS printer can opt into automatic
  printing after a completed sale. This is off by default. System printing
  opens the OS dialog. Desktop operators can select an enumerated OS printer
  locally for this business and computer; silent printing requires that
  selection. Existing profiles without one open the dialog. A missing saved
  queue fails instead of silently selecting another printer. ESC/POS has a visible 58/80 mm selector,
  synchronized with its advanced JSON configuration.
- ESC/POS network configuration requires the printer's real private network
  address. Example addresses are placeholders, never saved defaults. Direct
  USB and serial ESC/POS transports are not implemented; a USB-attached printer
  uses **System** with its OS driver. Switching printer methods preserves the
  automatic-print opt-in and keeps method-specific configuration separate.
- **Check registration** does not print. **Print a test ticket** in the desktop
  system-printer controls opens a real OS dialog for a synthetic document,
  without creating a sale. Failed tests show their diagnosis and are not
  announced as success. See [Printer setup](./PRINTER-SETUP.md) / [Configuración de impresoras](./es/PRINTER-SETUP.md).
- Electron uses the printer's default page size and printable area. Static
  SVG QR/barcode shapes survive print sanitization; active SVG constructs and
  external resources remain blocked. Canceling the native print dialog is a
  separate result, not a spooler error.
- Failed ESC/POS writes keep the durable hardware queue and automatic retry.
  They never open a second HTML/System print. The warning confirms a queued
  retry only after the server persists it; transport/bridge failures without
  confirmation ask the operator to check the printer and queue before reprinting.
  Explicit System printing and the no-ESC/POS route still use HTML. Hub-client
  local bridge failures have no durable retry queue. If a queued ESC/POS job
  finds that its printer was changed to System, it stops with a diagnostic
  dead letter and preserves its bytes. Registration never completes that job;
  review the queue before deliberately printing through another route.
- Concurrent print requests for one sale share the active attempt. A later
  deliberate reprint remains available. Browser confirmation means the print
  dialog opened, not that paper was produced.

- The active default `fiscal_dee` template is selected when a sale has fiscal
  documents; otherwise the active default `sale` template is selected. A
  fiscal sale falls back to the `sale` template when no active fiscal template
  exists.
- Browser and Electron system printing request server-rendered HTML from that
  template. Server-attached printers and hub clients receive ESC/POS bytes from
  the same layout and runtime sale context.
- Thermal output honors the registered printer's paper width, configured code
  page, drawer pulse, and cut order. QR and Code 128 blocks resolve the same
  source in HTML and ESC/POS.
- Tenants with no active template retain the previous hardcoded HTML/ESC-POS
  receipt as an upgrade fallback instead of losing printing.
- Reprints reuse posted sale amounts and payment rows. Ordinary completed sales
  also use frozen customer, site, cashier, product-name/SKU, company
  name/tax/contact, customer tax-ID, ordinary template layout, logo source, and
  locale values. The identity and presentation snapshot versions distinguish
  intentionally empty checkout fields or an absent template from a historical
  row; only pre-migration rows fall back to current related records and
  presentation. Fiscal reprints additionally use the frozen fiscal buyer,
  line, total, currency, locale, and emission-time snapshots rather than
  mutable customer or product joins, but their declarative template remains
  selected from the current fiscal configuration.
  Fiscal evidence is appended as a non-removable proof section: mock/draft
  documents show local identifier, resolution, maturity, and an explicit
  non-transmission notice; authority URLs and QR codes remain unavailable
  until the provider pack is certified.
- The ordinary logo snapshot preserves the configured URL or `data:image`
  source string. An inline data image therefore remains self-contained; a
  remote URL can still change or disappear outside Puntovivo and is not a
  retained copy of external bytes.

## Current editor behavior

The block list supports pointer drag-and-drop and keyboard reordering with
`@dnd-kit/core` and `@dnd-kit/sortable`. The dedicated grip keeps the title and
up/down controls independently operable. Reordering uses
`apps/web/src/lib/flipAnimate.ts`; reduced-motion users receive an instant
transition instead of animation.

The text editor is CodeMirror 6 in
`apps/web/src/features/receipt-templates/TextBlockEditor.tsx`. It provides paired
substitution braces, syntax highlighting, namespace/property/function
completion, and translated inline validation. The editor and server keep
parity tests for their grammar limits and whitelists. Authoring UI is lazy-loaded
with the administrative receipt-template route; historical build sizes are not
current performance evidence.

### Expression contract

Inside `{{ … }}`, an expression can be a dotted path, number/string literal,
or a whitelisted function call with bounded nesting. The parser is not a
JavaScript interpreter and cannot access host globals.

| Function                                         | Purpose                                                     |
| ------------------------------------------------ | ----------------------------------------------------------- |
| `currency(value, decimals?)`                     | Format through the receipt's locale-aware amount formatter. |
| `date(value, pattern?)`                          | Format an ISO string, date or Unix-millisecond value.       |
| `upper(value)` / `lower(value)`                  | Change text case.                                           |
| `round(value, decimals?)`                        | Round a numeric expression for display.                     |
| `limit(value, n)`                                | Limit Unicode characters, adding an ellipsis when it fits.  |
| `concat(a, b, …)`                                | Concatenate scalar values.                                  |
| `default(value, fallback)`                       | Use the fallback for null, undefined or blank text.         |
| `abs(value)`                                     | Absolute numeric value.                                     |
| `max(a, b, …)` / `min(a, b, …)` / `sum(a, b, …)` | Numeric aggregation.                                        |

Parser bounds are `MAX_EXPRESSION_LENGTH=200`, `MAX_FUNCTION_ARGS=8`,
`MAX_RECURSION_DEPTH=4` and `MAX_DECIMALS=20`. Arity and namespace validation
apply before saving and again when evaluating. Conditional functions
`if/eq/gt` are not implemented. Formatting functions affect receipt presentation,
not persisted financial calculation.

`currency()` uses the renderer callback; an explicit decimal argument is clamped
to 0–20. `date()` supports `yyyy / MM / dd / HH / mm / ss` tokens and the receipt
locale's `dateFormatShort`, falling back to `yyyy-MM-dd`.
`limit("hola mundo", 9)` returns `"hola m..."`.

The renderer resolves only own object properties, not prototype-chain fields.
The evaluator returns plain text; `resolveAndEscape` applies HTML escaping
after evaluation. Scanner sources are checked both while validating string
literals and after resolution so string concatenation cannot bypass URL-scheme
restrictions.

### Variable availability and branding

The administrative `receiptTemplates.variableAvailability` procedure reports
setup availability for `company`, `sale`, `item`, `fiscal` and `tender`.
Sale/item/tender fields are generally available at render time; optional company
values depend on the tenant row, and fiscal hints depend on the enabled fiscal
setting. These hints do not certify a provider or guarantee a value for every
sale. Unset variables appear dimmed in the editor with a translated explanation;
syntax errors can independently carry an error marker. The query uses a 60-second
stale window and updates editor decorations without remounting the field.

The `appFooter` block draws Puntovivo, its URL and support contact from
`APP_FOOTER_METADATA`. Both renderers honor `show: false`. It appears in default
presets and can be removed or hidden. Customer receipts do not print a fixed
application version because no sale-time application-version snapshot exists.
A remote logo URL snapshot is a saved reference, not an archive of its bytes.

## Cash handover evidence and historical widths

At completion, a single cash payment freezes the amount handed over and the
change returned separately from the net payment and cash-session income.
The tenders block with `showChange` displays this evidence in HTML, ESC/POS
and shared text. Drafts do not capture a handover; split and non-cash payments
do not infer one. Receipts created before these nullable snapshots retain their
legacy behavior without an invented cash-received amount.

An ordinary receipt keeps the presentation and paper width saved when its sale
completed. Selecting a new 58mm template affects new sales; it does not rewrite
an existing 80mm receipt. For system printing, select matching paper dimensions
in the operating system printer settings. Software PDF measurements do not
establish the printable width or feed behavior of a physical printer.

ESC/POS uses the selected peripheral's configured paper width to reflow the
saved receipt content into 32 or 48 columns. That rendering override does not
rewrite the sale's presentation snapshot. A queued job retains the bytes
captured when it was enqueued; changing a template does not regenerate it.
