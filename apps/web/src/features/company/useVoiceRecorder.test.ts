/**
 * ENG-040c slice 2 — `useVoiceRecorder` hook tests.
 *
 * Drives the hook with a fake `MediaRecorder` + `navigator.mediaDevices`
 * pair so each path runs without touching real hardware:
 *   - unsupported browser (MediaRecorder undefined)
 *   - permission denied (`NotAllowedError` from getUserMedia)
 *   - successful round-trip — start → stop resolves with Blob,
 *     stream tracks released
 *   - auto-stop at the 30-second hard cap
 */
import { act, renderHook } from '@testing-library/react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from 'vitest';

import {
  MAX_TEST_RECORDING_MS,
  useVoiceRecorder,
  VOICE_RECORDER_MIME_TYPES,
} from './useVoiceRecorder';

/** Stand-in for the spec MediaRecorder. Captures the `start`,
 *  `stop`, and event handler setters that the hook touches. */
class FakeMediaRecorder {
  static isTypeSupported = vi.fn((mime: string) => mime === 'audio/webm');
  static instances: FakeMediaRecorder[] = [];

  ondataavailable: ((ev: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType: string;

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? 'audio/webm';
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = 'recording';
  }

  stop(): void {
    if (this.state !== 'recording') return;
    this.state = 'inactive';
    // Mirror real MediaRecorder: emit a final chunk before onstop.
    this.ondataavailable?.({ data: new Blob(['audio-bytes'], { type: this.mimeType }) });
    this.onstop?.();
  }

  /** Test helper — simulate a runtime error from the recorder. */
  failWith(message: string): void {
    this.state = 'inactive';
    this.onerror?.(new ErrorEvent('error', { error: new Error(message) }));
  }
}

const trackStopSpy = vi.fn();

function buildFakeStream(): MediaStream {
  const track = { stop: trackStopSpy } as unknown as MediaStreamTrack;
  return {
    getTracks: () => [track],
  } as unknown as MediaStream;
}

let getUserMediaMock: Mock<(constraints: MediaStreamConstraints) => Promise<MediaStream>>;

const originalMediaRecorder = (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
const originalMediaDevices = (
  globalThis.navigator as Navigator & { mediaDevices?: MediaDevices }
).mediaDevices;

function installFakes(opts: { mediaRecorder: typeof FakeMediaRecorder | undefined } = {
  mediaRecorder: FakeMediaRecorder,
}): void {
  if (opts.mediaRecorder) {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder =
      opts.mediaRecorder as unknown as typeof MediaRecorder;
  } else {
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
  }
  Object.defineProperty(globalThis.navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: getUserMediaMock },
  });
}

function uninstallFakes(): void {
  if (originalMediaRecorder !== undefined) {
    (globalThis as { MediaRecorder?: unknown }).MediaRecorder = originalMediaRecorder;
  } else {
    delete (globalThis as { MediaRecorder?: unknown }).MediaRecorder;
  }
  if (originalMediaDevices !== undefined) {
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: originalMediaDevices,
    });
  } else {
    Object.defineProperty(globalThis.navigator, 'mediaDevices', {
      configurable: true,
      value: undefined,
    });
  }
}

beforeEach(() => {
  FakeMediaRecorder.instances.length = 0;
  FakeMediaRecorder.isTypeSupported.mockReset();
  FakeMediaRecorder.isTypeSupported.mockImplementation(
    (mime: string) => mime === 'audio/webm'
  );
  trackStopSpy.mockReset();
  getUserMediaMock = vi.fn(async () => buildFakeStream()) as Mock<
    (constraints: MediaStreamConstraints) => Promise<MediaStream>
  >;
  installFakes();
});

afterEach(() => {
  uninstallFakes();
  vi.useRealTimers();
});

describe('useVoiceRecorder (ENG-040c slice 2)', () => {
  it('reports supported=false when MediaRecorder is not defined', () => {
    uninstallFakes();
    installFakes({ mediaRecorder: undefined });

    const { result } = renderHook(() => useVoiceRecorder());
    expect(result.current.supported).toBe(false);
    expect(VOICE_RECORDER_MIME_TYPES).toContain('audio/webm');
  });

  it('classifies NotAllowedError as permission-denied + leaves recording=false', async () => {
    getUserMediaMock.mockRejectedValueOnce(
      Object.assign(new Error('Permission denied by user'), { name: 'NotAllowedError' })
    );

    const { result } = renderHook(() => useVoiceRecorder());
    // Swallow the throw inside `act` so state updates flush before we
    // assert; `expect(...).rejects.toThrow()` returns before the React
    // batch settles on this branch.
    let caught: unknown;
    await act(async () => {
      try {
        await result.current.start();
      } catch (err) {
        caught = err;
      }
    });
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toMatch(/Permission denied by user/);
    expect(result.current.recording).toBe(false);
    expect(result.current.error?.kind).toBe('permission-denied');
  });

  it('start + manual stop resolves with a Blob and releases the stream tracks', async () => {
    const { result } = renderHook(() => useVoiceRecorder());
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.recording).toBe(true);
    expect(FakeMediaRecorder.instances).toHaveLength(1);

    let blob: Blob | null = null;
    await act(async () => {
      blob = await result.current.stop();
    });

    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob | null)?.size ?? 0).toBeGreaterThan(0);
    expect(result.current.recording).toBe(false);
    // Cleanup: every active track on the stream must be stopped so
    // the OS mic indicator turns off.
    expect(trackStopSpy).toHaveBeenCalledTimes(1);
  });

  it('auto-stops at the 30-second hard cap and returns the captured blob', async () => {
    // `useFakeTimers` must keep `microtaskQueue` real so the
    // `getUserMedia` Promise inside `start()` resolves; otherwise
    // `vi.advanceTimersByTimeAsync` deadlocks waiting for a
    // microtask that the fake scheduler controls.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const onAutoStop = vi.fn();
    const { result } = renderHook(() => useVoiceRecorder({ onAutoStop }));
    await act(async () => {
      await result.current.start();
    });
    expect(result.current.recording).toBe(true);

    // Advancing past the cap should trigger MediaRecorder.stop() via
    // the hook's safety timer; the FakeMediaRecorder's onstop chain
    // then flushes through the React state updates inside `act`.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(MAX_TEST_RECORDING_MS + 100);
    });

    expect(result.current.recording).toBe(false);
    // Auto-stop ran the MediaRecorder.stop() side effect, which
    // releases the stream tracks via the onstop handler.
    expect(trackStopSpy).toHaveBeenCalledTimes(1);
    expect(onAutoStop).toHaveBeenCalledTimes(1);
    expect(onAutoStop.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
  });
});
