// ENG-074b — Hub-client local hardware bridge fork (ENG-178 slice 29).
//
// In `device_local` / `site_hub` modes the dispatch is server-side
// (`peripherals.printReceipt` mutation) — the byte builder, the
// `resolveTransport` call, and the actual write all happen inside
// the Authority Node process. In `hub_client` mode the renderer is
// the Authority Node ONLY for hardware: the hub returns the bytes
// via `peripherals.buildReceiptBytes` and this terminal pipes them
// through `window.electron.peripherals.dispatchLocalEscpos` to its
// locally-attached printer. Both helpers below collapse that
// decision into a single `() => Promise<EscPosDispatchOutcome>` so
// the call sites stay simple.
//
// The bridge result maps to the same outcome union the existing
// `printSaleReceipt` consumer already handles:
//   - bridge success → `printed`
//   - hub returned no peripheral → `system-fallback`
//   - bridge missing OR hub fetch failed OR write failed
//     → `fallback` (caller's `onEscposFallback` toasts a translated
//     message; the legacy HTML path runs anyway).
//
// Per ADR-0008 rule 6, the helpers themselves NEVER write to any
// operational table. They are a pure routing decision plus an IPC
// call.

import { getRuntimeConfigSync } from '@/lib/runtimeConfigClient';
import type {
  CreateEscposReceiptDispatcherInput,
  DispatchDrawerKickInput,
  DrawerKickOutcome,
  EscPosDispatchOutcome,
  HubDrawerBytesPayload,
  HubReceiptBytesPayload,
} from './types';

/**
 * Build the receipt-print dispatcher consumed by `printSaleReceipt`.
 * Pure function: the runtime mode is read once per call so a stale
 * cache cannot pin the wrong branch.
 */
export function createEscposReceiptDispatcher({
  serverPrint,
  fetchHubReceiptBytes,
}: CreateEscposReceiptDispatcherInput): () => Promise<EscPosDispatchOutcome> {
  return async () => {
    const cfg = getRuntimeConfigSync();
    if (cfg.authorityMode !== 'hub_client') {
      return serverPrint();
    }
    const bridge = window.electron?.peripherals?.dispatchLocalEscpos;
    if (!bridge) {
      return { status: 'fallback', error: 'BRIDGE_UNAVAILABLE' };
    }
    let payload: HubReceiptBytesPayload;
    try {
      payload = await fetchHubReceiptBytes();
    } catch (err) {
      return {
        status: 'fallback',
        error: 'HUB_BYTES_FETCH_FAILED',
        errorMessage: err instanceof Error ? err.message : undefined,
      };
    }
    if (payload.status !== 'ready' || payload.bytes.length === 0 || !payload.transportHint) {
      return { status: 'system-fallback' };
    }
    const result = await bridge({
      bytes: payload.bytes,
      transport: payload.transportHint,
    });
    if (result.success) return { status: 'printed' };
    return {
      status: 'fallback',
      error: result.errorCode ?? 'BRIDGE_DISPATCH_FAILED',
      errorMessage: result.error,
    };
  };
}

/**
 * Dispatch a cash-drawer kick respecting the runtime authority mode.
 * Same routing decision as `createEscposReceiptDispatcher` but for
 * the role-aware, one-time-approved drawer-kick action.
 */
export async function dispatchDrawerKick({
  serverKick,
  fetchHubDrawerBytes,
}: DispatchDrawerKickInput): Promise<DrawerKickOutcome> {
  const cfg = getRuntimeConfigSync();
  if (cfg.authorityMode !== 'hub_client') {
    return serverKick();
  }
  const bridge = window.electron?.peripherals?.dispatchLocalEscpos;
  if (!bridge) {
    return { status: 'failed', error: 'BRIDGE_UNAVAILABLE' };
  }
  let payload: HubDrawerBytesPayload;
  try {
    payload = await fetchHubDrawerBytes();
  } catch (err) {
    return {
      status: 'failed',
      error: 'HUB_BYTES_FETCH_FAILED',
      errorMessage: err instanceof Error ? err.message : undefined,
    };
  }
  if (payload.status === 'no-drawer-registered') {
    return { status: 'no-drawer-registered' };
  }
  if (payload.bytes.length === 0 || !payload.transportHint) {
    return { status: 'failed', error: 'EMPTY_PAYLOAD' };
  }
  const result = await bridge({
    bytes: payload.bytes,
    transport: payload.transportHint,
  });
  if (result.success) return { status: 'ok' };
  return {
    status: 'failed',
    error: result.errorCode ?? 'BRIDGE_DISPATCH_FAILED',
    errorMessage: result.error,
  };
}
