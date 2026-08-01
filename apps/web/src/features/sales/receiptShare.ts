export function buildReceiptWhatsAppUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function buildReceiptImageFilename(saleNumber: string): string {
  const safeSaleNumber = saleNumber
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `puntovivo-recibo-${safeSaleNumber || 'venta'}.png`;
}

function waitForFrame(frame: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Receipt image timed out')), 8_000);
    frame.addEventListener(
      'load',
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not encode the receipt image'));
    }, 'image/png');
  });
}

/**
 * Captures the trusted server-rendered receipt in an isolated, off-screen
 * document. The resulting Blob remains local to the terminal; callers decide
 * whether to download it. No receipt or customer field is uploaded.
 */
export async function createReceiptPng(html: string): Promise<Blob> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.left = '-10000px';
  frame.style.top = '0';
  frame.style.width = '640px';
  frame.style.height = '1px';
  frame.style.border = '0';
  document.body.appendChild(frame);

  try {
    const loaded = waitForFrame(frame);
    frame.srcdoc = html;
    await loaded;

    const frameDocument = frame.contentDocument;
    if (!frameDocument?.body) throw new Error('Receipt document is unavailable');
    await frameDocument.fonts?.ready;
    await Promise.all(
      Array.from(frameDocument.images).map(
        image =>
          image.complete ||
          new Promise<void>(resolve => {
            image.addEventListener('load', () => resolve(), { once: true });
            image.addEventListener('error', () => resolve(), { once: true });
          })
      )
    );

    const body = frameDocument.body;
    frame.style.width = `${Math.max(320, body.scrollWidth)}px`;
    frame.style.height = `${Math.max(1, body.scrollHeight)}px`;
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(body, {
      backgroundColor: '#ffffff',
      scale: Math.min(2, window.devicePixelRatio || 1),
      logging: false,
      useCORS: true,
      windowWidth: Math.max(320, body.scrollWidth),
      windowHeight: Math.max(1, body.scrollHeight),
    });
    return canvasToPng(canvas);
  } finally {
    frame.remove();
  }
}
