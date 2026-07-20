import { describe, expect, it, vi } from 'vitest';
import { encodeQrEscposBytes, encodeQrSvg } from '../services/qr-encoder.js';

describe('qr-encoder', () => {
  describe('encodeQrSvg', () => {
    it('returns a self-contained SVG for a valid URL source', () => {
      const svg = encodeQrSvg(
        'https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=abc',
        { pixelSize: 96 }
      );
      expect(svg).not.toBeNull();
      expect(svg!.startsWith('<svg')).toBe(true);
      expect(svg!).toContain('xmlns="http://www.w3.org/2000/svg"');
      // The qrcode lib's SVG output ships viewBox + width attrs.
      expect(svg!).toContain('viewBox');
      // 1-bit rule: must NOT contain gradient / opacity fills.
      expect(svg!).not.toContain('gradient');
      expect(svg!).not.toContain('opacity');
    });

    it('returns null for an empty / whitespace-only source', () => {
      expect(encodeQrSvg('', { pixelSize: 96 })).toBeNull();
      expect(encodeQrSvg('   ', { pixelSize: 96 })).toBeNull();
    });

    it('returns null when the payload exceeds QR capacity', () => {
      // A 5000-character ASCII blob blows past version-40 capacity even
      // at EC level L; the encoder must surface a warning + null
      // instead of throwing.
      const huge = 'A'.repeat(5000);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const svg = encodeQrSvg(huge, { pixelSize: 96 });
      expect(svg).toBeNull();
      expect(warnSpy).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
    });
  });

  describe('encodeQrEscposBytes', () => {
    it('emits the canonical GS ( k sequence for model 2 / EC M / size 6', () => {
      const bytes = encodeQrEscposBytes('puntovivo.co/f/FE-1');
      expect(bytes).not.toBeNull();
      const arr = bytes!;
      // Model select: GS ( k 04 00 31 41 32 00 = [0x1d 0x28 0x6b 0x04 0x00 0x31 0x41 0x32 0x00].
      expect(arr.slice(0, 9)).toEqual([0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
      // Module size: GS ( k 03 00 31 43 06.
      expect(arr.slice(9, 17)).toEqual([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06]);
      // Error correction: GS ( k 03 00 31 45 31 (M = 0x31).
      expect(arr.slice(17, 25)).toEqual([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31]);
      // Print: last 8 bytes are GS ( k 03 00 31 51 30.
      expect(arr.slice(-8)).toEqual([0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30]);
    });

    it('encodes the payload bytes between the store-data header and the print opcode', () => {
      const payload = 'AB';
      const bytes = encodeQrEscposBytes(payload);
      expect(bytes).not.toBeNull();
      const arr = bytes!;
      // Store-data header: GS ( k pL pH 31 50 30 where pL = len + 3 = 5.
      // Search for the 31 50 30 marker so we are not coupled to the
      // exact offset (the function commands above are fixed length).
      const storeIdx = arr.findIndex(
        (b, i) =>
          b === 0x1d &&
          arr[i + 1] === 0x28 &&
          arr[i + 2] === 0x6b &&
          arr[i + 5] === 0x31 &&
          arr[i + 6] === 0x50 &&
          arr[i + 7] === 0x30
      );
      expect(storeIdx).toBeGreaterThan(0);
      // pL = 5 (2 chars + 3), pH = 0.
      expect(arr[storeIdx + 3]).toBe(0x05);
      expect(arr[storeIdx + 4]).toBe(0x00);
      // Payload is the next 2 bytes: 'A' (0x41), 'B' (0x42).
      expect(arr[storeIdx + 8]).toBe(0x41);
      expect(arr[storeIdx + 9]).toBe(0x42);
    });

    it('returns null for an empty source', () => {
      expect(encodeQrEscposBytes('')).toBeNull();
      expect(encodeQrEscposBytes('   ')).toBeNull();
    });

    it('refuses to encode a payload over the 2953-byte 8-bit cap', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const huge = 'A'.repeat(3000);
      expect(encodeQrEscposBytes(huge)).toBeNull();
      expect(warnSpy).toHaveBeenCalledOnce();
      warnSpy.mockRestore();
    });

    it('collapses non-ASCII payload chars to "?" so the printer buffer stays ASCII', () => {
      const bytes = encodeQrEscposBytes('aéb');
      expect(bytes).not.toBeNull();
      const arr = bytes!;
      const storeIdx = arr.findIndex(
        (b, i) =>
          b === 0x1d &&
          arr[i + 1] === 0x28 &&
          arr[i + 2] === 0x6b &&
          arr[i + 5] === 0x31 &&
          arr[i + 6] === 0x50 &&
          arr[i + 7] === 0x30
      );
      expect(storeIdx).toBeGreaterThan(0);
      // Payload bytes follow the store-data header (8 bytes from start
      // of the GS ( k command).
      expect(arr[storeIdx + 8]).toBe(0x61); // 'a'
      expect(arr[storeIdx + 9]).toBe(0x3f); // 'é' → '?'
      expect(arr[storeIdx + 10]).toBe(0x62); // 'b'
    });

    it('clamps moduleSize outside [1..16] to the allowed range', () => {
      const tiny = encodeQrEscposBytes('x', { moduleSize: 0 });
      const huge = encodeQrEscposBytes('x', { moduleSize: 99 });
      // The module-size byte lives inside the second `GS ( k` command
      // (Function 167). Locate it via the opcode signature instead of a
      // fixed offset so test stays robust if the model-select prelude
      // ever grows.
      const sizeByteOf = (bytes: number[]) => {
        const idx = bytes.findIndex(
          (b, i) =>
            b === 0x1d &&
            bytes[i + 1] === 0x28 &&
            bytes[i + 2] === 0x6b &&
            bytes[i + 5] === 0x31 &&
            bytes[i + 6] === 0x43
        );
        return idx >= 0 ? bytes[idx + 7] : undefined;
      };
      expect(sizeByteOf(tiny!)).toBe(0x01);
      expect(sizeByteOf(huge!)).toBe(0x10);
    });
  });
});
