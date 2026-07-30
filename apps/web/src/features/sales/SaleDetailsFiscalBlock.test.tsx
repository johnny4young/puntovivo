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

// `FiscalDocumentXmlModal` now lazy-fetches the XML body
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
            maturity: 'certified',
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
            maturity: 'draft',
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

    // Post-: the modal opens and shows its loading state while
    // `reports.fiscal.getXml` resolves. The XML body itself comes
    // from the server, not from the list prop, so this assertion now
    // focuses on the modal heading + loading affordance.
    expect(screen.getByRole('heading', { name: 'XML CFDI 4.0' })).toBeInTheDocument();
    expect(screen.getByTestId('cfdi-xml-loading')).toBeInTheDocument();
  });

  it('labels mock evidence as local-only and never renders an authority link', () => {
    const localIdentifier = 'cafe1234'.repeat(12);
    render(
      <SaleDetailsFiscalBlock
        isAdmin={false}
        fiscalDocuments={[
          {
            id: 'fd_mock',
            source: 'sale',
            kind: 'DEE',
            cufe: localIdentifier,
            documentNumber: 'OB0000000010',
            status: 'accepted',
            maturity: 'mock',
            qrPayload: `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${localIdentifier}`,
            xmlRef: null,
            resolution: '18760000001 | OB 1-1000000 | 2026-01-01 - 2027-01-01',
            emittedAt: new Date().toISOString(),
            countryCode: 'CO',
          },
        ]}
      />
    );

    expect(screen.getByTestId('fiscal-maturity-badge')).toHaveTextContent('Demo');
    expect(screen.getByTestId('fiscal-non-certified-notice')).toHaveTextContent(
      /not transmitted to DIAN/i
    );
    expect(screen.getByText('Local fiscal identifier')).toBeInTheDocument();
    expect(screen.getByText(localIdentifier)).toBeInTheDocument();
    expect(screen.getByText(/18760000001/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Verify on DIAN/i })).not.toBeInTheDocument();
  });
});
