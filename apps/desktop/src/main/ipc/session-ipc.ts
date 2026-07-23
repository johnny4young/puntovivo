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
  type HubRealtimeHandle,
  type HubRealtimeInput,
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
  const realtimeHandles = new Map<
    string,
    { handle: HubRealtimeHandle; removeDestroyedListener: () => void }
  >();

  function realtimeKey(senderId: number, subscriptionId: string): string {
    return `${senderId}:${subscriptionId}`;
  }

  function closeRealtimeHandles(): void {
    for (const registration of realtimeHandles.values()) {
      registration.removeDestroyedListener();
      registration.handle.close();
    }
    realtimeHandles.clear();
  }

  function closeRealtimeHandle(key: string): void {
    const registration = realtimeHandles.get(key);
    if (!registration) return;
    registration.removeDestroyedListener();
    registration.handle.close();
    realtimeHandles.delete(key);
  }

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
    closeRealtimeHandles();
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
      closeRealtimeHandles();
      if (options.hubAuthSession) await options.hubAuthSession.logout();
      desktopSession.clear();
      return { ok: true as const };
    })
  );
  ipcMain.handle('session:hub-request', (_event, input: HubApiRequest) => {
    if (!options.hubAuthSession) throw new Error('Store Hub transport is unavailable');
    return options.hubAuthSession.request(input);
  });
  ipcMain.handle(
    'session:hub-realtime-open',
    (event, input: HubRealtimeInput & { subscriptionId: string }) =>
      captureHubAuthIpc(async () => {
        if (!options.hubAuthSession) throw new Error('Store Hub realtime is unavailable');
        if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.subscriptionId)) {
          throw new Error('Store Hub realtime subscription id is invalid');
        }
        const key = realtimeKey(event.sender.id, input.subscriptionId);
        closeRealtimeHandle(key);
        const handleDestroyed = () => closeRealtimeHandle(key);
        const handle = options.hubAuthSession.openRealtime(input, message => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('session:hub-realtime-event', {
              subscriptionId: input.subscriptionId,
              message,
            });
          }
          if (message.kind === 'closed' || message.kind === 'error') {
            realtimeHandles.get(key)?.removeDestroyedListener();
            realtimeHandles.delete(key);
          }
        });
        realtimeHandles.set(key, {
          handle,
          removeDestroyedListener: () => event.sender.removeListener('destroyed', handleDestroyed),
        });
        event.sender.once('destroyed', handleDestroyed);
        try {
          await handle.opened;
          return { ok: true as const };
        } catch (error) {
          closeRealtimeHandle(key);
          throw error;
        }
      })
  );
  ipcMain.handle('session:hub-realtime-close', (event, subscriptionId: string) => {
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(subscriptionId)) return { ok: false as const };
    const key = realtimeKey(event.sender.id, subscriptionId);
    closeRealtimeHandle(key);
    return { ok: true as const };
  });
  ipcMain.handle('session:hub-clear', () => {
    closeRealtimeHandles();
    options.hubAuthSession?.clear();
    desktopSession.clear();
    return { ok: true as const };
  });
}
