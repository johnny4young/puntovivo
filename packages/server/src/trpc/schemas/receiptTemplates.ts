/**
 * Receipt Template Zod Schemas (Iter 2 — declarative editor + pure renderer).
 *
 * The `ReceiptLayout` is a closed, declarative shape: a flat array of
 * atomic blocks (no nesting, no free-form HTML, no script handlers).
 * Variable substitutions inside text-bearing fields are restricted to a
 * whitelist of namespaces so untrusted user input cannot reference
 * arbitrary properties at render time. The renderer (
 * `services/receipt-renderer.ts`) escapes every variable substitution
 * before HTML emission as a second line of defence.
 *
 * Hard limits chosen for safety + UX, not for performance:
 *  - ≤ 50 blocks per layout (the editor UI also enforces it)
 *  - ≤ 500 characters per text/value field (so a single block cannot
 *    bloat a thermal-printer job; ESC/POS rolls of 80mm paper handle
 *    ~32-48 chars per line so 500 chars is already ~10-15 printed lines)
 *  - 1 ≤ items-table column count ≤ 6
 *  - QR / barcode source strings ≤ 200 chars
 *
 * @module trpc/schemas/receiptTemplates
 */

import { z } from 'zod';
import {
  receiptTemplateKindEnum,
  receiptTemplatePaperWidthEnum,
} from '../../db/schema.js';

export const receiptTemplateKindSchema = z.enum(receiptTemplateKindEnum);
export const receiptTemplatePaperWidthSchema = z.enum(
  receiptTemplatePaperWidthEnum
);

/**
 * Variable references look like `{{namespace.path}}` and must resolve
 * to one of the supported namespaces. The renderer is responsible for
 * the dot-path lookup; the schema only validates the surface form.
 *
 * Allowed namespaces:
 *  - `company.*` — tenant company snapshot (name, taxId, address, …)
 *  - `sale.*` — sale-level fields (saleNumber, createdAt, totals, …)
 *  - `item.*` — line-level fields (only valid inside `itemsTable`)
 *  - `fiscal.*` — fiscal document fields (cufe, qrUrl, …)
 *  - `tender.*` — payment-tender fields (only valid inside `tendersTable`)
 */
const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)\s*\}\}/g;
const ALLOWED_NAMESPACES = new Set([
  'company',
  'sale',
  'item',
  'fiscal',
  'tender',
]);
/**
 * Reject any URL that uses a JS-executable scheme. Used as a guard on
 * `qr.source` and `barcode128.source` so an admin cannot configure a
 * template that, when rendered into a QR PNG and scanned, would point
 * a phone at `javascript:` or `data:text/html`.
 */
const DISALLOWED_URL_SCHEME = /^(javascript|data|vbscript|file):/i;

function validateVariableWhitelist(
  value: string,
  ctx: z.RefinementCtx
): void {
  for (const match of value.matchAll(VARIABLE_PATTERN)) {
    const path = match[1];
    if (!path) continue;
    const namespace = path.split('.', 1)[0];
    if (!namespace || !ALLOWED_NAMESPACES.has(namespace)) {
      ctx.addIssue({
        code: 'custom',
        message: `Variable {{${path}}} references unknown namespace "${namespace ?? ''}". Allowed: ${Array.from(ALLOWED_NAMESPACES).join(', ')}`,
      });
    }
  }
}

/** Common to all blocks. */
const blockAlignSchema = z.enum(['left', 'center', 'right']).optional();

const logoBlockSchema = z.object({
  type: z.literal('logo'),
  align: blockAlignSchema,
  maxHeightMm: z.number().finite().min(5).max(50).optional(),
});

const textBlockSchema = z.object({
  type: z.literal('text'),
  value: z
    .string()
    .max(500, 'Text block cannot exceed 500 characters')
    .superRefine((value, ctx) => {
      validateVariableWhitelist(value, ctx);
    }),
  style: z.enum(['title', 'subtitle', 'normal', 'muted', 'monospace']).optional(),
  align: blockAlignSchema,
  bold: z.boolean().optional(),
});

const itemsTableColumnSchema = z.enum([
  'name',
  'qty',
  'unitPrice',
  'taxPercent',
  'discount',
  'total',
]);

const itemsTableBlockSchema = z.object({
  type: z.literal('itemsTable'),
  columns: z
    .array(itemsTableColumnSchema)
    .min(1, 'itemsTable must show at least one column')
    .max(6, 'itemsTable cannot exceed 6 columns'),
  showHeader: z.boolean().optional(),
});

const totalsLineSchema = z.enum([
  'subtotal',
  'discount',
  'taxTotal',
  'tip',
  'grandTotal',
]);

const totalsBlockSchema = z.object({
  type: z.literal('totalsBlock'),
  show: z
    .array(totalsLineSchema)
    .min(1, 'totalsBlock must show at least one line')
    .max(5),
});

const tendersTableBlockSchema = z.object({
  type: z.literal('tendersTable'),
  showChange: z.boolean().optional(),
});

const qrBlockSchema = z.object({
  type: z.literal('qr'),
  source: z
    .string()
    .min(1)
    .max(200)
    .superRefine((value, ctx) => {
      validateVariableWhitelist(value, ctx);
      const literalValue = value.replace(VARIABLE_PATTERN, '').trim();
      if (literalValue && DISALLOWED_URL_SCHEME.test(literalValue)) {
        ctx.addIssue({
          code: 'custom',
          message: `qr.source uses a disallowed URL scheme. javascript:, data:, vbscript: and file: are not permitted.`,
        });
      }
    }),
  sizeMm: z.number().finite().min(10).max(60).optional(),
});

const separatorBlockSchema = z.object({
  type: z.literal('separator'),
  char: z.string().min(1).max(4).optional(),
});

const barcode128BlockSchema = z.object({
  type: z.literal('barcode128'),
  source: z
    .string()
    .min(1)
    .max(200)
    .superRefine((value, ctx) => {
      validateVariableWhitelist(value, ctx);
    }),
  heightMm: z.number().finite().min(8).max(40).optional(),
});

/**
 * ENG-016 pass 1 (item #5) — Puntovivo-branded footer block.
 *
 * Non-editable atomic block. Renders the `Puntovivo` name, version, and
 * contact URL resolved from `APP_FOOTER_METADATA` in
 * `services/receipt-renderer.ts`.
 *
 * Toggleable: when `show: false` the block is retained in the layout
 * but renders nothing, letting admins hide the block without deleting
 * it (useful for branding-free invoice prints). `show` defaults to
 * `true` on create.
 *
 * Common in LATAM receipts (Siigo, Alegra, etc.) and allowed under
 * DIAN Anexo 1.9 free-text footer rules.
 */
const appFooterBlockSchema = z.object({
  type: z.literal('appFooter'),
  show: z.boolean().optional(),
  align: blockAlignSchema,
});

export const receiptBlockSchema = z.discriminatedUnion('type', [
  logoBlockSchema,
  textBlockSchema,
  itemsTableBlockSchema,
  totalsBlockSchema,
  tendersTableBlockSchema,
  qrBlockSchema,
  separatorBlockSchema,
  barcode128BlockSchema,
  appFooterBlockSchema,
]);

export type ReceiptBlock = z.infer<typeof receiptBlockSchema>;

export const receiptLayoutSchema = z.object({
  paperWidth: receiptTemplatePaperWidthSchema,
  blocks: z
    .array(receiptBlockSchema)
    .min(1, 'A layout must contain at least one block')
    .max(50, 'A layout cannot contain more than 50 blocks'),
});

export type ReceiptLayout = z.infer<typeof receiptLayoutSchema>;

// ---------------------------------------------------------------------------
// CRUD inputs
// ---------------------------------------------------------------------------

const templateNameSchema = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(100, 'Name cannot exceed 100 characters');

export const createReceiptTemplateInput = z.object({
  kind: receiptTemplateKindSchema,
  name: templateNameSchema,
  layout: receiptLayoutSchema,
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const updateReceiptTemplateInput = z.object({
  id: z.string().min(1, 'Template ID is required'),
  name: templateNameSchema.optional(),
  layout: receiptLayoutSchema.optional(),
  isActive: z.boolean().optional(),
});

export const deleteReceiptTemplateInput = z.object({
  id: z.string().min(1, 'Template ID is required'),
});

export const getReceiptTemplateInput = z.object({
  id: z.string().min(1, 'Template ID is required'),
});

export const listReceiptTemplatesInput = z
  .object({
    kind: receiptTemplateKindSchema.optional(),
    includeInactive: z.boolean().optional(),
    limit: z.number().int().positive().max(200).optional(),
  })
  .optional();

export const setDefaultReceiptTemplateInput = z.object({
  id: z.string().min(1, 'Template ID is required'),
});

export const duplicateReceiptTemplateInput = z.object({
  id: z.string().min(1, 'Template ID is required'),
  name: templateNameSchema.optional(),
});

const receiptRenderLabelsInput = z.object({
  documentTitle: z.string().trim().min(1).max(100),
  itemColumns: z.object({
    name: z.string().trim().min(1).max(50),
    qty: z.string().trim().min(1).max(50),
    unitPrice: z.string().trim().min(1).max(50),
    taxPercent: z.string().trim().min(1).max(50),
    discount: z.string().trim().min(1).max(50),
    total: z.string().trim().min(1).max(50),
  }),
  totalsLines: z.object({
    subtotal: z.string().trim().min(1).max(50),
    discount: z.string().trim().min(1).max(50),
    taxTotal: z.string().trim().min(1).max(50),
    tip: z.string().trim().min(1).max(50),
    grandTotal: z.string().trim().min(1).max(50),
  }),
  tendersTable: z.object({
    method: z.string().trim().min(1).max(50),
    reference: z.string().trim().min(1).max(50),
    amount: z.string().trim().min(1).max(50),
    change: z.string().trim().min(1).max(50),
  }),
});

export const renderPreviewReceiptTemplateInput = z.object({
  id: z.string().min(1).optional(),
  /**
   * Inline layout for live editor previews — lets the editor render the
   * unsaved draft without a round-trip through `update`. When provided,
   * `id` is optional and only used to resolve the `kind` for the mock
   * data set.
   */
  layout: receiptLayoutSchema.optional(),
  kind: receiptTemplateKindSchema.optional(),
  labels: receiptRenderLabelsInput.optional(),
});

export type CreateReceiptTemplateInput = z.infer<typeof createReceiptTemplateInput>;
export type UpdateReceiptTemplateInput = z.infer<typeof updateReceiptTemplateInput>;
export type DeleteReceiptTemplateInput = z.infer<typeof deleteReceiptTemplateInput>;
export type GetReceiptTemplateInput = z.infer<typeof getReceiptTemplateInput>;
export type ListReceiptTemplatesInput = z.infer<typeof listReceiptTemplatesInput>;
export type SetDefaultReceiptTemplateInput = z.infer<
  typeof setDefaultReceiptTemplateInput
>;
export type DuplicateReceiptTemplateInput = z.infer<
  typeof duplicateReceiptTemplateInput
>;
export type RenderPreviewReceiptTemplateInput = z.infer<
  typeof renderPreviewReceiptTemplateInput
>;
export type ReceiptRenderLabelsInput = z.infer<typeof receiptRenderLabelsInput>;
