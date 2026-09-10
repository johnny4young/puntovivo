import { randomBytes } from 'node:crypto';
import type { PuntovivoServer } from '@puntovivo/server';

/** Structural Electron-free identity guard: object equality is intentional, not renderer IDs. */
interface SetupSender {
  isDestroyed: () => boolean;
  mainFrame: { url: string };
}
/** Minimal main-window handle; native object identity binds the setup capability. */
interface SetupWindow {
  isDestroyed: () => boolean;
  webContents: SetupSender;
}
/** Invoking frame and sender identities supplied by Electron, never by renderer input. */
interface SetupEvent {
  sender: SetupSender;
  senderFrame: { url: string } | null;
}
/** Runtime-owned handles and trust configuration for the fixed first-use command. */
interface SetupClaimDependencies {
  getMainWindow: () => SetupWindow | null;
  getServer: () => Pick<PuntovivoServer, 'getSetupToken' | 'app'> | null;
  isHubClient: boolean;
  isDev: boolean;
  webDevServerUrl: string;
}

/** Safe renderer result: no capability, transport detail, or credential crosses this boundary. */
export type InstallationClaimResult = { ok: true } | { ok: false; errorCode: string };

function trustedOrigin(url: string, options: SetupClaimDependencies): boolean {
  try {
    const target = new URL(url);
    if (!options.isDev) {
      return (
        target.protocol === 'puntovivo-app:' &&
        target.hostname === 'app' &&
        target.port === '' &&
        target.username === '' &&
        target.password === '' &&
        target.pathname === '/index.html'
      );
    }
    const expected = new URL(options.webDevServerUrl);
    return (
      ['http:', 'https:'].includes(expected.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(expected.hostname) &&
      target.origin === expected.origin &&
      target.username === '' &&
      target.password === ''
    );
  } catch {
    return false;
  }
}

/**
 * The packaged renderer cannot read a localhost CSRF cookie. Keep both the
 * one-use proof and cookie in main, and dispatch the fixed tRPC mutation via
 * Fastify's in-process transport. No general-purpose request proxy is exposed.
 */
export function createInstallationClaimHandler(options: SetupClaimDependencies) {
  return async (event: SetupEvent, input: unknown): Promise<InstallationClaimResult> => {
    const window = options.getMainWindow();
    if (
      options.isHubClient ||
      !window ||
      window.isDestroyed() ||
      event.sender.isDestroyed() ||
      event.sender !== window.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      !trustedOrigin(event.sender.mainFrame.url, options)
    ) {
      return { ok: false, errorCode: 'SETUP_LOCAL_ACCESS_REQUIRED' };
    }
    try {
      const server = options.getServer();
      const token = server?.getSetupToken();
      if (!server || !token) return { ok: false, errorCode: 'SETUP_ALREADY_COMPLETED' };
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { ok: false, errorCode: 'VALIDATION_ERROR' };
      }
      const csrf = randomBytes(32).toString('base64url');
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/trpc/auth.completeSetup?batch=1',
        remoteAddress: '127.0.0.1',
        headers: {
          origin: 'puntovivo-app://app',
          'content-type': 'application/json',
          'x-csrf-token': csrf,
        },
        cookies: { puntovivo_csrf: csrf },
        payload: { '0': { ...input, token } },
      });
      const data = response.json()[0];
      if (response.statusCode === 200 && data?.result?.data?.created === true) return { ok: true };
      // Never forward SQL messages, paths, stack traces, secrets or invoke errors.
      const code: unknown = data?.error?.data?.errorCode;
      return {
        ok: false,
        errorCode:
          typeof code === 'string' && /^SETUP_[A-Z_]+$/.test(code)
            ? code
            : response.statusCode === 400
              ? 'VALIDATION_ERROR'
              : 'INTERNAL_SERVER_ERROR',
      };
    } catch {
      return { ok: false, errorCode: 'INTERNAL_SERVER_ERROR' };
    }
  };
}
