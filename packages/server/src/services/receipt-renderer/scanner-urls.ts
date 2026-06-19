/**
 * Receipt renderer scanner-source URL guards + QR placeholder geometry.
 *
 * ENG-178 — extracted verbatim from the former single-file
 * `services/receipt-renderer.ts`. Security-critical: `safeResolvedScannerSource`
 * + `RESOLVED_URL_SCHEME_BLOCKLIST` collapse a hostile resolved URL scheme to
 * the empty string before it reaches a phone scanner. Bodies moved byte-for-byte;
 * the QR geometry consts gained `export` for the HTML block renderer.
 *
 * @module services/receipt-renderer/scanner-urls
 */
import type { RenderData } from './types.js';
import { resolvePlain } from './escape-resolve.js';

/**
 * Defense-in-depth URL scheme rejection. The Zod schema in
 * `trpc/schemas/receiptTemplates.ts` already rejects literal
 * `javascript:` / `data:` / `vbscript:` / `file:` schemes in
 * `qr.source` and `barcode128.source`, but a layout that uses a
 * variable substitution like `{{fiscal.qrUrl}}` evades that check
 * because the literal portion is empty at validation time. Re-running
 * the check on the *resolved* string here closes that loophole: even
 * if upstream tenant data is ever corrupted to inject a hostile URL
 * scheme, the renderer collapses it to an empty string before the
 * value reaches a phone scanner.
 */
const RESOLVED_URL_SCHEME_BLOCKLIST = /^(javascript|data|vbscript|file):/i;
const QR_MODULE_COORDS: ReadonlyArray<readonly [number, number]> = [
  [30, 4],
  [42, 4],
  [48, 10],
  [30, 16],
  [36, 22],
  [48, 22],
  [30, 34],
  [42, 34],
  [54, 34],
  [24, 46],
  [36, 46],
  [48, 46],
  [60, 46],
  [30, 58],
  [42, 58],
  [54, 58],
  [66, 58],
  [30, 70],
  [48, 70],
];
export const QR_MODULE_SPANS = QR_MODULE_COORDS.map(
  ([left, top]) =>
    `<span class="qr-module" style="left:${left}px;top:${top}px"></span>`
).join('');

export function safeResolvedScannerSource(template: string, data: RenderData): string {
  const resolved = resolvePlain(template, data);
  if (RESOLVED_URL_SCHEME_BLOCKLIST.test(resolved.trim())) {
    return '';
  }
  return resolved;
}

/** ENG-097 — default pixel size for the rendered QR SVG when the
 *  block omits `sizeMm`. 78 px matches the handoff placeholder so the
 *  editor preview footprint does not jump when the renderer switches
 *  from the placeholder to the real SVG.
 */
export const QR_DEFAULT_PIXEL_SIZE = 78;
/** ENG-097 — mm-to-pixel scale used to size the inline SVG when the
 *  block declares `sizeMm`. Matches the design-system ratio (1 mm ≈
 *  3.78 px on screen at 96 dpi); the printer firmware re-rasters from
 *  the ESC/POS payload at its native dpi so this constant only affects
 *  the preview iframe.
 */
export const QR_MM_TO_PX = 3.78;
