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
  renderHook(() =>
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
  return { setCartItems, takePendingQuantity };
}

function lookup(overrides: { suggestedQuantity?: number | null; sellByFraction?: boolean } = {}) {
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
      ],
    },
    resolvedUnitId: null,
    suggestedPrice: null,
    suggestedQuantity: overrides.suggestedQuantity ?? null,
  };
}

/** Applies the cart updater the hook queued to an empty cart. */
function cartAfterScan(setCartItems: ReturnType<typeof vi.fn>) {
  const updater = setCartItems.mock.calls.at(-1)?.[0] as (items: unknown[]) => Array<{
    quantity: number;
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
});
