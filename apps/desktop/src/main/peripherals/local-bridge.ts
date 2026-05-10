/**
 * ENG-074b — Hub-client local hardware bridge.
 *
 * When the renderer runs in `authorityMode === 'hub_client'` and
 * needs to print a receipt or kick the cash drawer, the hub returns
 * the ESC/POS bytes (via `peripherals.buildReceiptBytes` /
 * `buildDrawerKickBytes`) and the renderer pipes them through this
 * Electron-main dispatcher. The dispatcher writes the bytes to the
 * locally-attached printer or drawer using the existing
 * `resolveTransport` helper from `@puntovivo/server`.
 *
 * **ADR-0008 rule 6 invariant**: this module NEVER opens a database
 * connection, NEVER writes to `sales`, `cash`, `inventory`,
 * `fiscal`, `journal`, or any side-effect queue table. The hub remains the
 * Authority Node for the operation; the bridge is a side-effect
 * actuator that turns bytes into hardware pulses. The architectural
 * lint test in `local-bridge.test.ts` pins this by import inspection.
 *
 * @module main/peripherals/local-bridge
 */

import {
  EscPosTransportError,
  resolveTransport,
  type EscPosTransportConfig,
} from '@puntovivo/server';

export interface LocalEscPosDispatchInput {
  /**
   * Bytes returned by the hub's `buildReceiptBytes` /
   * `buildDrawerKickBytes` query. Travels over IPC as `number[]`
   * (structured-clone safe); the bridge reconstitutes a
   * `Uint8Array` before handing to the transport.
   */
  bytes: number[] | Uint8Array;
  /**
   * Transport hint mirrored from the hub-side `site_peripherals.config`
   * row. The bridge passes it through to `resolveTransport` without
   * translation — same shape on both sides per ENG-074b.
   */
  transport: EscPosTransportConfig;
}

export interface LocalEscPosDispatchResult {
  success: boolean;
  /** Operator-readable failure detail when `success === false`. */
  error?: string;
  /** Discriminator from `EscPosTransportError.normalized.kind` when available. */
  errorCode?: string;
}

/**
 * Dispatch ESC/POS bytes through the local printer / drawer. Returns
 * `{ success: false, error }` instead of throwing so the IPC
 * boundary stays simple — the renderer surfaces the error via the
 * existing `onEscposFallback` toast. The transport is ALWAYS closed
 * after the write attempt, even on failure, to release native
 * handles (TCP socket / future USB endpoint).
 */
export async function dispatchLocalEscpos(
  input: LocalEscPosDispatchInput
): Promise<LocalEscPosDispatchResult> {
  const buffer = input.bytes instanceof Uint8Array
    ? input.bytes
    : Uint8Array.from(input.bytes);

  if (buffer.length === 0) {
    return { success: false, error: 'No bytes supplied to local bridge', errorCode: 'EMPTY_PAYLOAD' };
  }

  let transport;
  try {
    transport = resolveTransport(input.transport);
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to resolve transport',
      errorCode: err instanceof EscPosTransportError ? err.normalized.kind : 'TRANSPORT_RESOLVE_FAILED',
    };
  }

  try {
    await transport.write(buffer);
    return { success: true };
  } catch (err) {
    if (err instanceof EscPosTransportError) {
      return {
        success: false,
        error: err.normalized.message ?? err.message,
        errorCode: err.normalized.kind,
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Local bridge dispatch failed',
      errorCode: 'UNKNOWN',
    };
  } finally {
    try {
      await transport.close();
    } catch {
      // Closing failures are not user-visible — the write outcome is
      // the operator-facing signal.
    }
  }
}
