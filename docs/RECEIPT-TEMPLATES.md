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

### 1. Drag-and-drop reordering with animation — **shipped (ENG-016 pass 2)**

Shipped as part of ENG-016 pass 2:

- Adopted `@dnd-kit/core` + `@dnd-kit/sortable` (~8kB gzipped, no peer
  conflicts on React 19). Wrapped the block list with `<DndContext>` +
  `<SortableContext>` (vertical strategy); `PointerSensor` (4px
  activation distance to avoid accidental drags) and `KeyboardSensor`
  (with `sortableKeyboardCoordinates`) cover both input modalities.
- Each block row is rendered through a new internal `SortableBlockRow`
  subcomponent in `ReceiptTemplateEditor.tsx` that calls `useSortable`
  and applies `transform` + `transition` to the `<li>`. Drag listeners
  attach to a dedicated grip icon (`GripVertical` lucide) at the start
  of the row so the row title stays clickable for selection and the
  `↑/↓` buttons stay clickable for the a11y fallback.
- A `<DragOverlay>` portal renders the dragged card clone with the
  same active styling so the user can clearly track what they're
  moving.
- The `onDragEnd` handler routes through a new `moveBlockTo(fromIndex,
  toIndex)` helper that mirrors the keyboard `moveBlock` semantics —
  it captures a FLIP snapshot before the state mutation so pass-1's
  reusable `flipAnimate` helper plays the post-drop landing
  transition through the same `useLayoutEffect` path.
- New i18n keys under `editor.dragAndDrop.*` (`gripAriaLabel`,
  `screenReaderInstructions`) in both `en/` and `es/` (neutral LATAM
  Spanish per AGENTS.md).
- Three new component tests in `ReceiptTemplateEditor.test.tsx` pin:
  grip aria-label presence on every row, `data-flip-key` survives the
  dnd-kit wrapping (regression gate for pass-1's FLIP), and the
  `↑/↓` buttons coexist with the grip per row.

### 2. `text.value` field — authoring UX — **shipped (ENG-016 pass 4)**

Shipped as part of ENG-016 pass 4 via CodeMirror 6 adoption:

- **Auto-close pairs**: a custom `EditorView.inputHandler` watches
  for a `{` keystroke that immediately follows another `{` and
  swaps it for `{}}` with the caret between the closing braces.
  CM6's built-in `closeBrackets` only supports single-char pairs,
  so the multi-char `{{` ↔ `}}` case is handled explicitly. The
  handler is unit-tested via direct facet invocation in
  `TextBlockEditor.test.tsx`.
- **Syntax highlighting**: a `StreamLanguage` tokenizer in
  `templateLanguage.ts` emits `bracket`, `variableName`,
  `function(variableName)`, `string`, `number`, `punctuation`, and
  `invalid` tags via `@lezer/highlight`. The accompanying
  `HighlightStyle` paints brackets purple, namespaces teal,
  function names blue, strings amber, numbers magenta, and stray
  characters red with a wavy underline. Default CM6 themes (light
  + one-dark) inherit the same tag set so the palette stays
  legible across themes.
- **Autocomplete**: a `CompletionSource` in
  `templateAutocomplete.ts` inspects the cursor position via
  `getActiveSubstitution(text, cursor)` and emits suggestions:
  - Right after `{{` (no dot yet): the 5 allowed namespaces +
    the 12 whitelisted function names (each with a colored badge).
  - After a `.` following a known namespace: only that
    namespace's documented properties (catalog hardcoded in
    `NAMESPACE_PROPERTIES`).
  - Inside a function-call argument: still surfaces namespaces +
    properties so nested `{{ currency(sale.| ) }}` works.
  - Filtered by `validFor: /^[A-Za-z0-9_]*$/` so CM6's typing-
    filter stays consistent with the namespace/property identifier
    shape.
- **Inline error reporting**: a CM6 `linter()` extension in
  `templateLinter.ts` runs on every doc change and emits
  `Diagnostic` markers per validation issue: unknown namespace
  (range = the namespace token), unknown function (range = the
  function name), wrong arity (range = the call's `(` to `)`), or
  unparseable expression (range = the whole `{{…}}`). Messages
  are translatable through the same i18next instance the editor
  already uses (`editor.codeEditor.linter.*` keys, neutral LATAM
  Spanish). The web-side parser duplicates the server's grammar
  to avoid pulling fastify/drizzle into the web bundle; two
  parity tests pin drift (function names on both sides + a
  `MAX_EXPRESSION_LENGTH=200` mirror of the server cap).
- **Whitelist source of truth**: `TEMPLATE_NAMESPACES` and
  `NAMESPACE_PROPERTIES` are exported from `templateAutocomplete.ts`.
  Server-side `ALLOWED_NAMESPACES` (in
  `trpc/schemas/receiptTemplates.ts`) is a read-only mirror of the
  same five names; the parity test on the server suite catches
  drift if either side is updated independently.

The new editor lives in `apps/web/src/features/receipt-templates/TextBlockEditor.tsx`
and is dropped into `ReceiptTemplateEditor.tsx`'s `text` block
form as a one-line replacement of the previous `<textarea>`. The
adoption added 9 deps (codemirror, @codemirror/{state, view,
language, autocomplete, lint, commands}, @lezer/highlight,
@uiw/react-codemirror), lazy-loaded into the admin-only
`/receipt-templates` route. The verified `npm run ci:web` build for
this pass emits `ReceiptTemplatesPage` at 493.00 kB / 158.00 kB gzip
and the main `index` chunk at 681.98 kB / 210.76 kB gzip.

**Remaining for item #2**: nothing. All four originally-listed
sub-features ship in pass 4.

### 3. Template functions (basic batch) — **shipped (ENG-016 pass 3)**

Shipped as part of ENG-016 pass 3:

- New module `packages/server/src/services/template-expression.ts`
  hosts a recursive-descent parser, AST evaluator, and a static
  whitelisted function registry. Inside any `{{ … }}` substitution,
  operators can now write a bare path (`namespace.field` — current
  behavior, unchanged), a number/string literal, or a single
  function call whose arguments may themselves be paths, literals,
  or one level of nested function call.
- 12 functions ship in the registry — formatters
  (`currency(value, decimals?)`, `date(value, pattern?)`,
  `upper(value)`, `lower(value)`, `round(value, decimals?)`),
  string helpers (`limit(value, n)`, `concat(a, b, …)`,
  `default(value, fallback)`), and math (`abs(value)`,
  `max(a, b, …)`, `min(a, b, …)`, `sum(a, b, …)`). The conditional
  family (`if/eq/gt`) was tagged "(later)" in the original spec and
  stays parked.
- `currency()` reuses the renderer's `formatReceiptAmount` callback
  so it inherits ENG-017's tenant-locale (COP 0 decimals, USD 2,
  CLP 0, etc.) without duplicating the `Intl.NumberFormat` config.
  An optional second argument forces a specific decimal count
  (capped at 20 — `Math.pow(10, 1000)` would otherwise produce
  `NaN` and silently lose the amount).
- `date()` takes ISO strings, `Date` instances, or unix-ms numbers.
  Pattern tokens are `yyyy / MM / dd / HH / mm / ss`; the default
  pattern is the tenant's `dateFormatShort` (now exposed on
  `ReceiptRenderLocale`) or `yyyy-MM-dd` when absent.
- `limit("hola mundo", 9)` returns `"hola m..."` per the canonical
  example the operator feedback called out. `default(empty, "Sin
  CUFE")` lets templates fall back to a literal when an optional
  field is unset (e.g. fiscal docs on a tenant without DIAN
  habilitation).
- Zod refinement parses the AST and rejects unknown function names,
  wrong arity, unknown variable namespaces, and (for `qr.source`)
  string literals matching the disallowed-URL-scheme regex — closes
  the `concat("javascript:", …)` bypass that the legacy regex-only
  literal-strip would have missed.
- Defense-in-depth: the renderer's `lookupPath` swapped from `seg in
  obj` to `Object.prototype.hasOwnProperty.call(obj, seg)` so
  prototype-chain segments (`__proto__`, `constructor`,
  `toString`) cannot leak through. The evaluator also re-checks
  arity before dispatch — a future caller that bypasses
  `validateTemplate` cannot trigger `Math.max(...[]) → -Infinity` or
  `default(only-one-arg)` reading `args[1] === undefined`.
- HTML escape boundary preserved: `resolveAndEscape` runs the
  template through the evaluator first, then HTML-escapes the whole
  concatenated result, so neither literal markup typed in
  `text.value` nor data pulled in via paths/functions can survive
  as live HTML. `default(sale.notes, "<script>alert(1)</script>")`
  emits `&lt;script&gt;alert(1)&lt;/script&gt;`.
- Editor: a collapsible `<details>` "Available functions"
  cheat-sheet sits below the `text.value` textarea, listing each
  function's signature + a one-line description (translatable via
  `editor.functionsHelp.entries.<name>`) + a canonical example.
  Items #2 and #7 will replace the static panel with rich
  autocomplete + inline error markers; until they land this gives
  operators a reference without leaving the editor.
- 50+ new tests: 46 in `template-expression.test.ts` covering
  tokenizer, parser, evaluator per function, validator per failure
  mode, and the prototype-chain / arity / decimals-clamp regressions
  surfaced by review; 12 in `receipt-templates.test.ts` covering
  HTML / ESC/POS rendering with functions, Zod rejections, and the
  default-preset byte-stream regression. All previously-shipped
  receipt-template tests still pass — the rewire is fully
  backward compatible for layouts that only use bare-path
  substitutions.

**Remaining**: the conditional family (`if/eq/gt`) stays parked
inside the broader ENG-016 "Remaining" list (items 2, 7, 8). Item
#2 (rich text-authoring UX) and item #7 (in-preview error markers)
will benefit from this AST: the autocomplete panel can introspect
the same `FUNCTION_REGISTRY`, and the error markers can highlight
the `raw` substring on each `ValidationIssue`.

Reference comparables worth studying before items #2 / #7 lock in
the autocomplete syntax:

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

### 4. Bindings documentation exposed in the editor — **shipped (ENG-016 pass 1)**

Shipped as part of ENG-016 pass 1:

- Permanent caption above `itemsTable` in the editor reads (translated):
  "Rows are bound to the items in the current sale. Use the columns
  below to pick which ones get printed." — so the operator does not
  wonder where the list comes from.
- Collapsible explainer above `totalsBlock` lists the supported
  totals (subtotal, discount, tax, tip, grand total) + where their
  values come from, gated behind a chevron so it does not clutter
  the editor by default.
- Both captions live under `apps/web/src/features/receipt-templates/ReceiptTemplateEditor.tsx` and are exercised by
  `ReceiptTemplateEditor.test.tsx`.

### 5. Puntovivo-branded footer elements — **shipped (ENG-016 pass 1)**

Shipped as part of ENG-016 pass 1:

- New atomic block type `appFooter` in the Zod schema (`packages/server/src/trpc/schemas/receiptTemplates.ts`) with fields
  `show: boolean?` + `align: 'left' | 'center' | 'right'?`.
- Renderer (`packages/server/src/services/receipt-renderer.ts`) emits
  three centered lines: `Puntovivo <version>`, URL, support contact.
  Metadata lives in `APP_FOOTER_METADATA`. HTML + ESC/POS both
  respect `show: false` as a soft hide.
- Included in every default preset — both the client-side editor
  starter layouts (`apps/web/src/features/receipt-templates/defaultLayouts.ts`) and the dev seed (`packages/server/src/db/seed-dev.ts`).
- Available from the "add block" menu; admins can toggle visibility
  or remove the block entirely for a branding-free receipt.
- Default footer content is intentionally stable across tenants (see
  §Risks in the ENG-016 pass 1 summary). White-label mode is a
  future ticket; the current design matches DIAN Anexo 1.9
  free-text footer rules.

### 6. Reorder animation and keyboard-move transitions — **shipped (ENG-016 pass 1)**

Shipped as part of ENG-016 pass 1:

- Small in-house FLIP helper at `apps/web/src/lib/flipAnimate.ts`
  (~60 LoC) — framework-agnostic so subsequent features can reuse
  it. Measures pre-move rect, applies inverse transform, tweens to
  identity at 180ms ease-out.
- `ReceiptTemplateEditor.tsx` captures a snapshot in `moveBlock`
  before React commits the reorder, then `useLayoutEffect` replays
  the FLIP against the block-list `<ul>` via `data-flip-key`
  attributes so each card visibly animates to its new slot.
- Respects `prefers-reduced-motion: reduce` — under that media
  query the helper short-circuits to an instant move, matching the
  original UX for users who opt out of motion.
- No new deps (Web Animations API via `Element.animate`).
- 9 unit tests in `apps/web/src/lib/__tests__/flipAnimate.test.ts`
  pin the decision logic (zero-delta skip, reduced-motion
  short-circuit, inverse transform, new-element skip, null
  container).

### 7. Explicit i18n/variable error strategy — **shipped (ENG-016 pass 4 + 5)**

**Pass 4** closed the parser-side bullet via the CM6 linter under
item #2: invalid syntax / unknown namespace / unknown function /
wrong arity surface as inline red markers with translatable hover
tooltips at edit time, alongside the existing Zod rejection at
save time.

**Pass 5** closed the runtime-hint bullets:

- **Variable availability endpoint** — new
  `receiptTemplates.variableAvailability` admin tRPC procedure in
  `packages/server/src/trpc/routers/receiptTemplates.ts`. Reads the
  active tenant's `companies` row + `tenants.settings.fiscal_dian_enabled`
  flag and returns:

  ```ts
  Record<'company' | 'sale' | 'item' | 'fiscal' | 'tender',
    Record<string, boolean>>
  ```

  Contract: `sale.*`, `item.*`, `tender.*` always return `true`
  (those values are populated on every sale at render time —
  per-row optional fields like `customer` are still surfaced
  because the editor cannot reason per-sale). `company.*` reflects
  actual column population (`name` always true, `taxId / address /
  phone / email` reflect the row, `city` pinned to false until a
  schema column lands). `fiscal.*` reflects the
  `fiscal_dian_enabled` flag.

- **Dimmed for unset variables** — new CodeMirror 6 Decoration
  extension at `apps/web/src/features/receipt-templates/templateUnavailableDecorations.ts`.
  Walks the buffer per change, finds every `{{ namespace.field }}`
  path token, and adds a `cm-variable-unavailable` class to those
  whose availability map resolves false. Style: `opacity: 0.55;
  font-style: italic; text-decoration: underline dotted #94a3b8`.
  Hover tooltip via CM6 `hoverTooltip` surfaces a translatable
  message (`editor.codeEditor.unavailableVariable`) with the
  offending path interpolated in.

  The decoration walker tolerates string literals (a quoted
  `"fiscal.cufe"` inside a `concat(...)` is NOT flagged), function
  call names (only the inner path inside a `currency(fiscal.cufe)`
  is flagged), unterminated `{{`, and stale availability maps that
  miss a namespace key (treated as available — defensive against
  over-dim).

- The decoration layer is added BEFORE the linter in the CM6
  extension array so a single token can carry both severities (a
  typo for an optional field shows the dim hint plus the red
  squiggle).

- `useVariableAvailability` hook (`templateAvailability.ts`) wraps
  the tRPC query with a 60s staleTime; `TextBlockEditor` accepts
  an `unavailableVariables` prop and dispatches a CM6 `StateEffect`
  to update the StateField without remounting on prop change.

Tests: 6 new server cases (fiscal flag enabled/disabled, optional
company columns populated/not, whitespace-only treated as unset,
manager + cashier rejected as admin-only) + 17 web pure-helper
tests (covering offset accuracy, nested function calls, escape
sequences, unterminated `{{`, defensive empty-map behavior) + 3
TextBlockEditor component tests asserting the dim class is
applied/skipped per prop. i18n parity green; voseo audit clean.

**Remaining**: nothing for item #7. All four originally-listed
sub-bullets ship across passes 4 + 5.

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
