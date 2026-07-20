/**
 * Unit tests for `useScannerFocusRestoration`.
 *
 * Mounts the hook with a synthetic input ref so we can spy on
 * `focus()` + `select()` calls. `requestAnimationFrame` is stubbed
 * to a synchronous callback so each assertion runs in the same tick
 * as the rerender.
 */

import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { useScannerFocusRestoration } from './useScannerFocusRestoration';

interface HookProps {
  isProductSearchOpen: boolean;
  isPaymentModalOpen: boolean;
  isQuickCreateProductMounted: boolean;
  isQuickCreateCustomerMounted: boolean;
}

const closedAll: HookProps = {
  isProductSearchOpen: false,
  isPaymentModalOpen: false,
  isQuickCreateProductMounted: false,
  isQuickCreateCustomerMounted: false,
};

describe('useScannerFocusRestoration', () => {
  let focusSpy: ReturnType<typeof vi.fn>;
  let selectSpy: ReturnType<typeof vi.fn>;
  let productInputRef: { current: HTMLInputElement | null };
  let rafSpy: MockInstance<typeof requestAnimationFrame>;

  beforeEach(() => {
    focusSpy = vi.fn();
    selectSpy = vi.fn();
    productInputRef = {
      current: {
        focus: focusSpy,
        select: selectSpy,
      } as unknown as HTMLInputElement,
    };
    // Force RAF synchronous so the spies fire inside the same
    // microtask as the rerender — no waitFor needed.
    rafSpy = vi
      .spyOn(globalThis, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
  });

  afterEach(() => {
    rafSpy.mockRestore();
  });

  function render(initialProps: HookProps) {
    return renderHook(
      (props: HookProps) =>
        useScannerFocusRestoration({
          productInputRef,
          ...props,
        }),
      { initialProps }
    );
  }

  it('focuses the search input on mount', () => {
    render(closedAll);
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(selectSpy).toHaveBeenCalledTimes(1);
  });

  it('does not refocus when a modal transitions from closed to open', () => {
    const { rerender } = render(closedAll);
    expect(focusSpy).toHaveBeenCalledTimes(1);

    // Open ProductSearchDialog; nothing else changes.
    rerender({ ...closedAll, isProductSearchOpen: true });
    expect(focusSpy).toHaveBeenCalledTimes(1);

    // Re-render with the same state: still no focus.
    rerender({ ...closedAll, isProductSearchOpen: true });
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  it('focuses after ProductSearchDialog closes', () => {
    const { rerender } = render(closedAll);
    expect(focusSpy).toHaveBeenCalledTimes(1);

    rerender({ ...closedAll, isProductSearchOpen: true });
    expect(focusSpy).toHaveBeenCalledTimes(1);

    rerender({ ...closedAll, isProductSearchOpen: false });
    expect(focusSpy).toHaveBeenCalledTimes(2);
  });

  it('focuses after SalePaymentModal closes', () => {
    const { rerender } = render(closedAll);
    rerender({ ...closedAll, isPaymentModalOpen: true });
    rerender({ ...closedAll, isPaymentModalOpen: false });

    // 1 mount + 1 on close.
    expect(focusSpy).toHaveBeenCalledTimes(2);
  });

  it('focuses after QuickCreateProductGate unmounts', () => {
    const { rerender } = render(closedAll);
    rerender({ ...closedAll, isQuickCreateProductMounted: true });
    rerender({ ...closedAll, isQuickCreateProductMounted: false });

    expect(focusSpy).toHaveBeenCalledTimes(2);
  });

  it('focuses after QuickCreateCustomerGate unmounts', () => {
    const { rerender } = render(closedAll);
    rerender({ ...closedAll, isQuickCreateCustomerMounted: true });
    rerender({ ...closedAll, isQuickCreateCustomerMounted: false });

    expect(focusSpy).toHaveBeenCalledTimes(2);
  });

  it('focuses once per close transition even when multiple modals close in the same render', () => {
    const { rerender } = render(closedAll);
    // Open two modals.
    rerender({
      ...closedAll,
      isProductSearchOpen: true,
      isPaymentModalOpen: true,
    });
    expect(focusSpy).toHaveBeenCalledTimes(1);

    // Close both in a single render.
    rerender(closedAll);
    expect(focusSpy).toHaveBeenCalledTimes(2);
  });

  it('does not throw when the input ref is null at restoration time', () => {
    const { rerender } = render(closedAll);
    expect(focusSpy).toHaveBeenCalledTimes(1);

    productInputRef.current = null;
    rerender({ ...closedAll, isPaymentModalOpen: true });
    rerender({ ...closedAll, isPaymentModalOpen: false });

    // No additional focus call — ref was null.
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });
});
