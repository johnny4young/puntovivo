import { useEffect, useRef } from 'react';
import { isEditableShortcutTarget } from '@/features/sales/salesKeyboard';

/**
 * ENG-061 — USB HID keyboard-wedge barcode listener.
 *
 * USB HID barcode scanners pretend to be USB keyboards: when the
 * cashier scans a code, the scanner emits the decoded characters
 * as fast keydown events into whatever has focus. This hook
 * intercepts those bursts at the document level, distinguishes
 * scanner cadence from manual typing via `interCharGapMs`, and
 * fires `onScan(code)` once a complete code is captured.
 *
 * Detection rules:
 *
 *   - keydown events with single-character `key` accumulate into a
 *     buffer
 *   - if the gap between two consecutive keystrokes exceeds
 *     `interCharGapMs`, the buffer resets (manual typists never
 *     sustain <30 ms gaps)
 *   - end-of-scan signal flushes the buffer:
 *       'enter'    — Enter pressed flushes; Enter is also swallowed
 *                    when the buffer was a complete scan so the
 *                    document does not see it
 *       'tab'      — Tab pressed flushes (and is swallowed)
 *       'gap-only' — a `interCharGapMs * 4` timer flushes, no key
 *                    needed (some scanners do not emit Enter/Tab)
 *
 * Guards:
 *
 *   - bail out when any modal flag is true (caller passes
 *     `isProductSearchOpen`, `isPaymentModalOpen`, etc.); the
 *     scanner burst does not capture text inside a dialog
 *   - bail out when `isEditableShortcutTarget(event.target)` is
 *     true — the cashier is typing in an input/textarea, manual
 *     entry must not be misclassified as a scan
 *   - `enabled === false` short-circuits the entire listener
 *
 * The hook is NOT a singleton — multiple instances on the same
 * page would both emit. SalesPage is the only mount point in
 * ENG-061. Inventory / returns adoption is a follow-up.
 *
 * Paste handling: deliberately NOT supported. Pasting via Ctrl+V
 * fires a single `paste` event (not a series of `keydown`s) and
 * carries different security implications. ProductSearchDialog
 * still accepts pasted barcodes via its existing search field.
 */

export interface WedgeConfig {
  minLength: number;
  maxLength: number;
  interCharGapMs: number;
  endOfScan: 'enter' | 'tab' | 'gap-only';
  prefix?: string;
  suffix?: string;
  gs1Scheme?: 'none' | 'generic' | 'co' | 'mx' | 'cl';
}

export interface UseBarcodeWedgeListenerOptions {
  config: WedgeConfig;
  onScan: (code: string) => void;
  isProductSearchOpen: boolean;
  isPaymentModalOpen: boolean;
  isCashSessionModalOpen?: boolean;
  /** When false, the hook installs no listener. */
  enabled?: boolean;
  /**
   * Hook-private clock; tests inject `() => mockNow` to bypass
   * `performance.now()`. Defaults to `performance.now`.
   */
  now?: () => number;
}

export const DEFAULT_WEDGE_CONFIG: WedgeConfig = {
  minLength: 6,
  maxLength: 32,
  interCharGapMs: 30,
  endOfScan: 'enter',
  gs1Scheme: 'generic',
};

interface BufferState {
  chars: string[];
  lastKeyAt: number;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

function createEmptyBuffer(): BufferState {
  return { chars: [], lastKeyAt: 0, flushTimer: null };
}

function clearFlushTimer(buffer: BufferState) {
  if (buffer.flushTimer !== null) {
    clearTimeout(buffer.flushTimer);
    buffer.flushTimer = null;
  }
}

function resetBuffer(buffer: BufferState) {
  clearFlushTimer(buffer);
  buffer.chars = [];
  buffer.lastKeyAt = 0;
}

function stripPrefixSuffix(code: string, prefix?: string, suffix?: string): string {
  let result = code;
  if (prefix && result.startsWith(prefix)) {
    result = result.slice(prefix.length);
  }
  if (suffix && result.endsWith(suffix)) {
    result = result.slice(0, -suffix.length);
  }
  return result;
}

export function useBarcodeWedgeListener(options: UseBarcodeWedgeListenerOptions): void {
  // Mirror the latest options into a ref so the listener
  // installation effect stays stable (we only attach once); the
  // listener reads the current options on every keystroke. We sync
  // the ref inside an effect (not during render) to satisfy the
  // `react-hooks/refs` lint while keeping the listener stable.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    const buffer = createEmptyBuffer();
    const clock = () => (optionsRef.current.now ?? performance.now.bind(performance))();

    function flushBuffer() {
      const current = optionsRef.current;
      const { config, onScan } = current;
      const raw = buffer.chars.join('');
      resetBuffer(buffer);
      if (raw.length < config.minLength || raw.length > config.maxLength) {
        return;
      }
      const code = stripPrefixSuffix(raw, config.prefix, config.suffix);
      if (code.length === 0) return;
      onScan(code);
    }

    function handleKeyDown(event: KeyboardEvent) {
      const current = optionsRef.current;
      if (current.enabled === false) return;
      if (
        current.isProductSearchOpen ||
        current.isPaymentModalOpen ||
        current.isCashSessionModalOpen
      ) {
        resetBuffer(buffer);
        return;
      }
      if (isEditableShortcutTarget(event.target)) {
        // Cashier is typing into a text field — the scanner emits
        // a real keystroke into that field. We must not also
        // accumulate; reset to be safe so the next true scanner
        // burst (with focus elsewhere) starts clean.
        resetBuffer(buffer);
        return;
      }

      const config = current.config;
      const now = clock();

      // End-of-scan signals
      if (event.key === 'Enter' && config.endOfScan === 'enter') {
        // Suffix end-of-scan (handled below) supersedes Enter.
        const ready = buffer.chars.length >= config.minLength;
        if (ready) {
          event.preventDefault();
        }
        flushBuffer();
        return;
      }
      if (event.key === 'Tab' && config.endOfScan === 'tab') {
        const ready = buffer.chars.length >= config.minLength;
        if (ready) {
          event.preventDefault();
        }
        flushBuffer();
        return;
      }

      // Single-character keys are the only ones a scanner emits.
      // Ignore modifiers / arrows / function keys outright.
      if (event.key.length !== 1) {
        return;
      }

      // Gap detection — manual typing resets the buffer.
      if (
        buffer.chars.length > 0 &&
        now - buffer.lastKeyAt > config.interCharGapMs
      ) {
        resetBuffer(buffer);
      }

      buffer.chars.push(event.key);
      buffer.lastKeyAt = now;

      // Suffix-driven end-of-scan: if the recent tail matches the
      // configured suffix, flush.
      if (config.suffix && config.suffix.length > 0) {
        const tail = buffer.chars.slice(-config.suffix.length).join('');
        if (tail === config.suffix) {
          flushBuffer();
          return;
        }
      }

      // Hard upper bound — defensive against runaway buffers.
      if (buffer.chars.length > config.maxLength) {
        resetBuffer(buffer);
        return;
      }

      // Schedule a gap-driven flush for the 'gap-only' mode. The
      // timer is reset on every keystroke; whenever the next
      // keystroke fails to arrive within `interCharGapMs * 4`, we
      // flush whatever we have. The 4× factor gives slow scanners
      // headroom while still firing within ~120 ms typically.
      if (config.endOfScan === 'gap-only') {
        clearFlushTimer(buffer);
        buffer.flushTimer = setTimeout(() => {
          flushBuffer();
        }, config.interCharGapMs * 4);
      }
    }

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      clearFlushTimer(buffer);
    };
    // We intentionally install the listener once and let the ref
    // carry the latest options. Listing the options would force a
    // re-attachment on every render, racing with mid-buffer state.
  }, []);
}
