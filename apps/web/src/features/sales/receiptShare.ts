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

/**
 * A receipt remains useful without a remote logo or custom font. Do not let a
 * stalled asset keep the cashier's local share action pending indefinitely.
 * html2canvas receives the same bound for resources loaded by its cloned
 * document, so both asset phases share one explicit policy.
 */
export const RECEIPT_ASSET_WAIT_TIMEOUT_MS = 3_000;
export const RECEIPT_RENDER_TIMEOUT_MS = 8_000;

function waitForFrame(frame: HTMLIFrameElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const onLoad = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    const timeout = window.setTimeout(() => {
      frame.removeEventListener('load', onLoad);
      reject(new Error('Receipt image timed out'));
    }, 8_000);
    frame.addEventListener('load', onLoad, { once: true });
  });
}

async function waitForReceiptAssets(frameDocument: Document): Promise<void> {
  const controller = new AbortController();
  let timeout: number | undefined;

  const imagePromises = Array.from(frameDocument.images, image => {
    if (image.complete) return Promise.resolve();
    return new Promise<void>(resolve => {
      const settle = () => resolve();
      image.addEventListener('load', settle, { once: true, signal: controller.signal });
      image.addEventListener('error', settle, { once: true, signal: controller.signal });
    });
  });
  const assetsReady = Promise.allSettled([
    ...(frameDocument.fonts ? [frameDocument.fonts.ready] : []),
    ...imagePromises,
  ]);
  const deadline = new Promise<void>(resolve => {
    timeout = window.setTimeout(resolve, RECEIPT_ASSET_WAIT_TIMEOUT_MS);
  });

  try {
    await Promise.race([assetsReady, deadline]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
    controller.abort();
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      value => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      error => {
        window.clearTimeout(timeout);
        reject(error);
      }
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
  frame.setAttribute('sandbox', 'allow-same-origin');
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
    await waitForReceiptAssets(frameDocument);

    const body = frameDocument.body;
    frame.style.width = `${Math.max(320, body.scrollWidth)}px`;
    frame.style.height = `${Math.max(1, body.scrollHeight)}px`;
    const canvas = await withTimeout(
      import('html2canvas').then(({ default: html2canvas }) =>
        html2canvas(body, {
          backgroundColor: '#ffffff',
          imageTimeout: RECEIPT_ASSET_WAIT_TIMEOUT_MS,
          scale: Math.min(2, window.devicePixelRatio || 1),
          logging: false,
          useCORS: true,
          windowWidth: Math.max(320, body.scrollWidth),
          windowHeight: Math.max(1, body.scrollHeight),
        })
      ),
      RECEIPT_RENDER_TIMEOUT_MS,
      'Receipt rendering timed out'
    );
    return withTimeout(
      canvasToPng(canvas),
      RECEIPT_ASSET_WAIT_TIMEOUT_MS,
      'Receipt image encoding timed out'
    );
  } finally {
    frame.remove();
  }
}
