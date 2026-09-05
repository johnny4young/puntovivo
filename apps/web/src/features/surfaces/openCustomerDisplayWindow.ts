import { isCustomerDisplayAccessId } from './customerDisplayStorage';

const CUSTOMER_DISPLAY_WINDOW_NAME = 'puntovivo-customer-display';
const CUSTOMER_DISPLAY_ROUTE = '/customer-display';

let customerDisplayWindow: Window | null = null;
let activeAccessId: string | null = null;

function isUsable(handle: Window): boolean {
  try {
    return !handle.closed;
  } catch {
    return false;
  }
}

/**
 * Open one reusable browser popup without the `noopener` named-target trap.
 *
 * Chromium returns `null` for a successful `window.open` with `noopener` and
 * treats every named open as a new browsing context. Instead, create an empty
 * same-origin document, sever its opener before application code loads, and
 * only then navigate to the authority-free display entry.
 */
export function openCustomerDisplayWindow(accessId: string): boolean {
  if (!isCustomerDisplayAccessId(accessId)) return false;
  if (customerDisplayWindow && isUsable(customerDisplayWindow)) {
    try {
      if (activeAccessId !== accessId) {
        customerDisplayWindow.opener = null;
        customerDisplayWindow.location.replace(
          `${CUSTOMER_DISPLAY_ROUTE}?access=${encodeURIComponent(accessId)}`
        );
        activeAccessId = accessId;
      }
    } catch {
      try {
        customerDisplayWindow.close();
      } catch {
        // Cleanup is best-effort after a browser policy failure.
      }
      customerDisplayWindow = null;
      activeAccessId = null;
      return false;
    }
    try {
      customerDisplayWindow.focus();
    } catch {
      // Focus is best-effort; the existing display remains the sole target.
    }
    return true;
  }
  customerDisplayWindow = null;
  activeAccessId = null;

  let opened: Window | null = null;
  try {
    opened = window.open('', CUSTOMER_DISPLAY_WINDOW_NAME, 'popup');
    if (!opened) return false;
    opened.opener = null;
    opened.location.replace(`${CUSTOMER_DISPLAY_ROUTE}?access=${encodeURIComponent(accessId)}`);
    customerDisplayWindow = opened;
    activeAccessId = accessId;
    try {
      opened.focus();
    } catch {
      // The browser may deny focus without invalidating the created window.
    }
    return true;
  } catch {
    try {
      opened?.close();
    } catch {
      // Cleanup is best-effort after a browser policy failure.
    }
    customerDisplayWindow = null;
    activeAccessId = null;
    return false;
  }
}

/** Test-only reset for the module-level named-window handle. */
export function __resetCustomerDisplayWindowForTests(): void {
  customerDisplayWindow = null;
  activeAccessId = null;
}
