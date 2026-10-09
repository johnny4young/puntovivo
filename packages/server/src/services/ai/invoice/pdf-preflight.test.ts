import { jsPDF } from 'jspdf';
import { describe, expect, it } from 'vitest';

import { ServerErrorWithCode } from '../../../lib/errorCodes.js';
import { assertSinglePagePdf } from './pdf-preflight.js';

function pdfBase64(pageCount: number): string {
  const document = new jsPDF();
  for (let page = 1; page < pageCount; page += 1) document.addPage();
  return Buffer.from(document.output('arraybuffer')).toString('base64');
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return undefined;
}

describe('assertSinglePagePdf', () => {
  it('accepts exactly one page and rejects several', async () => {
    await expect(assertSinglePagePdf(pdfBase64(1))).resolves.toBeUndefined();
    const error = await caught(assertSinglePagePdf(pdfBase64(2)));
    expect((error as { cause?: ServerErrorWithCode }).cause?.errorCode).toBe(
      'AI_VISION_PDF_PAGE_LIMIT'
    );
  });

  it('reports a client cancellation during parsing as an abort, not an invalid PDF', async () => {
    const controller = new AbortController();
    const pending = assertSinglePagePdf(pdfBase64(1), controller.signal);
    controller.abort();
    const error = await caught(pending);
    expect(error).toMatchObject({ name: 'AbortError' });
    expect((error as { cause?: unknown }).cause).not.toBeInstanceOf(ServerErrorWithCode);
  });

  it('still reports a malformed document as AI_VISION_PDF_INVALID', async () => {
    const error = await caught(assertSinglePagePdf(Buffer.from('%PDF-1.7').toString('base64')));
    expect((error as { cause?: ServerErrorWithCode }).cause?.errorCode).toBe(
      'AI_VISION_PDF_INVALID'
    );
  });
});
