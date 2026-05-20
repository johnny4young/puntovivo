import { describe, expect, it, vi } from 'vitest';
import { fireEvent } from '@testing-library/react';
import { render, screen } from '@/test/utils';
import { SaleDetailsFiscalBlock } from './SaleDetailsFiscalBlock';

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

// ENG-103 — `FiscalDocumentXmlModal` now lazy-fetches the XML body
// via `reports.fiscal.getXml`; the surrounding test only verifies
// that clicking "View XML" opens the modal, so a minimal trpc mock
// keeps the loading state in place without exercising the network.
vi.mock('@/lib/trpc', () => ({
  trpc: {
    reports: {
      fiscal: {
        getXml: {
          useQuery: () => ({ data: undefined, isLoading: true }),
        },
      },
    },
  },
}));

describe('SaleDetailsFiscalBlock', () => {
  it('uses the fiscal authority for the document country', () => {
    render(
      <SaleDetailsFiscalBlock
        isAdmin={false}
        fiscalDocuments={[
          {
            id: 'fd_mx',
            source: 'sale',
            kind: 'FEV',
            cufe: '00000000-1111-2222-3333-444444444444',
            documentNumber: 'A-100',
            status: 'accepted',
            qrPayload:
              'https://verificacfdi.facturaelectronica.sat.gob.mx/?id=00000000-1111-2222-3333-444444444444',
            xmlRef: null,
            resolution: null,
            emittedAt: new Date().toISOString(),
            countryCode: 'MX',
          },
        ]}
      />
    );

    expect(screen.getByText('Fiscal folio (UUID)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Verify on SAT/i })).toHaveAttribute(
      'href',
      expect.stringContaining('verificacfdi.facturaelectronica.sat.gob.mx')
    );
    expect(screen.queryByText(/Verify on DIAN/i)).not.toBeInTheDocument();
  });

  it('opens the existing XML modal when an admin selects View XML', () => {
    render(
      <SaleDetailsFiscalBlock
        isAdmin
        fiscalDocuments={[
          {
            id: 'fd_xml',
            source: 'sale',
            kind: 'FEV',
            cufe: '00000000-1111-2222-3333-444444444444',
            documentNumber: 'A-101',
            status: 'pending',
            qrPayload: null,
            xmlRef: '<cfdi:Comprobante Version="4.0" />',
            resolution: null,
            emittedAt: new Date().toISOString(),
            countryCode: 'MX',
          },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /View XML/i }));

    // Post-ENG-103: the modal opens and shows its loading state while
    // `reports.fiscal.getXml` resolves. The XML body itself comes
    // from the server, not from the list prop, so this assertion now
    // focuses on the modal heading + loading affordance.
    expect(screen.getByRole('heading', { name: 'XML CFDI 4.0' })).toBeInTheDocument();
    expect(screen.getByTestId('cfdi-xml-loading')).toBeInTheDocument();
  });
});
