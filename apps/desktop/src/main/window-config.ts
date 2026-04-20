import type { WebPreferences } from 'electron';

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
  'preload' | 'sandbox' | 'contextIsolation' | 'nodeIntegration'
>;

/**
 * ENG-004 — the main BrowserWindow renderer runs under the Chromium
 * sandbox. Every Node-level capability must go through the preload's
 * contextBridge APIs, which in turn dispatch to `ipcMain.handle`
 * channels defined in `main/index.ts`. Direct Node access from the
 * renderer or the preload is disallowed and will break under sandbox.
 *
 * This constant is the single source of truth for the invariant.
 * Changing any field here is a security-relevant edit and must be
 * accompanied by a ROADMAP note — see ENG-004.
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
export function buildMainWindowWebPreferences(
  preload: string
): MainWindowResolvedWebPreferences {
  return {
    preload,
    ...MAIN_WINDOW_WEB_PREFERENCES,
  };
}
