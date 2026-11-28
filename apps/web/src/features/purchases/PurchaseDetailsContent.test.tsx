import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from 'i18next';
import { render } from '@/test/utils';
import type { Purchase } from '@/types';
import { PurchaseDetailsContent } from './PurchaseDetailsContent';

let mockRole: 'admin' | 'manager' | 'cashier' = 'manager';
const listInvalidateMock = vi.fn();
const getByIdInvalidateMock = vi.fn();
const getDocumentFetchMock = vi.fn();
const toastSuccessMock = vi.fn();
const attachMutateMock = vi.fn();
let attachMutationCallbacks: {
  onSuccess?: (_data?: unknown, variables?: { purchaseId: string }) => Promise<void> | void;
  onError?: (err: unknown, variables?: { purchaseId: string }) => Promise<void> | void;
} = {};

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1', role: mockRole } }),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      purchases: {
        list: { invalidate: listInvalidateMock },
        getById: { invalidate: getByIdInvalidateMock },
        getDocument: { fetch: getDocumentFetchMock },
      },
    }),
    purchases: {
      attachDocument: {
        useMutation: (callbacks?: typeof attachMutationCallbacks) => {
          attachMutationCallbacks = callbacks ?? {};
          return { mutate: attachMutateMock, mutateAsync: vi.fn(), isPending: false };
        },
      },
    },
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: toastSuccessMock, error: vi.fn() }),
}));

const purchase = {
  id: 'purchase-1',
  tenantId: 'tenant-1',
  purchaseNumber: 'COM-000001',
  providerId: 'provider-1',
  providerName: 'Proveedor',
  siteId: 'site-1',
  siteName: 'Principal',
  status: 'completed',
  subtotal: 20,
  total: 20,
  createdBy: 'user-1',
  createdAt: '2030-01-01T12:00:00.000Z',
  updatedAt: '2030-01-01T12:00:00.000Z',
  items: [
    {
      id: 'item-1',
      purchaseId: 'purchase-1',
      productId: 'product-1',
      productName: 'Producto lotificado',
      productSku: 'LOT-1',
      tracksLots: true,
      quantity: 2,
      unitId: 'unit-1',
      unitEquivalence: 1,
      unitName: 'Unidad',
      costPerUnit: 10,
      baseUnitCost: 10,
      total: 20,
      returnedQuantity: 0,
      remainingQuantity: 2,
      returnableQuantity: 0,
      lots: [
        {
          id: 'purchase-lot-1',
          purchaseItemId: 'item-1',
          inventoryLotId: 'lot-1',
          lotNumber: 'L-2031',
          expiresAt: '2031-01-31',
          baseQuantity: 2,
          unitCost: 10,
          currentOnHand: 0,
          currentStatus: 'quarantined',
          returnedBaseQuantity: 0,
          remainingBaseQuantity: 2,
          availableBaseQuantity: 0,
        },
      ],
    },
  ],
} as Purchase;

describe('PurchaseDetailsContent lot evidence', () => {
  beforeAll(async () => i18next.changeLanguage('es'));

  beforeEach(() => {
    mockRole = 'manager';
    listInvalidateMock.mockReset();
    getByIdInvalidateMock.mockReset();
    getDocumentFetchMock.mockReset();
    toastSuccessMock.mockReset();
    attachMutateMock.mockReset();
  });

  it('shows the calendar expiry and localized current lot status', () => {
    render(<PurchaseDetailsContent purchase={purchase} returnError={null} voidError={null} />);

    expect(screen.getByText(/vence .*2031/i)).toBeInTheDocument();
    expect(screen.getByText(/estado actual: en cuarentena/i)).toBeInTheDocument();
    expect(screen.queryByText(/quarantined/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Disponible para devolución' })
    ).toBeInTheDocument();
    const productRow = screen.getByRole('row', { name: /Producto lotificado/i });
    expect(within(productRow).getAllByRole('cell')[3]).toHaveTextContent('0');
    expect(screen.queryByRole('columnheader', { name: 'Restante' })).not.toBeInTheDocument();
  });

  it('offers to attach the supporting paper when none exists', () => {
    render(<PurchaseDetailsContent purchase={purchase} returnError={null} voidError={null} />);

    expect(screen.getByText('Sin documento')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Adjuntar foto o PDF del documento/i })
    ).toBeInTheDocument();
  });

  it('hides attach and view actions for roles without document permissions', () => {
    mockRole = 'cashier';
    const { rerender } = render(
      <PurchaseDetailsContent purchase={purchase} returnError={null} voidError={null} />
    );

    expect(
      screen.queryByRole('button', { name: /Adjuntar foto o PDF del documento/i })
    ).not.toBeInTheDocument();

    rerender(
      <PurchaseDetailsContent
        purchase={
          {
            ...purchase,
            document: {
              fileName: 'remision.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 512,
              createdAt: '2030-01-01T12:00:00.000Z',
            },
          } as Purchase
        }
        returnError={null}
        voidError={null}
      />
    );

    expect(screen.getByText('remision.pdf')).toBeInTheDocument();
    expect(screen.queryByText('Sin documento')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Ver documento adjunto/i })
    ).not.toBeInTheDocument();
  });

  it('labels the recorded remisión and views its attachment without retaining it in query cache', async () => {
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview-1');
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    getDocumentFetchMock.mockResolvedValue({
      fileName: 'remision.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
      documentBase64: btoa('fake-png'),
      payloadHash: 'abc',
      uploadedBy: 'user-1',
      createdAt: '2030-01-01T12:00:00.000Z',
    });

    render(
      <PurchaseDetailsContent
        purchase={
          {
            ...purchase,
            documentType: 'remision',
            documentNumber: 'RM-0042',
            document: {
              fileName: 'remision.png',
              mimeType: 'image/png',
              sizeBytes: 1024,
              createdAt: '2030-01-01T12:00:00.000Z',
            },
          } as Purchase
        }
        returnError={null}
        voidError={null}
      />
    );

    expect(screen.getByText('Remisión · RM-0042')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Ver documento adjunto/i }));

    await waitFor(() => {
      expect(screen.getByAltText('remision.png')).toHaveAttribute('src', 'blob:preview-1');
    });
    expect(getDocumentFetchMock).toHaveBeenCalledWith(
      { purchaseId: 'purchase-1' },
      { gcTime: 0, staleTime: 0 }
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:preview-1');
    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
  });

  it('shows the dedicated view error when getDocument fails', async () => {
    getDocumentFetchMock.mockRejectedValue(new Error('integrity check failed'));

    render(
      <PurchaseDetailsContent
        purchase={
          {
            ...purchase,
            document: {
              fileName: 'remision.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 512,
              createdAt: '2030-01-01T12:00:00.000Z',
            },
          } as Purchase
        }
        returnError={null}
        voidError={null}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Ver documento adjunto/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('No se pudo cargar el documento');
    });
  });

  it('surfaces distinct client validation errors and handles attach conflicts with a refresh', async () => {
    const { container } = render(
      <PurchaseDetailsContent purchase={purchase} returnError={null} voidError={null} />
    );
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;

    const unsupported = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(fileInput, { target: { files: [unsupported] } });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Solo se permiten archivos PDF, PNG, JPEG o WebP'
      );
    });

    const emptyPdf = new File([], 'empty.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [emptyPdf] } });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('El archivo seleccionado está vacío');
    });

    const oversizedPdf = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.pdf', {
      type: 'application/pdf',
    });
    fireEvent.change(fileInput, { target: { files: [oversizedPdf] } });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('El archivo supera el límite de 10 MB');
    });

    const validPdf = new File(['%PDF-1.4\n%%EOF\n'], 'remision.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [validPdf] } });
    await waitFor(() => {
      expect(attachMutateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          purchaseId: 'purchase-1',
          fileName: 'remision.pdf',
          mimeType: 'application/pdf',
        })
      );
    });

    await act(async () => {
      await attachMutationCallbacks.onError?.(
        { data: { code: 'CONFLICT' } },
        { purchaseId: 'purchase-1' }
      );
    });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Esta compra ya tiene un documento adjunto. La vista se actualizó para mostrarlo.'
      );
    });
    expect(listInvalidateMock).toHaveBeenCalled();
    expect(getByIdInvalidateMock).toHaveBeenCalled();
  });

  it('renders an inline PDF iframe with a localized fallback filename and extension', async () => {
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:pdf-1');
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    getDocumentFetchMock.mockResolvedValue({
      fileName: null,
      mimeType: 'application/pdf',
      sizeBytes: 256,
      documentBase64: btoa('%PDF-1.4\n%%EOF\n'),
      payloadHash: 'def',
      uploadedBy: 'user-1',
      createdAt: '2030-01-01T12:00:00.000Z',
    });

    render(
      <PurchaseDetailsContent
        purchase={
          {
            ...purchase,
            documentType: 'invoice',
            documentNumber: 'FE-100',
            document: {
              fileName: null,
              mimeType: 'application/pdf',
              sizeBytes: 256,
              createdAt: '2030-01-01T12:00:00.000Z',
            },
          } as Purchase
        }
        returnError={null}
        voidError={null}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Ver documento adjunto/i }));

    await waitFor(() => {
      const iframe = screen.getByTitle('Vista previa del documento');
      expect(iframe.tagName).toBe('IFRAME');
      expect(iframe).toHaveAttribute('src', 'blob:pdf-1');
    });
    expect(screen.getByRole('link', { name: 'Descargar' })).toHaveAttribute(
      'download',
      'documento.pdf'
    );
    createObjectUrlSpy.mockRestore();
    revokeObjectUrlSpy.mockRestore();
  });

  it('does not create an object URL if unmounted while getDocument is in flight', async () => {
    let resolveFetch!: (value: unknown) => void;
    getDocumentFetchMock.mockReturnValue(
      new Promise(resolve => {
        resolveFetch = resolve;
      })
    );
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:leaked');

    const { unmount } = render(
      <PurchaseDetailsContent
        purchase={
          {
            ...purchase,
            document: {
              fileName: 'remision.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 256,
              createdAt: '2030-01-01T12:00:00.000Z',
            },
          } as Purchase
        }
        returnError={null}
        voidError={null}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Ver documento adjunto/i }));
    unmount();

    await act(async () => {
      resolveFetch({
        fileName: 'remision.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 256,
        documentBase64: btoa('%PDF-1.4\n%%EOF\n'),
        payloadHash: 'def',
        uploadedBy: 'user-1',
        createdAt: '2030-01-01T12:00:00.000Z',
      });
      await Promise.resolve();
    });

    expect(createObjectUrlSpy).not.toHaveBeenCalled();
    createObjectUrlSpy.mockRestore();
  });

  it('keeps controls enabled after switching purchases while a previous view fetch is in flight', async () => {
    let resolveFirstFetch!: (value: unknown) => void;
    getDocumentFetchMock.mockReturnValue(
      new Promise(resolve => {
        resolveFirstFetch = resolve;
      })
    );
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stale');

    const { rerender } = render(
      <PurchaseDetailsContent
        purchase={
          {
            ...purchase,
            id: 'purchase-1',
            document: {
              fileName: 'first.pdf',
              mimeType: 'application/pdf',
              sizeBytes: 256,
              createdAt: '2030-01-01T12:00:00.000Z',
            },
          } as Purchase
        }
        returnError={null}
        voidError={null}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Ver documento adjunto/i }));
    expect(screen.getByRole('button', { name: /Ver documento adjunto/i })).toBeDisabled();

    rerender(
      <PurchaseDetailsContent
        purchase={{ ...purchase, id: 'purchase-2', document: null } as Purchase}
        returnError={null}
        voidError={null}
      />
    );

    expect(
      screen.getByRole('button', { name: /Adjuntar foto o PDF del documento/i })
    ).not.toBeDisabled();

    await act(async () => {
      resolveFirstFetch({
        fileName: 'first.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 256,
        documentBase64: btoa('%PDF-1.4\n%%EOF\n'),
        payloadHash: 'def',
        uploadedBy: 'user-1',
        createdAt: '2030-01-01T12:00:00.000Z',
      });
      await Promise.resolve();
    });

    expect(createObjectUrlSpy).not.toHaveBeenCalled();
    createObjectUrlSpy.mockRestore();
  });
});
