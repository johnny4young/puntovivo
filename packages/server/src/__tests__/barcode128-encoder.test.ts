import { describe, expect, it } from 'vitest';
import {
  encodeCode128EscposBytes,
  encodeCode128Svg,
  encodeCode128Values,
} from '../services/barcode128-encoder.js';

describe('Code 128 encoder', () => {
  it('encodes Code Set B values with the modulo-103 checksum', () => {
    expect(encodeCode128Values('PUNTO-128')).toEqual([
      104, 48, 53, 46, 52, 47, 13, 17, 18, 24, 57, 106,
    ]);
  });

  it('rejects empty and non-printable or non-ASCII sources', () => {
    expect(encodeCode128Values('')).toBeNull();
    expect(encodeCode128Values('   ')).toBeNull();
    expect(encodeCode128Values('line\nbreak')).toBeNull();
    expect(encodeCode128Values('Bogotá')).toBeNull();
  });

  it('renders a safe monochrome SVG with quiet zones and human-readable text', () => {
    const svg = encodeCode128Svg('SALE<&">');
    expect(svg).toContain('viewBox="0 0 ');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('<path d="M10,0');
    expect(svg).toContain('aria-label="SALE&lt;&amp;&quot;&gt;"');
    expect(svg).toContain('>SALE&lt;&amp;&quot;&gt;</text>');
    expect(svg).not.toContain('<script');
    expect(svg).not.toContain('gradient');
  });

  it('pins the Code 128 module pattern for a known one-character symbol', () => {
    const svg = encodeCode128Svg('A');
    expect(svg).toContain('viewBox="0 0 66 62"');
    expect(svg).toContain(
      '<path d="M10,0h2v48h-2zM13,0h1v48h-1zM16,0h1v48h-1zM21,0h1v48h-1zM23,0h1v48h-1zM27,0h2v48h-2zM32,0h1v48h-1zM36,0h1v48h-1zM38,0h2v48h-2zM43,0h2v48h-2zM48,0h3v48h-3zM52,0h1v48h-1zM54,0h2v48h-2z"'
    );
  });

  it('emits native ESC/POS Code 128 function-B commands and restores HRI state', () => {
    const bytes = encodeCode128EscposBytes('SALE-0001', {
      heightDots: 96,
      moduleWidth: 2,
    });
    expect(bytes).not.toBeNull();
    expect(bytes).toEqual([
      0x1d, 0x68, 96, 0x1d, 0x77, 2, 0x1d, 0x48, 0x02, 0x1d, 0x66, 0x01, 0x1d, 0x6b, 0x49, 11, 0x7b,
      0x42, 0x53, 0x41, 0x4c, 0x45, 0x2d, 0x30, 0x30, 0x30, 0x31, 0x1d, 0x48, 0x00,
    ]);
  });

  it('escapes literal braces for ESC/POS and rejects payloads beyond function B', () => {
    const bytes = encodeCode128EscposBytes('A{B');
    expect(bytes).not.toBeNull();
    const commandIndex = bytes?.findIndex(
      (byte, index) => byte === 0x1d && bytes[index + 1] === 0x6b
    );
    expect(commandIndex).toBeGreaterThanOrEqual(0);
    expect(bytes?.slice((commandIndex ?? 0) + 4, (commandIndex ?? 0) + 10)).toEqual([
      0x7b, 0x42, 0x41, 0x7b, 0x7b, 0x42,
    ]);
    expect(encodeCode128EscposBytes('{'.repeat(127))).toBeNull();
  });

  it('rejects a symbol that would consume the printer quiet zones', () => {
    expect(
      encodeCode128EscposBytes('A'.repeat(12), {
        moduleWidth: 2,
        maxWidthDots: 384,
      })
    ).not.toBeNull();
    expect(
      encodeCode128EscposBytes('A'.repeat(13), {
        moduleWidth: 2,
        maxWidthDots: 384,
      })
    ).toBeNull();
  });
});
