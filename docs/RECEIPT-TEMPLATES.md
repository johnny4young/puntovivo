# Receipt Templates — Visual Editor

> Status: **Stub — design document for the "small task" in the April 2026 plan.**
> Created: April 21, 2026.

## Goal

Let an administrator visually choose and edit the layout of POS receipts,
quotations, and (once fiscal lands) the DEE/FEV print representation —
without touching code or CSS.

## Why

- Different tenants have different branding (logo, colours, footer message)
- Paper width varies by hardware (58mm vs 80mm thermal vs letter PDF)
- Optional sections come and go: tenders block, per-line VAT column,
  DIAN QR code (once fiscal lands), suggested tip (restaurants)

## Design principle: declarative layout, no free HTML

The template is a **structured JSON**, not a blob of HTML. Every visible
element is one of a fixed set of **atomic blocks** with its own validated
options. The renderer builds HTML (for `webContents.print`) and an
ESC/POS byte stream (for the thermal driver) from the same layout.

Security: there is **no mechanism** for a template to inject raw HTML or
arbitrary tags. Values referenced from the layout are HTML-escaped in
the renderer before any markup is built. Free-text fields are length-limited.

## Atomic blocks

- `logo` — company logo, centered, max height mm
- `text` — static text or `{variable}` interpolation, style: title | muted | monospace | normal, alignment
- `separator` — horizontal line
- `itemsTable` — line items with configurable columns: `name`, `qty`, `unitPrice`, `discount`, `taxPercent`, `total`
- `totalsBlock` — configurable set: `subtotal`, `discount`, `vatBreakdown`, `incBreakdown`, `tip`, `grandTotal`, `change`
- `tendersTable` — split payments
- `qr` — renders a QR from a whitelisted source variable (`fiscal.cufeUrl`, `sale.verificationUrl`)
- `barcode128` — renders a Code128 barcode
- `metaBlock` — key/value meta (sale number, date, cashier, site, customer)

## Whitelist of variables

Only variables under these namespaces can be interpolated in a `text`
block:

- `company.*` (legalName, taxId, address, phone, ...)
- `sale.*` (number, dateISO, cashier, site, customer, total, ...)
- `item.*` (inside `itemsTable` cells)
- `fiscal.*` (cufe, cufeUrl — populated when fiscal module is active)
- `tender.*` (inside `tendersTable`)

Any other variable fails Zod validation at save time.

## Domain

### Schema

```sql
CREATE TABLE receipt_templates (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sale', 'quotation', 'fiscal_dee', 'fiscal_fev', 'kitchen_ticket')),
  name TEXT NOT NULL,
  layout_json TEXT NOT NULL,        -- Zod-validated structure
  is_default INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### tRPC procedures

```
trpc.receiptTemplates.list(kind?)
trpc.receiptTemplates.getById(id)
trpc.receiptTemplates.create(input)
trpc.receiptTemplates.update(id, input)
trpc.receiptTemplates.delete(id)
trpc.receiptTemplates.setDefault(id)
trpc.receiptTemplates.duplicate(id)
trpc.receiptTemplates.renderPreview(id, sampleDataKind)  // returns HTML
```

### Renderer service (shared server + client)

```
packages/server/src/services/receipt-renderer.ts
  renderReceipt(layout, data): { html: string; escpos: Uint8Array }
```

Pure, deterministic, no I/O. Testable with fixture data.

## UI

`/setup/receipt-templates` — admin only.

Two-pane editor:

- **Left**: sortable list of blocks (`@dnd-kit/sortable`), each with an
  options panel (style, alignment, value, columns, ...)
- **Right**: **live preview** using mock sale data; updates in <100ms
- **Actions**: save, duplicate, set as default, test print, restore to
  system default

Constraints enforced in UI + Zod:

- Max 50 blocks per template
- Flat layout (no nesting)
- Max 500 chars per text block
- Paper width ∈ `{ '58mm', '80mm', 'letter', 'a4' }`

## Tests

- `renderReceipt.test.ts`: each block produces expected HTML and ESC/POS
- Snapshot: 15-item sale, 3 tenders, mixed VAT (19% + 5% + exempt), 10% tip
- **Security**: verify that `<script>`, `javascript:`, `onerror=` inside
  template values are neutralized (appear escaped in output, not as markup)
- Editor: drag adds/removes, preview updates, JSON round-trip stable
- i18n: all new strings exist in both `en` and `es` (parity test)

## Files (planned)

```
packages/server/src/db/schema.ts                        # receiptTemplates table
packages/server/src/db/index.ts                         # raw DDL
packages/server/src/trpc/schemas/receiptTemplates.ts    # Zod
packages/server/src/trpc/routers/receiptTemplates.ts    # CRUD + preview
packages/server/src/services/receipt-renderer.ts        # pure renderer

apps/web/src/features/receipt-templates/
  ReceiptTemplatesPage.tsx
  ReceiptTemplateEditor.tsx
  ReceiptTemplatePreview.tsx
  blocks/{LogoBlock,TextBlock,ItemsTableBlock,...}.tsx

apps/web/src/i18n/locales/{en,es}/receiptTemplates.json
```

## Out of scope (v1)

- WYSIWYG pixel-drag editor (declarative JSON covers the need)
- Per-site templates (tenant-wide only in v1)
- Import/export templates as JSON files
- Nested / computed expressions beyond simple variable interpolation
