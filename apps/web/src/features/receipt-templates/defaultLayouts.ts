/**
 * Default layouts shipped with the editor so a new tenant has something
 * usable on the first save without having to compose every block from
 * scratch. Each preset lines up with the `kind` enum of
 * `receipt_templates`.
 *
 * The editor builds these defaults from the active i18n language instead of
 * freezing English strings into newly-created templates. This keeps the
 * admin-facing experience coherent in Spanish while still persisting the
 * resulting layout as plain template data.
 */

export type ReceiptTemplateKind = 'sale' | 'quotation' | 'fiscal_dee';

export type ReceiptBlockKind =
  | 'logo'
  | 'text'
  | 'itemsTable'
  | 'totalsBlock'
  | 'tendersTable'
  | 'qr'
  | 'separator'
  | 'barcode128'
  | 'appFooter'
  // ENG-086 — Puntovivo brand wordmark and 2-column meta band.
  | 'wordmark'
  | 'metaTable';

export interface EditorMetaTableRow {
  key: string;
  value: string;
}

export type EditorReceiptBlock =
  | { type: 'logo'; align?: 'left' | 'center' | 'right'; maxHeightMm?: number }
  | {
      type: 'text';
      value: string;
      style?: 'title' | 'subtitle' | 'normal' | 'muted' | 'monospace';
      align?: 'left' | 'center' | 'right';
      bold?: boolean;
    }
  | {
      type: 'itemsTable';
      columns: Array<'name' | 'qty' | 'unitPrice' | 'taxPercent' | 'discount' | 'total'>;
      showHeader?: boolean;
    }
  | {
      type: 'totalsBlock';
      show: Array<
        | 'subtotal'
        | 'discount'
        | 'taxTotal'
        | 'tip'
        | 'serviceCharge'
        | 'grandTotal'
      >;
    }
  | { type: 'tendersTable'; showChange?: boolean }
  | { type: 'qr'; source: string; sizeMm?: number }
  | { type: 'separator'; char?: string }
  | { type: 'barcode128'; source: string; heightMm?: number }
  // ENG-016 pass 1 (item #5) — Puntovivo-branded footer block.
  // `show` defaults to `true`; setting it `false` keeps the block
  // in the layout but hides its rendered output (soft toggle).
  | { type: 'appFooter'; show?: boolean; align?: 'left' | 'center' | 'right' }
  // ENG-086 — Brand wordmark. No editable content; `show: false`
  // collapses the block without removing it from the layout.
  | { type: 'wordmark'; show?: boolean; align?: 'left' | 'center' | 'right' }
  // ENG-086 — Compact key/value band. Each row's `key` and `value`
  // accept the same `{{...}}` whitelist as `text.value`.
  | { type: 'metaTable'; rows: EditorMetaTableRow[] };

export interface EditorReceiptLayout {
  paperWidth: '58mm' | '80mm' | 'letter' | 'a4';
  blocks: EditorReceiptBlock[];
}

type Translate = (key: string) => string;

function cloneLayout(layout: EditorReceiptLayout): EditorReceiptLayout {
  return structuredClone(layout);
}

function interpolateLabel(label: string, variableRef: string): string {
  return `${label} ${variableRef}`;
}

export function buildDefaultLayouts(
  t: Translate
): Record<ReceiptTemplateKind, EditorReceiptLayout> {
  return {
    // ENG-086 — sale + fiscal_dee defaults match
    // `preview/25-print-thermal.html` from the 2026-05-15 handoff:
    // wordmark header band, compact metaTable for Factura / Fecha /
    // Caja, then the standard items + totals + tenders strip. Existing
    // tenant templates are untouched — the new structure only applies
    // to layouts created from these presets.
    sale: {
      paperWidth: '80mm',
      blocks: [
        { type: 'wordmark', show: true, align: 'center' },
        { type: 'text', value: '{{company.name}}', style: 'normal', align: 'center' },
        { type: 'text', value: '{{company.address}}', style: 'muted', align: 'center' },
        {
          type: 'text',
          value: interpolateLabel(t('editor.defaults.taxIdLabel'), '{{company.taxId}}'),
          style: 'muted',
          align: 'center',
        },
        {
          type: 'metaTable',
          rows: [
            { key: t('editor.defaults.saleNumberLabel'), value: '{{sale.saleNumber}}' },
            { key: t('editor.defaults.dateLabel'), value: '{{ date(sale.createdAt) }}' },
            { key: t('editor.defaults.cashierLabel'), value: '{{sale.cashier}}' },
            // The customer row drops automatically when the value
            // resolves to empty (anonymous walk-in sale), so existing
            // operators that relied on this surface stay covered for
            // B2B and credit-customer flows.
            { key: t('editor.defaults.customerLabel'), value: '{{sale.customer}}' },
          ],
        },
        { type: 'separator' },
        {
          type: 'itemsTable',
          columns: ['name', 'qty', 'unitPrice', 'total'],
        },
        { type: 'separator' },
        { type: 'totalsBlock', show: ['subtotal', 'taxTotal', 'grandTotal'] },
        { type: 'tendersTable', showChange: true },
        { type: 'separator' },
        { type: 'text', value: t('editor.defaults.thankYou'), align: 'center', style: 'muted' },
        // ENG-016 pass 1 (item #5) — Puntovivo-branded footer block.
        // Admins can toggle `show: false` to hide without deleting.
        { type: 'appFooter', show: true, align: 'center' },
      ],
    },
    quotation: {
      paperWidth: 'letter',
      blocks: [
        { type: 'text', value: '{{company.name}}', style: 'title', align: 'center' },
        {
          type: 'text',
          value: interpolateLabel(
            t('editor.defaults.quotationNumberLabel'),
            '{{sale.saleNumber}}'
          ),
          style: 'subtitle',
          align: 'center',
        },
        {
          type: 'text',
          value: `${t('editor.defaults.customerLabel')}: {{sale.customer}}`,
        },
        { type: 'separator' },
        {
          type: 'itemsTable',
          columns: ['name', 'qty', 'unitPrice', 'discount', 'total'],
        },
        { type: 'separator' },
        { type: 'totalsBlock', show: ['subtotal', 'discount', 'taxTotal', 'grandTotal'] },
        { type: 'appFooter', show: true, align: 'center' },
      ],
    },
    fiscal_dee: {
      paperWidth: '80mm',
      blocks: [
        { type: 'wordmark', show: true, align: 'center' },
        { type: 'text', value: '{{company.name}}', style: 'normal', align: 'center' },
        {
          type: 'text',
          value: interpolateLabel(t('editor.defaults.taxIdLabel'), '{{company.taxId}}'),
          style: 'muted',
          align: 'center',
        },
        {
          type: 'metaTable',
          rows: [
            { key: t('editor.defaults.documentLabel'), value: '{{fiscal.documentNumber}}' },
            { key: t('editor.defaults.resolutionLabel'), value: '{{fiscal.resolution}}' },
            { key: t('editor.defaults.dateLabel'), value: '{{ date(sale.createdAt) }}' },
          ],
        },
        { type: 'separator' },
        {
          type: 'itemsTable',
          columns: ['name', 'qty', 'unitPrice', 'taxPercent', 'total'],
        },
        { type: 'totalsBlock', show: ['subtotal', 'taxTotal', 'grandTotal'] },
        { type: 'separator' },
        { type: 'qr', source: '{{fiscal.qrUrl}}', sizeMm: 25 },
        { type: 'text', value: 'CUFE {{fiscal.cufe}}', style: 'monospace', align: 'center' },
        { type: 'appFooter', show: true, align: 'center' },
      ],
    },
  };
}

export function getDefaultLayout(
  kind: ReceiptTemplateKind,
  t: Translate
): EditorReceiptLayout {
  return cloneLayout(buildDefaultLayouts(t)[kind]);
}

export function createEmptyBlock(
  kind: ReceiptBlockKind,
  t: Translate
): EditorReceiptBlock {
  switch (kind) {
    case 'logo':
      return { type: 'logo', align: 'center', maxHeightMm: 18 };
    case 'text':
      return { type: 'text', value: t('editor.defaults.newText') };
    case 'itemsTable':
      return { type: 'itemsTable', columns: ['name', 'qty', 'unitPrice', 'total'] };
    case 'totalsBlock':
      return { type: 'totalsBlock', show: ['subtotal', 'taxTotal', 'grandTotal'] };
    case 'tendersTable':
      return { type: 'tendersTable', showChange: true };
    case 'qr':
      return { type: 'qr', source: '{{fiscal.qrUrl}}', sizeMm: 25 };
    case 'separator':
      return { type: 'separator' };
    case 'barcode128':
      return { type: 'barcode128', source: '{{sale.saleNumber}}', heightMm: 12 };
    case 'appFooter':
      // ENG-016 pass 1 (item #5) — new block defaults to visible +
      // centered; admins can toggle the `show` field from the form.
      return { type: 'appFooter', show: true, align: 'center' };
    case 'wordmark':
      // ENG-086 — wordmark defaults to visible + centered. There is no
      // editable copy because the wordmark is brand identity.
      return { type: 'wordmark', show: true, align: 'center' };
    case 'metaTable':
      // ENG-086 — start with a single row so the operator sees the
      // shape immediately; they can add up to 11 more before the Zod
      // 12-row cap kicks in.
      return {
        type: 'metaTable',
        rows: [{ key: t('editor.defaults.metaKey'), value: t('editor.defaults.metaValue') }],
      };
    default: {
      const exhaustive: never = kind;
      void exhaustive;
      throw new Error(`Unknown block kind: ${String(kind)}`);
    }
  }
}
