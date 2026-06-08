/**
 * ENG-132h — FiscalDocumentDetailsDrawer tests.
 *
 * Pins the row-detail Drawer holding the columns trimmed off the default
 * fiscal-documents table:
 *   - renders the trimmed fields (provider id + the FULL untruncated CUFE);
 *   - the "View XML" footer action calls onViewXml only when the document has
 *     an xmlRef, and the Close action calls onClose;
 *   - stays closed when `item` is null;
 *   - no serious accessibility violations.
 *
 * @module features/fiscal/FiscalDocumentDetailsDrawer.test
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FiscalDocumentListItem } from '@/types';
import { assertNoA11yViolations } from '@/test/a11y';
import { FiscalDocumentDetailsDrawer } from './FiscalDocumentDetailsDrawer';

const FULL_CUFE = 'CUFE0011223344556677889900AABBCCDDEEFF0011223344';

function makeDoc(overrides?: Partial<FiscalDocumentListItem>): FiscalDocumentListItem {
  return {
    id: 'fd-1',
    source: 'sale',
    sourceId: 'sale-1',
    kind: 'FEV',
    documentNumber: 'FEV-000990',
    consecutive: 990,
    cufe: FULL_CUFE,
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
    ...overrides,
  } as FiscalDocumentListItem;
}

describe('FiscalDocumentDetailsDrawer (ENG-132h)', () => {
  it('renders the trimmed provider + full CUFE fields', () => {
    render(<FiscalDocumentDetailsDrawer item={makeDoc()} onClose={vi.fn()} />);

    const drawer = screen.getByTestId('fiscal-document-details-drawer');
    expect(within(drawer).getByText('co-dian-mock')).toBeInTheDocument(); // provider id
    expect(within(drawer).getByText(FULL_CUFE)).toBeInTheDocument(); // full, untruncated CUFE
    expect(within(drawer).getByText('Comercializadora Andina')).toBeInTheDocument(); // buyer
    expect(screen.getByRole('heading', { name: 'FEV-000990' })).toBeInTheDocument();
  });

  it('hands off to the XML viewer only when the document has an xmlRef', () => {
    const onViewXml = vi.fn();
    const doc = makeDoc();
    const { rerender } = render(
      <FiscalDocumentDetailsDrawer item={doc} onClose={vi.fn()} onViewXml={onViewXml} />
    );

    fireEvent.click(screen.getByRole('button', { name: /view xml|ver xml/i }));
    expect(onViewXml).toHaveBeenCalledWith(doc);

    const noXml = makeDoc({ id: 'fd-2', xmlRef: false });
    rerender(
      <FiscalDocumentDetailsDrawer item={noXml} onClose={vi.fn()} onViewXml={onViewXml} />
    );
    expect(screen.queryByRole('button', { name: /view xml|ver xml/i })).not.toBeInTheDocument();

    const numericNoXml = makeDoc({
      id: 'fd-3',
      xmlRef: 0 as unknown as FiscalDocumentListItem['xmlRef'],
    });
    rerender(
      <FiscalDocumentDetailsDrawer item={numericNoXml} onClose={vi.fn()} onViewXml={onViewXml} />
    );
    expect(screen.queryByRole('button', { name: /view xml|ver xml/i })).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('calls onClose when the Close footer action is clicked', () => {
    const onClose = vi.fn();
    render(<FiscalDocumentDetailsDrawer item={makeDoc()} onClose={onClose} />);

    // The footer Close button (the header X is "Close modal" / "Cerrar modal").
    fireEvent.click(screen.getByRole('button', { name: /^(close|cerrar)$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('stays closed when item is null', () => {
    render(<FiscalDocumentDetailsDrawer item={null} onClose={vi.fn()} />);

    expect(
      screen.queryByTestId('fiscal-document-details-drawer')
    ).not.toBeInTheDocument();
  });

  it('has no serious accessibility violations', async () => {
    const { baseElement } = render(
      <FiscalDocumentDetailsDrawer item={makeDoc()} onClose={vi.fn()} onViewXml={vi.fn()} />
    );
    await assertNoA11yViolations(baseElement);
  });
});
