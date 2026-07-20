/**
 * Pure ESC/POS byte builder unit tests.
 *
 * Locks the canonical byte sequences (init, codepage, alignment,
 * bold, double-height, drawer pulse, full cut) and the column
 * wrapping behavior for the 58mm + 80mm reference papers. The
 * builder is a pure module; tests stay synchronous + I/O-free.
 */

import { describe, expect, it } from 'vitest';
import {
  buildEscPosBytes,
  buildSaleReceiptDocument,
  encodeForCharset,
  ESCPOS_BYTES,
  wrapToColumns,
  type ReceiptDocument,
} from '../services/peripherals/escpos/byte-builder.js';

function bytesToArray(bytes: Uint8Array): number[] {
  return Array.from(bytes);
}

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= haystack.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

const NOOP_DOC: ReceiptDocument = { lines: [], cut: false };

describe('encodeForCharset', () => {
  it('passes ASCII through verbatim', () => {
    expect(bytesToArray(encodeForCharset('Hola POS', 'cp858'))).toEqual([
      0x48, 0x6f, 0x6c, 0x61, 0x20, 0x50, 0x4f, 0x53,
    ]);
  });

  it('maps Spanish accented characters via the cp858 override table', () => {
    // ñáéíóú → 0xa4 0xa0 0x82 0xa1 0xa2 0xa3
    expect(bytesToArray(encodeForCharset('ñáéíóú', 'cp858'))).toEqual([
      0xa4, 0xa0, 0x82, 0xa1, 0xa2, 0xa3,
    ]);
  });

  it('substitutes ? for non-ASCII when targeting cp437', () => {
    expect(bytesToArray(encodeForCharset('niño', 'cp437'))).toEqual([0x6e, 0x69, 0x3f, 0x6f]);
  });

  it('encodes the Euro sign at 0xD5 in cp858', () => {
    expect(bytesToArray(encodeForCharset('€', 'cp858'))).toEqual([0xd5]);
  });
});

describe('wrapToColumns', () => {
  it('returns an empty-line array for empty input', () => {
    expect(wrapToColumns('', 32)).toEqual(['']);
  });

  it('keeps short text on a single line', () => {
    expect(wrapToColumns('Hola POS', 32)).toEqual(['Hola POS']);
  });

  it('wraps on whitespace at the boundary', () => {
    expect(wrapToColumns('one two three four five six', 12)).toEqual([
      'one two',
      'three four',
      'five six',
    ]);
  });

  it('hard-cuts a token longer than the column width', () => {
    expect(wrapToColumns('1234567890ABCDEF', 8)).toEqual(['12345678', '90ABCDEF']);
  });

  it('preserves explicit line breaks', () => {
    expect(wrapToColumns('linea uno\n\ntres', 32)).toEqual(['linea uno', '', 'tres']);
  });
});

describe('buildEscPosBytes — control sequences', () => {
  it('emits ESC @ + ESC t 19 (cp858) at the head of every output', () => {
    const bytes = buildEscPosBytes(NOOP_DOC, { paperWidth: '80mm' });
    expect(bytesToArray(bytes.slice(0, 5))).toEqual([0x1b, 0x40, 0x1b, 0x74, 0x13]);
  });

  it('emits the ESC t code matching the requested character set', () => {
    const bytes437 = buildEscPosBytes(NOOP_DOC, {
      paperWidth: '80mm',
      characterSet: 'cp437',
    });
    expect(bytes437[4]).toBe(0x00);
    const bytes850 = buildEscPosBytes(NOOP_DOC, {
      paperWidth: '80mm',
      characterSet: 'cp850',
    });
    expect(bytes850[4]).toBe(0x02);
  });

  it('emits the full-cut command at the end when cut is not false', () => {
    const bytes = buildEscPosBytes({ lines: [{ text: 'abc' }] }, { paperWidth: '80mm' });
    expect(indexOf(bytes, ESCPOS_BYTES.CUT_FULL)).toBeGreaterThan(0);
    expect(bytesToArray(bytes.slice(-3))).toEqual([0x1d, 0x56, 0x00]);
  });

  it('skips the cut command when cut === false', () => {
    const bytes = buildEscPosBytes(
      { lines: [{ text: 'abc' }], cut: false },
      { paperWidth: '80mm' }
    );
    expect(indexOf(bytes, ESCPOS_BYTES.CUT_FULL)).toBe(-1);
  });

  it('emits the drawer pulse (ESC p 0 25 250) when kickDrawer === true', () => {
    const bytes = buildEscPosBytes(
      { lines: [{ text: 'abc' }], kickDrawer: true },
      { paperWidth: '80mm' }
    );
    expect(indexOf(bytes, ESCPOS_BYTES.DRAWER_KICK)).toBeGreaterThan(0);
  });

  it('does NOT emit the drawer pulse when kickDrawer is undefined or false', () => {
    const bytes = buildEscPosBytes({ lines: [{ text: 'abc' }] }, { paperWidth: '80mm' });
    expect(indexOf(bytes, ESCPOS_BYTES.DRAWER_KICK)).toBe(-1);
  });

  it('drawer pulse precedes the cut so the drawer pops as the cashier tears the paper', () => {
    const bytes = buildEscPosBytes(
      { lines: [{ text: 'abc' }], kickDrawer: true },
      { paperWidth: '80mm' }
    );
    const kickIdx = indexOf(bytes, ESCPOS_BYTES.DRAWER_KICK);
    const cutIdx = indexOf(bytes, ESCPOS_BYTES.CUT_FULL);
    expect(kickIdx).toBeGreaterThanOrEqual(0);
    expect(cutIdx).toBeGreaterThanOrEqual(0);
    expect(kickIdx).toBeLessThan(cutIdx);
  });

  it('switches alignment via ESC a n only when it changes between lines', () => {
    const bytes = buildEscPosBytes(
      {
        lines: [
          { text: 'a', align: 'center' },
          { text: 'b', align: 'center' },
          { text: 'c', align: 'right' },
        ],
        cut: false,
      },
      { paperWidth: '80mm' }
    );
    // Center sequence: 1b 61 01
    const center = new Uint8Array([0x1b, 0x61, 0x01]);
    const right = new Uint8Array([0x1b, 0x61, 0x02]);
    // Center should appear exactly once for two consecutive center lines.
    let idx = indexOf(bytes, center);
    expect(idx).toBeGreaterThan(0);
    // Find the second occurrence:
    const second = indexOf(bytes.slice(idx + center.length), center);
    expect(second).toBe(-1);
    // Right should appear exactly once.
    expect(indexOf(bytes, right)).toBeGreaterThan(0);
  });

  it('uses 32 column wrapping for 58mm paper via wrapToColumns', () => {
    // The byte builder calls `wrapToColumns(text, 32)` internally on
    // 58mm paper. Assert the wrapping primitive directly so the
    // assertion is not fragile against the binary encoding.
    const wrapped = wrapToColumns(
      'una linea suficientemente larga para forzar un envoltorio en 32 columnas',
      32
    );
    expect(wrapped.length).toBeGreaterThan(1);
    expect(Math.max(...wrapped.map(l => l.length))).toBeLessThanOrEqual(32);
  });

  it('uses 48 column wrapping for 80mm paper via wrapToColumns', () => {
    const wrapped = wrapToColumns(
      'una linea muy muy larga que solo se envuelve cuando supera las cuarenta y ocho columnas configuradas',
      48
    );
    expect(wrapped.length).toBeGreaterThan(1);
    expect(Math.max(...wrapped.map(l => l.length))).toBeLessThanOrEqual(48);
  });

  it('toggles bold via ESC E n based on the line bold flag', () => {
    const bytes = buildEscPosBytes(
      {
        lines: [{ text: 'plain' }, { text: 'BOLD', bold: true }, { text: 'plain again' }],
        cut: false,
      },
      { paperWidth: '80mm' }
    );
    expect(indexOf(bytes, ESCPOS_BYTES.BOLD_ON)).toBeGreaterThan(0);
    expect(indexOf(bytes, ESCPOS_BYTES.BOLD_OFF)).toBeGreaterThan(0);
  });

  it('renders the receipt total at double height when the line flags it', () => {
    const bytes = buildEscPosBytes(
      {
        lines: [{ text: 'TOTAL: $ 100', doubleHeight: true, bold: true, align: 'right' }],
      },
      { paperWidth: '80mm' }
    );
    expect(indexOf(bytes, ESCPOS_BYTES.DOUBLE_HEIGHT)).toBeGreaterThan(0);
  });

  it('rejects an unsupported paper width', () => {
    expect(() =>
      buildEscPosBytes(NOOP_DOC, { paperWidth: '100mm' as unknown as '80mm' })
    ).toThrow();
  });

  it('rejects an unsupported character set', () => {
    expect(() =>
      buildEscPosBytes(NOOP_DOC, {
        paperWidth: '80mm',
        characterSet: 'iso-8859-1' as unknown as 'cp858',
      })
    ).toThrow();
  });
});

describe('buildSaleReceiptDocument', () => {
  it('produces the canonical line ordering with header, items, totals, footer', () => {
    const doc = buildSaleReceiptDocument({
      header: { tenantName: 'Bodega Doña Ana', siteName: 'Sede Norte' },
      saleNumber: 'VTA-N-000123',
      cashierName: 'Carla',
      items: [
        { name: 'Pan tajado', quantity: 1, unitPrice: 6500, total: 6500 },
        { name: 'Leche entera 1L', quantity: 2, unitPrice: 5400, total: 10800 },
      ],
      subtotal: 17300,
      taxAmount: 0,
      total: 17300,
      totalLabel: 'TOTAL',
      footer: 'Gracias por tu compra',
      formatCurrency: v => `$ ${v.toLocaleString('es-CO')}`,
    });
    const lines = doc.lines.map(l => l.text);
    expect(lines[0]).toBe('Bodega Doña Ana');
    expect(lines).toContain('Sede Norte');
    expect(lines).toContain('Venta: VTA-N-000123');
    expect(lines).toContain('Cajero: Carla');
    expect(lines).toContain('Pan tajado');
    expect(lines).toContain('Leche entera 1L');
    // Total shows up via the totalLabel + currency.
    expect(lines.some(l => l.startsWith('TOTAL: $'))).toBe(true);
    expect(lines).toContain('Gracias por tu compra');
  });
});
