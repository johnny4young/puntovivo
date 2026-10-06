import { throwServerError } from '../../../lib/errorCodes.js';

/**
 * Validate the PDF page tree before a paid synchronous Textract attempt.
 * A file-size limit is enforced by the upload route; this deadline bounds
 * parser work on malformed but byte-bounded documents.
 */
export async function assertSinglePagePdf(documentBase64: string, abortSignal?: AbortSignal) {
  const deadline = AbortSignal.timeout(10_000);
  const signal = abortSignal ? AbortSignal.any([abortSignal, deadline]) : deadline;
  signal.throwIfAborted();

  let pageCount: number;
  try {
    // Load only for PDFs: image OCR does not pay the parser's startup cost.
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    signal.throwIfAborted();
    const bytes = new Uint8Array(Buffer.from(documentBase64, 'base64'));
    const loadingTask = getDocument({
      data: bytes,
      useWorkerFetch: false,
      stopAtErrors: true,
      // Defence in depth for untrusted uploads: the preflight only counts
      // pages, so never install font faces or render XFA forms. (PDF.js 6 no
      // longer compiles font programs with eval; cf. CVE-2024-4367.)
      disableFontFace: true,
      enableXfa: false,
    });
    let onAbort: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
      const document = await Promise.race([loadingTask.promise, aborted]);
      pageCount = document.numPages;
      if (pageCount === 1) {
        // A broken page tree can advertise one page without yielding it.
        const page = await Promise.race([document.getPage(1), aborted]);
        page.cleanup();
      }
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
      await loadingTask.destroy();
    }
  } catch (error) {
    // A client that went away is a cancellation, not an invalid PDF; let the
    // request boundary report it as such. Our own parse deadline still means
    // the document could not be validated.
    if (abortSignal?.aborted) throw abortSignal.reason ?? error;
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_VISION_PDF_INVALID',
      message: 'Invoice PDF could not be validated before extraction',
    });
  }
  if (pageCount !== 1) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_VISION_PDF_PAGE_LIMIT',
      message: 'Synchronous invoice extraction accepts exactly one PDF page',
    });
  }
}
