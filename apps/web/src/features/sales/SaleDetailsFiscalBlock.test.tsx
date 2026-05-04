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

    expect(screen.getByRole('heading', { name: 'XML CFDI 4.0' })).toBeInTheDocument();
    expect(screen.getByText('<cfdi:Comprobante Version="4.0" />')).toBeInTheDocument();
  });
});
