import { ipcRenderer } from 'electron';

import type {
  HubAccessGrant,
  HubApiRequest,
  HubApiResponse,
  HubAuthIpcResult,
  HubLoginInput,
  HubRealtimeInput,
  HubRealtimeMessage,
  HubSwitchStaffInput,
} from '../main/session/hub-auth-session.js';

/**
 * Authentication and fixed-destination Hub transport for the main POS
 * renderer. Keeping this cohesive avoids duplicating listener lifecycle logic
 * inside the broader desktop bridge; public auxiliary windows must never
 * import or expose it.
 */
export interface SessionAPI {
  register: (accessToken: string) => Promise<{ ok: true }>;
  resume: () => Promise<{ token: string | null }>;
  clear: () => Promise<{ ok: true }>;
  loginHub: (input: HubLoginInput) => Promise<HubAuthIpcResult<HubAccessGrant>>;
  refreshHub: () => Promise<HubAuthIpcResult<HubAccessGrant>>;
  switchStaffHub: (input: HubSwitchStaffInput) => Promise<HubAuthIpcResult<HubAccessGrant>>;
  logoutHub: () => Promise<HubAuthIpcResult<{ ok: true }>>;
  requestHub: (input: HubApiRequest) => Promise<HubApiResponse>;
  openHubRealtime: (
    input: HubRealtimeInput,
    listener: (message: HubRealtimeMessage) => void
  ) => string;
  closeHubRealtime: (subscriptionId: string) => Promise<{ ok: boolean }>;
  clearHub: () => Promise<{ ok: true }>;
}

export function createSessionApi(): SessionAPI {
  const hubRealtimeListeners = new Map<
    string,
    (
      event: Electron.IpcRendererEvent,
      payload: { subscriptionId: string; message: HubRealtimeMessage }
    ) => void
  >();

  const removeHubRealtimeListener = (subscriptionId: string): void => {
    const listener = hubRealtimeListeners.get(subscriptionId);
    if (!listener) return;
    ipcRenderer.removeListener('session:hub-realtime-event', listener);
    hubRealtimeListeners.delete(subscriptionId);
  };

  const removeAllHubRealtimeListeners = (): void => {
    for (const subscriptionId of [...hubRealtimeListeners.keys()]) {
      removeHubRealtimeListener(subscriptionId);
    }
  };

  return {
    register: (accessToken: string) => ipcRenderer.invoke('session:register', accessToken),
    resume: () => ipcRenderer.invoke('session:resume'),
    clear: () => ipcRenderer.invoke('session:clear'),
    loginHub: input => ipcRenderer.invoke('session:hub-login', input),
    refreshHub: () => ipcRenderer.invoke('session:hub-refresh'),
    switchStaffHub: input => ipcRenderer.invoke('session:hub-switch-staff', input),
    logoutHub: () => {
      removeAllHubRealtimeListeners();
      return ipcRenderer.invoke('session:hub-logout');
    },
    requestHub: input => ipcRenderer.invoke('session:hub-request', input),
    openHubRealtime: (input, onMessage) => {
      const subscriptionId = crypto.randomUUID();
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { subscriptionId: string; message: HubRealtimeMessage }
      ) => {
        if (payload.subscriptionId !== subscriptionId) return;
        onMessage(payload.message);
        if (payload.message.kind === 'closed' || payload.message.kind === 'error') {
          removeHubRealtimeListener(subscriptionId);
        }
      };
      hubRealtimeListeners.set(subscriptionId, listener);
      ipcRenderer.on('session:hub-realtime-event', listener);
      void ipcRenderer
        .invoke('session:hub-realtime-open', { ...input, subscriptionId })
        .then((result: HubAuthIpcResult<{ ok: true }>) => {
          if (result.ok) return;
          onMessage({
            kind: 'error',
            message: result.error.message,
            ...(result.error.status ? { status: result.error.status } : {}),
          });
          removeHubRealtimeListener(subscriptionId);
        })
        .catch((error: unknown) => {
          onMessage({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
          removeHubRealtimeListener(subscriptionId);
        });
      return subscriptionId;
    },
    closeHubRealtime: subscriptionId => {
      removeHubRealtimeListener(subscriptionId);
      return ipcRenderer.invoke('session:hub-realtime-close', subscriptionId);
    },
    clearHub: () => {
      removeAllHubRealtimeListeners();
      return ipcRenderer.invoke('session:hub-clear');
    },
  };
}
