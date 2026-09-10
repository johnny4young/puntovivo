import { ipcMain } from 'electron';
import { isCustomerDisplayAccessId } from '../renderer-protocol.js';
import * as desktopSession from '../session/desktopSession.js';
import { createWindowHandlers } from './window-handlers.js';
import { captureDesktopIpcSessionResult } from './session-authorization.js';

/** Register the bounded auxiliary-window capabilities exposed to the renderer. */
export function registerWindowIpc(deps: {
  openCustomerDisplay: (accessId: string) => Promise<void>;
}): void {
  const handlers = createWindowHandlers({
    session: desktopSession,
    isCustomerDisplayAccessId,
    openCustomerDisplay: deps.openCustomerDisplay,
  });

  ipcMain.handle('window:open-customer-display', async (_event, accessId: unknown) => {
    return captureDesktopIpcSessionResult(() => handlers.openCustomerDisplay(accessId));
  });
}
