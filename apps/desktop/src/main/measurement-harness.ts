/** Shared by the memory and main-thread measurement modes. */

import { app, type WebContents } from 'electron';
import { setTimeout as delay } from 'node:timers/promises';
import type { PuntovivoLogger } from '@puntovivo/server';
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

export function exitAfterMeasurement(deps: {
  stopEmbeddedServer: () => Promise<void>;
  log: PuntovivoLogger;
  label: string;
}): void {
  void deps
    .stopEmbeddedServer()
    .catch(err => {
      deps.log.warn({ err }, `failed to stop embedded server after ${deps.label}`);
    })
    .finally(() => app.exit(0));
}
