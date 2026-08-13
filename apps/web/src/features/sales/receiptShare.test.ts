import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildReceiptImageFilename,
  buildReceiptWhatsAppUrl,
  createReceiptPng,
  RECEIPT_ASSET_WAIT_TIMEOUT_MS,
  RECEIPT_RENDER_TIMEOUT_MS,
} from './receiptShare';

const html2canvasMock = vi.hoisted(() => vi.fn());

vi.mock('html2canvas', () => ({ default: html2canvasMock }));

describe('receipt share helpers', () => {
  afterEach(() => {
    vi.useRealTimers();
    html2canvasMock.mockReset();
    document.querySelectorAll('iframe').forEach(frame => frame.remove());
  });

  it('builds an explicit WhatsApp handoff without selecting a recipient', () => {
    const url = buildReceiptWhatsAppUrl('Receipt V-1\nTotal: $10');

    expect(url).toBe('https://wa.me/?text=Receipt%20V-1%0ATotal%3A%20%2410');
    expect(url).not.toContain('phone=');
  });

  it('encodes Unicode receipt text and accepts an empty handoff safely', () => {
    expect(buildReceiptWhatsAppUrl('Recibo Ñ-1\nCafé: $10')).toBe(
      'https://wa.me/?text=Recibo%20%C3%91-1%0ACaf%C3%A9%3A%20%2410'
    );
    expect(buildReceiptWhatsAppUrl('')).toBe('https://wa.me/?text=');
  });

  it('builds a filesystem-safe local image filename', () => {
    expect(buildReceiptImageFilename('FE / 2026 # 001')).toBe('puntovivo-recibo-fe-2026-001.png');
    expect(buildReceiptImageFilename('FÉ-Ñ-001')).toBe('puntovivo-recibo-fe-n-001.png');
    expect(buildReceiptImageFilename('🧾')).toBe('puntovivo-recibo-venta.png');
  });

  it('sandboxes receipt HTML while retaining same-origin capture access', async () => {
    const canvas = document.createElement('canvas');
    canvas.toBlob = callback => callback(new Blob(['png'], { type: 'image/png' }));
    html2canvasMock.mockResolvedValue(canvas);

    const capture = createReceiptPng('<html><body>Receipt V-1</body></html>');
    const frame = document.querySelector('iframe');

    expect(frame).not.toBeNull();
    expect(frame).toHaveAttribute('sandbox', 'allow-same-origin');
    frame?.dispatchEvent(new Event('load'));

    await expect(capture).resolves.toMatchObject({ type: 'image/png' });
    expect(html2canvasMock).toHaveBeenCalledWith(
      expect.objectContaining({ tagName: 'BODY' }),
      expect.objectContaining({
        imageTimeout: RECEIPT_ASSET_WAIT_TIMEOUT_MS,
        logging: false,
        useCORS: true,
      })
    );
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('captures after the shared asset deadline when fonts and images never settle', async () => {
    vi.useFakeTimers();
    const canvas = document.createElement('canvas');
    canvas.toBlob = callback => callback(new Blob(['png'], { type: 'image/png' }));
    html2canvasMock.mockResolvedValue(canvas);

    const capture = createReceiptPng('<html><body>Receipt V-2</body></html>');
    const frame = document.querySelector('iframe');
    const frameDocument = frame?.contentDocument;
    expect(frameDocument?.body).not.toBeNull();

    Object.defineProperty(frameDocument, 'fonts', {
      configurable: true,
      value: { ready: new Promise(() => undefined) },
    });
    const stalledImage = frameDocument!.createElement('img');
    Object.defineProperty(stalledImage, 'complete', { configurable: true, value: false });
    frameDocument!.body.appendChild(stalledImage);
    frame?.dispatchEvent(new Event('load'));

    await vi.advanceTimersByTimeAsync(RECEIPT_ASSET_WAIT_TIMEOUT_MS - 1);
    expect(html2canvasMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(capture).resolves.toMatchObject({ type: 'image/png' });
    expect(html2canvasMock).toHaveBeenCalledWith(
      expect.objectContaining({ tagName: 'BODY' }),
      expect.objectContaining({ imageTimeout: RECEIPT_ASSET_WAIT_TIMEOUT_MS })
    );
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('rejects and removes the frame when html2canvas never settles', async () => {
    vi.useFakeTimers();
    html2canvasMock.mockReturnValue(new Promise(() => undefined));

    const capture = createReceiptPng('<html><body>Receipt V-3</body></html>');
    const outcome = capture.then(
      () => null,
      error => error as Error
    );
    document.querySelector('iframe')?.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(0);
    expect(html2canvasMock).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(RECEIPT_RENDER_TIMEOUT_MS);
    expect(await outcome).toEqual(expect.objectContaining({ message: 'Receipt rendering timed out' }));
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('rejects and removes the frame when canvas encoding never calls back', async () => {
    vi.useFakeTimers();
    const canvas = document.createElement('canvas');
    canvas.toBlob = () => undefined;
    html2canvasMock.mockResolvedValue(canvas);

    const capture = createReceiptPng('<html><body>Receipt V-4</body></html>');
    const outcome = capture.then(
      () => null,
      error => error as Error
    );
    document.querySelector('iframe')?.dispatchEvent(new Event('load'));
    await vi.advanceTimersByTimeAsync(0);

    await vi.advanceTimersByTimeAsync(RECEIPT_ASSET_WAIT_TIMEOUT_MS);
    expect(await outcome).toEqual(
      expect.objectContaining({ message: 'Receipt image encoding timed out' })
    );
    expect(document.querySelector('iframe')).toBeNull();
  });
});
