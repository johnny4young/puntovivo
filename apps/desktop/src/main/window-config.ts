import type { Session, WebPreferences } from 'electron';

/**
 * Shape of the security-critical subset of the main window's webPreferences.
 *
 * Only the three fields that dictate the renderer's privilege level live
 * here so they can be pinned by a Node-side regression test
 * (`__tests__/window-config.test.ts`) without booting Electron. The
 * `preload` path stays at the call site in `main/index.ts` because it
 * depends on `__dirname` of the compiled bundle.
 */
export type MainWindowWebPreferences = Pick<
  WebPreferences,
  'sandbox' | 'contextIsolation' | 'nodeIntegration'
>;

export type MainWindowResolvedWebPreferences = Pick<
  WebPreferences,
  'preload' | 'sandbox' | 'contextIsolation' | 'nodeIntegration' | 'spellcheck'
>;

/**
 * Electron's builtin spellchecker stays off in every Puntovivo window.
 *
 * On Windows and Linux it downloads Hunspell dictionaries from the Chromium
 * CDN by default, a runtime network dependency an offline-first register must
 * not have (the same reason fonts ship inside the app). It cannot detect the
 * language being typed, the app offers no spelling suggestions, and most
 * register fields hold codes, SKUs and names, so its only visible effect was
 * underlining correct input. On macOS it also sends typed text to the system
 * spell server. The web app keeps each browser's own behavior.
 */
const RENDERER_SPELLCHECK = false;

/**
 * the main BrowserWindow renderer runs under the Chromium
 * sandbox. Every Node-level capability must go through the preload's
 * contextBridge APIs, which in turn dispatch to `ipcMain.handle`
 * channels defined in `main/index.ts`. Direct Node access from the
 * renderer or the preload is disallowed and will break under sandbox.
 *
 * This constant is the single source of truth for the invariant.
 * Changing any field here is a security-relevant edit and must be
 * accompanied by a documented rationale — see .
 */
export const MAIN_WINDOW_WEB_PREFERENCES: MainWindowWebPreferences = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
};

/**
 * Build the exact webPreferences object consumed by BrowserWindow.
 *
 * Keeping this composition next to the invariant closes the gap between
 * "the constant is secure" and "the actual BrowserWindow options stayed
 * secure". The node-side regression test imports this helper directly,
 * so weakening the runtime shape in `main/index.ts` requires editing this
 * module and trips CI.
 */
export function buildMainWindowWebPreferences(preload: string): MainWindowResolvedWebPreferences {
  return {
    preload,
    ...MAIN_WINDOW_WEB_PREFERENCES,
    spellcheck: RENDERER_SPELLCHECK,
  };
}

/**
 * Build the Customer Display preferences with the same Chromium isolation but
 * a dedicated least-privilege preload. Keeping the builder separate makes an
 * accidental return to the main renderer's broad desktop bridge reviewable
 * and testable.
 */
export function buildCustomerDisplayWindowWebPreferences(
  preload: string
): MainWindowResolvedWebPreferences {
  return {
    preload,
    ...MAIN_WINDOW_WEB_PREFERENCES,
    spellcheck: RENDERER_SPELLCHECK,
  };
}

/**
 * Turn the builtin spellchecker off for a whole session, so windows without
 * these preferences, such as the hidden receipt print window, and the session's
 * dictionary downloader stay off too. Call it before any window is created.
 */
export function disableBuiltinSpellchecker(session: Pick<Session, 'setSpellCheckerEnabled'>): void {
  session.setSpellCheckerEnabled(RENDERER_SPELLCHECK);
}
