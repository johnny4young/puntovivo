# Receipt Templates — Visual Editor

> Status: **Shipped — Iter 2 of the April 22, 2026 plan**
> Originally drafted: April 21, 2026; landed: April 22, 2026

Lets an administrator visually choose and edit the layout of POS
receipts, quotations, and (once fiscal lands) the DEE/FEV print
representation — without touching code or CSS.

## Why

- Different tenants have different branding (logo, colours, footer message).
- Paper width varies by hardware (58mm vs 80mm thermal vs letter PDF).
- Optional sections come and go: tenders block, per-line VAT column,
  DIAN QR code (once fiscal lands), suggested tip (restaurants).

## Design principle: declarative layout, no free HTML

The template is a **structured JSON** (`ReceiptLayout`), not a blob of
HTML. Every visible element is one of a fixed set of **atomic blocks**
with its own validated options. The renderer
(`packages/server/src/services/receipt-renderer.ts`) builds HTML (for
`webContents.print`) and an ESC/POS byte stream (for the thermal driver
that lands in Iter 4) from the same layout.

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

| Block | Fields |
|---|---|
| `logo` | `align?`, `maxHeightMm?` |
| `text` | `value` (≤ 500 chars), `style?` (`title` / `subtitle` / `normal` / `muted` / `monospace`), `align?`, `bold?` |
| `itemsTable` | `columns` (1-6 of `name` / `qty` / `unitPrice` / `taxPercent` / `discount` / `total`), `showHeader?` |
| `totalsBlock` | `show` (1-5 of `subtotal` / `discount` / `taxTotal` / `tip` / `grandTotal`) |
| `tendersTable` | `showChange?` |
| `qr` | `source` (whitelisted vars only, no JS schemes), `sizeMm?` (10-60) |
| `separator` | `char?` (default `-`, max 4 chars) |
| `barcode128` | `source` (whitelisted vars only), `heightMm?` (8-40) |

The QR and barcode blocks emit a placeholder element today; the actual
rasterization lands with the ESC/POS driver in Iter 4 (the
`EscPosPrinterAdapter` will swap the placeholder for a real `GS ( k`
sequence).

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

`packages/server/src/db/schema.ts` declares:

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

The partial unique index lives in the hand-appended Drizzle migration
`0001_receipt_templates.sql`, because Drizzle's SQLite dialect cannot
generate `WHERE` clauses for unique indexes today. The service layer
additionally enforces the invariant inside transactions: any insert/promote
that would create a second default first demotes the prior one in the same
statement.

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
path used at print time, so the preview and the production output are
guaranteed to agree.

### Renderer service (shared server + client)

`packages/server/src/services/receipt-renderer.ts` exports
`renderReceipt(layout: ReceiptLayout, data: RenderData): { html, escpos }`.
Pure, deterministic, no I/O. Testable with fixture data; used at edit
time (preview), at receipt print time, and in unit tests.

`buildPreviewData(kind)` synthesizes a deterministic mock dataset so
the editor preview is stable across reloads.

## UI

`/receipt-templates` — admin only (registered in `App.tsx` with
`adminOnlyRoles`, sidebar entry under **Setup**).

The page has two modes kept in local state:

1. **List** — paginated table grouped by kind, with per-row actions:
   *Edit* (opens the inline editor in mode 2), *Set as default*
   (mutates the selected row to `isDefault=true` atomically),
   *Duplicate* (creates a copy with " (copy)" suffix, never inheriting
   the default flag), *Delete* (modal confirmation; refuses when the
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
     freezing English strings into Spanish sessions.

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
- At real print time the items come from the actual sale handed to
  `renderReceipt(layout, data)` by whoever calls it (today the web
  receipt-printer path in Iter 2; future Iter 7 reprint and Iter 4
  ESC/POS adapter).
- **UX gap**: the editor does not surface this binding explicitly
  today. An operator who expects a "pick an SKU list" or "filter by
  category" has to read the docs. Tracked in the follow-up list below
  as *itemsTable binding caption*.

### `totalsBlock`

- The block renders N labelled lines, one per entry in its `show`
  array (any subset of `subtotal`, `discount`, `taxTotal`, `tip`,
  `grandTotal`). Each label is a translated string from the
  `editor.totalsLines.*` i18n namespace; each value comes from the
  corresponding scalar on the current sale snapshot:

  | Line | Source field | Computed by |
  |---|---|---|
  | `subtotal` | `sale.subtotal` | Sum of `line.total` (gross per line minus per-line discount) converted to the pre-tax base (`line.total / (1 + taxRate/100)`) summed across lines. |
  | `discount` | `sale.discount` | Sum of per-line discount amounts. |
  | `taxTotal` | `sale.taxTotal` | `sale.subtotal` × effective VAT rate by line, summed. |
  | `tip` | `sale.tip` | Tip captured at checkout (restaurants). |
  | `grandTotal` | `sale.grandTotal` | `subtotal + taxTotal + tip − discount`. The value the customer pays. |

  All of these values are pre-computed when the sale is built (see
  `computeQuotationTotals` for the equivalent quotation path and the
  sales service for the sale path). The renderer never recomputes
  totals — it just formats the pre-computed numbers. That's
  intentional: the receipt must match the posted sale to the cent.

- **UX gap**: the editor shows "Subtotal / Tax / Total" checkboxes but
  does not explain where those numbers come from. Tracked as
  *totalsBlock documentation caption* below.

## Default presets

`apps/web/src/features/receipt-templates/defaultLayouts.ts` ships
ready-to-use presets per kind so the editor never starts blank:

- `sale` — 80mm thermal layout (logo + company header + items + totals
  + tenders + thank-you footer).
- `quotation` — letter layout with discount column and itemized totals.
- `fiscal_dee` — 80mm thermal with QR + CUFE footer for Colombia DIAN
  DEE (placeholder values until Iter 3 Fase A wires the snapshot).

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

Web (i18n parity + lint + build).

## Files

```
packages/server/src/db/schema.ts                                 # receiptTemplates table + enums
packages/server/src/db/index.ts                                  # raw DDL + partial unique
packages/server/src/db/migrations/0001_receipt_templates.sql     # Drizzle migration (partial unique appended)
packages/server/src/lib/errorCodes.ts                            # RECEIPT_TEMPLATE_* codes
packages/server/src/services/receipt-templates.ts                # CRUD + default-flip transactions
packages/server/src/services/receipt-renderer.ts                 # pure renderReceipt
packages/server/src/trpc/schemas/receiptTemplates.ts             # Zod ReceiptLayout
packages/server/src/trpc/routers/receiptTemplates.ts             # admin tRPC procedures
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

## Wiring with later iterations

- **Iter 4 (Hardware POS)** swaps the QR/barcode placeholders for real
  raster bytes via `EscPosPrinterAdapter`, and routes the print job
  through ESC/POS instead of `webContents.print` when the operator
  configures a thermal driver. The renderer surface stays unchanged.
- **Iter 7 (Reimpresión)** reuses the same `renderReceipt` to produce
  the HTML for a re-print, ensuring re-prints look identical to the
  original.
- **Iter 3 Fase A (Fiscal DIAN)** populates `fiscal.cufe`,
  `fiscal.qrUrl`, `fiscal.resolution` and `fiscal.documentNumber` from
  the immutable `fiscal_documents` snapshot when emitting a DEE/FEV.

## Follow-up improvements (tracked — April 22, 2026 feedback)

The following improvements were raised by the user after the initial
Iter 2 shipped. They are **not** implemented yet; they are captured
here so the next pass on the editor picks them up in order. Each item
carries a short rationale + implementation sketch so an engineer can
estimate without re-deriving the context.

### 1. Drag-and-drop reordering with animation

Currently blocks reorder via `↑` / `↓` buttons (one position at a
time, instant). The follow-up:

- Adopt **`@dnd-kit/sortable`** (already referenced in an earlier
  draft of the plan) for pointer + keyboard drag-drop reordering of
  the block list. Keep `↑` / `↓` buttons as an a11y fallback.
- Animate the drop and the keyboard move with a short (~150ms)
  `transform` transition on the block card so the user can follow
  where the block moved (otherwise on long lists the reorder is
  visually lossy).
- Package add: `@dnd-kit/core` + `@dnd-kit/sortable`. Bundle cost ~8kB
  gzipped.

### 2. `text.value` field — authoring UX

Today `text.value` is a plain `<textarea>`. Follow-up work:

- **Auto-close pairs**: typing `{{` inserts `}}` with the caret
  between. Typing a trailing `}` against an existing `}}` swallows
  the extra character (standard pair-matching like IDE editors).
- **Syntax highlighting**: color the `{{namespace.path}}` tokens
  distinctly from literal text. Reuse a lightweight code-editor
  component (CodeMirror 6 headless mode or a custom contenteditable
  tokenizer — CodeMirror is heavier but gives us autocomplete for
  free).
- **Autocomplete**:
  - After typing `{{`, show a dropdown of the 5 allowed namespaces
    (`company`, `sale`, `item`, `fiscal`, `tender`) filtered by what
    the operator has typed so far.
  - After the operator selects a namespace and types `.`, show the
    known properties of that namespace from a static list
    (`company.name`, `company.taxId`, ...) — same list the docs
    enumerate, shared between the editor and the Zod whitelist so
    they can never drift.
- **Inline error reporting**: when the Zod schema rejects a value
  (unknown namespace, > 500 chars, JS scheme), show a red underline
  + tooltip on the offending token. The Zod issue `path` already
  points at the failing block; translate its `message` through the
  existing `translateServerError` helper for localized errors.
- Expose the whitelist of namespaces + properties from
  `trpc/schemas/receiptTemplates.ts` (currently only the namespace
  names are exported) so the autocomplete and the validator read
  from one source.

### 3. Template functions (basic → advanced)

Today the template grammar is limited to `{{namespace.path}}`
substitution. Market tools (JasperReports, Crystal Reports,
Metabase, Grafana templating, Siigo/Alegra receipt builders) all ship
a small function library. Start with a conservative whitelist:

- **Formatters**: `currency(value, locale?)`, `date(value,
  pattern?)`, `upper(value)`, `lower(value)`, `round(value,
  decimals)`.
- **Aggregations / math**: `max(a, b, ...)`, `min(a, b, ...)`,
  `sum(a, b, ...)`, `abs(a)`.
- **String**: `limit(value, n)` — the canonical example from the
  user feedback: `limit("hola mundo", 9)` returns `"hola m..."`
  (truncate to `n` chars, append `...` if truncated). Also
  `concat(a, b, ...)`, `default(value, fallback)`.
- **Conditional** (later): `if(cond, then, else?)`, `eq(a, b)`,
  `gt(a, b)`.

**Implementation path**:

- Grammar: parse `{{ function(arg1, arg2, {{variable}}) }}` — a
  one-level expression inside the moustaches. Either hand-roll a
  small recursive-descent parser (ASTs stay shallow, no precedence)
  or use a tiny library (e.g. `jexl`, `expressionparser`).
- Zod: validate at save time that every function name is in a
  whitelist and argument counts match. Adding functions behind the
  whitelist means a malicious template cannot call `eval`-equivalent
  helpers.
- Renderer: evaluate the AST at substitution time with the same
  variable-resolution context that already exists; each function is
  a pure TS implementation with no I/O.
- Documentation: cheat-sheet inside the editor panel (a small "?"
  tooltip listing every available function with one example each).

Reference comparables worth studying before we lock in syntax:

- **JasperReports** — `$F{field}`, `$V{var}`, expressions in Java.
  Over-powered but battle-tested for fiscal receipts in LATAM.
- **Crystal Reports** — similar, older.
- **Siigo receipt templates** — moustache-like with functions like
  `@IMPUESTO` and `@DESCUENTO`. Closer to what we want.
- **Alegra receipt builder** — visual-only, limited expressions.
  Shows the "too simple" end of the spectrum.
- **Metabase pulses / Grafana templates** — excellent autocomplete
  but pipe-based (`{{variable | limit:9}}`). Worth copying the UX
  of the autocomplete popover.

### 4. Bindings documentation exposed in the editor

- Add a permanent caption above `itemsTable` in the editor that
  reads (translated): "Lines bound to the items of the current sale.
  Use the columns below to pick what gets printed." so the operator
  does not wonder "where does the list come from".
- Add a permanent caption above `totalsBlock` with the table of
  currently supported totals + where their values come from (same
  content as the "Data bindings" section of this doc, but in a
  tooltip / collapsible explainer).

### 5. Puntovivo-branded footer elements

Common in LATAM receipts: a footer row naming the POS software,
contact URL, version. Comparable implementations include Siigo's
"Software de facturación" footer and Alegra's "Generado con Alegra".
Follow-up work:

- Add a new atomic block type **`appFooter`** that renders (non
  editable, but toggleable):
  - App name + version (`Puntovivo 1.0.0`).
  - A short URL (e.g. `puntovivo.co`).
  - Contact email or support URL.
- Colombian DIAN Anexo 1.9 allows a free-text footer — this block
  complies with that while also giving Puntovivo organic brand
  surface. Include it in every default preset but tag it as
  toggleable so a tenant that wants a branding-free receipt can
  delete it.
- Legally required per some jurisdictions (e.g. if the software is
  part of the certified billing chain). Revisit in Iter 3 Fase A /
  Fase B to ensure it aligns with what DIAN expects the software
  identifier to look like.

### 6. Reorder animation and keyboard-move transitions

Even without full drag-and-drop (which is follow-up #1), the current
`↑` / `↓` buttons should animate the move so the user can see the
block traveled. CSS-only:

- Give the block list `LayoutGroup`-style FLIP animation (measure
  pre-move rect, apply inverse transform, tween to identity).
  React-spring or `framer-motion`'s `LayoutGroup` both do this.
  Bundle cost ~12kB for framer-motion but Puntovivo does not
  currently depend on it. Alternative: a small in-house FLIP helper
  (~50 LoC).
- Respect `prefers-reduced-motion` and make the tween instant for
  those users.
- Duration: ~180ms ease-out matches the rest of the UI's
  micro-interactions.

### 7. Explicit i18n/variable error strategy

Builds on follow-up #2:

- When the layout fails Zod validation at save time, focus the first
  offending block and highlight the offending token in red. Today
  we show a toast but the operator has to hunt for which block
  caused it.
- When a variable resolves to `undefined` at render time (e.g.
  `{{fiscal.cufe}}` on a tenant that hasn't enabled fiscal yet), the
  renderer renders the empty string. The editor preview should
  visually flag such substitutions (dimmed / italic / tooltip:
  "This variable is unset for the current tenant — will be empty in
  production") so the operator knows at design time.
- Optionally add a per-tenant "variable availability" endpoint so
  the editor knows which fiscal/company keys are populated and can
  warn accordingly.

### 8. Other improvements already noted

- WYSIWYG pixel-drag editor (declarative JSON still covers the core
  need, so this remains low priority).
- Per-site templates (today tenant-wide only). Useful when a chain
  has distinct branding per location.
- Import/export templates as JSON files for sharing between
  tenants.
- Nested / computed expressions beyond the basic functions in
  follow-up #3.
- Real raster QR / barcode emission (waits for Iter 4 hardware
  adapter and the `EscPosPrinterAdapter` GS ( k command).

### 9. Developer seed command (cross-cutting, separate ticket)

Independent of the editor, the user also requested a single command
to load a realistic test-data set so developers, QA, and early
customers can exercise the whole app without building the catalog
manually. Captured in its own design doc:
**[DEV-SEED.md](./DEV-SEED.md)**.
