/**
 * QR code encoder shared between the HTML and ESC/POS render branches.
 *
 * The receipt renderer (`services/receipt-renderer.ts`) used to emit a
 * pure-CSS placeholder for QR blocks because ENG-086 deliberately
 * stopped at the visual silhouette and deferred real PNG generation to
 * the print handler. ENG-097 closes that loop: receipts that ship a
 * fiscal `qrUrl` (DIAN, CFDI, DTE) must scan correctly on the customer
 * phone, otherwise the receipt is non-compliant.
 *
 * This module wraps the `qrcode` npm package (~20 KB minified, pure
 * JS, no native deps — already used in `apps/web` for fiscal PDFs) and
 * exposes two pure functions:
 *
 *   - `encodeQrSvg(source, options)` → inline SVG with monochrome
 *     modules; safe under the strict `sandbox=""` editor preview iframe
 *     because there is no script + no external resource.
 *   - `encodeQrEscposBytes(source, options)` → the Epson Standard Mode
 *     `GS ( k` sequence (model select + error correction + module size
 *     + store data + print). Universal across 58 mm and 80 mm
 *     ESC/POS-compatible thermal printers.
 *
 * Both functions accept the same `source` and degrade gracefully:
 *
 *   - Empty / whitespace-only source → returns `null` so the caller can
 *     fall back to the editor's empty-state placeholder.
 *   - Encoder rejects the source (payload exceeds version-40 capacity
 *     at the chosen EC level, or invalid input) → returns `null` plus
 *     a `console.warn` so the receipt still prints without throwing.
 *
 * `errorCorrectionLevel` defaults to `'M'` (15% recovery) — matches the
 * DIAN handoff in `preview/25-print-thermal.html` and stays inside the
 * commodity-printer comfort zone.
 *
 * @module services/qr-encoder
 */

import QRCode from 'qrcode';

export type QrErrorCorrectionLevel = 'L' | 'M' | 'Q' | 'H';

const DEFAULT_EC_LEVEL: QrErrorCorrectionLevel = 'M';

export interface QrSvgOptions {
  /** Pixel dimension of the rendered SVG (both width + height). */
  pixelSize: number;
  /**
   * QR error correction level. Higher levels survive more scuffs but
   * shrink the data capacity. `M` matches the 2026-05-15 handoff and is
   * the safe default for fiscal URLs.
   */
  errorCorrectionLevel?: QrErrorCorrectionLevel;
  /**
   * Quiet zone in modules. Defaults to 4 (the QR spec minimum). The
   * handoff matches this so changing the value here also changes the
   * receipt look — keep aligned with `.qr-placeholder` CSS.
   */
  margin?: number;
}

export interface QrEscposOptions {
  /**
   * Module size in dots (1–16). The Epson default is 3; 6 produces a
   * scannable code on commodity 58 mm + 80 mm rolls and matches the
   * handoff QR footprint at 78 px on screen.
   */
  moduleSize?: number;
  errorCorrectionLevel?: QrErrorCorrectionLevel;
}

/**
 * Build an inline SVG QR code. Returns the SVG string ready to embed
 * inside the receipt HTML, or `null` when the source is empty / the
 * encoder rejects the payload.
 *
 * Uses `QRCode.create()` (the sync API that returns a bit matrix) and
 * renders the SVG manually — `QRCode.toString()` returns a Promise, but
 * the receipt renderer pipeline is pure and synchronous, so we cannot
 * await it without cascading async through every call site. The manual
 * SVG renderer emits one `<path>` covering every dark module so the
 * markup stays small (a 25×25 matrix becomes a single path attribute
 * vs. 625 rects). `xmlns` is explicit so the SVG renders inside the
 * iframe without inheriting the document namespace.
 */
export function encodeQrSvg(
  source: string,
  options: QrSvgOptions
): string | null {
  const trimmed = source.trim();
  if (!trimmed) return null;
  let matrix: ReturnType<typeof QRCode.create>;
  try {
    matrix = QRCode.create(trimmed, {
      errorCorrectionLevel:
        options.errorCorrectionLevel ?? DEFAULT_EC_LEVEL,
    });
  } catch (err) {
    // Payload too large for QR version 40 at this EC level, or any
    // upstream encoding error. Keep the receipt printable.
    // eslint-disable-next-line no-console
    console.warn(
      '[receipt-renderer] QR SVG encode failed; falling back to placeholder',
      err
    );
    return null;
  }

  const margin = options.margin ?? 4;
  const size = matrix.modules.size;
  const totalUnits = size + margin * 2;
  const path = buildQrPath(matrix.modules, margin);
  if (!path) {
    // All-light matrix shouldn't happen for non-empty input, but guard
    // anyway so the SVG is never visually empty when we promised real
    // modules.
    return null;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalUnits} ${totalUnits}" width="${options.pixelSize}" height="${options.pixelSize}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

/**
 * Convert the QR bit matrix into a single SVG path `d` attribute. Each
 * dark module becomes a 1×1 rectangle anchored at the module's
 * (x + margin, y + margin) coordinate so the quiet zone shows on every
 * side. Path commands stay minimal (`Mx,yh1v1h-1z`) so the rendered
 * SVG is small even for a version-40 symbol.
 */
function buildQrPath(
  modules: { size: number; get: (row: number, col: number) => boolean | number },
  margin: number
): string {
  const size = modules.size;
  const parts: string[] = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (modules.get(row, col)) {
        const x = col + margin;
        const y = row + margin;
        parts.push(`M${x},${y}h1v1h-1z`);
      }
    }
  }
  return parts.join('');
}

/**
 * ESC/POS opcodes used by the Epson Standard Mode QR command set
 * (`GS ( k`). The byte sequences below come from the Epson FS Command
 * Reference (T20III / TM-T20 / TM-T88) — the same dialect every
 * commodity 58 mm and 80 mm thermal printer accepts.
 */
const GS = 0x1d;
const LPAREN = 0x28;
const QR_CN = 0x6b;
/**
 * `fn` discriminator bytes for the five `GS ( k` QR commands we emit.
 * Wire format is `GS ( k pL pH cn fn …` where `cn = 0x31` (= 49) selects
 * the QR symbol family. The `fn` value picks the per-command function:
 * 0x41 (= 65) model select, 0x43 (= 67) module size, 0x45 (= 69) EC
 * level, 0x50 (= 80) store data, 0x51 (= 81) print. The actual wire
 * sample for model select is `1D 28 6B 04 00 31 41 32 00`.
 */
const QR_FN_MODEL = 0x41;
const QR_FN_MODULE_SIZE = 0x43;
const QR_FN_ERROR_CORRECTION = 0x45;
const QR_FN_STORE_DATA = 0x50;
const QR_FN_PRINT = 0x51;

const QR_EC_BYTE: Record<QrErrorCorrectionLevel, number> = {
  L: 0x30,
  M: 0x31,
  Q: 0x32,
  H: 0x33,
};

/**
 * Emit the ESC/POS byte sequence that drives the printer to render
 * the supplied source as a QR symbol. Returns `null` when the source
 * is empty / too long for the printer buffer (Epson caps QR payload
 * at 7089 numeric / 4296 alphanumeric / 2953 8-bit characters at EC
 * level L; the printer firmware silently truncates above that point,
 * which produces an unscannable code — we guard the cap explicitly so
 * receipts stay correct).
 */
export function encodeQrEscposBytes(
  source: string,
  options: QrEscposOptions = {}
): number[] | null {
  const trimmed = source.trim();
  if (!trimmed) return null;

  // 8-bit byte payload upper bound at EC L per the Epson reference.
  if (trimmed.length > 2953) {
    // eslint-disable-next-line no-console
    console.warn(
      '[receipt-renderer] QR ESC/POS source exceeds 2953 bytes; falling back to placeholder'
    );
    return null;
  }

  const moduleSize = clampModuleSize(options.moduleSize ?? 6);
  const ecLevel = options.errorCorrectionLevel ?? DEFAULT_EC_LEVEL;
  const ecByte = QR_EC_BYTE[ecLevel];

  const out: number[] = [];

  // Function 165 — Select QR model 2 (`GS ( k pL pH cn fn n1 n2`).
  // n1=50 (model 2), n2=0.
  out.push(GS, LPAREN, QR_CN, 0x04, 0x00, 0x31, QR_FN_MODEL, 0x32, 0x00);

  // Function 167 — Module size.
  out.push(GS, LPAREN, QR_CN, 0x03, 0x00, 0x31, QR_FN_MODULE_SIZE, moduleSize);

  // Function 169 — Error correction level.
  out.push(GS, LPAREN, QR_CN, 0x03, 0x00, 0x31, QR_FN_ERROR_CORRECTION, ecByte);

  // Function 080 — Store the symbol data in the printer's QR buffer.
  // pL/pH encode `dataLength + 3` little-endian.
  const dataLength = trimmed.length + 3;
  const pL = dataLength & 0xff;
  const pH = (dataLength >> 8) & 0xff;
  out.push(GS, LPAREN, QR_CN, pL, pH, 0x31, QR_FN_STORE_DATA, 0x30);
  for (let i = 0; i < trimmed.length; i += 1) {
    const code = trimmed.charCodeAt(i);
    // Collapse non-ASCII to '?' (mirrors the renderer's bytesFromString
    // policy). Fiscal URLs are ASCII so this is a no-op in practice.
    out.push(code < 128 ? code : 0x3f);
  }

  // Function 081 — Print the QR symbol stored in the buffer.
  out.push(GS, LPAREN, QR_CN, 0x03, 0x00, 0x31, QR_FN_PRINT, 0x30);

  return out;
}

function clampModuleSize(value: number): number {
  if (!Number.isFinite(value)) return 6;
  const rounded = Math.round(value);
  if (rounded < 1) return 1;
  if (rounded > 16) return 16;
  return rounded;
}
