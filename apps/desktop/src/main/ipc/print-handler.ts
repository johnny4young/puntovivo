/**
 * electron-free print-receipt request handler so the session
 * gate, sanitisation order, and result mapping stay pinned by node tests.
 * The BrowserWindow print pipeline and the i18n lookup are injected by
 * `./print.ts`.
 *
 * @module main/ipc/print-handler
 */

import { sanitisePrintHtml } from '../print-html-sanitizer.ts';
import { sessionGateFailure } from './session-gate.ts';
import type { ReceiptPrintSettings } from './settings.ts';

export type PrintErrorTranslationKey = 'print.sessionRequired' | 'print.documentRequired';

export interface PrintReceiptResult {
  success: boolean;
  error?: string;
  errorCode?: string;
}

export interface PrintReceiptHandlerDeps {
  loadSettings: () => Promise<ReceiptPrintSettings>;
  printReceipt: (html: string, settings: ReceiptPrintSettings) => Promise<void>;
  logError: (error: unknown) => void;
  /** Main-process i18n lookup — the strings cross to renderer toasts. */
  t: (key: PrintErrorTranslationKey) => string;
}

export async function handlePrintReceiptRequest(
  receiptHtml: unknown,
  deps: PrintReceiptHandlerDeps
): Promise<PrintReceiptResult> {
  // Same renderer-as-attacker posture as the peripherals bridge: the
  // printer is a hardware actuator, so it must not be reachable before a
  // verified login registers a session. The channel contract is "never
  // throw across IPC", so the rejection is returned as a failure result.
  const gate = sessionGateFailure(deps.t('print.sessionRequired'));
  if (gate) {
    return gate;
  }

  if (typeof receiptHtml !== 'string' || receiptHtml.trim().length === 0) {
    return {
      success: false,
      error: deps.t('print.documentRequired'),
    };
  }

  // strip every active HTML construct (scripts, iframes,
  // event-handler attributes, non-data: image srcs) at the IPC trust
  // boundary BEFORE the HTML is loaded into the ephemeral print window.
  // The print window already runs sandbox: true, but defense-in-depth
  // makes a corrupted template harmless even if it slipped past the
  // renderer. (No post-sanitize emptiness re-check: the sanitizer always
  // wraps non-empty input in an html scaffold, so it cannot return an
  // empty string here.)
  const sanitisedHtml = sanitisePrintHtml(receiptHtml);

  try {
    const settings = await deps.loadSettings();
    await deps.printReceipt(sanitisedHtml, settings);
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Receipt printing failed';
    deps.logError(error);
    return {
      success: false,
      error: message,
    };
  }
}
