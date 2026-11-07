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

function renderScanner() {
  const setCartItems = vi.fn();
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
    })
  );
  return { setCartItems };
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
      title: 'El código escaneado no es válido. Vuelve a escanearlo.',
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
  });
});
