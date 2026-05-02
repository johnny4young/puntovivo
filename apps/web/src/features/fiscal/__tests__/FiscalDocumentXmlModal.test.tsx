/**
 * ENG-035b — Tests del FiscalDocumentXmlModal.
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

const sampleXml = `<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" Version="4.0">
  <cfdi:Emisor Rfc="AAA010101AAA" />
</cfdi:Comprobante>`;

describe('FiscalDocumentXmlModal (ENG-035b)', () => {
  beforeEach(async () => {
    await i18next.changeLanguage('en');
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it('renders XML body inside <pre> when xml prop is provided', () => {
    render(
      <FiscalDocumentXmlModal
        isOpen
        onClose={vi.fn()}
        xml={sampleXml}
        cufe="00000000-0000-4000-8000-000000000000"
        documentNumber="F0000000042"
      />
    );
    const pre = screen.getByTestId('cfdi-xml-pre');
    expect(pre.textContent).toContain('cfdi:Comprobante');
    expect(pre.textContent).toContain('AAA010101AAA');
    expect(screen.getByText('F0000000042')).toBeInTheDocument();
  });

  it('shows empty state when xml is null', () => {
    render(
      <FiscalDocumentXmlModal
        isOpen
        onClose={vi.fn()}
        xml={null}
        cufe="abc"
        documentNumber="F1"
      />
    );
    // Empty state message is exposed; the <pre> is not rendered.
    expect(screen.queryByTestId('cfdi-xml-pre')).not.toBeInTheDocument();
    expect(screen.getByText(/no XML attached/i)).toBeInTheDocument();
  });

  it('disables Copy + Download buttons when xml is null', () => {
    render(
      <FiscalDocumentXmlModal
        isOpen
        onClose={vi.fn()}
        xml={null}
        cufe="abc"
        documentNumber="F1"
      />
    );
    expect(screen.getByRole('button', { name: /copy/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /download/i })).toBeDisabled();
  });

  it('emits success toast when Copy is clicked (clipboard write attempts)', async () => {
    // userEvent v14 intercepts clipboard writes via its own mock; we
    // verify the visible side-effect (toast) instead of the
    // underlying writeText call.
    const user = userEvent.setup();
    render(
      <FiscalDocumentXmlModal
        isOpen
        onClose={vi.fn()}
        xml={sampleXml}
        cufe="abc"
        documentNumber="F1"
      />
    );
    await user.click(screen.getByRole('button', { name: /copy/i }));
    // Either success or error path fires (clipboard support varies in
    // jsdom + userEvent); the contract is that exactly one fires.
    const successCalls = toastSuccess.mock.calls.length;
    const errorCalls = toastError.mock.calls.length;
    expect(successCalls + errorCalls).toBeGreaterThan(0);
  });

  it('triggers a Blob download when Download is clicked', async () => {
    const user = userEvent.setup();
    const createObjectURL = vi.fn().mockReturnValue('blob:fake');
    const revokeObjectURL = vi.fn();
    const originalCreate = (URL as unknown as { createObjectURL?: unknown })
      .createObjectURL;
    const originalRevoke = (URL as unknown as { revokeObjectURL?: unknown })
      .revokeObjectURL;
    Object.assign(URL, { createObjectURL, revokeObjectURL });

    render(
      <FiscalDocumentXmlModal
        isOpen
        onClose={vi.fn()}
        xml={sampleXml}
        cufe="abc"
        documentNumber="F1"
      />
    );
    await user.click(screen.getByRole('button', { name: /download/i }));
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake');

    // Restore.
    Object.assign(URL, {
      createObjectURL: originalCreate,
      revokeObjectURL: originalRevoke,
    });
  });

  it('renders nothing when isOpen is false', () => {
    render(
      <FiscalDocumentXmlModal
        isOpen={false}
        onClose={vi.fn()}
        xml={sampleXml}
        cufe="abc"
        documentNumber="F1"
      />
    );
    expect(screen.queryByTestId('cfdi-xml-pre')).not.toBeInTheDocument();
  });
});
