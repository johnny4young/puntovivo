import { describe, expect, it } from 'vitest';
import { createLuminanceDecoder, targetBand, toLuminance } from './cameraScanFallback';

const L = [
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
];
const G = L.map(code =>
  [...code]
    .map(bit => (bit === '0' ? '1' : '0'))
    .reverse()
    .join('')
);
const R = L.map(code => [...code].map(bit => (bit === '0' ? '1' : '0')).join(''));
const PARITY = [
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
];

function ean13Modules(code: string): string {
  const digits = [...code].map(Number);
  let modules = '101';
  for (let i = 1; i < 7; i += 1) {
    modules += (PARITY[digits[0]!]![i - 1] === 'L' ? L : G)[digits[i]!];
  }
  modules += '01010';
  for (let i = 7; i < 13; i += 1) modules += R[digits[i]!];
  return `${modules}101`;
}

/** A grey frame with the barcode printed in its middle, as a camera would see it. */
function frameWith(modules: string, moduleWidth = 3) {
  const quiet = 12 * moduleWidth;
  const width = modules.length * moduleWidth + quiet * 2 + 40;
  const height = 60;
  const luma = new Uint8ClampedArray(width * height).fill(200);
  const left = Math.floor((width - modules.length * moduleWidth) / 2);
  for (let y = 10; y < height - 10; y += 1) {
    for (let x = left - quiet; x < left + modules.length * moduleWidth + quiet; x += 1) {
      const module = modules[Math.floor((x - left) / moduleWidth)];
      luma[y * width + x] = module === '1' ? 10 : 245;
    }
  }
  return { luma, width, height };
}

describe('fallback barcode decoder', () => {
  it('reads a retail barcode from a grayscale frame', () => {
    const { luma, width, height } = frameWith(ean13Modules('7702010001017'));
    expect(createLuminanceDecoder()(luma, width, height)).toBe('7702010001017');
  });

  it('returns null for a frame without a code', () => {
    const blank = new Uint8ClampedArray(320 * 60).fill(180);
    expect(createLuminanceDecoder()(blank, 320, 60)).toBeNull();
  });

  it('crops the band under the on-screen target and caps its size', () => {
    expect(targetBand(1280, 720)).toEqual({
      sx: 102,
      sy: 180,
      sw: 1076,
      sh: 360,
      dw: 960,
      dh: 160,
    });
    expect(targetBand(640, 200)).toMatchObject({ sw: 538, sh: 100, dw: 538, dh: 100 });
  });

  it('turns RGBA pixels into luma', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255]);
    expect([...toLuminance(rgba)]).toEqual([255, 0, 76]);
  });
});
