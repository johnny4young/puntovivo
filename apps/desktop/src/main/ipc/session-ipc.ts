/**
 * desktop session lifecycle IPC handlers, extracted verbatim
 * from the former monolithic `main/index.ts`.
 *
 * `../session/desktopSession.ts` is the single source of truth
 * for the authenticated identity at the IPC boundary. Every db:* / sync:*
 * handler reads tenantId from there instead of trusting the
 * renderer-supplied argument. The `SESSION_NOT_REGISTERED` and
 * `SESSION_REGISTER_REJECTED` error strings are the stable contract the
 * renderer matches against to decide whether to redirect to the login
 * screen.
 *
 * @module main/ipc/session-ipc
 */

import { ipcMain } from 'electron';
import { verifyTokenWithServer } from '@puntovivo/server';
import { getServer } from '../runtime.js';
import * as desktopSession from '../session/desktopSession.js';
import {
  captureHubAuthIpc,
  type HubApiRequest,
  type HubAuthSession,
  type HubLoginInput,
  type HubSwitchStaffInput,
} from '../session/hub-auth-session.js';

// vector 1 — session lifecycle. `session:register` is called
// by the renderer's AuthProvider after a successful login (or after a
// successful refresh that rotated the access token); `session:clear`
// is called on logout. Until a session is registered, every db:* and
// sync:* handler (see ./register.ts) throws SESSION_NOT_REGISTERED so
// the renderer can never reach the SQLite store with a tenantId of its
// choosing.
export function registerSessionIpc(options: { hubAuthSession?: HubAuthSession } = {}): void {
  ipcMain.handle('session:register', async (_event, accessToken: unknown) => {
    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new Error('SESSION_REGISTER_REJECTED');
    }
    if (options.hubAuthSession) {
      await desktopSession.register(accessToken, options.hubAuthSession.verifyAccessToken);
    } else {
      const activeServer = getServer();
      if (!activeServer) {
        throw new Error('Embedded server is not started yet');
      }
      const fastifyApp = activeServer.app;
      await desktopSession.register(accessToken, token =>
        verifyTokenWithServer(fastifyApp, token, 'access')
      );
    }
    return { ok: true };
  });
  ipcMain.handle('session:clear', async () => {
    desktopSession.clear();
    return { ok: true };
  });
  ipcMain.handle('session:hub-login', (_event, input: HubLoginInput) =>
    captureHubAuthIpc(async () => {
      if (!options.hubAuthSession) throw new Error('Store Hub authentication is unavailable');
      return options.hubAuthSession.login(input);
    })
  );
  ipcMain.handle('session:hub-refresh', () =>
    captureHubAuthIpc(async () => {
      if (!options.hubAuthSession) throw new Error('Store Hub authentication is unavailable');
      return options.hubAuthSession.refresh();
    })
  );
  ipcMain.handle('session:hub-switch-staff', (_event, input: HubSwitchStaffInput) =>
    captureHubAuthIpc(async () => {
      if (!options.hubAuthSession) throw new Error('Store Hub authentication is unavailable');
      return options.hubAuthSession.switchStaff(input);
    })
  );
  ipcMain.handle('session:hub-logout', () =>
    captureHubAuthIpc(async () => {
      if (options.hubAuthSession) await options.hubAuthSession.logout();
      desktopSession.clear();
      return { ok: true as const };
    })
  );
  ipcMain.handle('session:hub-request', (_event, input: HubApiRequest) => {
    if (!options.hubAuthSession) throw new Error('Store Hub transport is unavailable');
    return options.hubAuthSession.request(input);
  });
  ipcMain.handle('session:hub-clear', () => {
    options.hubAuthSession?.clear();
    desktopSession.clear();
    return { ok: true as const };
  });
}
