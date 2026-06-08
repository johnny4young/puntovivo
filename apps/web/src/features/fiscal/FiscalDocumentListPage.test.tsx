/**
 * ENG-132h — FiscalDocumentListPage column-trim + row-detail integration.
 *
 * The first test for this page. Renders with the REAL custom table +
 * FiscalDocumentDetailsDrawer (only the heavy XML modal is stubbed) to prove:
 *   - the default table renders the smallest useful column set — the Provider
 *     and CUFE headers are gone;
 *   - the Details (eye) action opens the row-detail Drawer, which surfaces
 *     exactly those trimmed fields (provider id + full CUFE).
 *
 * @module features/fiscal/FiscalDocumentListPage.test
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const FULL_CUFE = 'CUFE0011223344556677889900AABBCCDDEEFF0011223344';

const { doc } = vi.hoisted(() => ({
  doc: {
    id: 'fd-1',
    source: 'sale',
    sourceId: 'sale-1',
    kind: 'FEV',
    documentNumber: 'FEV-000990',
    consecutive: 990,
    cufe: 'CUFE0011223344556677889900AABBCCDDEEFF0011223344',
    status: 'accepted',
    buyerTaxId: '900123456',
    buyerTaxIdTypeCode: '31',
    buyerName: 'Comercializadora Andina',
    subtotal: 100000,
    taxAmount: 19000,
    totalAmount: 119000,
    currencyCode: 'COP',
    emittedAt: '2026-06-01T10:00:00.000Z',
    providerId: 'co-dian-mock',
    retries: 0,
    xmlRef: true,
    maturity: 'mock',
  },
}));

// Stub only the heavy XML modal; the custom table + FiscalDocumentDetailsDrawer
// stay REAL so the column set and the drawer round-trip are exercised.
vi.mock('./FiscalDocumentXmlModal', () => ({ FiscalDocumentXmlModal: () => null }));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    reports: {
      fiscal: {
        list: {
          useQuery: () => ({
            data: { items: [doc], total: 1 },
            isLoading: false,
            error: null,
          }),
        },
      },
    },
  },
}));

import { FiscalDocumentListPage } from './FiscalDocumentListPage';

describe('FiscalDocumentListPage default column set (ENG-132h)', () => {
  it('renders the smallest useful column set — provider / cufe trimmed', () => {
    render(<FiscalDocumentListPage />);

    // Core columns stay.
    for (const header of ['When', 'Document number', 'Kind', 'Status', 'Buyer', 'Total']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }

    // Trimmed columns are gone (reachable via the Details drawer).
    expect(screen.queryByRole('columnheader', { name: 'Provider' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'CUFE' })).not.toBeInTheDocument();
  });

  it('opens the row-detail drawer with the trimmed fields via the Details action', () => {
    render(<FiscalDocumentListPage />);

    expect(screen.queryByTestId('fiscal-document-details-drawer')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /view details|ver detalle/i }));

    const drawer = screen.getByTestId('fiscal-document-details-drawer');
    expect(drawer).toBeInTheDocument();
    expect(screen.getByText('co-dian-mock')).toBeInTheDocument(); // trimmed provider id
    expect(screen.getByText(FULL_CUFE)).toBeInTheDocument(); // full CUFE in the drawer
  });
});
