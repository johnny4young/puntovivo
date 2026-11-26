/**
 * Shelf-label (habladores de góndola) barcode, printable sheet, ZPL and TSPL builders.
 *
 * Pure zero-dependency module: renders scannable EAN-13 (when the barcode is a valid
 * 13-digit EAN-13) or Code 128B fallback SVG, Letter/A4 printable sheets, Zebra ZPL II,
 * and TSC/Xprinter TSPL commands for retail and supermarket shelves.
 */

export interface ShelfLabelProduct {
  id: string;
  name: string;
  sku: string;
  barcode?: string | null | undefined;
  price: number;
  unitLabel?: string | null | undefined;
  copies?: number | undefined;
}

export type ShelfLabelPaper = 'letter' | 'a4';
export type ShelfLabelGrid = '3x8' | '3x10' | '2x6';

const EAN13_L_CODES = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
] as const;

const EAN13_G_CODES = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
] as const;

const EAN13_R_CODES = [
  '1110010',
  '1100110',
  '1101100',
  '1000010',
  '1011100',
  '1001110',
  '1010000',
  '1000100',
  '1001000',
  '1110100',
] as const;

const EAN13_PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
] as const;

/** Standard Code 128 bar-width patterns (indices 0..106, Start B = 104, Stop = 106). */
const CODE128_PATTERNS = [
  '212222',
  '222122',
  '222221',
  '121223',
  '121322',
  '131222',
  '122213',
  '122312',
  '132212',
  '221213',
  '221312',
  '231212',
  '112232',
  '122132',
  '122231',
  '113222',
  '123122',
  '123221',
  '223211',
  '221132',
  '221231',
  '213212',
  '223112',
  '312131',
  '311222',
  '321122',
  '321221',
  '312212',
  '322112',
  '322211',
  '212123',
  '212321',
  '232121',
  '111323',
  '131123',
  '131321',
  '112313',
  '132113',
  '132311',
  '211313',
  '231113',
  '231311',
  '112133',
  '112331',
  '132131',
  '113123',
  '113321',
  '133121',
  '313121',
  '211331',
  '231131',
  '213113',
  '213311',
  '213131',
  '311123',
  '311321',
  '331121',
  '312113',
  '312311',
  '332111',
  '314111',
  '221411',
  '431111',
  '111224',
  '111422',
  '121124',
  '121421',
  '141122',
  '141221',
  '112214',
  '112412',
  '122114',
  '122411',
  '142112',
  '142211',
  '241211',
  '221114',
  '413111',
  '241112',
  '134111',
  '111242',
  '121142',
  '121241',
  '114212',
  '124112',
  '124211',
  '411212',
  '421112',
  '421211',
  '212141',
  '214121',
  '412121',
  '111143',
  '111341',
  '131141',
  '114113',
  '114311',
  '411113',
  '411311',
  '113141',
  '114131',
  '311141',
  '411131',
  '211412',
  '211214',
  '211232',
  '2331112',
] as const;

export function isValidEan13(code: string): boolean {
  if (!/^\d{13}$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const digit = Number(code[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  return (10 - (sum % 10)) % 10 === Number(code[12]);
}

export function encodeEan13Modules(code: string): string | null {
  if (!isValidEan13(code)) return null;
  const firstDigit = Number(code[0]);
  const parity = EAN13_PARITY[firstDigit]!;
  let bits = '101';
  for (let i = 1; i <= 6; i += 1) {
    const d = Number(code[i]);
    bits += parity[i - 1] === 'L' ? EAN13_L_CODES[d]! : EAN13_G_CODES[d]!;
  }
  bits += '01010';
  for (let i = 7; i <= 12; i += 1) {
    bits += EAN13_R_CODES[Number(code[i])]!;
  }
  bits += '101';
  return bits;
}

function widthsToBits(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    out += (i % 2 === 0 ? '1' : '0').repeat(Number(pattern[i]));
  }
  return out;
}

export function sanitizeCode128Text(raw: string): string {
  const cleaned = raw
    .trim()
    .split('')
    .filter(ch => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code <= 126;
    })
    .join('')
    .slice(0, 32);
  return cleaned.length > 0 ? cleaned : '000000';
}

export function encodeCode128BModules(raw: string): { bits: string; value: string } {
  const value = sanitizeCode128Text(raw);
  const startCode = 104;
  let checksum = startCode;
  const codes = [startCode];
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i) - 32;
    codes.push(code);
    checksum += code * (i + 1);
  }
  codes.push(checksum % 103);
  codes.push(106);
  const bits = codes.map(code => widthsToBits(CODE128_PATTERNS[code]!)).join('');
  return { bits, value };
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function resolveLabelBarcode(product: Pick<ShelfLabelProduct, 'barcode' | 'sku'>): string {
  const candidate = (product.barcode ?? '').trim();
  return candidate.length > 0 ? candidate : product.sku.trim();
}

export function renderBarcodeSvg(
  rawCode: string,
  options?: { height?: number; moduleWidth?: number }
): { symbology: 'ean13' | 'code128'; svg: string; encodedValue: string } {
  const trimmed = rawCode.trim();
  const eanBits = encodeEan13Modules(trimmed);
  const symbology = eanBits ? 'ean13' : 'code128';
  const encoded = eanBits ? { bits: eanBits, value: trimmed } : encodeCode128BModules(trimmed);
  const barHeight = options?.height ?? 36;
  const moduleWidth = options?.moduleWidth ?? 1.5;
  const quietModules = 6;
  const totalWidth = Math.round((encoded.bits.length + quietModules * 2) * moduleWidth);
  const totalHeight = barHeight + 14;

  // Coalesce contiguous '1' runs into single SVG rects to keep markup tiny.
  const rects: string[] = [];
  let runStart = -1;
  for (let i = 0; i <= encoded.bits.length; i += 1) {
    const on = encoded.bits[i] === '1';
    if (on && runStart === -1) {
      runStart = i;
    } else if (!on && runStart !== -1) {
      const x = ((runStart + quietModules) * moduleWidth).toFixed(2);
      const w = ((i - runStart) * moduleWidth).toFixed(2);
      rects.push(`<rect x="${x}" y="0" width="${w}" height="${barHeight}" fill="#111"/>`);
      runStart = -1;
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth} ${totalHeight}" width="100%" height="${totalHeight}" role="img" aria-label="${escapeXml(encoded.value)}"><rect width="100%" height="100%" fill="#fff"/>${rects.join('')}<text x="${(totalWidth / 2).toFixed(1)}" y="${barHeight + 11}" text-anchor="middle" font-family="ui-monospace,SFMono-Regular,Menlo,monospace" font-size="10" fill="#111">${escapeXml(encoded.value)}</text></svg>`;
  return { symbology, svg, encodedValue: encoded.value };
}

export function expandLabelCopies(items: readonly ShelfLabelProduct[]): ShelfLabelProduct[] {
  const out: ShelfLabelProduct[] = [];
  for (const item of items) {
    const copies = Math.max(1, Math.min(99, Math.floor(item.copies ?? 1)));
    for (let i = 0; i < copies; i += 1) {
      out.push(item);
    }
  }
  return out;
}

const GRID_SPECS: Record<ShelfLabelGrid, { cols: number; rows: number; minHeightMm: number }> = {
  '3x8': { cols: 3, rows: 8, minHeightMm: 31 },
  '3x10': { cols: 3, rows: 10, minHeightMm: 25 },
  '2x6': { cols: 2, rows: 6, minHeightMm: 41 },
};

export function buildShelfLabelsPrintHtml(
  items: readonly ShelfLabelProduct[],
  options: {
    paper: ShelfLabelPaper;
    grid: ShelfLabelGrid;
    formatPrice: (price: number) => string;
    title: string;
  }
): string {
  const expanded = expandLabelCopies(items);
  const spec = GRID_SPECS[options.grid];
  const pageSize = options.paper === 'a4' ? 'A4 portrait' : 'letter portrait';

  const cards = expanded
    .map(item => {
      const code = resolveLabelBarcode(item);
      const barcode = renderBarcodeSvg(code, { height: 30, moduleWidth: 1.4 });
      const unitSuffix = item.unitLabel ? ` / ${escapeXml(item.unitLabel)}` : '';
      return `<article class="label-card"><div class="label-name">${escapeXml(item.name)}</div><div class="label-price">${escapeXml(options.formatPrice(item.price))}<span class="label-unit">${unitSuffix}</span></div><div class="label-barcode">${barcode.svg}</div><div class="label-sku">SKU: ${escapeXml(item.sku)}</div></article>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>${escapeXml(options.title)}</title>
<style>
  @page { size: ${pageSize}; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: system-ui, -apple-system, sans-serif; color: #111; background: #fff; }
  .sheet { display: grid; grid-template-columns: repeat(${spec.cols}, 1fr); gap: 3mm; }
  .label-card {
    border: 0.4mm dashed #bbb;
    border-radius: 1.5mm;
    padding: 2.5mm;
    min-height: ${spec.minHeightMm}mm;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .label-name { font-size: 9pt; font-weight: 600; line-height: 1.15; max-height: 2.3em; overflow: hidden; }
  .label-price { font-size: 14pt; font-weight: 800; letter-spacing: -0.02em; margin: 1mm 0; }
  .label-unit { font-size: 8pt; font-weight: 500; color: #444; }
  .label-barcode svg { display: block; width: 100%; max-height: 12mm; }
  .label-sku { font-size: 7pt; color: #555; text-align: right; }
  @media print { .label-card { border-color: #ddd; } }
</style>
</head>
<body>
<main class="sheet">${cards}</main>
</body>
</html>`;
}

function sanitizeThermalText(value: string, maxLen: number): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\r\n^~"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

/** Generate Zebra ZPL II commands (50×30mm @ 203 dpi = 400×240 dots). */
export function buildZplLabels(
  items: readonly ShelfLabelProduct[],
  options: { formatPrice: (price: number) => string }
): string {
  const blocks: string[] = [];
  for (const item of items) {
    const copies = Math.max(1, Math.min(99, Math.floor(item.copies ?? 1)));
    const name = sanitizeThermalText(item.name, 30);
    const price = sanitizeThermalText(options.formatPrice(item.price), 18);
    const sku = sanitizeThermalText(item.sku, 20);
    const rawCode = resolveLabelBarcode(item);
    const barcodeCmd = isValidEan13(rawCode)
      ? `^BY2,3,52^BEN,52,Y,N^FD${rawCode.slice(0, 12)}^FS`
      : `^BY2,3,52^BCN,52,Y,N,N^FD${sanitizeCode128Text(rawCode)}^FS`;
    blocks.push(
      [
        '^XA',
        '^CI28',
        '^PW400',
        '^LL240',
        `^FO16,14^A0N,26,24^FD${name}^FS`,
        `^FO16,46^A0N,42,38^FD${price}^FS`,
        `^FO16,96${barcodeCmd}`,
        `^FO16,204^A0N,18,18^FDSKU: ${sku}^FS`,
        `^PQ${copies},0,1,Y`,
        '^XZ',
      ].join('\n')
    );
  }
  return blocks.join('\n');
}

/** Generate TSC / Xprinter TSPL commands (50×30mm thermal shelf label). */
export function buildTsplLabels(
  items: readonly ShelfLabelProduct[],
  options: { formatPrice: (price: number) => string }
): string {
  const lines: string[] = ['SIZE 50 mm, 30 mm', 'GAP 3 mm, 0 mm', 'DIRECTION 1', 'REFERENCE 0,0'];
  for (const item of items) {
    const copies = Math.max(1, Math.min(99, Math.floor(item.copies ?? 1)));
    const name = sanitizeThermalText(item.name, 28);
    const price = sanitizeThermalText(options.formatPrice(item.price), 18);
    const sku = sanitizeThermalText(item.sku, 20);
    const rawCode = resolveLabelBarcode(item);
    const barcodeType = isValidEan13(rawCode) ? 'EAN13' : '128';
    const barcodeVal = isValidEan13(rawCode) ? rawCode.slice(0, 12) : sanitizeCode128Text(rawCode);
    lines.push(
      'CLS',
      `TEXT 16,14,"3",0,1,1,"${name}"`,
      `TEXT 16,48,"4",0,1,1,"${price}"`,
      `BARCODE 16,96,"${barcodeType}",54,1,0,2,2,"${barcodeVal}"`,
      `TEXT 16,204,"1",0,1,1,"SKU: ${sku}"`,
      `PRINT 1,${copies}`
    );
  }
  return lines.join('\n');
}
