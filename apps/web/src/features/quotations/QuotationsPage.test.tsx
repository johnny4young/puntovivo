import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils';
import { useCartWorkspaceStore } from '@/features/sales/useCartWorkspaceStore';
import { QuotationsPage } from './QuotationsPage';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  fetchDetail: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  currentSite: { id: 'site-1', name: 'Main Site' },
}));

vi.mock('react-router', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => mocks.navigate };
});
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({
    success: mocks.success,
    error: mocks.error,
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));
vi.mock('@/features/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1', role: 'admin' } }),
}));
vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({
    currentTenant: { id: 'tenant-1' },
    currentSite: mocks.currentSite,
  }),
}));
vi.mock('@/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ quotations: { getById: { fetch: mocks.fetchDetail } } }),
  },
}));
vi.mock('./QuotationsHistoryTable', () => ({
  QuotationsHistoryTable: ({ onConvertToSale }: { onConvertToSale: (id: string) => void }) => (
    <button type="button" onClick={() => onConvertToSale('quote-1')}>
      Convert fixture
    </button>
  ),
}));
vi.mock('./QuotationCreateModal', () => ({ QuotationCreateModal: () => null }));
vi.mock('./QuotationDetailsModal', () => ({ QuotationDetailsModal: () => null }));

function detail() {
  return {
    id: 'quote-1',
    quotationNumber: 'COT-000001',
    status: 'accepted' as const,
    customerId: 'customer-1',
    customerName: 'Acme',
    priceTier: 2 as const,
    siteId: 'site-1',
    siteName: 'Main Site',
    validUntil: '2099-01-01T00:00:00.000Z',
    items: [
      {
        id: 'line-1',
        productId: 'product-1',
        productName: 'Cable',
        productSku: 'CABLE-1',
        unitId: 'unit-1',
        unitEquivalence: 1,
        unitName: 'Unit',
        unitAbbreviation: 'EA',
        quantity: 2,
        unitPrice: 10,
        discount: 5,
        taxRate: 19,
        taxComponents: [{ vatRateId: 'vat-19' }],
        availableStock: 12,
        tracksStock: true,
        tracksSerials: false,
        sellByFraction: false,
        fractionStep: null,
        fractionMinimum: null,
      },
    ],
  };
}

describe('QuotationsPage conversion preparation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCartWorkspaceStore.getState().resetAllWorkspaces();
    localStorage.clear();
    mocks.currentSite.id = 'site-1';
    mocks.currentSite.name = 'Main Site';
    mocks.fetchDetail.mockResolvedValue(detail());
  });

  it('hydrates a line-locked POS workspace from the current quotation snapshot', async () => {
    render(<QuotationsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Convert fixture' }));

    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/sales'));
    expect(mocks.fetchDetail).toHaveBeenCalledWith({ id: 'quote-1' }, { staleTime: 0 });
    const state = useCartWorkspaceStore.getState();
    const active = state.activeId ? state.workspaces[state.activeId] : null;
    expect(active).toMatchObject({
      ownerKey: 'tenant-1:user-1',
      sourceQuotationId: 'quote-1',
      sourceQuotationSiteId: 'site-1',
      sourceQuotationCustomerId: 'customer-1',
      priceTier: 2,
      items: [
        expect.objectContaining({
          key: 'quotation:line-1',
          sourceQuotationItemId: 'line-1',
          taxComponents: [{ vatRateId: 'vat-19' }],
          availableStock: 12,
          priceEdited: true,
        }),
      ],
    });
  });

  it('refuses to hydrate a quotation belonging to another active site', async () => {
    mocks.currentSite.id = 'site-2';
    render(<QuotationsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Convert fixture' }));

    await waitFor(() => expect(mocks.error).toHaveBeenCalled());
    expect(useCartWorkspaceStore.getState().activeId).toBeNull();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
