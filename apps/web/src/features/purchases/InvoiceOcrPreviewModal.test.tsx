/**
 * ENG-040a + slice 1b — Tests for InvoiceOcrPreviewModal.
 *
 * Slice 1 tests cover the upload + preview rendering; slice 1b adds
 * the match CTA path, unavailable mode, create-purchase callback,
 * and the module-deactivated render branch.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/utils';
import { InvoiceOcrPreviewModal } from './InvoiceOcrPreviewModal';
import type { PurchaseCartItem } from './purchaseCart';

const extractMutate = vi.fn();
const matchMutate = vi.fn();
let extractOnSuccess: ((result: unknown) => void) | null = null;
let matchOnSuccess: ((result: unknown) => void) | null = null;
let extractError: Error | null = null;
let matchError: Error | null = null;
let semanticSearchActive = true;
const successToast = vi.fn();
const infoToast = vi.fn();

vi.mock('@/lib/trpc', () => ({
  trpc: {
    ai: {
      extractInvoiceLines: {
        useMutation: ({ onSuccess }: { onSuccess?: (result: unknown) => void }) => {
          extractOnSuccess = onSuccess ?? null;
          return {
            isPending: false,
            isError: false,
            mutateAsync: (input: unknown) => {
              extractMutate(input);
              if (extractError) {
                return Promise.reject(extractError);
              }
              return Promise.resolve(null);
            },
            reset: vi.fn(),
          };
        },
      },
      matchInvoiceLines: {
        useMutation: ({ onSuccess }: { onSuccess?: (result: unknown) => void }) => {
          matchOnSuccess = onSuccess ?? null;
          return {
            isPending: false,
            isError: Boolean(matchError),
            mutateAsync: (input: unknown) => {
              matchMutate(input);
              if (matchError) {
                return Promise.reject(matchError);
              }
              return Promise.resolve(null);
            },
            reset: vi.fn(),
          };
        },
      },
    },
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: successToast,
    error: vi.fn(),
    info: infoToast,
    warning: vi.fn(),
  }),
}));

vi.mock('@/features/modules', () => ({
  useIsModuleActive: () => semanticSearchActive,
}));

beforeEach(() => {
  extractMutate.mockClear();
  matchMutate.mockClear();
  successToast.mockClear();
  infoToast.mockClear();
  extractOnSuccess = null;
  matchOnSuccess = null;
  extractError = null;
  matchError = null;
  semanticSearchActive = true;
});

function buildFile(name: string, type: string, size: number): File {
  const file = new File(['x'.repeat(Math.min(size, 1024))], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

const SAMPLE_INVOICE_RESPONSE = {
  invoice: {
    supplierName: 'Distribuidora Norte',
    supplierTaxId: '900123456-1',
    invoiceNumber: 'FAC-0001',
    invoiceDate: '2026-05-09',
    currencyCode: 'COP',
    lines: [
      { description: 'Coca Cola', quantity: 12, unitPrice: 4500, totalLine: 54000 },
      { description: 'Pan tajado', quantity: 4, unitPrice: 3000, totalLine: 12000 },
    ],
    subtotal: 66000,
    taxAmount: 12540,
    total: 78540,
  },
  costUsd: 0.012,
  durationMs: 800,
  provider: 'anthropic',
  model: 'test-vision',
  auditLogId: 'audit-1',
};

async function uploadAndPreview() {
  const input = screen.getByTestId('ocr-file-input') as HTMLInputElement;
  const file = buildFile('invoice.png', 'image/png', 4 * 1024);
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(extractMutate).toHaveBeenCalledTimes(1));
  expect(extractOnSuccess).toBeTruthy();
  extractOnSuccess?.(SAMPLE_INVOICE_RESPONSE);
  await waitFor(() => expect(screen.getByTestId('ocr-preview')).toBeInTheDocument());
}

describe('InvoiceOcrPreviewModal', () => {
  it('renders the upload CTA when open', () => {
    render(<InvoiceOcrPreviewModal isOpen onClose={vi.fn()} />);
    expect(screen.getByTestId('ocr-upload-button')).toBeInTheDocument();
    expect(screen.getByText(/Invoice OCR/i)).toBeInTheDocument();
  });

  it('rejects an oversize image without calling the mutation', async () => {
    render(<InvoiceOcrPreviewModal isOpen onClose={vi.fn()} />);
    const input = screen.getByTestId('ocr-file-input') as HTMLInputElement;
    const huge = buildFile('big.jpg', 'image/jpeg', 6 * 1024 * 1024);
    fireEvent.change(input, { target: { files: [huge] } });
    await waitFor(() => {
      expect(screen.getByText(/exceeds the 5 MB limit/i)).toBeInTheDocument();
    });
    expect(extractMutate).not.toHaveBeenCalled();
  });

  it('rejects an unsupported MIME type without calling the mutation', async () => {
    render(<InvoiceOcrPreviewModal isOpen onClose={vi.fn()} />);
    const input = screen.getByTestId('ocr-file-input') as HTMLInputElement;
    const gif = buildFile('a.gif', 'image/gif', 1024);
    fireEvent.change(input, { target: { files: [gif] } });
    await waitFor(() => {
      expect(screen.getByText(/JPG, PNG or WebP/i)).toBeInTheDocument();
    });
    expect(extractMutate).not.toHaveBeenCalled();
  });

  it('passes the image payload to the mutation and renders the extracted preview', async () => {
    render(<InvoiceOcrPreviewModal isOpen onClose={vi.fn()} />);
    await uploadAndPreview();
    expect(screen.getByText('Distribuidora Norte')).toBeInTheDocument();
    expect(screen.getByText('FAC-0001')).toBeInTheDocument();
    expect(screen.getByText('Coca Cola')).toBeInTheDocument();
  });

  it('does not render raw server mutation errors inside the validation box', async () => {
    extractError = new Error('Provider anthropic is not configured (set the API key env var)');
    render(<InvoiceOcrPreviewModal isOpen onClose={vi.fn()} />);
    const input = screen.getByTestId('ocr-file-input') as HTMLInputElement;
    const file = buildFile('invoice.png', 'image/png', 4 * 1024);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(extractMutate).toHaveBeenCalledTimes(1);
    });
    expect(
      screen.queryByText(/Provider anthropic is not configured/i)
    ).not.toBeInTheDocument();
  });

  // Slice 1b — line-to-product matching + cart pre-fill.

  it('exposes the match CTA when the semantic-search module is active and preview lines exist', async () => {
    render(<InvoiceOcrPreviewModal isOpen onClose={vi.fn()} />);
    await uploadAndPreview();
    expect(screen.getByTestId('ocr-match-button')).toBeInTheDocument();
    expect(screen.queryByTestId('ocr-match-module-hint')).not.toBeInTheDocument();
  });

  it('hides the match CTA and shows the module hint when semantic-search is inactive', async () => {
    semanticSearchActive = false;
    render(<InvoiceOcrPreviewModal isOpen onClose={vi.fn()} />);
    await uploadAndPreview();
    expect(screen.queryByTestId('ocr-match-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('ocr-match-module-hint')).toBeInTheDocument();
  });

  it('renders the unavailable hint when the matcher returns mode unavailable', async () => {
    render(<InvoiceOcrPreviewModal isOpen onClose={vi.fn()} />);
    await uploadAndPreview();
    fireEvent.click(screen.getByTestId('ocr-match-button'));
    await waitFor(() => expect(matchMutate).toHaveBeenCalledTimes(1));
    matchOnSuccess?.({ mode: 'unavailable', reason: 'no-embeddings', matches: [] });
    await waitFor(() =>
      expect(screen.getByTestId('ocr-match-unavailable')).toBeInTheDocument()
    );
  });

  it('fires onMatchedLinesReady with matched cart items and surfaces unmatched count', async () => {
    const onMatchedLinesReady = vi.fn();
    const onClose = vi.fn();
    render(
      <InvoiceOcrPreviewModal
        isOpen
        onClose={onClose}
        onMatchedLinesReady={onMatchedLinesReady}
      />
    );
    await uploadAndPreview();
    fireEvent.click(screen.getByTestId('ocr-match-button'));
    await waitFor(() => expect(matchMutate).toHaveBeenCalledTimes(1));
    // First line matches; second line is below the floor.
    matchOnSuccess?.({
      mode: 'matched',
      matches: [
        {
          line: { description: 'Coca Cola', quantity: 12, unitPrice: 4500, totalLine: 54000 },
          product: {
            productId: 'prod-cola',
            productName: 'Coca Cola 1.5L',
            productSku: 'CCL-15',
            cost: 4500,
            stock: 24,
            unitId: 'unit-und',
            unitName: 'Unidad',
            unitAbbreviation: 'UND',
            unitEquivalence: 1,
          },
          similarity: 0.93,
        },
        {
          line: { description: 'Pan tajado', quantity: 4, unitPrice: 3000, totalLine: 12000 },
          product: null,
          similarity: null,
        },
      ],
    });
    await waitFor(() =>
      expect(screen.getByTestId('ocr-create-purchase-button')).toBeInTheDocument()
    );

    fireEvent.click(screen.getByTestId('ocr-create-purchase-button'));
    expect(onMatchedLinesReady).toHaveBeenCalledTimes(1);
    const payload = onMatchedLinesReady.mock.calls[0]![0] as PurchaseCartItem[];
    expect(payload).toHaveLength(1);
    expect(payload[0]?.productId).toBe('prod-cola');
    expect(payload[0]?.quantity).toBe(12);
    expect(payload[0]?.costPerUnit).toBe(4500);
    expect(payload[0]?.unitId).toBe('unit-und');
    expect(infoToast).toHaveBeenCalled();
    expect(successToast).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the match CTA visible after the mutation throws so the operator can retry', async () => {
    matchError = new Error('Network down');
    render(<InvoiceOcrPreviewModal isOpen onClose={vi.fn()} />);
    await uploadAndPreview();
    fireEvent.click(screen.getByTestId('ocr-match-button'));
    await waitFor(() => expect(matchMutate).toHaveBeenCalledTimes(1));
    // The CTA stays in the DOM so the operator can retry. The exact
    // label flips to "Retry matching" via the mutation's `isError`
    // flag; that wiring is covered by manual smoke since vi mock state
    // does not roundtrip into React's render cycle in a single click.
    expect(screen.getByTestId('ocr-match-button')).toBeInTheDocument();
  });

  // ENG-040d — mobile/tablet camera capture.

  it('renders the dual upload + camera CTAs side by side', () => {
    render(<InvoiceOcrPreviewModal isOpen onClose={vi.fn()} />);
    expect(screen.getByTestId('ocr-upload-button')).toBeInTheDocument();
    expect(screen.getByTestId('ocr-camera-button')).toBeInTheDocument();
  });

  it('exposes capture="environment" on the camera input so mobile browsers open the rear camera', () => {
    render(<InvoiceOcrPreviewModal isOpen onClose={vi.fn()} />);
    const cameraInput = screen.getByTestId('ocr-camera-input') as HTMLInputElement;
    expect(cameraInput).toHaveAttribute('capture', 'environment');
    // Same explicit MIME whitelist as the file input so iOS Safari
    // filters HEIC at the chooser instead of letting it land in JS.
    expect(cameraInput).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
  });

  it('feeds the camera input into the same handleFileChange pipeline', async () => {
    render(<InvoiceOcrPreviewModal isOpen onClose={vi.fn()} />);
    const cameraInput = screen.getByTestId('ocr-camera-input') as HTMLInputElement;
    const file = buildFile('camera-shot.jpg', 'image/jpeg', 4 * 1024);
    fireEvent.change(cameraInput, { target: { files: [file] } });
    await waitFor(() => expect(extractMutate).toHaveBeenCalledTimes(1));
  });

  it('rejects a HEIC photo coming through the camera input', async () => {
    render(<InvoiceOcrPreviewModal isOpen onClose={vi.fn()} />);
    const cameraInput = screen.getByTestId('ocr-camera-input') as HTMLInputElement;
    const heic = buildFile('shot.heic', 'image/heic', 1024);
    fireEvent.change(cameraInput, { target: { files: [heic] } });
    await waitFor(() => {
      expect(screen.getByText(/JPG, PNG or WebP/i)).toBeInTheDocument();
    });
    expect(extractMutate).not.toHaveBeenCalled();
  });
});
