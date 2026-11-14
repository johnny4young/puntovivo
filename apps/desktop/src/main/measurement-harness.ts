/** Renderer readiness for the soak mode. */

import type { WebContents } from 'electron';
import { setTimeout as delay } from 'node:timers/promises';
import { whenServerReady } from './runtime.js';

const ROOT_MOUNTED_SCRIPT =
  'Boolean(document.getElementById("root") && document.getElementById("root").childElementCount > 0)';

/**
 * Resolves whether React mounted once the page loaded and the server is ready,
 * so a Chromium error page never measures as the app. Install before the
 * renderer URL loads.
 */
export function whenAppMounted(webContents: WebContents, settleMs = 0): Promise<boolean> {
  const loaded = new Promise<void>(resolve => {
    webContents.once('did-finish-load', () => resolve());
  });
  return Promise.all([loaded, whenServerReady()])
    .then(() => delay(settleMs))
    .then(() => webContents.executeJavaScript(ROOT_MOUNTED_SCRIPT))
    .then(Boolean, () => false);
}
