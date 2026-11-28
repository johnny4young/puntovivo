import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PURCHASE_IMAGE_MAX_LONG_SIDE_PX,
  PURCHASE_IMAGE_QUALITY,
  preparePurchaseDocumentFile,
} from './preparePurchaseDocumentFile';

describe('preparePurchaseDocumentFile', () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, 'createImageBitmap', {
      value: originalCreateImageBitmap,
      configurable: true,
      writable: true,
    });
  });

  it('passes PDFs through unchanged without invoking image compression', async () => {
    const createBitmap = vi.fn();
    Object.defineProperty(globalThis, 'createImageBitmap', {
      value: createBitmap,
      configurable: true,
      writable: true,
    });

    const pdf = new File(['%PDF-1.4\n%%EOF\n'], 'remision.pdf', { type: 'application/pdf' });
    const prepared = await preparePurchaseDocumentFile(pdf);

    expect(createBitmap).not.toHaveBeenCalled();
    expect(prepared.fileName).toBe('remision.pdf');
    expect(prepared.mimeType).toBe('application/pdf');
    expect(atob(prepared.documentBase64)).toBe('%PDF-1.4\n%%EOF\n');
  });

  it('downscales oversized images to 1600 px on the long side and encodes as WebP', async () => {
    const close = vi.fn();
    const fillRect = vi.fn();
    const drawImage = vi.fn();
    const context = { fillStyle: '', fillRect, drawImage };
    Object.defineProperty(globalThis, 'createImageBitmap', {
      value: vi.fn(async () => ({ width: 4000, height: 3000, close })),
      configurable: true,
      writable: true,
    });

    const createdCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((cb: BlobCallback, mimeType?: string, quality?: number) => {
        expect(mimeType).toBe('image/webp');
        expect(quality).toBe(PURCHASE_IMAGE_QUALITY);
        cb(new Blob(['RIFF\x0c\x00\x00\x00WEBPVP8 '], { type: 'image/webp' }));
      }),
    };
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) =>
      tagName === 'canvas'
        ? (createdCanvas as unknown as HTMLCanvasElement)
        : originalCreateElement(tagName)) as typeof document.createElement);

    const photo = new File([new Uint8Array(2048)], 'IMG_0042.JPG', { type: 'image/jpeg' });
    const prepared = await preparePurchaseDocumentFile(photo);

    expect(createdCanvas.width).toBe(PURCHASE_IMAGE_MAX_LONG_SIDE_PX);
    expect(createdCanvas.height).toBe(1200);
    expect(context.fillStyle).toBe('#ffffff');
    expect(fillRect).toHaveBeenCalledWith(0, 0, 1600, 1200);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200);
    expect(close).toHaveBeenCalledTimes(1);
    expect(prepared.mimeType).toBe('image/webp');
    expect(prepared.fileName).toBe('IMG_0042.webp');
  });

  it('falls back to JPEG when the canvas does not support WebP encoding', async () => {
    const close = vi.fn();
    Object.defineProperty(globalThis, 'createImageBitmap', {
      value: vi.fn(async () => ({ width: 2000, height: 1000, close })),
      configurable: true,
      writable: true,
    });

    const createdCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() })),
      toBlob: vi.fn((cb: BlobCallback, mimeType?: string) => {
        if (mimeType === 'image/webp') {
          cb(new Blob(['png-fallback'], { type: 'image/png' }));
          return;
        }
        cb(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }));
      }),
    };
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) =>
      tagName === 'canvas'
        ? (createdCanvas as unknown as HTMLCanvasElement)
        : originalCreateElement(tagName)) as typeof document.createElement);

    const photo = new File([new Uint8Array(4096)], 'scan.png', { type: 'image/png' });
    const prepared = await preparePurchaseDocumentFile(photo);

    expect(createdCanvas.width).toBe(1600);
    expect(createdCanvas.height).toBe(800);
    expect(prepared.mimeType).toBe('image/jpeg');
    expect(prepared.fileName).toBe('scan.jpg');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported MIME types and empty files with distinct errors', async () => {
    const textFile = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    await expect(preparePurchaseDocumentFile(textFile)).rejects.toThrow('UNSUPPORTED_MIME');

    const emptyPdf = new File([], 'empty.pdf', { type: 'application/pdf' });
    await expect(preparePurchaseDocumentFile(emptyPdf)).rejects.toThrow('EMPTY_DOCUMENT');
  });
});
