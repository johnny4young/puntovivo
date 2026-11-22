/**
 * useSalesKeyboardShortcuts tests.
 *
 * Focused on the Ctrl/Cmd additions introduced by the multi-cart
 * workspace (Ctrl+P suspend, Ctrl+R toggle panel, Ctrl+Shift+P
 * reprint). The existing Alt+X / F5 / F1 / Delete branches are
 * exercised indirectly by the SalesPage integration smoke + E2E.
 */

import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRODUCT_SEARCH_UNIT_SELECT_ID } from '@/components/dialogs/productSearchSelection';
import { useSalesKeyboardShortcuts } from './useSalesKeyboardShortcuts';

function fireKey(key: string, options: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  document.dispatchEvent(event);
  return event;
}

describe('useSalesKeyboardShortcuts — Ctrl/Cmd guard lift', () => {
  afterEach(() => {
    // Clean leftover elements between cases without touching innerHTML
    // keeps the security-reminder hook silent and is slightly faster.
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
    // Regression: the  refactor must not break existing
    // Alt-based shortcuts that cashiers already depend on.
    renderHook(() => useSalesKeyboardShortcuts(defaultOptions));
    fireKey('p', { altKey: true });
    expect(defaultOptions.focusProductInput).toHaveBeenCalledOnce();
  });

  it('does not claim product-search shortcuts when product search is unavailable', () => {
    const onOpenSearch = vi.fn();
    const focusProductInput = vi.fn();
    renderHook(() =>
      useSalesKeyboardShortcuts({
        ...defaultOptions,
        canOpenSearch: false,
        onOpenSearch,
        focusProductInput,
      })
    );

    const f5Event = fireKey('F5');
    const altPEvent = fireKey('p', { altKey: true, code: 'KeyP' });
    expect(onOpenSearch).not.toHaveBeenCalled();
    expect(focusProductInput).not.toHaveBeenCalled();
    expect(f5Event.defaultPrevented).toBe(false);
    expect(altPEvent.defaultPrevented).toBe(false);
  });

  it('claims Alt+U in product search only while the unit picker is shown', () => {
    renderHook(() => useSalesKeyboardShortcuts({ ...defaultOptions, isProductSearchOpen: true }));
    expect(fireKey('u', { altKey: true, code: 'KeyU' }).defaultPrevented).toBe(false);

    const select = document.createElement('select');
    select.id = PRODUCT_SEARCH_UNIT_SELECT_ID;
    document.body.append(select);
    expect(fireKey('u', { altKey: true, code: 'KeyU' }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(select);
    select.remove();
  });

  // Mod+Z undo binding.
  describe('Mod+Z undo', () => {
    it('fires onUndo on Ctrl+Z and prevents the browser default', () => {
      const onUndo = vi.fn();
      renderHook(() => useSalesKeyboardShortcuts({ ...defaultOptions, onUndo }));
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
      renderHook(() => useSalesKeyboardShortcuts({ ...defaultOptions, onUndo }));

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

  it('leaves the cart alone while a sheet over the register owns the keyboard', () => {
    const onOpenPayment = vi.fn();
    const onRemoveSelectedItem = vi.fn();
    const onOpenSearch = vi.fn();
    const onFastCash = vi.fn();
    const onSuspend = vi.fn();
    const onUndo = vi.fn();
    renderHook(() =>
      useSalesKeyboardShortcuts({
        ...defaultOptions,
        selectedItemKey: 'line-1',
        canOpenSearch: true,
        canSuspend: true,
        onOpenPayment,
        onRemoveSelectedItem,
        onOpenSearch,
        onFastCash,
        onSuspend,
        onUndo,
      })
    );
    const sheet = document.createElement('div');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    document.body.append(sheet);

    for (const key of ['F1', 'F2', 'F5', 'Delete']) fireKey(key);
    fireKey('p', { ctrlKey: true });
    fireKey('z', { ctrlKey: true });

    expect(onOpenPayment).not.toHaveBeenCalled();
    expect(onFastCash).not.toHaveBeenCalled();
    expect(onOpenSearch).not.toHaveBeenCalled();
    expect(onRemoveSelectedItem).not.toHaveBeenCalled();
    expect(onSuspend).not.toHaveBeenCalled();
    expect(onUndo).not.toHaveBeenCalled();

    sheet.remove();
    fireKey('Delete');
    expect(onRemoveSelectedItem).toHaveBeenCalledWith('line-1');
  });

  describe('F9 incident sheet', () => {
    it('opens the sheet from the scan field and prevents the browser default', () => {
      const onOpenIncident = vi.fn();
      renderHook(() => useSalesKeyboardShortcuts({ ...defaultOptions, onOpenIncident }));
      const input = document.createElement('input');
      input.id = 'sales-product-search-input';
      document.body.appendChild(input);
      input.focus();
      const event = new KeyboardEvent('keydown', { key: 'F9', bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      expect(onOpenIncident).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    });

    it('does not reopen the sheet when the sheet already took the F9 to close', () => {
      const onOpenIncident = vi.fn();
      renderHook(() => useSalesKeyboardShortcuts({ ...defaultOptions, onOpenIncident }));
      const closeSheet = (event: KeyboardEvent) => event.preventDefault();
      window.addEventListener('keydown', closeSheet, { capture: true });
      fireKey('F9');
      window.removeEventListener('keydown', closeSheet, { capture: true });
      expect(onOpenIncident).not.toHaveBeenCalled();
    });

    it('stays inert while payment, product search or another dialog is open', () => {
      const onOpenIncident = vi.fn();
      const { rerender } = renderHook(
        (props: { isPaymentModalOpen: boolean; isProductSearchOpen: boolean }) =>
          useSalesKeyboardShortcuts({ ...defaultOptions, ...props, onOpenIncident }),
        { initialProps: { isPaymentModalOpen: true, isProductSearchOpen: false } }
      );
      fireKey('F9');
      rerender({ isPaymentModalOpen: false, isProductSearchOpen: true });
      fireKey('F9');
      rerender({ isPaymentModalOpen: false, isProductSearchOpen: false });
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      document.body.appendChild(dialog);
      expect(fireKey('F9').defaultPrevented).toBe(false);
      expect(onOpenIncident).not.toHaveBeenCalled();
    });
  });

  // F2 rapid-cash binding.
  describe('F2 fast-cash', () => {
    it('fires onFastCash on F2 and prevents the browser default outside the modal', () => {
      const onFastCash = vi.fn();
      renderHook(() => useSalesKeyboardShortcuts({ ...defaultOptions, onFastCash }));
      const event = fireKey('F2');
      expect(onFastCash).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    });

    it('still fires onFastCash while the payment modal is already open', () => {
      // F2 doubles as a "re-apply exact cash" trigger inside the
      // modal — unlike Mod-based shortcuts that suspend when the
      // modal owns focus.
      const onFastCash = vi.fn();
      renderHook(() =>
        useSalesKeyboardShortcuts({
          ...defaultOptions,
          isPaymentModalOpen: true,
          onFastCash,
        })
      );
      const event = fireKey('F2');
      expect(onFastCash).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    });

    it('does nothing on F2 when onFastCash is not wired (no preventDefault)', () => {
      renderHook(() => useSalesKeyboardShortcuts({ ...defaultOptions }));
      const event = fireKey('F2');
      // Without a handler, the hook must NOT steal the browser
      // default — preventDefault stays false.
      expect(event.defaultPrevented).toBe(false);
    });

    it('ignores F2 inside an editable input outside the payment modal', () => {
      const onFastCash = vi.fn();
      renderHook(() => useSalesKeyboardShortcuts({ ...defaultOptions, onFastCash }));

      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      const event = new KeyboardEvent('keydown', {
        key: 'F2',
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, 'target', { value: input });
      document.dispatchEvent(event);

      expect(onFastCash).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });

    it('fires F2 from an editable input while the payment modal is open', () => {
      const onFastCash = vi.fn();
      renderHook(() =>
        useSalesKeyboardShortcuts({
          ...defaultOptions,
          isPaymentModalOpen: true,
          onFastCash,
        })
      );

      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      const event = new KeyboardEvent('keydown', {
        key: 'F2',
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, 'target', { value: input });
      document.dispatchEvent(event);

      expect(onFastCash).toHaveBeenCalledOnce();
      expect(event.defaultPrevented).toBe(true);
    });

    it('does not fire onFastCash while the product search dialog is open', () => {
      const onFastCash = vi.fn();
      renderHook(() =>
        useSalesKeyboardShortcuts({
          ...defaultOptions,
          isProductSearchOpen: true,
          onFastCash,
        })
      );
      const event = fireKey('F2');
      expect(onFastCash).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });
  });
});

describe('useSalesKeyboardShortcuts — register lifecycle (atajos reales)', () => {
  afterEach(() => {
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

  it('Alt+N starts a new sale', () => {
    const onNewSale = vi.fn();
    renderHook(() => useSalesKeyboardShortcuts({ ...defaultOptions, onNewSale }));

    const event = fireKey('n', { altKey: true, code: 'KeyN' });
    expect(onNewSale).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('Alt+A opens the cash session modal only when provided', () => {
    const onOpenCashSession = vi.fn();
    renderHook(() => useSalesKeyboardShortcuts({ ...defaultOptions, onOpenCashSession }));
    fireKey('a', { altKey: true, code: 'KeyA' });
    expect(onOpenCashSession).toHaveBeenCalledOnce();
  });

  it('Alt+A stays inert when the handler is undefined', () => {
    renderHook(() => useSalesKeyboardShortcuts({ ...defaultOptions }));
    const event = fireKey('a', { altKey: true, code: 'KeyA' });
    expect(event.defaultPrevented).toBe(false);
  });

  it('Alt+M records a cash movement', () => {
    const onOpenCashMovement = vi.fn();
    renderHook(() => useSalesKeyboardShortcuts({ ...defaultOptions, onOpenCashMovement }));
    fireKey('m', { altKey: true, code: 'KeyM' });
    expect(onOpenCashMovement).toHaveBeenCalledOnce();
  });

  it('Alt+Shift+C opens the blind close and never the quantity focus', () => {
    const onOpenCashClose = vi.fn();
    const focusQuantityInput = vi.fn();
    renderHook(() =>
      useSalesKeyboardShortcuts({
        ...defaultOptions,
        selectedItemKey: 'p1:u1',
        focusQuantityInput,
        onOpenCashClose,
      })
    );

    fireKey('C', { altKey: true, shiftKey: true, code: 'KeyC' });
    expect(onOpenCashClose).toHaveBeenCalledOnce();
    expect(focusQuantityInput).not.toHaveBeenCalled();

    // Plain Alt+C still focuses the quantity of the selected row.
    fireKey('c', { altKey: true, code: 'KeyC' });
    expect(focusQuantityInput).toHaveBeenCalledWith('p1:u1');
  });

  it('matches by physical key when macOS composes an alternate character', () => {
    const focusProductInput = vi.fn();
    renderHook(() => useSalesKeyboardShortcuts({ ...defaultOptions, focusProductInput }));

    // Alt+P on macOS reports key 'π'; the code still says KeyP.
    fireKey('π', { altKey: true, code: 'KeyP' });
    expect(focusProductInput).toHaveBeenCalledOnce();
  });
});

describe('useSalesKeyboardShortcuts — guard contracts (review fixes)', () => {
  afterEach(() => {
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

  it('state-mutating combos never fire from an editable target (mac dead keys)', () => {
    const onNewSale = vi.fn();
    renderHook(() => useSalesKeyboardShortcuts({ ...defaultOptions, onNewSale }));

    const input = document.createElement('input');
    document.body.appendChild(input);
    // Typing eñe on a mac US layout is Option+N (dead tilde).
    const event = new KeyboardEvent('keydown', {
      key: 'Dead',
      code: 'KeyN',
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);
    expect(onNewSale).not.toHaveBeenCalled();
  });

  it('state-mutating combos never act through an open dialog', () => {
    const onOpenCashSession = vi.fn();
    renderHook(() => useSalesKeyboardShortcuts({ ...defaultOptions, onOpenCashSession }));

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);

    fireKey('a', { altKey: true, code: 'KeyA' });
    expect(onOpenCashSession).not.toHaveBeenCalled();
  });

  it('Alt+Shift+P still reaches the product-focus alias', () => {
    const focusProductInput = vi.fn();
    renderHook(() => useSalesKeyboardShortcuts({ ...defaultOptions, focusProductInput }));

    fireKey('P', { altKey: true, shiftKey: true, code: 'KeyP' });
    expect(focusProductInput).toHaveBeenCalledOnce();
  });

  it('printable keys keep label semantics under Alt (AZERTY safety)', () => {
    const onOpenCashSession = vi.fn();
    renderHook(() => useSalesKeyboardShortcuts({ ...defaultOptions, onOpenCashSession }));

    // AZERTY labeled Alt+A: key is the printable a, physical code KeyQ.
    fireKey('a', { altKey: true, code: 'KeyQ' });
    expect(onOpenCashSession).toHaveBeenCalledOnce();
  });
});
