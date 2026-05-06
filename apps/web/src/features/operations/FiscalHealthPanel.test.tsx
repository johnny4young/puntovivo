/**
 * ENG-065a — Tests for FiscalHealthPanel.
 *
 * Asserts:
 *   - Empty state when status filter returns no rows.
 *   - Rows render with status badge + retry button on
 *     contingency/rejected.
 *   - Retry mutation fires for admin clicks.
 *   - Manager sees the row but the retry button is disabled with a
 *     translated tooltip.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@/test/utils';
import { FiscalHealthPanel } from './FiscalHealthPanel';

const retryMutate = vi.fn(async () => undefined);
const fiscalListInvalidate = vi.fn(async () => undefined);
let mockUserRole: 'admin' | 'manager' = 'admin';
let mockFiscalRows: Array<Record<string, unknown>> = [];

vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      reports: { fiscal: { list: { invalidate: fiscalListInvalidate } } },
    }),
    reports: {
      fiscal: {
        list: {
          useQuery: () => ({
            data: { items: mockFiscalRows, total: mockFiscalRows.length },
            isLoading: false,
            error: null,
          }),
        },
        retryDocument: {
          useMutation: () => ({
            isPending: false,
            mutateAsync: retryMutate,
            variables: undefined,
          }),
        },
      },
    },
  },
}));

vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'demo@test', role: mockUserRole, tenantId: 't1' },
  }),
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

beforeEach(() => {
  retryMutate.mockClear();
  fiscalListInvalidate.mockClear();
  mockUserRole = 'admin';
  mockFiscalRows = [];
});

describe('FiscalHealthPanel', () => {
  it('renders the empty state when no contingency rows', () => {
    render(<FiscalHealthPanel />);
    expect(
      screen.getByText(/No fiscal documents are currently in contingency/i)
    ).toBeInTheDocument();
  });

  it('renders contingency rows with retry button (admin)', () => {
    mockFiscalRows = [
      {
        id: 'doc-1',
        documentNumber: 'DEE-000001',
        cufe: 'cufe-abc-123',
        status: 'contingency',
        emittedAt: '2026-05-05T12:00:00.000Z',
        buyerName: 'Empresa Demo',
        totalAmount: 10000,
        currencyCode: 'COP',
        kind: 'DEE',
        source: 'sale',
        sourceId: 'sale-1',
        consecutive: 1,
        buyerTaxId: '900000000',
        buyerTaxIdTypeCode: '31',
        subtotal: 9000,
        taxAmount: 1000,
        providerId: 'mock-co',
        retries: 0,
        xmlRef: null,
      },
    ];

    render(<FiscalHealthPanel />);
    expect(screen.getByText('DEE-000001')).toBeInTheDocument();
    expect(screen.getByText(/cufe-abc-123/i)).toBeInTheDocument();
    expect(screen.getByTestId('fiscal-retry-doc-1')).toBeInTheDocument();
    expect(screen.getByTestId('fiscal-retry-doc-1')).not.toBeDisabled();
  });

  it('triggers the retry mutation on admin click', async () => {
    mockFiscalRows = [
      {
        id: 'doc-2',
        documentNumber: 'DEE-000002',
        cufe: 'cufe-def-456',
        status: 'rejected',
        emittedAt: '2026-05-05T12:00:00.000Z',
        buyerName: 'Empresa Demo',
        totalAmount: 5000,
        currencyCode: 'COP',
        kind: 'DEE',
        source: 'sale',
        sourceId: 'sale-2',
        consecutive: 2,
        buyerTaxId: '900000000',
        buyerTaxIdTypeCode: '31',
        subtotal: 4500,
        taxAmount: 500,
        providerId: 'mock-co',
        retries: 1,
        xmlRef: null,
      },
    ];

    render(<FiscalHealthPanel />, { initialEntries: ['/operations?tab=fiscal'] });
    fireEvent.click(screen.getByTestId('fiscal-status-rejected'));
    fireEvent.click(screen.getByTestId('fiscal-retry-doc-2'));
    // Retry mutation called with the right document id.
    expect(retryMutate).toHaveBeenCalledWith({ fiscalDocumentId: 'doc-2' });
  });

  it('disables the retry button for manager role', () => {
    mockUserRole = 'manager';
    mockFiscalRows = [
      {
        id: 'doc-3',
        documentNumber: 'DEE-000003',
        cufe: 'cufe-xyz',
        status: 'contingency',
        emittedAt: '2026-05-05T12:00:00.000Z',
        buyerName: 'Empresa Demo',
        totalAmount: 5000,
        currencyCode: 'COP',
        kind: 'DEE',
        source: 'sale',
        sourceId: 'sale-3',
        consecutive: 3,
        buyerTaxId: '900000000',
        buyerTaxIdTypeCode: '31',
        subtotal: 4500,
        taxAmount: 500,
        providerId: 'mock-co',
        retries: 0,
        xmlRef: null,
      },
    ];

    render(<FiscalHealthPanel />);
    const button = screen.getByTestId('fiscal-retry-doc-3');
    expect(button).toBeDisabled();
    expect(button.getAttribute('title')).toMatch(/admin/i);
  });
});
