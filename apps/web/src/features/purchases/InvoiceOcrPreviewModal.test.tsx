/**
 * ENG-040a — Tests for InvoiceOcrPreviewModal.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@/test/utils';
import { InvoiceOcrPreviewModal } from './InvoiceOcrPreviewModal';

const extractMutate = vi.fn();
let mutationOnSuccess: ((result: unknown) => void) | null = null;
let mutationError: Error | null = null;

vi.mock('@/lib/trpc', () => ({
  trpc: {
    ai: {
      extractInvoiceLines: {
        useMutation: ({ onSuccess }: { onSuccess?: (result: unknown) => void }) => {
          mutationOnSuccess = onSuccess ?? null;
          return {
            isPending: false,
            mutateAsync: (input: unknown) => {
              extractMutate(input);
              if (mutationError) {
                return Promise.reject(mutationError);
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
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

beforeEach(() => {
  extractMutate.mockClear();
  mutationOnSuccess = null;
  mutationError = null;
});

function buildFile(name: string, type: string, size: number): File {
  const file = new File(['x'.repeat(Math.min(size, 1024))], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
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
    const input = screen.getByTestId('ocr-file-input') as HTMLInputElement;
    const file = buildFile('invoice.png', 'image/png', 4 * 1024);
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(extractMutate).toHaveBeenCalledTimes(1);
    });
    const payload = extractMutate.mock.calls[0]![0] as {
      imageBase64: string;
      mimeType: string;
    };
    expect(payload.imageBase64).toMatch(/^data:image\/png;base64,/);
    expect(payload.mimeType).toBe('image/png');

    expect(mutationOnSuccess).toBeTruthy();
    mutationOnSuccess?.({
      invoice: {
        supplierName: 'Distribuidora Norte',
        supplierTaxId: '900123456-1',
        invoiceNumber: 'FAC-0001',
        invoiceDate: '2026-05-09',
        currencyCode: 'COP',
        lines: [
          { description: 'Coca Cola', quantity: 12, unitPrice: 4500, totalLine: 54000 },
        ],
        subtotal: 54000,
        taxAmount: 10260,
        total: 64260,
      },
      costUsd: 0.012,
      durationMs: 800,
      provider: 'anthropic',
      model: 'test-vision',
      auditLogId: 'audit-1',
    });

    await waitFor(() => {
      expect(screen.getByTestId('ocr-preview')).toBeInTheDocument();
    });
    expect(screen.getByText('Distribuidora Norte')).toBeInTheDocument();
    expect(screen.getByText('FAC-0001')).toBeInTheDocument();
    expect(screen.getByText('Coca Cola')).toBeInTheDocument();
  });

  it('does not render raw server mutation errors inside the validation box', async () => {
    mutationError = new Error('Provider anthropic is not configured (set the API key env var)');
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
});
