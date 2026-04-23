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
  | 'barcode128';

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
      show: Array<'subtotal' | 'discount' | 'taxTotal' | 'tip' | 'grandTotal'>;
    }
  | { type: 'tendersTable'; showChange?: boolean }
  | { type: 'qr'; source: string; sizeMm?: number }
  | { type: 'separator'; char?: string }
  | { type: 'barcode128'; source: string; heightMm?: number };

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
    sale: {
      paperWidth: '80mm',
      blocks: [
        { type: 'logo', align: 'center', maxHeightMm: 18 },
        { type: 'text', value: '{{company.name}}', style: 'title', align: 'center' },
        {
          type: 'text',
          value: interpolateLabel(t('editor.defaults.taxIdLabel'), '{{company.taxId}}'),
          style: 'muted',
          align: 'center',
        },
        { type: 'text', value: '{{company.address}}', style: 'muted', align: 'center' },
        { type: 'separator' },
        {
          type: 'text',
          value: interpolateLabel(t('editor.defaults.saleNumberLabel'), '{{sale.saleNumber}}'),
        },
        {
          type: 'text',
          value: `${t('editor.defaults.cashierLabel')}: {{sale.cashier}}`,
          style: 'muted',
        },
        {
          type: 'text',
          value: `${t('editor.defaults.customerLabel')}: {{sale.customer}}`,
          style: 'muted',
        },
        { type: 'separator' },
        {
          type: 'itemsTable',
          columns: ['name', 'qty', 'unitPrice', 'total'],
        },
        { type: 'separator' },
        { type: 'totalsBlock', show: ['subtotal', 'taxTotal', 'grandTotal'] },
        { type: 'separator' },
        { type: 'tendersTable', showChange: true },
        { type: 'separator' },
        { type: 'text', value: t('editor.defaults.thankYou'), align: 'center', style: 'muted' },
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
      ],
    },
    fiscal_dee: {
      paperWidth: '80mm',
      blocks: [
        { type: 'text', value: '{{company.name}}', style: 'title', align: 'center' },
        {
          type: 'text',
          value: interpolateLabel(t('editor.defaults.taxIdLabel'), '{{company.taxId}}'),
          style: 'muted',
          align: 'center',
        },
        {
          type: 'text',
          value: interpolateLabel(
            t('editor.defaults.resolutionLabel'),
            '{{fiscal.resolution}}'
          ),
          style: 'muted',
          align: 'center',
        },
        { type: 'separator' },
        { type: 'text', value: '{{fiscal.documentNumber}}', style: 'subtitle', align: 'center' },
        { type: 'separator' },
        {
          type: 'itemsTable',
          columns: ['name', 'qty', 'unitPrice', 'taxPercent', 'total'],
        },
        { type: 'totalsBlock', show: ['subtotal', 'taxTotal', 'grandTotal'] },
        { type: 'separator' },
        { type: 'qr', source: '{{fiscal.qrUrl}}', sizeMm: 25 },
        { type: 'text', value: 'CUFE {{fiscal.cufe}}', style: 'monospace', align: 'center' },
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
    default: {
      const exhaustive: never = kind;
      void exhaustive;
      throw new Error(`Unknown block kind: ${String(kind)}`);
    }
  }
}
