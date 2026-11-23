import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import i18n from '@/i18n';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  onScan: null as ((code: string) => Promise<void> | void) | null,
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn() },
  playScanError: vi.fn(),
}));

vi.mock('@/lib/trpc', () => ({
  trpc: { useUtils: () => ({ products: { lookupByBarcode: { fetch: mocks.fetch } } }) },
}));
vi.mock('@/components/feedback/ToastProvider', () => ({ useToast: () => mocks.toast }));
vi.mock('@/features/tenant/TenantProvider', () => ({
  useTenant: () => ({ currentSite: { id: 'site-1' } }),
}));
vi.mock('@/lib/sound', () => ({
  playScanError: mocks.playScanError,
  playScanSuccess: vi.fn(),
}));
vi.mock('@/features/sales/useBarcodeWedgeListener', () => ({
  useBarcodeWedgeListener: (options: { onScan: (code: string) => Promise<void> }) => {
    mocks.onScan = options.onScan;
  },
}));

import { useBarcodeProductScanner } from './useBarcodeProductScanner';

function renderScanner(pendingQuantity: number | 'rejected' | null = null) {
  const setCartItems = vi.fn();
  const takePendingQuantity = vi.fn(() => pendingQuantity);
  const { result } = renderHook(() =>
    useBarcodeProductScanner({
      scannerConfig: { minLength: 6, maxLength: 32, interCharGapMs: 30, endOfScan: 'enter' },
      isResumedCart: false,
      isProductSearchOpen: false,
      isPaymentModalOpen: false,
      isCashSessionModalOpen: false,
      isCashSessionCloseModalOpen: false,
      isCashSessionMovementModalOpen: false,
      productInputRef: { current: null },
      setCartItems,
      setSelectedCartItemKey: vi.fn(),
      setProductSearchQuery: vi.fn(),
      setSaleError: vi.fn(),
      takePendingQuantity,
    })
  );
  return { setCartItems, takePendingQuantity, hook: result };
}

function lookup(
  overrides: {
    suggestedQuantity?: number | null;
    sellByFraction?: boolean;
    resolvedUnitId?: string | null;
  } = {}
) {
  return {
    product: {
      id: 'product-1',
      name: 'Arroz Diana 500g',
      sku: 'ABR-0001',
      price: 3200,
      taxRate: 0,
      stock: 20,
      sellByFraction: overrides.sellByFraction ?? false,
      unitAssignments: [
        { id: 'a1', unitId: 'unit-base', unitName: 'Unidad', equivalence: 1, price: 3200, isBase: true },
        { id: 'a2', unitId: 'unit-pack', unitName: 'Paca', equivalence: 6, price: 18000, isBase: false },
      ],
    },
    resolvedUnitId: overrides.resolvedUnitId ?? null,
    suggestedPrice: null,
    suggestedQuantity: overrides.suggestedQuantity ?? null,
  };
}

/** Applies the cart updater the hook queued to an empty cart. */
function cartAfterScan(setCartItems: ReturnType<typeof vi.fn>) {
  const updater = setCartItems.mock.calls.at(-1)?.[0] as (items: unknown[]) => Array<{
    quantity: number;
    unitId: string;
  }>;
  return updater([]);
}

beforeEach(async () => {
  await i18n.changeLanguage('es');
  mocks.fetch.mockReset();
  mocks.playScanError.mockReset();
  for (const fn of Object.values(mocks.toast)) fn.mockReset();
});

describe('useBarcodeProductScanner', () => {
  it('asks to scan again when the code fails its check digit', async () => {
    mocks.fetch.mockRejectedValue({ data: { errorCode: 'GS1_CHECK_DIGIT_INVALID' } });
    const { setCartItems } = renderScanner();

    await act(async () => {
      await mocks.onScan!('7702011000103');
    });

    expect(mocks.playScanError).toHaveBeenCalledOnce();
    expect(mocks.toast.warning).toHaveBeenCalledWith({
      title: 'El código escaneado no es válido. Vuelva a escanearlo.',
    });
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(setCartItems).not.toHaveBeenCalled();
  });

  it('keeps the not-found message for a valid code no product carries', async () => {
    mocks.fetch.mockResolvedValue(null);
    renderScanner();

    await act(async () => {
      await mocks.onScan!('7790000000003');
    });

    expect(mocks.toast.warning).toHaveBeenCalledWith({
      title: 'No encontré el producto con ese código',
    });
    // The site's own stock rides on the lookup, so the cart line matches checkout.
    expect(mocks.fetch).toHaveBeenCalledWith(
      { barcode: '7790000000003', siteId: 'site-1' },
      { retry: false }
    );
  });

  it('sells the command-bar quantity on the next scan', async () => {
    mocks.fetch.mockResolvedValue(lookup());
    const { setCartItems, takePendingQuantity } = renderScanner(3);

    await act(async () => {
      await mocks.onScan!('7702001000011');
    });

    expect(cartAfterScan(setCartItems)).toEqual([expect.objectContaining({ quantity: 3 })]);
    expect(takePendingQuantity).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Arroz Diana 500g' })
    );
  });

  it('lets a weight label win and keeps the typed quantity for the next read', async () => {
    mocks.fetch.mockResolvedValue(lookup({ suggestedQuantity: 0.485, sellByFraction: true }));
    const { setCartItems, takePendingQuantity } = renderScanner(3);

    await act(async () => {
      await mocks.onScan!('2900001004851');
    });

    expect(cartAfterScan(setCartItems)).toEqual([expect.objectContaining({ quantity: 0.485 })]);
    expect(takePendingQuantity).not.toHaveBeenCalled();
  });

  it('adds nothing when the typed quantity does not fit the product', async () => {
    mocks.fetch.mockResolvedValue(lookup());
    const { setCartItems } = renderScanner('rejected');

    await act(async () => {
      await mocks.onScan!('7702001000011');
    });

    expect(setCartItems).not.toHaveBeenCalled();
  });

  it('looks up the code without a quantity prefix caught in the same burst', async () => {
    mocks.fetch.mockResolvedValue(lookup());
    renderScanner(3);

    await act(async () => {
      await mocks.onScan!('3*7702001000011');
    });

    expect(mocks.fetch).toHaveBeenCalledWith(
      { barcode: '7702001000011', siteId: 'site-1' },
      { retry: false }
    );
  });

  it('adds a hand-typed presentation code in that presentation', async () => {
    mocks.fetch.mockResolvedValue(lookup({ resolvedUnitId: 'unit-pack' }));
    const { setCartItems, hook } = renderScanner();

    let added: boolean | undefined;
    await act(async () => {
      added = await hook.current.handleTypedCode(' 7702001000028 ');
    });

    expect(added).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledWith(
      { barcode: '7702001000028', siteId: 'site-1' },
      { retry: false }
    );
    expect(cartAfterScan(setCartItems)).toEqual([
      expect.objectContaining({ unitId: 'unit-pack', quantity: 1 }),
    ]);
  });

  it('leaves typed text that is not a known code to the product search', async () => {
    mocks.fetch.mockResolvedValue(null);
    const { setCartItems, hook } = renderScanner();

    await act(async () => {
      expect(await hook.current.handleTypedCode('arroz')).toBe(false);
      expect(await hook.current.handleTypedCode('ABR0001')).toBe(false);
    });

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.toast.warning).not.toHaveBeenCalled();
    expect(setCartItems).not.toHaveBeenCalled();
  });
});
