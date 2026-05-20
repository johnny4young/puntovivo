/**
 * ENG-035b + ENG-103 — Tests del FiscalDocumentXmlModal.
 *
 * Post-ENG-103 el modal recibe `documentId` y resuelve el XML body
 * lazy via `reports.fiscal.getXml`, en vez de aceptar el `xml` como
 * prop. La descarga ahora pasa por el helper `downloadFile`
 * centralizado en `services/export/exportService.ts`, y el server
 * decide el filename y MIME type canónicos.
 */
import { render, screen } from '@/test/utils';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18next from '@/i18n';
import { FiscalDocumentXmlModal } from '../FiscalDocumentXmlModal';

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: toastSuccess,
    error: toastError,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

interface GetXmlEnvelope {
  data: string;
  filename: string;
  mimeType: string;
}

// Ref-based pattern (same as KdsBoard.test.tsx) so each test case can
// swap the mocked tRPC query state without re-mocking the module.
const xmlQueryRef: { current: { data?: GetXmlEnvelope; isLoading: boolean } } = {
  current: { data: undefined, isLoading: false },
};

vi.mock('@/lib/trpc', () => ({
  trpc: {
    reports: {
      fiscal: {
        getXml: {
          useQuery: () => xmlQueryRef.current,
        },
      },
    },
  },
}));

const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0">
  <cfdi:Emisor Rfc="AAA010101AAA" />
</cfdi:Comprobante>`;

const sampleEnvelope: GetXmlEnvelope = {
  data: sampleXml,
  filename: 'cfdi-mx-F0000000042.xml',
  mimeType: 'application/xml;charset=utf-8',
};

describe('FiscalDocumentXmlModal (ENG-035b + ENG-103)', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
    toastSuccess.mockReset();
    toastError.mockReset();
    xmlQueryRef.current = { data: undefined, isLoading: false };
  });

  it('renders XML body inside <pre> when the server returns an envelope', () => {
    xmlQueryRef.current = { data: sampleEnvelope, isLoading: false };
    render(
      <FiscalDocumentXmlModal
        isOpen
        onClose={vi.fn()}
        documentId="doc-1"
        cufe="00000000-0000-4000-8000-000000000000"
        documentNumber="F0000000042"
      />
    );
    const pre = screen.getByTestId('cfdi-xml-pre');
    expect(pre.textContent).toContain('cfdi:Comprobante');
    expect(pre.textContent).toContain('AAA010101AAA');
    expect(screen.getByText('F0000000042')).toBeInTheDocument();
  });

  it('shows empty state when the server reports no XML available', () => {
    xmlQueryRef.current = { data: undefined, isLoading: false };
    render(
      <FiscalDocumentXmlModal
        isOpen
        onClose={vi.fn()}
        documentId="doc-2"
        cufe="abc"
        documentNumber="F1"
      />
    );
    expect(screen.queryByTestId('cfdi-xml-pre')).not.toBeInTheDocument();
    expect(screen.getByText(/no XML attached/i)).toBeInTheDocument();
  });

  it('shows loading state and disables Download while the query is in flight', () => {
    xmlQueryRef.current = { data: undefined, isLoading: true };
    render(
      <FiscalDocumentXmlModal
        isOpen
        onClose={vi.fn()}
        documentId="doc-3"
        cufe="abc"
        documentNumber="F1"
      />
    );
    expect(screen.getByTestId('cfdi-xml-loading')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /copy/i })).toBeDisabled();
  });

  it('disables Copy + Download when the envelope is absent', () => {
    xmlQueryRef.current = { data: undefined, isLoading: false };
    render(
      <FiscalDocumentXmlModal
        isOpen
        onClose={vi.fn()}
        documentId="doc-4"
        cufe="abc"
        documentNumber="F1"
      />
    );
    expect(screen.getByRole('button', { name: /copy/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /download/i })).toBeDisabled();
  });

  it('emits a toast when Copy is clicked (clipboard write attempt)', async () => {
    xmlQueryRef.current = { data: sampleEnvelope, isLoading: false };
    const user = userEvent.setup();
    render(
      <FiscalDocumentXmlModal
        isOpen
        onClose={vi.fn()}
        documentId="doc-5"
        cufe="abc"
        documentNumber="F1"
      />
    );
    await user.click(screen.getByRole('button', { name: /copy/i }));
    const successCalls = toastSuccess.mock.calls.length;
    const errorCalls = toastError.mock.calls.length;
    expect(successCalls + errorCalls).toBeGreaterThan(0);
  });

  it('triggers a Blob download with the server-suggested filename when Download is clicked', async () => {
    xmlQueryRef.current = { data: sampleEnvelope, isLoading: false };
    const user = userEvent.setup();
    const createObjectURL = vi.fn().mockReturnValue('blob:fake');
    const revokeObjectURL = vi.fn();
    const originalCreate = (URL as unknown as { createObjectURL?: unknown })
      .createObjectURL;
    const originalRevoke = (URL as unknown as { revokeObjectURL?: unknown })
      .revokeObjectURL;
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    // Spy on anchor.download so we can confirm the canonical filename
    // is what the renderer hands to the OS.
    const originalCreateElement = document.createElement.bind(document);
    const downloadValues: string[] = [];
    const createElementSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => {
        const el = originalCreateElement(tag);
        if (tag === 'a') {
          Object.defineProperty(el, 'download', {
            configurable: true,
            set: (v: string) => {
              downloadValues.push(v);
            },
            get: () => downloadValues[downloadValues.length - 1] ?? '',
          });
        }
        return el;
      });

    render(
      <FiscalDocumentXmlModal
        isOpen
        onClose={vi.fn()}
        documentId="doc-6"
        cufe="abc"
        documentNumber="F0000000042"
      />
    );
    await user.click(screen.getByRole('button', { name: /download/i }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(downloadValues).toContain('cfdi-mx-F0000000042.xml');

    createElementSpy.mockRestore();
    Object.assign(URL, {
      createObjectURL: originalCreate,
      revokeObjectURL: originalRevoke,
    });
  });

  it('renders nothing visible when isOpen is false', () => {
    xmlQueryRef.current = { data: sampleEnvelope, isLoading: false };
    render(
      <FiscalDocumentXmlModal
        isOpen={false}
        onClose={vi.fn()}
        documentId="doc-7"
        cufe="abc"
        documentNumber="F1"
      />
    );
    expect(screen.queryByTestId('cfdi-xml-pre')).not.toBeInTheDocument();
  });
});
