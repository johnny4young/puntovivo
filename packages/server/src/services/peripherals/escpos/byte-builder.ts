/**
 * Pure ESC/POS byte builder.
 *
 * Renders a structured `ReceiptDocument` (lines + alignment + cut +
 * optional drawer pulse) into a `Uint8Array` of canonical ESC/POS
 * commands. Pure module: zero I/O, zero native deps, fully unit
 * testable. Mirrors the purity convention of
 * `services/peripherals/barcode/parser.ts` () and
 * `services/fiscal/qr-builder.ts` ().
 *
 * The reference printer family is the Epson TM-T20/T88 + Xprinter
 * XP-58/XP-80 that dominate LATAM retail today; their bytes follow
 * the original Epson "ESC/POS Application Programming Guide". We
 * only emit the subset every modern thermal printer accepts:
 *
 * ESC @           init
 * ESC t n         select codepage
 * ESC a n         alignment (0=left, 1=center, 2=right)
 * ESC E n         bold (0=off, 1=on)
 * GS !  n         character size (low nibble width, high nibble height)
 * ESC p 0 25 250  drawer pulse (RJ11 connector pin 2/5)
 * GS V 0          full paper cut
 *
 * Codepage selection: cp858 is the LATAM default — Latin-1 with
 * EUR added at 0xD5. It encodes ñáéíóú correctly. cp437 is the
 * legacy default (ASCII only); cp850 is Spain's older default.
 *
 * @module services/peripherals/escpos/byte-builder
 */

// =============================================================================
// Types
// =============================================================================

export type ReceiptAlign = 'left' | 'center' | 'right';

export interface ReceiptLine {
  text: string;
  align?: ReceiptAlign;
  bold?: boolean;
  /** Render the line at 2× height (useful for the receipt total). */
  doubleHeight?: boolean;
}

export interface ReceiptDocument {
  /** Ordered top-to-bottom rows. An empty `text` emits a blank line. */
  lines: ReceiptLine[];
  /** Append a full cut (GS V 0) at the end. Defaults to true. */
  cut?: boolean;
  /** Append a drawer pulse (ESC p 0 25 250) before the cut. Defaults to false. */
  kickDrawer?: boolean;
}

export type EscPosCharset = 'cp437' | 'cp858' | 'cp850' | 'pc858_euro';

export interface BuildEscPosBytesOptions {
  paperWidth: '58mm' | '80mm';
  characterSet?: EscPosCharset;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * `ESC t n` codepage codes per the Epson reference. cp858 (n=19) is
 * the LATAM default; cp437 (n=0) is the legacy fallback; cp850
 * (n=2) is the older Spain default; pc858_euro is alias for cp858.
 */
const CHARSET_CODES: Record<EscPosCharset, number> = {
  cp437: 0,
  cp850: 2,
  cp858: 19,
  pc858_euro: 19,
};

const COLUMNS_BY_PAPER_WIDTH: Record<'58mm' | '80mm', number> = {
  '58mm': 32,
  '80mm': 48,
};

// Canonical bytes the tests assert against.
export const ESCPOS_BYTES = {
  INIT: new Uint8Array([0x1b, 0x40]),
  CUT_FULL: new Uint8Array([0x1d, 0x56, 0x00]),
  DRAWER_KICK: new Uint8Array([0x1b, 0x70, 0x00, 0x19, 0xfa]),
  BOLD_ON: new Uint8Array([0x1b, 0x45, 0x01]),
  BOLD_OFF: new Uint8Array([0x1b, 0x45, 0x00]),
  DOUBLE_HEIGHT: new Uint8Array([0x1d, 0x21, 0x01]),
  NORMAL_HEIGHT: new Uint8Array([0x1d, 0x21, 0x00]),
  LF: new Uint8Array([0x0a]),
};

// Subset of cp858 mapping for the Spanish characters we actually emit
// in receipts. Anything outside this map falls back to '?' (0x3f).
const CP858_OVERRIDES: Record<string, number> = {
  ñ: 0xa4,
  Ñ: 0xa5,
  á: 0xa0,
  é: 0x82,
  í: 0xa1,
  ó: 0xa2,
  ú: 0xa3,
  Á: 0xb5,
  É: 0x90,
  Í: 0xd6,
  Ó: 0xe0,
  Ú: 0xe9,
  ü: 0x81,
  Ü: 0x9a,
  '¿': 0xa8,
  '¡': 0xad,
  '€': 0xd5,
  '°': 0xf8,
  '·': 0xfa,
};

// =============================================================================
// Helpers
// =============================================================================

function alignByte(align: ReceiptAlign | undefined): number {
  switch (align) {
    case 'center':
      return 1;
    case 'right':
      return 2;
    default:
      return 0;
  }
}

/**
 * Encode a string into a printer-aware byte buffer. cp437 keeps the
 * ASCII-only path; cp858 / cp850 / pc858_euro substitute Spanish
 * accented characters from the override table.
 */
export function encodeForCharset(text: string, charset: EscPosCharset): Uint8Array {
  const out: number[] = [];
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code < 0x80) {
      out.push(code);
      continue;
    }
    if (charset === 'cp437') {
      out.push(0x3f); // '?'
      continue;
    }
    const override = CP858_OVERRIDES[char];
    if (typeof override === 'number') {
      out.push(override);
      continue;
    }
    out.push(0x3f);
  }
  return new Uint8Array(out);
}

/**
 * Wrap text to `cols` width by splitting on whitespace where
 * possible; fall back to hard-cutting long tokens.
 */
export function wrapToColumns(text: string, cols: number): string[] {
  if (cols <= 0) {
    throw new Error('columns must be a positive integer', {
      cause: {
        helper: 'wrapToColumns',
        receivedCols: cols,
      },
    });
  }
  if (text.length === 0) return [''];
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) {
      out.push('');
      continue;
    }
    let current = '';
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    for (const word of words) {
      if (word.length > cols) {
        // Flush current line first then hard-cut the long token.
        if (current.length > 0) {
          out.push(current);
          current = '';
        }
        for (let i = 0; i < word.length; i += cols) {
          out.push(word.slice(i, i + cols));
        }
        continue;
      }
      const next = current.length === 0 ? word : `${current} ${word}`;
      if (next.length <= cols) {
        current = next;
      } else {
        out.push(current);
        current = word;
      }
    }
    if (current.length > 0) {
      out.push(current);
    }
  }
  return out;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

// =============================================================================
// Top-level builder
// =============================================================================

/**
 * Render a `ReceiptDocument` to canonical ESC/POS bytes.
 *
 * The output always starts with `ESC @` (init) + `ESC t n`
 * (codepage select), so the printer state is never inherited from
 * a previous job. The output ends with the optional drawer pulse
 * + the optional cut, so the cashier tears the paper after the
 * drawer pops.
 */
export function buildEscPosBytes(doc: ReceiptDocument, opts: BuildEscPosBytesOptions): Uint8Array {
  const charset = opts.characterSet ?? 'cp858';
  const charsetCode = CHARSET_CODES[charset];
  if (typeof charsetCode !== 'number') {
    throw new Error(`Unsupported character set: ${charset}`, {
      cause: {
        helper: 'buildEscPosBytes',
        unsupportedCharset: charset,
        supported: Object.keys(CHARSET_CODES),
      },
    });
  }
  const cols = COLUMNS_BY_PAPER_WIDTH[opts.paperWidth];
  if (typeof cols !== 'number') {
    throw new Error(`Unsupported paper width: ${opts.paperWidth}`, {
      cause: {
        helper: 'buildEscPosBytes',
        unsupportedPaperWidth: opts.paperWidth,
        supported: Object.keys(COLUMNS_BY_PAPER_WIDTH),
      },
    });
  }

  const chunks: Uint8Array[] = [];
  chunks.push(ESCPOS_BYTES.INIT);
  chunks.push(new Uint8Array([0x1b, 0x74, charsetCode]));

  let lastAlign: ReceiptAlign | undefined;
  let lastBold = false;
  let lastDoubleHeight = false;

  for (const line of doc.lines) {
    const align = line.align ?? 'left';
    if (align !== lastAlign) {
      chunks.push(new Uint8Array([0x1b, 0x61, alignByte(align)]));
      lastAlign = align;
    }
    const bold = line.bold === true;
    if (bold !== lastBold) {
      chunks.push(bold ? ESCPOS_BYTES.BOLD_ON : ESCPOS_BYTES.BOLD_OFF);
      lastBold = bold;
    }
    const doubleHeight = line.doubleHeight === true;
    if (doubleHeight !== lastDoubleHeight) {
      chunks.push(doubleHeight ? ESCPOS_BYTES.DOUBLE_HEIGHT : ESCPOS_BYTES.NORMAL_HEIGHT);
      lastDoubleHeight = doubleHeight;
    }

    if (line.text.length === 0) {
      chunks.push(ESCPOS_BYTES.LF);
      continue;
    }
    const wrapped = wrapToColumns(line.text, cols);
    for (const piece of wrapped) {
      chunks.push(encodeForCharset(piece, charset));
      chunks.push(ESCPOS_BYTES.LF);
    }
  }

  // Always reset to defaults before drawer/cut so the next job lands
  // in a known state.
  if (lastBold) chunks.push(ESCPOS_BYTES.BOLD_OFF);
  if (lastDoubleHeight) chunks.push(ESCPOS_BYTES.NORMAL_HEIGHT);

  if (doc.kickDrawer === true) {
    chunks.push(ESCPOS_BYTES.DRAWER_KICK);
  }

  if (doc.cut !== false) {
    chunks.push(ESCPOS_BYTES.CUT_FULL);
  }

  return concatBytes(chunks);
}

// =============================================================================
// Convenience builder for sale receipts
// =============================================================================

// explicit `| undefined` on every optional field so the
// caller can spread partial sale data without violating
// `exactOptionalPropertyTypes`.
export interface SaleReceiptInput {
  header: { tenantName: string; siteName?: string | undefined; address?: string | undefined };
  saleNumber: string;
  cashierName?: string | undefined;
  customerName?: string | undefined;
  items: Array<{ name: string; quantity: number; unitPrice: number; total: number }>;
  subtotal: number;
  taxAmount?: number | undefined;
  total: number;
  totalLabel: string;
  paymentSummary?: string | undefined;
  footer?: string | undefined;
  formatCurrency: (value: number) => string;
}

/**
 * Build a `ReceiptDocument` from a structured sale shape. The
 * adapter pipes this into `buildEscPosBytes`. The function is pure
 * + deterministic so unit tests can pin a snapshot.
 */
export function buildSaleReceiptDocument(
  input: SaleReceiptInput,
  options: { kickDrawer?: boolean } = {}
): ReceiptDocument {
  const { formatCurrency } = input;
  const lines: ReceiptLine[] = [];

  // Header
  lines.push({ text: input.header.tenantName, align: 'center', bold: true });
  if (input.header.siteName) {
    lines.push({ text: input.header.siteName, align: 'center' });
  }
  if (input.header.address) {
    lines.push({ text: input.header.address, align: 'center' });
  }
  lines.push({ text: '' });

  // Sale meta
  lines.push({ text: `Venta: ${input.saleNumber}` });
  if (input.cashierName) {
    lines.push({ text: `Cajero: ${input.cashierName}` });
  }
  if (input.customerName) {
    lines.push({ text: `Cliente: ${input.customerName}` });
  }
  lines.push({ text: '' });

  // Items
  for (const item of input.items) {
    lines.push({ text: item.name });
    lines.push({
      text: `${item.quantity} x ${formatCurrency(item.unitPrice)}   ${formatCurrency(item.total)}`,
      align: 'right',
    });
  }
  lines.push({ text: '' });

  // Totals
  lines.push({ text: `Subtotal: ${formatCurrency(input.subtotal)}`, align: 'right' });
  if (typeof input.taxAmount === 'number') {
    lines.push({ text: `IVA: ${formatCurrency(input.taxAmount)}`, align: 'right' });
  }
  lines.push({
    text: `${input.totalLabel}: ${formatCurrency(input.total)}`,
    align: 'right',
    bold: true,
    doubleHeight: true,
  });

  if (input.paymentSummary) {
    lines.push({ text: '' });
    lines.push({ text: input.paymentSummary });
  }

  if (input.footer) {
    lines.push({ text: '' });
    lines.push({ text: input.footer, align: 'center' });
  }

  lines.push({ text: '' });

  return {
    lines,
    cut: true,
    kickDrawer: options.kickDrawer === true,
  };
}
