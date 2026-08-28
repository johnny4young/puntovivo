/**
 * Electron-free authorization boundary shared by IPC handler cores.
 *
 * The renderer never supplies identity. Authenticated handlers obtain the
 * active tenant from the verified main-process session before any injected
 * operation runs. Pre-login exceptions stay separate and therefore cannot
 * accidentally inherit an authenticated handler signature.
 *
 * @module main/ipc/session-authorization
 */

export interface DesktopSessionAuthorizer {
  /** Throws SESSION_NOT_REGISTERED when no verified session is active. */
  requireTenantId: () => string;
}

export interface AuthenticatedIpcContext {
  tenantId: string;
}

export type DesktopIpcSessionErrorCode = 'SESSION_NOT_REGISTERED';

/**
 * Error envelope used only on the main/preload wire. Electron logs every
 * rejected ipcMain.handle invocation, including expected stale-session
 * rejections. Returning this bounded envelope keeps the main process clean;
 * preload unwraps it back into a normal rejected Promise for renderer callers.
 */
export type DesktopIpcSessionResult<T> =
  { ok: true; value: T } | { ok: false; errorCode: DesktopIpcSessionErrorCode };

function getDesktopIpcSessionErrorCode(error: unknown): DesktopIpcSessionErrorCode | null {
  return error instanceof Error && error.message === 'SESSION_NOT_REGISTERED'
    ? 'SESSION_NOT_REGISTERED'
    : null;
}

export async function captureDesktopIpcSessionResult<T>(
  operation: () => T | Promise<T>
): Promise<DesktopIpcSessionResult<Awaited<T>>> {
  try {
    return { ok: true, value: await operation() };
  } catch (error) {
    const errorCode = getDesktopIpcSessionErrorCode(error);
    if (errorCode) {
      return { ok: false, errorCode };
    }
    throw error;
  }
}

export function unwrapDesktopIpcSessionResult<T>(result: DesktopIpcSessionResult<T>): T {
  if (!result.ok) {
    throw new Error(result.errorCode);
  }
  return result.value;
}

/**
 * Wrap an Electron-free handler so session authorization always runs first.
 *
 * Keeping this wrapper independent of ipcMain lets Node tests prove that a
 * missing session cannot reach persistence, validation, or renderer-provided
 * tenant hints. The returned tenant comes only from the main-process session.
 */
export function withAuthenticatedDesktopSession<Args extends unknown[], Result>(
  session: DesktopSessionAuthorizer,
  handler: (context: AuthenticatedIpcContext, ...args: Args) => Result
): (...args: Args) => Result {
  return (...args: Args): Result => {
    const tenantId = session.requireTenantId();
    return handler({ tenantId }, ...args);
  };
}
