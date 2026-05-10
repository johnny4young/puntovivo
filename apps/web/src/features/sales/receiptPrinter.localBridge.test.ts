import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  createEscposReceiptDispatcher,
  dispatchDrawerKick,
  type EscPosDispatchOutcome,
  type HubReceiptBytesPayload,
  type HubDrawerBytesPayload,
} from '@/features/sales/receiptPrinter';
import {
  __resetRuntimeConfigCacheForTests,
  type RendererRuntimeConfig,
} from '@/lib/runtimeConfigClient';

// ENG-074b — renderer fork pins for the local hardware bridge.
//
// The helpers under test route ESC/POS dispatch based on the
// authority mode reported by `getRuntimeConfigSync()`:
//   - device_local / site_hub → server-managed (existing path).
//   - hub_client + IPC bridge → fetch bytes from hub + pipe through
//     `window.electron.peripherals.dispatchLocalEscpos`.
//   - hub_client + IPC missing → graceful fallback so the legacy
//     HTML print path still runs.

type BridgeIpcFn = (payload: {
  bytes: number[];
  transport: unknown;
}) => Promise<{ success: boolean; error?: string; errorCode?: string }>;

interface MutableWindow {
  electron?: Record<string, unknown>;
}

function getMutableWindow(): MutableWindow {
  return window as unknown as MutableWindow;
}

function setBridgeRuntime(cfg: RendererRuntimeConfig | null): void {
  __resetRuntimeConfigCacheForTests();
  const w = getMutableWindow();
  if (cfg === null) {
    delete w.electron;
    return;
  }
  w.electron = {
    ...(w.electron ?? {}),
    runtime: { getConfigSync: () => cfg },
  };
}

function setBridgeIpc(fn: BridgeIpcFn | null): void {
  const w = getMutableWindow();
  if (!w.electron) {
    w.electron = {};
  }
  if (fn === null) {
    delete w.electron.peripherals;
    return;
  }
  w.electron.peripherals = { dispatchLocalEscpos: fn };
}

beforeEach(() => {
  __resetRuntimeConfigCacheForTests();
  delete getMutableWindow().electron;
});

afterEach(() => {
  __resetRuntimeConfigCacheForTests();
  delete getMutableWindow().electron;
});

describe('createEscposReceiptDispatcher (ENG-074b)', () => {
  it('routes through serverPrint in device_local mode', async () => {
    setBridgeRuntime({
      authorityMode: 'device_local',
      hubUrl: null,
      siteId: null,
      deviceId: null,
    });
    const serverPrint = vi.fn(
      async (): Promise<EscPosDispatchOutcome> => ({ status: 'printed' })
    );
    const fetchHubReceiptBytes = vi.fn();
    const dispatcher = createEscposReceiptDispatcher({
      serverPrint,
      fetchHubReceiptBytes,
    });
    const result = await dispatcher();
    expect(result).toEqual({ status: 'printed' });
    expect(serverPrint).toHaveBeenCalledTimes(1);
    expect(fetchHubReceiptBytes).not.toHaveBeenCalled();
  });

  it('routes through serverPrint in site_hub mode', async () => {
    setBridgeRuntime({
      authorityMode: 'site_hub',
      hubUrl: 'http://hub.local:8090',
      siteId: 'site_1',
      deviceId: 'dev_1',
    });
    const serverPrint = vi.fn(
      async (): Promise<EscPosDispatchOutcome> => ({ status: 'system-fallback' })
    );
    const fetchHubReceiptBytes = vi.fn();
    const dispatcher = createEscposReceiptDispatcher({
      serverPrint,
      fetchHubReceiptBytes,
    });
    const result = await dispatcher();
    expect(result).toEqual({ status: 'system-fallback' });
    expect(serverPrint).toHaveBeenCalledTimes(1);
    expect(fetchHubReceiptBytes).not.toHaveBeenCalled();
  });

  it('hub_client + IPC + ready bytes → printed via local bridge', async () => {
    setBridgeRuntime({
      authorityMode: 'hub_client',
      hubUrl: 'http://hub.local:8090',
      siteId: 'site_1',
      deviceId: 'dev_1',
    });
    const captured: number[][] = [];
    setBridgeIpc(async payload => {
      captured.push(payload.bytes);
      return { success: true };
    });
    const fetchHubReceiptBytes = vi.fn(
      async (): Promise<HubReceiptBytesPayload> => ({
        status: 'ready',
        bytes: [0x1b, 0x40, 0x41, 0x42, 0x43],
        transportHint: { channel: 'tcp', host: '127.0.0.1', port: 9100 },
      })
    );
    const serverPrint = vi.fn();
    const dispatcher = createEscposReceiptDispatcher({
      serverPrint,
      fetchHubReceiptBytes,
    });
    const result = await dispatcher();
    expect(result).toEqual({ status: 'printed' });
    expect(serverPrint).not.toHaveBeenCalled();
    expect(fetchHubReceiptBytes).toHaveBeenCalledTimes(1);
    expect(captured).toEqual([[0x1b, 0x40, 0x41, 0x42, 0x43]]);
  });

  it('hub_client + IPC missing → fallback BRIDGE_UNAVAILABLE', async () => {
    setBridgeRuntime({
      authorityMode: 'hub_client',
      hubUrl: 'http://hub.local:8090',
      siteId: 'site_1',
      deviceId: 'dev_1',
    });
    // No setBridgeIpc — peripherals key is absent.
    const fetchHubReceiptBytes = vi.fn();
    const serverPrint = vi.fn();
    const dispatcher = createEscposReceiptDispatcher({
      serverPrint,
      fetchHubReceiptBytes,
    });
    const result = await dispatcher();
    expect(result).toEqual({
      status: 'fallback',
      error: 'BRIDGE_UNAVAILABLE',
    });
    expect(fetchHubReceiptBytes).not.toHaveBeenCalled();
    expect(serverPrint).not.toHaveBeenCalled();
  });

  it('hub_client + system-fallback payload → system-fallback outcome', async () => {
    setBridgeRuntime({
      authorityMode: 'hub_client',
      hubUrl: 'http://hub.local:8090',
      siteId: 'site_1',
      deviceId: 'dev_1',
    });
    const dispatchSpy = vi.fn();
    setBridgeIpc(dispatchSpy);
    const fetchHubReceiptBytes = vi.fn(
      async (): Promise<HubReceiptBytesPayload> => ({
        status: 'system-fallback',
        bytes: [],
        transportHint: null,
      })
    );
    const dispatcher = createEscposReceiptDispatcher({
      serverPrint: vi.fn(),
      fetchHubReceiptBytes,
    });
    const result = await dispatcher();
    expect(result).toEqual({ status: 'system-fallback' });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('hub_client + ready bytes + bridge write fails → fallback with errorCode', async () => {
    setBridgeRuntime({
      authorityMode: 'hub_client',
      hubUrl: 'http://hub.local:8090',
      siteId: 'site_1',
      deviceId: 'dev_1',
    });
    setBridgeIpc(async () => ({
      success: false,
      error: 'connection refused',
      errorCode: 'TCP_REFUSED',
    }));
    const fetchHubReceiptBytes = vi.fn(
      async (): Promise<HubReceiptBytesPayload> => ({
        status: 'ready',
        bytes: [0x1b],
        transportHint: { channel: 'tcp', host: '127.0.0.1', port: 9100 },
      })
    );
    const dispatcher = createEscposReceiptDispatcher({
      serverPrint: vi.fn(),
      fetchHubReceiptBytes,
    });
    const result = await dispatcher();
    expect(result).toEqual({
      status: 'fallback',
      error: 'TCP_REFUSED',
      errorMessage: 'connection refused',
    });
  });

  it('hub_client + hub fetch throws → fallback HUB_BYTES_FETCH_FAILED', async () => {
    setBridgeRuntime({
      authorityMode: 'hub_client',
      hubUrl: 'http://hub.local:8090',
      siteId: 'site_1',
      deviceId: 'dev_1',
    });
    setBridgeIpc(async () => ({ success: true }));
    const fetchHubReceiptBytes = vi.fn(async (): Promise<HubReceiptBytesPayload> => {
      throw new Error('UNAUTHORIZED');
    });
    const dispatcher = createEscposReceiptDispatcher({
      serverPrint: vi.fn(),
      fetchHubReceiptBytes,
    });
    const result = await dispatcher();
    expect(result).toEqual({
      status: 'fallback',
      error: 'HUB_BYTES_FETCH_FAILED',
      errorMessage: 'UNAUTHORIZED',
    });
  });
});

describe('dispatchDrawerKick (ENG-074b)', () => {
  it('routes through serverKick in device_local mode', async () => {
    setBridgeRuntime({
      authorityMode: 'device_local',
      hubUrl: null,
      siteId: null,
      deviceId: null,
    });
    const serverKick = vi.fn(async () => ({ status: 'ok' as const }));
    const fetchHubDrawerBytes = vi.fn();
    const result = await dispatchDrawerKick({
      serverKick,
      fetchHubDrawerBytes,
    });
    expect(result).toEqual({ status: 'ok' });
    expect(serverKick).toHaveBeenCalledTimes(1);
    expect(fetchHubDrawerBytes).not.toHaveBeenCalled();
  });

  it('hub_client + IPC + ready bytes → ok via bridge', async () => {
    setBridgeRuntime({
      authorityMode: 'hub_client',
      hubUrl: 'http://hub.local:8090',
      siteId: 'site_1',
      deviceId: 'dev_1',
    });
    const captured: number[][] = [];
    setBridgeIpc(async payload => {
      captured.push(payload.bytes);
      return { success: true };
    });
    const fetchHubDrawerBytes = vi.fn(
      async (): Promise<HubDrawerBytesPayload> => ({
        status: 'ready',
        bytes: [0x1b, 0x70, 0x00, 0x19, 0xfa],
        transportHint: { channel: 'tcp', host: '127.0.0.1', port: 9100 },
      })
    );
    const result = await dispatchDrawerKick({
      serverKick: vi.fn(),
      fetchHubDrawerBytes,
    });
    expect(result).toEqual({ status: 'ok' });
    expect(captured).toEqual([[0x1b, 0x70, 0x00, 0x19, 0xfa]]);
  });

  it('hub_client + no-drawer-registered → propagates to caller', async () => {
    setBridgeRuntime({
      authorityMode: 'hub_client',
      hubUrl: 'http://hub.local:8090',
      siteId: 'site_1',
      deviceId: 'dev_1',
    });
    const dispatchSpy = vi.fn();
    setBridgeIpc(dispatchSpy);
    const fetchHubDrawerBytes = vi.fn(
      async (): Promise<HubDrawerBytesPayload> => ({
        status: 'no-drawer-registered',
        bytes: [],
        transportHint: null,
      })
    );
    const result = await dispatchDrawerKick({
      serverKick: vi.fn(),
      fetchHubDrawerBytes,
    });
    expect(result).toEqual({ status: 'no-drawer-registered' });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it('hub_client + IPC missing → failed BRIDGE_UNAVAILABLE', async () => {
    setBridgeRuntime({
      authorityMode: 'hub_client',
      hubUrl: 'http://hub.local:8090',
      siteId: 'site_1',
      deviceId: 'dev_1',
    });
    const result = await dispatchDrawerKick({
      serverKick: vi.fn(),
      fetchHubDrawerBytes: vi.fn(),
    });
    expect(result).toEqual({
      status: 'failed',
      error: 'BRIDGE_UNAVAILABLE',
    });
  });
});
