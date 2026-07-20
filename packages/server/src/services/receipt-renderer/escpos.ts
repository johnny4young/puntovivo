/**
 * Receipt renderer ESC/POS byte builders + block renderer.
 *
 * extracted verbatim from the former single-file
 * `services/receipt-renderer.ts`. The control-byte primitives stay
 * module-private; `ESC` / `LF` / `escposCut` / `renderBlockEscPos` /
 * `paperWidthCharsFor` gain `export` for the orchestrator. The byte output is
 * unchanged ( `GS ( k` QR sequence + the same scanner-scheme guard).
 *
 * @module services/receipt-renderer/escpos
 */
import type { ReceiptBlock, ReceiptLayout } from '../../trpc/schemas/receiptTemplates.js';
import { encodeQrEscposBytes } from '../qr-encoder.js';
import type { ReceiptRenderLabels, RenderData } from './types.js';
import { APP_FOOTER_METADATA, WORDMARK_TAGLINE } from './labels.js';
import { resolvePlain } from './escape-resolve.js';
import { formatNumber, formatReceiptAmount, totalsLabel, totalsValue } from './format-helpers.js';
import { safeResolvedScannerSource } from './scanner-urls.js';

export const ESC = 0x1b;
const GS = 0x1d;
export const LF = 0x0a;

function bytesFromString(value: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    out.push(code < 128 ? code : 0x3f); // non-ASCII collapses to '?'
  }
  return out;
}

function escposAlign(align: string | undefined): number[] {
  // ESC a n — 0=left, 1=center, 2=right
  const n = align === 'center' ? 1 : align === 'right' ? 2 : 0;
  return [ESC, 0x61, n];
}

function escposBoldOn(): number[] {
  return [ESC, 0x45, 0x01];
}
function escposBoldOff(): number[] {
  return [ESC, 0x45, 0x00];
}
export function escposCut(): number[] {
  return [GS, 0x56, 0x00];
}
function escposLine(): number[] {
  return [LF];
}

export function renderBlockEscPos(
  block: ReceiptBlock,
  data: RenderData,
  paperWidthChars: number,
  labels: ReceiptRenderLabels
): number[] {
  switch (block.type) {
    case 'text': {
      const text = resolvePlain(block.value, data);
      const out: number[] = [];
      out.push(...escposAlign(block.align));
      const bold = block.bold || block.style === 'title' || block.style === 'subtitle';
      if (bold) out.push(...escposBoldOn());
      out.push(...bytesFromString(text));
      if (bold) out.push(...escposBoldOff());
      out.push(...escposLine());
      return out;
    }
    case 'logo': {
      // Logo emission requires raster mode bytes the upstream driver in
      // Iter 4 will supply (the renderer cannot decode the PNG without
      // a binary dependency). For now the logo space prints a blank
      // line so the layout cadence matches HTML preview.
      return [...escposLine()];
    }
    case 'itemsTable': {
      const out: number[] = [];
      out.push(...escposAlign('left'));
      for (const item of data.sale.items) {
        const namePiece = item.name
          .padEnd(Math.max(0, paperWidthChars - 16))
          .slice(0, paperWidthChars - 16);
        const qtyPiece = formatNumber(item.qty).padStart(6);
        const totalPiece = formatReceiptAmount(item.total, data.locale).padStart(10);
        out.push(...bytesFromString(`${namePiece}${qtyPiece}${totalPiece}`));
        out.push(...escposLine());
      }
      return out;
    }
    case 'totalsBlock': {
      const out: number[] = [];
      out.push(...escposAlign('right'));
      for (const line of block.show) {
        const label = totalsLabel(line, labels);
        const value = formatReceiptAmount(totalsValue(line, data), data.locale);
        const padded = `${label}: ${value}`;
        out.push(...bytesFromString(padded));
        out.push(...escposLine());
      }
      return out;
    }
    case 'tendersTable': {
      const out: number[] = [];
      out.push(...escposAlign('left'));
      for (const tender of data.sale.tenders) {
        out.push(
          ...bytesFromString(
            `${tender.method.padEnd(8)} ${formatReceiptAmount(tender.amount, data.locale).padStart(10)}`
          )
        );
        out.push(...escposLine());
      }
      if (block.showChange && data.sale.changeDue && data.sale.changeDue > 0) {
        out.push(
          ...bytesFromString(
            `${labels.tendersTable.change.padEnd(8)} ${formatReceiptAmount(data.sale.changeDue, data.locale).padStart(10)}`
          )
        );
        out.push(...escposLine());
      }
      return out;
    }
    case 'qr': {
      // emit the real Epson Standard Mode `GS ( k` QR
      // sequence so the printed code scans. Falls through to a
      // placeholder line when the source is empty or the encoder
      // rejects the payload (too long for the chosen EC level) — the
      // receipt stays printable instead of throwing mid-flush. Same
      // scheme guard as the HTML branch keeps hostile resolved values
      // (`javascript:`, `data:`, …) off the printer.
      const resolved = safeResolvedScannerSource(block.source, data);
      const qrBytes = encodeQrEscposBytes(resolved);
      if (qrBytes) {
        return [...escposAlign('center'), ...qrBytes, ...escposLine(), ...escposAlign('left')];
      }
      return [
        ...escposAlign('center'),
        ...bytesFromString(resolved ? `[QR: ${resolved}]` : ''),
        ...escposLine(),
        ...escposAlign('left'),
      ];
    }
    case 'separator': {
      const char = block.char ?? '-';
      return [
        ...escposAlign('left'),
        ...bytesFromString(char.repeat(paperWidthChars)),
        ...escposLine(),
      ];
    }
    case 'barcode128': {
      const resolved = safeResolvedScannerSource(block.source, data);
      return [...escposAlign('center'), ...bytesFromString(`[BC: ${resolved}]`), ...escposLine()];
    }
    case 'appFooter': {
      // pass 1 (item #5) — 3 centered lines of Puntovivo branding.
      if (block.show === false) return [];
      const { appName, appVersion, appUrl, appSupport } = APP_FOOTER_METADATA;
      const out: number[] = [...escposAlign(block.align ?? 'center')];
      for (const line of [`${appName} ${appVersion}`, appUrl, appSupport]) {
        out.push(...bytesFromString(line));
        out.push(...escposLine());
      }
      return out;
    }
    case 'wordmark': {
      // centered brand lockup. ESC/POS lacks the
      // mixed-weight typography the HTML preview ships, so the wordmark
      // collapses to a bold lowercase `puntovivo` line plus the handoff
      // tagline on the printed strip.
      if (block.show === false) return [];
      const out: number[] = [
        ...escposAlign(block.align ?? 'center'),
        ...escposBoldOn(),
        ...bytesFromString(APP_FOOTER_METADATA.appName.toLowerCase()),
        ...escposBoldOff(),
        ...escposLine(),
        ...bytesFromString(WORDMARK_TAGLINE),
        ...escposLine(),
      ];
      return out;
    }
    case 'metaTable': {
      // render each `{key, value}` row as a left-padded label
      // and a right-aligned interpolated value so the strip stays
      // readable on 32/48-char paper. Empty resolved values drop the
      // row entirely.
      const out: number[] = [...escposAlign('left')];
      for (const row of block.rows) {
        const resolvedValue = resolvePlain(row.value, data);
        if (!resolvedValue) continue;
        const resolvedKey = resolvePlain(row.key, data);
        const gap = Math.max(1, paperWidthChars - resolvedKey.length - resolvedValue.length);
        const line = `${resolvedKey}${' '.repeat(gap)}${resolvedValue}`;
        out.push(...bytesFromString(line.slice(0, paperWidthChars)));
        out.push(...escposLine());
      }
      return out;
    }
    default: {
      const _exhaustive: never = block;
      void _exhaustive;
      return [];
    }
  }
}

export function paperWidthCharsFor(width: ReceiptLayout['paperWidth']): number {
  switch (width) {
    case '58mm':
      return 32;
    case '80mm':
      return 48;
    case 'letter':
    case 'a4':
      return 80;
    default:
      return 48;
  }
}
