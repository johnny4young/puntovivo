import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import i18n from '@/i18n';
import { render } from '@/test/utils';
import type { QuotationDetail } from '@/types';
import { QuotationDetailsModal } from './QuotationDetailsModal';

const { detailUseQuery, balanceUseQuery } = vi.hoisted(() => ({
  detailUseQuery: vi.fn(),
  balanceUseQuery: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: {
    quotations: { getById: { useQuery: detailUseQuery } },
    customerLedger: { getBalance: { useQuery: balanceUseQuery } },
  },
}));

vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }),
}));

function quotation(overrides: Partial<QuotationDetail> = {}): QuotationDetail {
  return {
    id: 'quotation-1',
    quotationNumber: 'COT-000042',
    status: 'sent',
    customerId: 'customer-1',
    customerName: 'Tienda Rosa',
    priceTier: 2,
    customerTaxId: '900123456',
    customerEmail: 'rosa@example.com',
    customerPhone: null,
    customerCreditLimit: 2_000,
    siteId: 'site-1',
    siteName: 'Sede Centro',
    subtotal: 100,
    taxAmount: 19,
    discountAmount: 0,
    total: 119,
    validUntil: null,
    notes: null,
    createdAt: '2026-08-29T12:00:00.000Z',
    createdBy: 'user-1',
    createdByName: 'Admin',
    statusChangedAt: null,
    statusChangedBy: null,
    statusChangedByName: null,
    updatedAt: '2026-08-29T12:00:00.000Z',
    items: [
      {
        id: 'line-1',
        productId: 'product-1',
        productName: 'Café',
        productSku: 'CAF-1',
        quantity: 1,
        unitPrice: 100,
        discount: 0,
        taxRate: 19,
        taxKind: 'iva',
        taxAmount: 19,
        taxComponents: [],
        total: 119,
      },
    ],
    ...overrides,
  };
}

describe('QuotationDetailsModal customer account', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await i18n.changeLanguage('en');
    detailUseQuery.mockReturnValue({
      data: quotation(),
      isLoading: false,
      error: null,
    });
    balanceUseQuery.mockReturnValue({
      data: { balance: 725 },
      isLoading: false,
      error: null,
    });
  });

  it('shows the stored credit limit and the live receivable balance', () => {
    render(
      <QuotationDetailsModal isOpen quotationId="quotation-1" onClose={vi.fn()} />
    );

    expect(balanceUseQuery).toHaveBeenCalledWith(
      { customerId: 'customer-1' },
      { enabled: true }
    );
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText(/2,000/)).toBeInTheDocument();
    expect(screen.getByText(/725/)).toBeInTheDocument();
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument();
  });

  it('does not request an account balance for a walk-in quotation', () => {
    detailUseQuery.mockReturnValue({
      data: quotation({
        customerId: null,
        customerName: null,
        customerCreditLimit: null,
      }),
      isLoading: false,
      error: null,
    });

    render(
      <QuotationDetailsModal isOpen quotationId="quotation-1" onClose={vi.fn()} />
    );

    expect(balanceUseQuery).toHaveBeenCalledWith({ customerId: '' }, { enabled: false });
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });
});
