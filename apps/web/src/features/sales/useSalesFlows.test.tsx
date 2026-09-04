import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SalePaymentValues } from './salePaymentModal.types';
import type { SaleCartItem } from './saleCart';
import { useCartWorkspaceStore, type CartWorkspace } from './useCartWorkspaceStore';
import { useSalesFlows, type UseSalesFlowsParams } from './useSalesFlows';

const mocks = vi.hoisted(() => ({
  invalidateGroups: vi.fn(async () => undefined),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: mocks.success, error: mocks.error }),
}));
vi.mock('@/lib/trpc', () => ({
  trpc: { useUtils: () => ({}) },
}));
vi.mock('@/lib/invalidateGroups', () => ({
  invalidateGroups: mocks.invalidateGroups,
  SERIAL_INVENTORY_INVALIDATIONS: [],
}));
vi.mock('@/lib/translateServerError', () => ({
  translateServerError: () => 'translated error',
}));

function cartItem(): SaleCartItem {
  return {
    key: 'product-1:unit-1',
    productId: 'product-1',
    productName: 'Tier product',
    productSku: 'TIER-1',
    unitId: 'unit-1',
    unitName: 'Unit',
    unitEquivalence: 1,
    quantity: 1,
    unitPrice: 80,
    discount: 0,
    taxRate: 0,
    availableStock: 10,
    sellByFraction: false,
  };
}

function workspace(overrides: Partial<CartWorkspace> = {}): CartWorkspace {
  return {
    id: 'workspace-1',
    ownerKey: 'tenant-1:user-1',
    items: [cartItem()],
    selectedItemKey: null,
    serverSaleId: null,
    serverSaleNumber: null,
    serverCustomerId: null,
    sourceQuotationId: null,
    sourceQuotationNumber: null,
    sourceQuotationSiteId: null,
    sourceQuotationCustomerId: null,
    sourceQuotationCustomerName: null,
    label: null,
    checkoutStartedAt: '2026-08-28T12:00:00.000Z',
    priceTier: 2,
    createdAt: '2026-08-28T12:00:00.000Z',
    historyStack: [],
    ...overrides,
  };
}

function paymentValues(): SalePaymentValues {
  return {
    customerId: '',
    paymentMethod: 'cash',
    amountReceived: 80,
    notes: '',
    tenders: [],
    tipAmount: 0,
    tipMethod: null,
    creditOverride: false,
    serviceChargeAmount: 0,
    serviceChargeRate: null,
  };
}

function setup(activeWorkspace: CartWorkspace) {
  const create = vi.fn(async () => ({ id: 'sale-created' }));
  const completeDraft = vi.fn(async () => ({ id: 'sale-completed' }));
  const suspend = vi.fn(async () => ({ id: activeWorkspace.serverSaleId ?? 'sale-created' }));
  const params: UseSalesFlowsParams = {
    activeWorkspace,
    cartItems: activeWorkspace.items,
    ownerKey: activeWorkspace.ownerKey,
    draftSummary: { itemCount: 1, subtotal: 80, taxAmount: 0, total: 80 },
    isSuspending: false,
    suspendLabelDraft: '',
    canCharge: true,
    itemsLocked:
      activeWorkspace.serverSaleId !== null || activeWorkspace.sourceQuotationId !== null,
    setSaleError: vi.fn(),
    setIsSuspendLabelPromptOpen: vi.fn(),
    setSuspendLabelDraft: vi.fn(),
    setIsSuspending: vi.fn(),
    setIsSuspendedPanelOpen: vi.fn(),
    createMutation: {
      isPending: false,
      mutateAsync: create,
    } as unknown as UseSalesFlowsParams['createMutation'],
    completeDraftMutation: {
      isPending: false,
      mutateAsync: completeDraft,
    } as unknown as UseSalesFlowsParams['completeDraftMutation'],
    suspendMutation: { mutateAsync: suspend } as unknown as UseSalesFlowsParams['suspendMutation'],
    resumeMutation: {
      isPending: false,
      mutateAsync: vi.fn(),
    } as unknown as UseSalesFlowsParams['resumeMutation'],
    discardDraftMutation: {
      mutateAsync: vi.fn(),
    } as unknown as UseSalesFlowsParams['discardDraftMutation'],
  };
  const hook = renderHook(() => useSalesFlows(params));
  return { ...hook, create, completeDraft, suspend };
}

beforeEach(() => {
  mocks.invalidateGroups.mockClear();
  mocks.success.mockClear();
  mocks.error.mockClear();
  useCartWorkspaceStore.getState().resetAllWorkspaces();
});

describe('useSalesFlows explicit price tier forwarding', () => {
  it('carries the active tier into a fresh checkout', async () => {
    const { result, create } = setup(workspace({ priceTier: 2 }));

    await act(() => result.current.handleCheckout(paymentValues()));

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ priceTier: 2 }));
  });

  it('echoes the frozen tier while completing a resumed draft', async () => {
    const { result, completeDraft } = setup(
      workspace({ serverSaleId: 'draft-1', serverSaleNumber: 'VTA-1', priceTier: 3 })
    );

    await act(() => result.current.handleCheckout(paymentValues()));

    expect(completeDraft).toHaveBeenCalledWith(
      expect.objectContaining({ saleId: 'draft-1', priceTier: 3 })
    );
  });

  it('persists the active tier when creating a suspended draft', async () => {
    const active = workspace({ priceTier: 2 });
    useCartWorkspaceStore.setState({ workspaces: { [active.id]: active }, activeId: active.id });
    const { result, create, suspend } = setup(active);

    await act(() => result.current.handleSuspendConfirm());

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ status: 'draft', priceTier: 2 }));
    expect(suspend).toHaveBeenCalledWith({ saleId: 'sale-created', label: undefined });
  });

  it('forwards immutable quotation identities and ignores payment-customer drift', async () => {
    const quoted = workspace({
      sourceQuotationId: 'quote-1',
      sourceQuotationNumber: 'COT-1',
      sourceQuotationSiteId: 'site-1',
      sourceQuotationCustomerId: 'customer-frozen',
      sourceQuotationCustomerName: 'Frozen Customer',
      items: [
        {
          ...cartItem(),
          key: 'quotation:line-1',
          sourceQuotationItemId: 'line-1',
          taxComponents: [{ vatRateId: 'vat-19' }],
        },
      ],
    });
    const { result, create } = setup(quoted);

    await act(() =>
      result.current.handleCheckout({ ...paymentValues(), customerId: 'customer-tampered' })
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceQuotationId: 'quote-1',
        customerId: 'customer-frozen',
        priceTier: 2,
        items: [
          expect.objectContaining({
            sourceQuotationItemId: 'line-1',
            taxComponents: [{ vatRateId: 'vat-19' }],
          }),
        ],
      })
    );
  });
});
