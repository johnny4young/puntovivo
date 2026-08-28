/** Electron-free persistent-device-id handler core. */

import {
  withAuthenticatedDesktopSession,
  type DesktopSessionAuthorizer,
} from './session-authorization.ts';

interface DeviceHandlerLogger {
  warn: (bindings: Record<string, unknown>, message: string) => void;
}

export interface DeviceHandlerDeps {
  session: DesktopSessionAuthorizer;
  getUserDataPath: () => string;
  readDeviceId: (directory: string) => Promise<string | null>;
  writeDeviceId: (directory: string, deviceId: string) => Promise<void>;
  log: DeviceHandlerLogger;
}

export function createDeviceHandlers(deps: DeviceHandlerDeps) {
  return {
    // Login needs the persisted server-issued id before a desktop session can
    // exist. This read-only pre-login exception is intentionally separate from
    // the authenticated setter below.
    getId: async (): Promise<string | null> => {
      const directory = deps.getUserDataPath();
      try {
        return await deps.readDeviceId(directory);
      } catch (error) {
        deps.log.warn(
          { err: error, dir: directory },
          'device:get-id failed reading persisted device id'
        );
        return null;
      }
    },
    setId: withAuthenticatedDesktopSession(
      deps.session,
      async (_context, deviceId: unknown): Promise<void> => {
        if (typeof deviceId !== 'string' || deviceId.length === 0 || deviceId.length > 256) {
          throw new Error('DEVICE_SET_ID_REJECTED');
        }
        await deps.writeDeviceId(deps.getUserDataPath(), deviceId);
      }
    ),
  };
}
