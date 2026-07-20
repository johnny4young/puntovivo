/**
 * hub-client local hardware bridge IPC, extracted verbatim
 * from the former monolithic `main/index.ts`.
 *
 * the renderer in hub_client mode fetches ESC/POS bytes from
 * the hub via `peripherals.buildReceiptBytes` / `buildDrawerKickBytes`
 * and pipes them through this handler. The dispatcher reuses the
 * server's `resolveTransport` helper but never opens a DB connection —
 * see ../peripherals/local-bridge.ts for the ADR-0008 rule 6 invariant.
 *
 * @module main/ipc/peripherals
 */

import { ipcMain } from 'electron';
import * as desktopSession from '../session/desktopSession.js';

export function registerPeripheralsIpc(): void {
  ipcMain.handle('peripherals:dispatch-local-escpos', async (_event, payload) => {
    // Same renderer-as-attacker posture as the db:*/sync:* handlers: the
    // bridge is a hardware actuator, so it must not be reachable before a
    // verified login registers a session ( vector 1). The bridge
    // contract is "never throw across IPC", so the rejection is returned
    // as a failure result the existing onEscposFallback toast can surface.
    try {
      desktopSession.requireTenantId();
    } catch {
      return {
        success: false,
        error: 'No registered desktop session',
        errorCode: 'SESSION_NOT_REGISTERED',
      };
    }
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('bytes' in payload) ||
      !('transport' in payload)
    ) {
      return {
        success: false,
        error: 'Malformed local ESC/POS dispatch payload',
        errorCode: 'INVALID_PAYLOAD',
      };
    }
    const { dispatchLocalEscpos } = await import('../peripherals/local-bridge.js');
    return dispatchLocalEscpos(
      payload as import('../peripherals/local-bridge.js').LocalEscPosDispatchInput
    );
  });
}
