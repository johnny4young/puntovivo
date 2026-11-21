// Deep imports keep the RSS and 2D readers, which the package index drags in, out of the chunk.
import BinaryBitmap from '@zxing/library/esm/core/BinaryBitmap';
import DecodeHintType from '@zxing/library/esm/core/DecodeHintType';
import NotFoundException from '@zxing/library/esm/core/NotFoundException';
import RGBLuminanceSource from '@zxing/library/esm/core/RGBLuminanceSource';
import type BitArray from '@zxing/library/esm/core/common/BitArray';
import HybridBinarizer from '@zxing/library/esm/core/common/HybridBinarizer';
import Code128Reader from '@zxing/library/esm/core/oned/Code128Reader';
import Code39Reader from '@zxing/library/esm/core/oned/Code39Reader';
import ITFReader from '@zxing/library/esm/core/oned/ITFReader';
import MultiFormatUPCEANReader from '@zxing/library/esm/core/oned/MultiFormatUPCEANReader';
import OneDReader from '@zxing/library/esm/core/oned/OneDReader';
import type { CameraCodeReader } from './cameraScan';

/** Tries each retail symbology on a row, as the library's multi-format reader does; mirrors the native format list. */
class RetailOneDReader extends OneDReader {
  private readonly readers: OneDReader[];

  constructor() {
    super();
    this.readers = [
      new MultiFormatUPCEANReader(new Map()),
      new Code128Reader(),
      new Code39Reader(),
      new ITFReader(),
    ];
  }

  decodeRow(rowNumber: number, row: BitArray, hints: Map<DecodeHintType, unknown>) {
    for (const reader of this.readers) {
      try {
        return reader.decodeRow(rowNumber, row, hints);
      } catch {
        // Not this symbology; try the next one.
      }
    }
    throw new NotFoundException();
  }
}

/** Wide enough for a phone frame held at arm's length, small enough to decode every tick. */
const MAX_BAND_WIDTH = 960;
/** The decoder samples about 15 rows, so a taller band only costs pixels; bars stay vertical when squashed. */
const MAX_BAND_HEIGHT = 160;

/** The band under the on-screen target, scaled down for decoding. */
export function targetBand(width: number, height: number) {
  const sx = Math.round(width * 0.08);
  const sy = Math.round(height * 0.25);
  const sw = width - sx * 2;
  const sh = height - sy * 2;
  const dw = Math.round(sw * Math.min(1, MAX_BAND_WIDTH / sw));
  return { sx, sy, sw, sh, dw, dh: Math.min(sh, MAX_BAND_HEIGHT) };
}

/** Rec. 601 luma from RGBA pixels, the input the decoder expects. */
export function toLuminance(rgba: Uint8ClampedArray): Uint8ClampedArray {
  const luma = new Uint8ClampedArray(rgba.length / 4);
  for (let i = 0, p = 0; p < luma.length; i += 4, p += 1) {
    luma[p] = (rgba[i]! * 299 + rgba[i + 1]! * 587 + rgba[i + 2]! * 114) / 1000;
  }
  return luma;
}

/** Decodes one grayscale image; null when it holds no retail code. */
export function createLuminanceDecoder() {
  // No TRY_HARDER: it scans every row and makes a missed frame about ten times slower.
  const reader = new RetailOneDReader();
  return (luma: Uint8ClampedArray, width: number, height: number): string | null => {
    const source = new RGBLuminanceSource(luma, width, height);
    try {
      return reader.decode(new BinaryBitmap(new HybridBinarizer(source))).getText();
    } catch {
      // No code in this frame (or a misread checksum); the next frame may have one.
      return null;
    }
  };
}

export function createFallbackCodeReader(): CameraCodeReader {
  const decode = createLuminanceDecoder();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D is unavailable');

  return {
    async read(video) {
      if (!video.videoWidth || !video.videoHeight) return null;
      const band = targetBand(video.videoWidth, video.videoHeight);
      // Assigning a canvas size clears its backing store, even to the same value.
      if (canvas.width !== band.dw) canvas.width = band.dw;
      if (canvas.height !== band.dh) canvas.height = band.dh;
      context.drawImage(video, band.sx, band.sy, band.sw, band.sh, 0, 0, band.dw, band.dh);
      const luma = toLuminance(context.getImageData(0, 0, band.dw, band.dh).data);
      return decode(luma, band.dw, band.dh);
    },
  };
}
