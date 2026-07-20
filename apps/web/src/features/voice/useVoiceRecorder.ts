/**
 * slice 2 — Browser MediaRecorder wrapper for the "Test
 * transcription" affordance on the AI settings card.
 *
 * Responsibilities:
 * - Detect the first supported audio MIME type that matches the
 * server-side whitelist (see
 * `VOICE_TRANSCRIBE_MIME_TYPES` in
 * `services/ai/voice/transcribe.ts`).
 * - Request microphone access, start recording, and resolve a
 * final `Blob` when the caller calls `stop()`.
 * - Auto-stop at the 30-second hard cap so the operator can never
 * blow the 10 MB byte budget the server already enforces.
 * - Release MediaStream tracks on stop / unmount.
 * - Surface three error modes (permission-denied, no-microphone,
 * unsupported-browser) so the consuming component can render
 * the right localized hint.
 *
 * The hook owns no DOM — pure state + browser APIs — so the
 * consumer keeps full control over button labels, countdowns, and
 * transcript display.
 *
 * @module features/voice/useVoiceRecorder
 */
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * MIME types the server's `ai.transcribeAudio` route accepts. The
 * hook walks this list in order via `MediaRecorder.isTypeSupported`
 * to pick the first that the browser produces natively — Chromium
 * lands on `audio/webm`, Safari on `audio/mp4`, older Safari on
 * `audio/wav`.
 *
 * Mirrored from `VOICE_TRANSCRIBE_MIME_TYPES` in the server module;
 * if the server whitelist ever shrinks we mirror it here.
 */
export const VOICE_RECORDER_MIME_TYPES = [
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/m4a',
  'audio/ogg',
  'audio/x-m4a',
] as const;

export type VoiceRecorderMimeType = (typeof VOICE_RECORDER_MIME_TYPES)[number];

/** 30-second hard cap on a single recording. */
export const MAX_TEST_RECORDING_MS = 30_000;

/**
 * Discriminated error states. `permission-denied` covers the
 * `NotAllowedError` from `getUserMedia`; `no-microphone` covers
 * `NotFoundError`; `unsupported-browser` fires when `MediaRecorder`
 * is undefined or none of the whitelist MIME types are supported.
 * `unknown` is the catch-all for runtime exceptions the browser
 * surfaces without a typed cause.
 */
export type VoiceRecorderErrorKind =
  'permission-denied' | 'no-microphone' | 'unsupported-browser' | 'unknown';

export interface VoiceRecorderError {
  kind: VoiceRecorderErrorKind;
  message: string;
}

export interface VoiceRecorderHook {
  /** True while the MediaRecorder is actively capturing audio. */
  recording: boolean;
  /** Whether `MediaRecorder` is available + at least one MIME from
   * the whitelist is supported. Computed once on mount. */
  supported: boolean;
  /** Most recent error, if any. Cleared by `reset()`. */
  error: VoiceRecorderError | null;
  /** MIME type the active recording uses. Null until `start()` is
   * called and MediaRecorder picks one. */
  recordedMimeType: VoiceRecorderMimeType | null;
  /** Start a recording. Rejects with a `VoiceRecorderError` if mic
   * permission is denied or hardware is missing. */
  start: () => Promise<void>;
  /** Stop the active recording. Resolves with the captured Blob;
   * rejects if no recording is in flight. */
  stop: () => Promise<Blob>;
  /** Clear the last error + reset state. Does NOT stop a live
   * recording — call `stop()` first if needed. */
  reset: () => void;
}

export interface VoiceRecorderOptions {
  /**
   * Called when the 30-second safety timer stops the recording. Manual
   * stops still resolve through `stop()`.
   */
  onAutoStop?: (blob: Blob) => void | Promise<void>;
}

/**
 * Pick the first whitelist MIME that the runtime's `MediaRecorder`
 * advertises support for. The strict-mode `isTypeSupported` check
 * also covers codec parameters when present (e.g. the browser
 * decides `audio/webm;codecs=opus` is supported but bare
 * `audio/webm` is not). The fallback iterates the codec-stripped
 * form because every browser worth supporting accepts the bare
 * mime variant for at least one whitelist entry.
 */
function detectSupportedMimeType(): VoiceRecorderMimeType | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const candidate of VOICE_RECORDER_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return null;
}

function classifyGetUserMediaError(err: unknown): VoiceRecorderError {
  if (err instanceof Error) {
    if (err.name === 'NotAllowedError' || err.name === 'SecurityError') {
      return {
        kind: 'permission-denied',
        message: err.message || 'Microphone access denied',
      };
    }
    if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
      return {
        kind: 'no-microphone',
        message: err.message || 'No microphone available',
      };
    }
    return { kind: 'unknown', message: err.message };
  }
  return { kind: 'unknown', message: 'Unknown error starting recording' };
}

export function useVoiceRecorder(options: VoiceRecorderOptions = {}): VoiceRecorderHook {
  // `supported` is derived once on mount and stays constant. We use
  // a ref-backed state to keep the value visible across re-renders
  // without re-running the detection on every render.
  const [supported] = useState<boolean>(() => detectSupportedMimeType() !== null);
  const [recording, setRecording] = useState<boolean>(false);
  const [error, setError] = useState<VoiceRecorderError | null>(null);
  const [recordedMimeType, setRecordedMimeType] = useState<VoiceRecorderMimeType | null>(null);

  // Refs survive re-renders without triggering them, which keeps the
  // MediaRecorder lifecycle decoupled from React state updates.
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const stopResolverRef = useRef<((blob: Blob) => void) | null>(null);
  const stopRejecterRef = useRef<((err: Error) => void) | null>(null);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoStopTriggeredRef = useRef<boolean>(false);
  const onAutoStopRef = useRef<VoiceRecorderOptions['onAutoStop']>(options.onAutoStop);

  useEffect(() => {
    onAutoStopRef.current = options.onAutoStop;
  }, [options.onAutoStop]);

  const releaseStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  const clearAutoStop = useCallback(() => {
    if (autoStopTimerRef.current !== null) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    if (!supported) {
      const next: VoiceRecorderError = {
        kind: 'unsupported-browser',
        message: 'MediaRecorder is not supported in this browser',
      };
      setError(next);
      throw new Error(next.message);
    }
    if (recorderRef.current && recorderRef.current.state === 'recording') {
      // Caller asked to start while a recording is already live; treat
      // as a no-op rather than spinning up a second recorder.
      return;
    }
    setError(null);

    const mimeType = detectSupportedMimeType();
    // `detectSupportedMimeType` already gated supported=true above,
    // so this branch is defensive against a runtime regression
    // (MediaRecorder reports unsupported between mount and start).
    if (!mimeType) {
      const next: VoiceRecorderError = {
        kind: 'unsupported-browser',
        message: 'No supported audio MIME type for MediaRecorder',
      };
      setError(next);
      throw new Error(next.message);
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const classified = classifyGetUserMediaError(err);
      setError(classified);
      throw err instanceof Error ? err : new Error(classified.message);
    }

    streamRef.current = stream;
    chunksRef.current = [];

    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;
    setRecordedMimeType(mimeType);

    recorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = () => {
      clearAutoStop();
      const blob = new Blob(chunksRef.current, { type: mimeType });
      chunksRef.current = [];
      releaseStream();
      recorderRef.current = null;
      setRecording(false);
      const resolve = stopResolverRef.current;
      const autoStopped = autoStopTriggeredRef.current;
      autoStopTriggeredRef.current = false;
      stopResolverRef.current = null;
      stopRejecterRef.current = null;
      if (resolve) {
        resolve(blob);
      } else if (autoStopped) {
        void onAutoStopRef.current?.(blob);
      }
    };

    recorder.onerror = event => {
      clearAutoStop();
      releaseStream();
      recorderRef.current = null;
      setRecording(false);
      const err =
        event instanceof ErrorEvent && event.error instanceof Error
          ? event.error
          : new Error('MediaRecorder failed');
      setError({ kind: 'unknown', message: err.message });
      const reject = stopRejecterRef.current;
      stopResolverRef.current = null;
      stopRejecterRef.current = null;
      if (reject) reject(err);
    };

    recorder.start();
    setRecording(true);

    // Hard cap: stop the recording at the 30-second budget so we
    // never reach the server's `VOICE_TRANSCRIBE_MAX_BYTES` guard
    // for normal usage. `stop()` is idempotent at the MediaRecorder
    // layer so a parallel manual stop won't double-fire.
    autoStopTimerRef.current = setTimeout(() => {
      if (recorderRef.current && recorderRef.current.state === 'recording') {
        autoStopTriggeredRef.current = true;
        recorderRef.current.stop();
      }
    }, MAX_TEST_RECORDING_MS);
  }, [clearAutoStop, releaseStream, supported]);

  const stop = useCallback((): Promise<Blob> => {
    if (!recorderRef.current || recorderRef.current.state !== 'recording') {
      return Promise.reject(new Error('No active recording to stop'));
    }
    return new Promise<Blob>((resolve, reject) => {
      autoStopTriggeredRef.current = false;
      stopResolverRef.current = resolve;
      stopRejecterRef.current = reject;
      recorderRef.current?.stop();
    });
  }, []);

  const reset = useCallback(() => {
    setError(null);
    setRecordedMimeType(null);
  }, []);

  // Cleanup on unmount: stop the recorder and release the stream so
  // the mic indicator turns off when the operator navigates away.
  useEffect(() => {
    return () => {
      clearAutoStop();
      autoStopTriggeredRef.current = false;
      if (recorderRef.current && recorderRef.current.state === 'recording') {
        recorderRef.current.stop();
      }
      releaseStream();
    };
  }, [clearAutoStop, releaseStream]);

  return {
    recording,
    supported,
    error,
    recordedMimeType,
    start,
    stop,
    reset,
  };
}
