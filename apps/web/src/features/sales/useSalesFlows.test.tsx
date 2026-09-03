import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SalePaymentValues } from './salePaymentModal.types';
import type { SaleCartItem } from './saleCart';
import { useCartWorkspaceStore, type CartWorkspace } from './useCartWorkspaceStore';
import { useSalesFlows, type UseSalesFlowsParams } from './useSalesFlows';

const mocks = vi.hoisted(() => ({
  invalidateGroups: vi.fn(async (_utils: unknown, _pickers: unknown[]) => undefined),
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
  deviceId: 'device-current' as string | null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/components/feedback/ToastProvider', () => ({
  useToast: () => ({ success: mocks.success, error: mocks.error, warning: mocks.warning }),
}));
vi.mock('@/lib/trpc', () => ({
  trpc: { useUtils: () => ({}) },
}));
vi.mock('@/lib/invalidateGroups', () => ({
  invalidateCommittedGroups: async (utils: unknown, pickers: unknown[]) => {
    try {
      await mocks.invalidateGroups(utils, pickers);
      return true;
    } catch {
      return false;
    }
  },
  INVENTORY_RESERVATION_INVALIDATIONS: [],
}));
vi.mock('@/lib/translateServerError', () => ({
  translateServerError: () => 'translated error',
}));
vi.mock('@/lib/deviceId', () => ({
  getCachedDeviceIdSync: () => mocks.deviceId,
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
    sourceReturnId: null,
    sourceReturnSaleNumber: null,
    sourceReturnCustomerId: null,
    sourceReturnCustomerName: null,
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

function setup(activeWorkspace: CartWorkspace, resumedResult?: Record<string, unknown>) {
  const create = vi.fn(async () => ({ id: 'sale-created' }));
  const completeDraft = vi.fn(async () => ({ id: 'sale-completed' }));
  const suspend = vi.fn(async () => ({ id: activeWorkspace.serverSaleId ?? 'sale-created' }));
  const openRestaurantCheck = vi.fn(async () => ({ id: 'restaurant-sale-created' }));
  const resume = vi.fn(async () => resumedResult);
  const discard = vi.fn(async () => undefined);
  const setIsSuspendedPanelOpen = vi.fn();
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
    setIsSuspendedPanelOpen,
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
      mutateAsync: resume,
    } as unknown as UseSalesFlowsParams['resumeMutation'],
    discardDraftMutation: {
      mutateAsync: discard,
    } as unknown as UseSalesFlowsParams['discardDraftMutation'],
    openRestaurantCheckMutation: {
      isPending: false,
      mutateAsync: openRestaurantCheck,
    } as unknown as UseSalesFlowsParams['openRestaurantCheckMutation'],
  };
  const hook = renderHook(() => useSalesFlows(params));
  return {
    ...hook,
    create,
    completeDraft,
    suspend,
    openRestaurantCheck,
    resume,
    discard,
    setIsSuspendedPanelOpen,
  };
}

beforeEach(() => {
  mocks.deviceId = 'device-current';
  mocks.invalidateGroups.mockReset();
  mocks.invalidateGroups.mockResolvedValue(undefined);
  mocks.success.mockClear();
  mocks.error.mockClear();
  mocks.warning.mockClear();
  useCartWorkspaceStore.getState().resetAllWorkspaces();
});

describe('useSalesFlows explicit price tier forwarding', () => {
  it('carries the active tier into a fresh checkout', async () => {
    const { result, create } = setup(workspace({ priceTier: 2 }));

    await act(() =>
      result.current.handleCheckout({
        ...paymentValues(),
        pharmacyEvidenceIds: ['evidence-approved-fresh'],
      })
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        priceTier: 2,
        pharmacyEvidenceIds: ['evidence-approved-fresh'],
      })
    );
  });

  it('forwards the promotion fingerprint and derives payment state from its quoted total', async () => {
    const { result, create } = setup(workspace({ priceTier: 2 }));

    await act(() =>
      result.current.handleCheckout({
        ...paymentValues(),
        amountReceived: 60,
        promotionFingerprint: 'b'.repeat(64),
        promotionTotal: 60,
      })
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        promotionFingerprint: 'b'.repeat(64),
        amountReceived: 60,
        paymentStatus: 'paid',
      })
    );
  });

  it('echoes the frozen tier while completing a resumed draft', async () => {
    const { result, completeDraft } = setup(
      workspace({ serverSaleId: 'draft-1', serverSaleNumber: 'VTA-1', priceTier: 3 })
    );

    await act(() =>
      result.current.handleCheckout({
        ...paymentValues(),
        pharmacyEvidenceIds: ['evidence-approved-draft'],
      })
    );

    expect(completeDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        saleId: 'draft-1',
        priceTier: 3,
        pharmacyEvidenceIds: ['evidence-approved-draft'],
      })
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

  it('opens a restaurant check atomically with the active price tier', async () => {
    const active = workspace({ priceTier: 2 });
    useCartWorkspaceStore.setState({ workspaces: { [active.id]: active }, activeId: active.id });
    const { result, create, suspend, openRestaurantCheck } = setup(active);

    await act(() =>
      result.current.handleSuspendConfirm({ tableId: 'restaurant-table-1', guestCount: 3 })
    );

    expect(openRestaurantCheck).toHaveBeenCalledWith({
      tableId: 'restaurant-table-1',
      guestCount: 3,
      priceTier: 2,
      checkLabel: undefined,
      diners: [
        { clientId: 'seat-1', seatNumber: 1 },
        { clientId: 'seat-2', seatNumber: 2 },
        { clientId: 'seat-3', seatNumber: 3 },
      ],
      items: [
        expect.objectContaining({
          productId: 'product-1',
          unitId: 'unit-1',
          dinerClientId: null,
          courseKey: 'main',
          modifiers: [],
        }),
      ],
    });
    expect(create).not.toHaveBeenCalled();
    expect(suspend).not.toHaveBeenCalled();

    const invalidationPickers = mocks.invalidateGroups.mock.calls[0]?.[1] as
      Array<(utils: unknown) => unknown> | undefined;
    expect(invalidationPickers).toBeDefined();
    const visitedPaths = new Set<string>();
    const pathProbe = (path: string[] = []): unknown =>
      new Proxy(() => undefined, {
        get: (_target, property) => {
          const nextPath = [...path, String(property)];
          visitedPaths.add(nextPath.join('.'));
          return pathProbe(nextPath);
        },
      });
    for (const picker of invalidationPickers ?? []) {
      picker(pathProbe());
    }
    expect(visitedPaths).toContain('restaurantServices.getTableState');
  });

  it('normalizes a fractional restaurant party before building diner identities', async () => {
    const active = workspace();
    useCartWorkspaceStore.setState({ workspaces: { [active.id]: active }, activeId: active.id });
    const { result, openRestaurantCheck } = setup(active);

    await act(() =>
      result.current.handleSuspendConfirm({ tableId: 'restaurant-table-1', guestCount: 3.9 })
    );

    expect(openRestaurantCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        guestCount: 3,
        diners: [
          { clientId: 'seat-1', seatNumber: 1 },
          { clientId: 'seat-2', seatNumber: 2 },
          { clientId: 'seat-3', seatNumber: 3 },
        ],
      })
    );
  });

  it('does not keep a committed restaurant cart when cache refresh fails', async () => {
    const active = workspace();
    useCartWorkspaceStore.setState({ workspaces: { [active.id]: active }, activeId: active.id });
    mocks.invalidateGroups.mockRejectedValueOnce(new Error('cache refresh failed'));
    const { result, openRestaurantCheck } = setup(active);

    await act(() =>
      result.current.handleSuspendConfirm({ tableId: 'restaurant-table-1', guestCount: 2 })
    );

    expect(openRestaurantCheck).toHaveBeenCalledTimes(1);
    const state = useCartWorkspaceStore.getState();
    expect(state.workspaces[active.id]).toBeUndefined();
    expect(state.activeId).not.toBe(active.id);
    expect(state.activeId ? state.workspaces[state.activeId]?.items : null).toEqual([]);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledWith({
      title: 'park.toastSuspendTitle',
      description: 'common:toast.committedRefreshWarning',
    });
  });

  it('cancels an orphaned generic draft when the second park command fails', async () => {
    const active = workspace();
    useCartWorkspaceStore.setState({ workspaces: { [active.id]: active }, activeId: active.id });
    const { result, suspend, discard } = setup(active);
    suspend.mockRejectedValueOnce(new Error('park transport failed'));

    await act(() => result.current.handleSuspendConfirm());

    expect(discard).toHaveBeenCalledWith({ saleId: 'sale-created' });
    expect(mocks.error).toHaveBeenCalledWith({
      title: 'park.toastErrorTitle',
      description: 'translated error',
    });
  });

  it('warns against retrying when an orphaned generic draft cannot be cancelled', async () => {
    const active = workspace();
    useCartWorkspaceStore.setState({ workspaces: { [active.id]: active }, activeId: active.id });
    const { result, suspend, discard } = setup(active);
    suspend.mockRejectedValueOnce(new Error('park transport failed'));
    discard.mockRejectedValueOnce(new Error('discard transport failed'));

    await act(() => result.current.handleSuspendConfirm());

    expect(discard).toHaveBeenCalledWith({ saleId: 'sale-created' });
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(mocks.error).toHaveBeenCalledWith({
      title: 'park.toastErrorTitle',
      description: 'park.suspendRecoveryFailedDescription',
    });
    expect(useCartWorkspaceStore.getState().workspaces[active.id]).toBeDefined();
  });

  it('hydrates a resumed draft even when its committed-state refresh fails', async () => {
    const resumed = {
      id: 'draft-refresh-failure',
      saleNumber: 'VTA-REFRESH',
      suspendedLabel: 'Mesa 8',
      customerId: null,
      priceTier: 1,
      items: [
        {
          id: 'line-refresh',
          productId: 'product-1',
          productName: 'Recovered item',
          productSku: 'REC-1',
          unitId: 'unit-1',
          unitName: 'Unit',
          unitAbbreviation: 'UND',
          unitEquivalence: 1,
          quantity: 1,
          unitPrice: 80,
          priceEdited: false,
          discount: 0,
          taxRate: 0,
          tracksStock: true,
        },
      ],
    };
    mocks.invalidateGroups.mockRejectedValueOnce(new Error('cache refresh failed'));
    const { result, resume } = setup(workspace(), resumed);

    await act(() =>
      result.current.handleResumeFromPanel({
        id: resumed.id,
        label: 'Mesa 8',
        tableId: null,
        suspendedAt: '2026-09-03T12:00:00.000Z',
        resumedDeviceId: null,
      })
    );

    expect(resume).toHaveBeenCalledTimes(1);
    const state = useCartWorkspaceStore.getState();
    expect(state.activeId ? state.workspaces[state.activeId] : null).toMatchObject({
      serverSaleId: resumed.id,
      label: 'Mesa 8',
      items: [expect.objectContaining({ key: 'product-1:unit-1:server:line-refresh' })],
    });
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.warning).toHaveBeenCalledWith({
      title: 'park.toastResumeTitle',
      description: 'common:toast.committedRefreshWarning',
    });
  });

  it('refreshes an existing same-device claim instead of trusting its stale local snapshot', async () => {
    const resumedWorkspace = workspace({
      id: 'workspace-recovered',
      serverSaleId: 'draft-already-recovered',
      serverSaleNumber: 'VTA-RECOVERED',
      label: 'Mesa 4',
    });
    const otherWorkspace = workspace({ id: 'workspace-other' });
    useCartWorkspaceStore.setState({
      workspaces: {
        [resumedWorkspace.id]: resumedWorkspace,
        [otherWorkspace.id]: otherWorkspace,
      },
      activeId: otherWorkspace.id,
    });
    const { result, resume, setIsSuspendedPanelOpen } = setup(otherWorkspace, {
      id: resumedWorkspace.serverSaleId,
      saleNumber: 'VTA-REFRESHED',
      customerId: null,
      priceTier: 3,
      items: [],
    });

    await act(() =>
      result.current.handleResumeFromPanel({
        id: resumedWorkspace.serverSaleId!,
        label: resumedWorkspace.label,
        tableId: null,
        suspendedAt: null,
        resumedDeviceId: 'device-current',
      })
    );

    expect(resume).toHaveBeenCalledWith({ saleId: resumedWorkspace.serverSaleId });
    expect(useCartWorkspaceStore.getState().activeId).toBe(resumedWorkspace.id);
    expect(Object.values(useCartWorkspaceStore.getState().workspaces)).toHaveLength(2);
    expect(setIsSuspendedPanelOpen).toHaveBeenCalledWith(false);
    expect(useCartWorkspaceStore.getState().workspaces[resumedWorkspace.id]).toMatchObject({
      serverSaleNumber: 'VTA-REFRESHED',
      serverCustomerId: null,
      priceTier: 3,
      items: [],
    });
  });

  it('reclaims a remote device claim before focusing an existing workspace', async () => {
    const resumedWorkspace = workspace({
      id: 'workspace-stale-device',
      serverSaleId: 'draft-remote-device',
      serverSaleNumber: 'VTA-REMOTE',
    });
    useCartWorkspaceStore.setState({
      workspaces: { [resumedWorkspace.id]: resumedWorkspace },
      activeId: resumedWorkspace.id,
    });
    const resumed = {
      id: 'draft-remote-device',
      saleNumber: 'VTA-REMOTE',
      customerId: null,
      priceTier: 1,
      items: [],
    };
    const { result, resume } = setup(resumedWorkspace, resumed);

    await act(() =>
      result.current.handleResumeFromPanel({
        id: resumed.id,
        label: null,
        tableId: null,
        suspendedAt: null,
        resumedDeviceId: 'device-other',
      })
    );

    expect(resume).toHaveBeenCalledWith({ saleId: resumed.id });
    expect(useCartWorkspaceStore.getState().activeId).toBe(resumedWorkspace.id);
    expect(Object.values(useCartWorkspaceStore.getState().workspaces)).toHaveLength(1);
    expect(useCartWorkspaceStore.getState().workspaces[resumedWorkspace.id]?.items).toEqual([]);
  });

  it('rehydrates duplicate product/unit rows with distinct server line identities', async () => {
    const resumed = {
      id: 'draft-gs1',
      saleNumber: 'VTA-GS1',
      suspendedLabel: 'Two packages',
      customerId: null,
      priceTier: 1,
      items: [
        {
          id: 'line-price-199',
          productId: 'product-1',
          productName: 'Packaged cut',
          productSku: 'CUT-1',
          unitId: 'unit-1',
          unitName: 'Unit',
          unitAbbreviation: 'UND',
          unitEquivalence: 1,
          quantity: 1,
          unitPrice: 1.99,
          priceEdited: true,
          discount: 0,
          taxRate: 0,
          tracksStock: true,
        },
        {
          id: 'line-price-249',
          productId: 'product-1',
          productName: 'Packaged cut',
          productSku: 'CUT-1',
          unitId: 'unit-1',
          unitName: 'Unit',
          unitAbbreviation: 'UND',
          unitEquivalence: 1,
          quantity: 1,
          unitPrice: 2.49,
          priceEdited: true,
          discount: 0,
          taxRate: 0,
          tracksStock: true,
        },
      ],
    };
    const { result } = setup(workspace(), resumed);

    await act(() =>
      result.current.handleResumeFromPanel({
        id: 'draft-gs1',
        label: 'Two packages',
        tableId: null,
        suspendedAt: '2026-09-03T12:00:00.000Z',
        resumedDeviceId: null,
      })
    );

    expect(mocks.invalidateGroups).toHaveBeenCalledTimes(1);
    const state = useCartWorkspaceStore.getState();
    const active = state.activeId ? state.workspaces[state.activeId] : null;
    expect(active?.items).toHaveLength(2);
    expect(new Set(active?.items.map(item => item.key)).size).toBe(2);
    expect(active?.items.map(item => item.key)).toEqual([
      'product-1:unit-1:server:line-price-199',
      'product-1:unit-1:server:line-price-249',
    ]);
    expect(active?.items.every(item => item.priceEdited === true)).toBe(true);
  });

  it('re-suspends a committed resume when local hydration fails', async () => {
    const resumed = {
      id: 'draft-storage-failure',
      saleNumber: 'VTA-STORAGE',
      suspendedLabel: null,
      customerId: null,
      priceTier: 1,
      items: [
        {
          id: 'line-storage',
          productId: 'product-1',
          productName: 'Recovered item',
          productSku: 'REC-1',
          unitId: 'unit-1',
          unitName: 'Unit',
          unitAbbreviation: 'UND',
          unitEquivalence: 1,
          quantity: 1,
          unitPrice: 80,
          priceEdited: false,
          discount: 0,
          taxRate: 0,
          tracksStock: true,
        },
      ],
    };
    const hydrate = vi
      .spyOn(useCartWorkspaceStore.getState(), 'hydrateFromResumed')
      .mockImplementationOnce(() => {
        throw new Error('local storage unavailable');
      });
    const { result, resume, suspend } = setup(workspace(), resumed);

    await act(() =>
      result.current.handleResumeFromPanel({
        id: resumed.id,
        label: 'Mesa segura',
        tableId: 'table-1',
        suspendedAt: '2026-09-03T12:00:00.000Z',
        resumedDeviceId: null,
      })
    );

    expect(resume).toHaveBeenCalledWith({ saleId: resumed.id });
    expect(suspend).toHaveBeenCalledWith({
      saleId: resumed.id,
      label: 'Mesa segura',
      tableId: 'table-1',
    });
    expect(mocks.error).toHaveBeenCalledWith({
      title: 'park.toastErrorTitle',
      description: 'park.resumeRestoredDescription',
    });
    hydrate.mockRestore();
  });

  it('warns against recreating a sale when committed resume recovery also fails', async () => {
    const resumed = {
      id: 'draft-double-failure',
      saleNumber: 'VTA-DOUBLE',
      suspendedLabel: null,
      customerId: null,
      priceTier: 1,
      items: [],
    };
    const hydrate = vi
      .spyOn(useCartWorkspaceStore.getState(), 'hydrateFromResumed')
      .mockImplementationOnce(() => {
        throw new Error('local storage unavailable');
      });
    const { result, suspend } = setup(workspace(), resumed);
    suspend.mockRejectedValueOnce(new Error('network unavailable'));

    await act(() =>
      result.current.handleResumeFromPanel({
        id: resumed.id,
        label: null,
        tableId: null,
        suspendedAt: '2026-09-03T12:00:00.000Z',
        resumedDeviceId: null,
      })
    );

    expect(suspend).toHaveBeenCalledWith({ saleId: resumed.id });
    expect(mocks.error).toHaveBeenCalledWith({
      title: 'park.toastErrorTitle',
      description: 'park.resumeRecoveryFailedDescription',
    });
    hydrate.mockRestore();
  });

  it('does not hydrate a previous owner after the sales surface unmounts', async () => {
    const resumed = {
      id: 'draft-after-logout',
      saleNumber: 'VTA-LOGOUT',
      suspendedLabel: null,
      customerId: null,
      priceTier: 1,
      items: [],
    };
    let resolveResume: ((value: typeof resumed) => void) | undefined;
    const pendingResume = new Promise<typeof resumed>(resolve => {
      resolveResume = resolve;
    });
    const { result, resume, suspend, unmount } = setup(workspace(), resumed);
    resume.mockReturnValueOnce(pendingResume);

    let pending: Promise<void> | undefined;
    act(() => {
      pending = result.current.handleResumeFromPanel({
        id: resumed.id,
        label: 'Mesa logout',
        tableId: null,
        suspendedAt: '2026-09-03T12:00:00.000Z',
        resumedDeviceId: null,
      });
    });
    unmount();
    resolveResume?.(resumed);
    await act(async () => {
      await pending;
    });

    expect(suspend).toHaveBeenCalledWith({ saleId: resumed.id, label: 'Mesa logout' });
    expect(
      Object.values(useCartWorkspaceStore.getState().workspaces).some(
        candidate => candidate.serverSaleId === resumed.id
      )
    ).toBe(false);
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

  it('links a replacement sale to its return and ignores payment-customer drift', async () => {
    const exchange = workspace({
      sourceReturnId: 'return-1',
      sourceReturnSaleNumber: 'VTA-1',
      sourceReturnCustomerId: 'customer-frozen',
      sourceReturnCustomerName: 'Frozen Customer',
    });
    const { result, create } = setup(exchange);

    await act(() =>
      result.current.handleCheckout({ ...paymentValues(), customerId: 'customer-tampered' })
    );

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceReturnId: 'return-1',
        customerId: 'customer-frozen',
        priceTier: 2,
      })
    );
  });

  it('does not park an exchange because a generic draft would lose its return link', async () => {
    const exchange = workspace({
      sourceReturnId: 'return-1',
      sourceReturnSaleNumber: 'VTA-1',
      sourceReturnCustomerId: 'customer-frozen',
      sourceReturnCustomerName: 'Frozen Customer',
    });
    useCartWorkspaceStore.setState({
      workspaces: { [exchange.id]: exchange },
      activeId: exchange.id,
    });
    const { result, create, suspend } = setup(exchange);

    act(() => result.current.handleOpenSuspendPrompt());
    let shouldResetModalSelection = false;
    await act(async () => {
      shouldResetModalSelection = await result.current.handleSuspendConfirm();
    });

    expect(create).not.toHaveBeenCalled();
    expect(suspend).not.toHaveBeenCalled();
    expect(shouldResetModalSelection).toBe(true);
  });
});
