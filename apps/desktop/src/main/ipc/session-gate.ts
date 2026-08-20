/**
 * shared pre-auth gate for result-shaped IPC channels whose
 * contract is "never throw across IPC" (hardware actuators). Channels
 * that may throw (db:*, settings update-*) call
 * `desktopSession.requireTenantId()` directly instead.
 *
 * @module main/ipc/session-gate
 */

// read authenticated identity from the main-process singleton,
// never from renderer-supplied arguments.
import * as desktopSession from '../session/desktopSession.ts';

export interface SessionGateFailure {
  success: false;
  error: string;
  errorCode: typeof desktopSession.SESSION_NOT_REGISTERED;
}

/**
 * Returns `null` when a verified session is registered, otherwise the
 * failure result the channel should return as-is. `message` is the
 * renderer-visible copy (localize it at the call site when the channel
 * has main-process i18n available).
 */
export function sessionGateFailure(
  message = 'No registered desktop session'
): SessionGateFailure | null {
  try {
    desktopSession.requireTenantId();
    return null;
  } catch {
    return {
      success: false,
      error: message,
      errorCode: desktopSession.SESSION_NOT_REGISTERED,
    };
  }
}
