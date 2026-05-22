/**
 * ENG-018b — useSalesKeyboardShortcuts tests.
 *
 * Focused on the Ctrl/Cmd additions introduced by the multi-cart
 * workspace (Ctrl+P suspend, Ctrl+R toggle panel, Ctrl+Shift+P
 * reprint). The existing Alt+X / F5 / F1 / Delete branches are
 * exercised indirectly by the SalesPage integration smoke + E2E.
 */

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSalesKeyboardShortcuts } from './useSalesKeyboardShortcuts';

function fireKey(
  key: string,
  options: Partial<KeyboardEventInit> = {}
): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  document.dispatchEvent(event);
  return event;
}

describe('useSalesKeyboardShortcuts — Ctrl/Cmd guard lift (ENG-018b)', () => {
  afterEach(() => {
    // Clean leftover elements between cases without touching innerHTML
    // — keeps the security-reminder hook silent and is slightly faster.
    document.body.replaceChildren();
  });

  const defaultOptions = {
    selectedItemKey: null,
    canCharge: true,
    isProductSearchOpen: false,
    isPaymentModalOpen: false,
    onOpenSearch: vi.fn(),
    onOpenPayment: vi.fn(),
    onRemoveSelectedItem: vi.fn(),
    focusProductInput: vi.fn(),
    focusQuantityInput: vi.fn(),
    focusDiscountInput: vi.fn(),
  };

  it('calls onSuspend when Ctrl+P fires and canSuspend is true', () => {
    const onSuspend = vi.fn();
    renderHook(() =>
      useSalesKeyboardShortcuts({
        ...defaultOptions,
        canSuspend: true,
        onSuspend,
      })
    );

    const event = fireKey('p', { ctrlKey: true });
    expect(onSuspend).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('does nothing when Ctrl+P fires but canSuspend is false', () => {
    const onSuspend = vi.fn();
    renderHook(() =>
      useSalesKeyboardShortcuts({
        ...defaultOptions,
        canSuspend: false,
        onSuspend,
      })
    );

    const event = fireKey('p', { ctrlKey: true });
    expect(onSuspend).not.toHaveBeenCalled();
    // preventDefault should NOT fire — we want the browser print
    // dialog to open when Suspend is unavailable.
    expect(event.defaultPrevented).toBe(false);
  });

  it('fires onToggleSuspendedPanel on Ctrl+R when canToggleSuspendedPanel is true', () => {
    const onToggleSuspendedPanel = vi.fn();
    renderHook(() =>
      useSalesKeyboardShortcuts({
        ...defaultOptions,
        onToggleSuspendedPanel,
        canToggleSuspendedPanel: true,
      })
    );

    const event = fireKey('r', { ctrlKey: true });
    expect(onToggleSuspendedPanel).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('does not hijack browser reload when canToggleSuspendedPanel is false', () => {
    // Regression: with no drafts in flight and the panel closed, Ctrl+R
    // should keep its browser-default "reload" behaviour so the cashier
    // can refresh the page reflexively.
    const onToggleSuspendedPanel = vi.fn();
    renderHook(() =>
      useSalesKeyboardShortcuts({
        ...defaultOptions,
        onToggleSuspendedPanel,
        canToggleSuspendedPanel: false,
      })
    );

    const event = fireKey('r', { ctrlKey: true });
    expect(onToggleSuspendedPanel).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('fires onReprintSelectedHistoryRow on Ctrl+Shift+P', () => {
    const onReprintSelectedHistoryRow = vi.fn();
    renderHook(() =>
      useSalesKeyboardShortcuts({
        ...defaultOptions,
        onReprintSelectedHistoryRow,
      })
    );

    const event = fireKey('P', { ctrlKey: true, shiftKey: true });
    expect(onReprintSelectedHistoryRow).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores Ctrl+P when focus is inside an editable input', () => {
    const onSuspend = vi.fn();
    renderHook(() =>
      useSalesKeyboardShortcuts({
        ...defaultOptions,
        canSuspend: true,
        onSuspend,
      })
    );

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'p',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'target', { value: input });
    document.dispatchEvent(event);

    expect(onSuspend).not.toHaveBeenCalled();
  });

  it('suppresses Ctrl shortcuts when the payment modal is open', () => {
    const onSuspend = vi.fn();
    const onToggleSuspendedPanel = vi.fn();
    renderHook(() =>
      useSalesKeyboardShortcuts({
        ...defaultOptions,
        isPaymentModalOpen: true,
        canSuspend: true,
        onSuspend,
        onToggleSuspendedPanel,
        canToggleSuspendedPanel: true,
      })
    );

    fireKey('p', { ctrlKey: true });
    fireKey('r', { ctrlKey: true });
    expect(onSuspend).not.toHaveBeenCalled();
    expect(onToggleSuspendedPanel).not.toHaveBeenCalled();
  });

  it('still fires Alt+P (focus product input) after the Ctrl guard was lifted', () => {
    // Regression: the ENG-018b refactor must not break existing
    // Alt-based shortcuts that cashiers already depend on.
    renderHook(() => useSalesKeyboardShortcuts(defaultOptions));
    fireKey('p', { altKey: true });
    expect(defaultOptions.focusProductInput).toHaveBeenCalledOnce();
  });

  // ENG-105d — Mod+Z undo binding.
  describe('Mod+Z undo (ENG-105d)', () => {
    it('fires onUndo on Ctrl+Z and prevents the browser default', () => {
      const onUndo = vi.fn();
      renderHook(() =>
        useSalesKeyboardShortcuts({ ...defaultOptions, onUndo })
      );
      const event = fireKey('z', { ctrlKey: true });
      expect(onUndo).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    });

    it('does nothing when onUndo is omitted (no preventDefault)', () => {
      renderHook(() => useSalesKeyboardShortcuts({ ...defaultOptions }));
      const event = fireKey('z', { ctrlKey: true });
      // Without a handler the hook must not steal the browser default
      // (text undo elsewhere, etc.). preventDefault stays false.
      expect(event.defaultPrevented).toBe(false);
    });

    it('does not fire onUndo while the payment modal is open', () => {
      const onUndo = vi.fn();
      renderHook(() =>
        useSalesKeyboardShortcuts({
          ...defaultOptions,
          isPaymentModalOpen: true,
          onUndo,
        })
      );
      fireKey('z', { ctrlKey: true });
      expect(onUndo).not.toHaveBeenCalled();
    });

    it('ignores Mod+Z when the focus is inside an editable input', () => {
      // Browser-native text undo must keep working inside form fields
      // (customer-picker, discount input, etc.). The hook returns
      // early when `isEditableShortcutTarget(event.target)` matches.
      const onUndo = vi.fn();
      renderHook(() =>
        useSalesKeyboardShortcuts({ ...defaultOptions, onUndo })
      );

      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      const event = new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, 'target', { value: input });
      document.dispatchEvent(event);

      expect(onUndo).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });
  });
});
