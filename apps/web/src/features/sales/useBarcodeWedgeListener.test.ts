import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  DEFAULT_WEDGE_CONFIG,
  useBarcodeWedgeListener,
  type UseBarcodeWedgeListenerOptions,
  type WedgeConfig,
} from './useBarcodeWedgeListener';

/**
 * ENG-061 — useBarcodeWedgeListener tests.
 *
 * Drives the document-level keydown listener through a controllable
 * clock and asserts that fast bursts emit `onScan` while manual
 * typing (gap > interCharGapMs) is suppressed. ProductSearchDialog /
 * PaymentModal flags are exercised explicitly so SalesPage's modal
 * cross-talk never lands a scan.
 */

let mockTime = 1_000;
function advance(ms: number) {
  mockTime += ms;
}
const now = () => mockTime;

function fireKey(key: string) {
  document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

function buildOptions(overrides?: Partial<UseBarcodeWedgeListenerOptions>): UseBarcodeWedgeListenerOptions {
  return {
    config: { ...DEFAULT_WEDGE_CONFIG },
    onScan: vi.fn(),
    isProductSearchOpen: false,
    isPaymentModalOpen: false,
    now,
    ...overrides,
  };
}

describe('useBarcodeWedgeListener', () => {
  beforeEach(() => {
    mockTime = 1_000;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('emits onScan when a 13-char burst arrives within gap and ends with Enter', () => {
    const onScan = vi.fn();
    renderHook(() => useBarcodeWedgeListener(buildOptions({ onScan })));

    const code = '7702049000031';
    for (const char of code) {
      advance(5);
      fireKey(char);
    }
    advance(5);
    fireKey('Enter');

    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('7702049000031');
  });

  it('rejects manual typing when every inter-key gap exceeds interCharGapMs', () => {
    const onScan = vi.fn();
    renderHook(() => useBarcodeWedgeListener(buildOptions({ onScan })));

    // Manual typist: 200ms between every keystroke. Each new
    // keystroke's gap > 30ms threshold so the buffer resets every
    // time, never accumulating beyond a single character.
    for (const char of '7702049000031') {
      advance(200);
      fireKey(char);
    }
    fireKey('Enter');

    expect(onScan).not.toHaveBeenCalled();
  });

  it('drops a buffer shorter than config.minLength on Enter', () => {
    const onScan = vi.fn();
    const config: WedgeConfig = { ...DEFAULT_WEDGE_CONFIG, minLength: 10 };
    renderHook(() => useBarcodeWedgeListener(buildOptions({ onScan, config })));

    for (const char of '12345') {
      advance(5);
      fireKey(char);
    }
    fireKey('Enter');

    expect(onScan).not.toHaveBeenCalled();
  });

  it('suppresses every emission while ProductSearchDialog is open', () => {
    const onScan = vi.fn();
    renderHook(() =>
      useBarcodeWedgeListener(buildOptions({ onScan, isProductSearchOpen: true }))
    );

    for (const char of '7702049000031') {
      advance(5);
      fireKey(char);
    }
    fireKey('Enter');

    expect(onScan).not.toHaveBeenCalled();
  });

  it('honors the tab end-of-scan mode', () => {
    const onScan = vi.fn();
    const config: WedgeConfig = { ...DEFAULT_WEDGE_CONFIG, endOfScan: 'tab' };
    renderHook(() => useBarcodeWedgeListener(buildOptions({ onScan, config })));

    for (const char of '7702049000031') {
      advance(5);
      fireKey(char);
    }
    fireKey('Tab');

    expect(onScan).toHaveBeenCalledWith('7702049000031');
  });

  it('strips a configured prefix and suffix before emitting', () => {
    const onScan = vi.fn();
    const config: WedgeConfig = {
      ...DEFAULT_WEDGE_CONFIG,
      prefix: '*',
      suffix: '#',
    };
    renderHook(() => useBarcodeWedgeListener(buildOptions({ onScan, config })));

    // Suffix '#' triggers an early flush, no Enter needed.
    for (const char of '*7702049000031#') {
      advance(5);
      fireKey(char);
    }

    expect(onScan).toHaveBeenCalledWith('7702049000031');
  });

  it('emits nothing when an editable element is the keydown target', () => {
    const onScan = vi.fn();
    renderHook(() => useBarcodeWedgeListener(buildOptions({ onScan })));

    // Dispatch a keydown whose target is a real <input>; the hook
    // bails because isEditableShortcutTarget returns true.
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: '7', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(onScan).not.toHaveBeenCalled();
    document.body.removeChild(input);
  });
});
