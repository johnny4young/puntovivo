import type { ComponentProps } from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render } from '@/test/utils';
import { InvoiceOcrDialog } from './InvoiceOcrDialog';
import type { PurchaseDraft } from './types';
import type { Provider } from '@/types';

let featureEnabled = true;
const uploadMutateAsync = vi.fn();
const extractMutateAsync = vi.fn();
const confirmMutateAsync = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('@/features/ai-shared', () => ({
  useAiFeatureFlag: () => ({ enabled: featureEnabled, isLoading: false }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
  }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    upload: {
      uploadInvoice: { useMutation: () => ({ mutateAsync: uploadMutateAsync }) },
    },
    ai: {
      invoiceOcr: {
        extract: { useMutation: () => ({ mutateAsync: extractMutateAsync }) },
        confirm: { useMutation: () => ({ mutateAsync: confirmMutateAsync, isPending: false }) },
      },
    },
    products: {
      search: {
        useQuery: () => ({ data: { items: [] }, isLoading: false, error: null }),
      },
    },
    // ProductSearchDialog reads the expiry-discount suggestions
    // through useDiscountSuggestions (opt-in, off for this dialog, but the
    // hook still mounts).
    inventoryLots: {
      activeSuggestions: {
        useQuery: () => ({ data: undefined, isLoading: false, error: null }),
      },
    },
  },
}));

const providers: Provider[] = [
  {
    id: 'provider-1',
    tenantId: 'tenant-1',
    name: 'Lacteos El Campo S.A.S.',
    taxId: '900421118-3',
    phone: null,
    email: null,
    address: null,
    cityId: null,
    cityName: null,
    departmentName: null,
    countryName: null,
    contactName: null,
    isActive: true,
    version: 0,
    createdAt: '2026-05-15T00:00:00.000Z',
    updatedAt: '2026-05-15T00:00:00.000Z',
  },
];

const draft: PurchaseDraft = {
  supplier: {
    name: 'Lacteos El Campo S.A.S.',
    nit: '900421118-3',
    confidence: 0.92,
  },
  providerId: 'provider-1',
  invoiceNumber: {
    value: 'FAC-001-2026',
    confidence: 0.9,
  },
  lines: [
    {
      description: 'Yogurt fresa 200g',
      quantity: 2,
      unitPrice: 5000,
      matchedProductId: 'product-1',
      matchedProductName: 'Yogurt fresa 200g',
      matchedProductSku: 'YOG-200',
      unitId: 'unit-1',
      unitName: 'Unidad',
      unitEquivalence: 1,
      matchedBy: 'sku',
      confidence: 0.88,
    },
  ],
  totals: {
    subtotal: 10_000,
    iva: 1900,
    total: 11_900,
    linesSum: 11_900,
  },
  warnings: [],
  meta: {
    costUsd: 0,
    latencyMs: 120,
    provider: 'textract',
  },
  uploadId: 'upload-1',
  extractAuditId: 'audit-1',
  uploadAuditId: 'upload-audit-1',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderDialog(props?: Partial<ComponentProps<typeof InvoiceOcrDialog>>) {
  return render(
    <InvoiceOcrDialog
      open
      onClose={vi.fn()}
      providers={providers}
      onConfirmed={vi.fn()}
      {...props}
    />
  );
}

function invoiceFile() {
  return new File(['invoice'], 'factura.png', { type: 'image/png' });
}

function pdfFile() {
  return new File(['%PDF-1.7'], 'factura.pdf', { type: 'application/pdf' });
}

function uploadInput(container: HTMLElement) {
  return container.querySelector(
    'input[accept="image/png,image/jpeg,application/pdf"]'
  ) as HTMLInputElement;
}

beforeEach(() => {
  featureEnabled = true;
  uploadMutateAsync.mockReset();
  extractMutateAsync.mockReset();
  confirmMutateAsync.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:invoice');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

describe('InvoiceOcrDialog states', () => {
  it('renders nothing when the invoice OCR feature is disabled', () => {
    featureEnabled = false;
    renderDialog();
    expect(screen.queryByText(/OCR de factura|Invoice OCR/i)).not.toBeInTheDocument();
  });

  it('renders the idle upload state', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: /subir archivo|upload file/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tomar foto|take photo/i })).toBeInTheDocument();
    expect(screen.getAllByText(/JPG.*PNG.*PDF.*10 MB/i).length).toBeGreaterThan(0);
  });

  it('renders the uploading state while the upload mutation is pending', async () => {
    const user = userEvent.setup();
    const pendingUpload = deferred<{ uploadId: string }>();
    uploadMutateAsync.mockReturnValue(pendingUpload.promise);
    renderDialog();

    await user.upload(uploadInput(document.body), invoiceFile());

    expect(await screen.findByText(/preparando imagen|preparing image/i)).toBeInTheDocument();
  });

  it('renders a PDF preview while upload is pending', async () => {
    const user = userEvent.setup();
    uploadMutateAsync.mockReturnValue(deferred<{ uploadId: string }>().promise);
    renderDialog();

    await user.upload(uploadInput(document.body), pdfFile());

    expect(await screen.findByText('factura.pdf')).toBeInTheDocument();
    expect(screen.getAllByText(/PDF/i).length).toBeGreaterThan(0);
  });

  it('renders the extracting state after upload succeeds while OCR is pending', async () => {
    const user = userEvent.setup();
    uploadMutateAsync.mockResolvedValue({ uploadId: 'upload-1' });
    extractMutateAsync.mockReturnValue(deferred<PurchaseDraft>().promise);
    renderDialog();

    await user.upload(uploadInput(document.body), invoiceFile());

    expect(await screen.findByText(/leyendo la factura|reading the invoice/i)).toBeInTheDocument();
  });

  it('renders the review state with extracted fields and confidence chips', async () => {
    const user = userEvent.setup();
    uploadMutateAsync.mockResolvedValue({ uploadId: 'upload-1' });
    extractMutateAsync.mockResolvedValue(draft);
    renderDialog();

    await user.upload(uploadInput(document.body), invoiceFile());

    expect(await screen.findByText(/borrador de compra|purchase draft/i)).toBeInTheDocument();
    expect(screen.getAllByDisplayValue('Lacteos El Campo S.A.S.').length).toBeGreaterThan(0);
    expect(screen.getByText('YOG-200 Yogurt fresa 200g')).toBeInTheDocument();
    expect(screen.getByText(/AI read the invoice|La IA leyó la factura/i)).toBeInTheDocument();
  });

  it('renders the error state when upload fails and lets the operator retry', async () => {
    const user = userEvent.setup();
    uploadMutateAsync.mockRejectedValue(new Error('Upload failed'));
    renderDialog();

    await user.upload(uploadInput(document.body), invoiceFile());

    expect(
      await screen.findByText(/no pude leer esa factura|couldn't read|could not read/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reintentar|try again/i })).toBeInTheDocument();
  });

  it('rejects unsupported files before uploading and returns to idle on retry', async () => {
    renderDialog();
    const badFile = new File(['not-an-invoice'], 'factura.txt', { type: 'text/plain' });

    fireEvent.change(uploadInput(document.body), { target: { files: [badFile] } });

    expect(
      await screen.findByText(/no pude leer esa factura|couldn't read|could not read/i)
    ).toBeInTheDocument();
    expect(uploadMutateAsync).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /reintentar|try again/i }));

    expect(screen.getByRole('button', { name: /subir archivo|upload file/i })).toBeInTheDocument();
  });

  it('rejects files over the OCR size limit before uploading', async () => {
    renderDialog();
    const largeFile = invoiceFile();
    Object.defineProperty(largeFile, 'size', { value: 10 * 1024 * 1024 + 1 });

    fireEvent.change(uploadInput(document.body), { target: { files: [largeFile] } });

    expect(await screen.findByText(/too large|demasiado grande/i)).toBeInTheDocument();
    expect(uploadMutateAsync).not.toHaveBeenCalled();
  });

  it('shows blocking warnings for unresolved review data', async () => {
    const user = userEvent.setup();
    const unresolvedDraft: PurchaseDraft = {
      ...draft,
      providerId: null,
      lines: [
        {
          ...draft.lines[0]!,
          matchedProductId: null,
          matchedProductName: null,
          matchedProductSku: null,
          unitId: null,
          unitName: null,
        },
      ],
      totals: {
        ...draft.totals,
        linesSum: 10_000,
      },
    };
    uploadMutateAsync.mockResolvedValue({ uploadId: 'upload-1' });
    extractMutateAsync.mockResolvedValue(unresolvedDraft);
    renderDialog();

    await user.upload(uploadInput(document.body), invoiceFile());

    expect(await screen.findByText(/total does not match|total no coincide/i)).toBeInTheDocument();
    expect(screen.getByText(/without a catalog match|sin coincidencia/i)).toBeInTheDocument();
    expect(
      screen.getByText(/select the catalog supplier|selecciona el proveedor/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirmar|confirm/i })).toBeDisabled();
  });

  it('confirms a reviewed draft and closes the dialog', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirmed = vi.fn();
    uploadMutateAsync.mockResolvedValue({ uploadId: 'upload-1' });
    extractMutateAsync.mockResolvedValue(draft);
    confirmMutateAsync.mockResolvedValue({ id: 'purchase-1', number: 'COM-000042' });
    renderDialog({ onClose, onConfirmed });

    await user.upload(uploadInput(document.body), invoiceFile());
    await screen.findByText(/borrador de compra|purchase draft/i);
    await user.click(screen.getByRole('button', { name: /confirmar|confirm/i }));

    await waitFor(() => expect(confirmMutateAsync).toHaveBeenCalledTimes(1));
    expect(confirmMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadId: 'upload-1',
        providerId: 'provider-1',
        extractAuditId: 'audit-1',
      })
    );
    expect(toastSuccess).toHaveBeenCalled();
    expect(onConfirmed).toHaveBeenCalledWith(draft);
    expect(onClose).toHaveBeenCalled();
  });

  it('keeps the review open when confirmation fails', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    uploadMutateAsync.mockResolvedValue({ uploadId: 'upload-1' });
    extractMutateAsync.mockResolvedValue(draft);
    confirmMutateAsync.mockRejectedValue(new Error('Confirm failed'));
    renderDialog({ onClose });

    await user.upload(uploadInput(document.body), invoiceFile());
    await screen.findByText(/borrador de compra|purchase draft/i);
    await user.click(screen.getByRole('button', { name: /confirmar|confirm/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Confirm failed' })
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
