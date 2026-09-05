/** Electron-free authorization core for auxiliary-window IPC. */

import {
  withAuthenticatedDesktopSession,
  type DesktopSessionAuthorizer,
} from './session-authorization.ts';

export interface WindowHandlerDeps {
  session: DesktopSessionAuthorizer;
  isCustomerDisplayAccessId: (value: unknown) => value is string;
  openCustomerDisplay: (accessId: string) => Promise<void>;
}

export function createWindowHandlers(deps: WindowHandlerDeps) {
  return {
    openCustomerDisplay: withAuthenticatedDesktopSession(
      deps.session,
      async (_context, accessId: unknown): Promise<{ ok: true }> => {
        if (!deps.isCustomerDisplayAccessId(accessId)) {
          throw new Error('Customer Display pairing is invalid');
        }
        await deps.openCustomerDisplay(accessId);
        return { ok: true };
      }
    ),
  };
}
