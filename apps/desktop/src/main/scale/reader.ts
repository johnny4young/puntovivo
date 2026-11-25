/** One weight read over an injected serial port; Electron- and native-free for tests. */
import {
  parseScaleFrame,
  SCALE_POLL_BYTE,
  splitFrames,
  type ScaleConfig,
  type ScaleErrorCode,
  type ScaleFrame,
  type ScaleReadResult,
} from './protocol.ts';

export interface ScalePortHandle {
  /** Resolves with the next chunk; rejects once the port is closed. */
  read: () => Promise<Uint8Array>;
  write: (bytes: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
}

export type OpenScalePort = (config: ScaleConfig) => Promise<ScalePortHandle>;

interface ReadScaleOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

const ISSUE_CODES: Record<Exclude<ScaleFrame['kind'], 'weight'>, ScaleErrorCode> = {
  unstable: 'SCALE_UNSTABLE',
  overload: 'SCALE_OVERLOAD',
  negative: 'SCALE_NEGATIVE',
  empty: 'SCALE_EMPTY',
  unit: 'SCALE_UNSUPPORTED_UNIT',
};

/**
 * Opens the port, polls when the protocol asks for it and resolves with the
 * first stable weight. Frames without a stability flag count as stable once
 * two in a row agree. The port is always closed before resolving.
 */
export async function readScaleWeight(
  config: ScaleConfig,
  open: OpenScalePort,
  { timeoutMs = 2500, pollIntervalMs = 300 }: ReadScaleOptions = {}
): Promise<ScaleReadResult> {
  let port: ScalePortHandle;
  try {
    port = await open(config);
  } catch (error) {
    // Adapters report their own code; anything else means the port is gone.
    const code = (error as { code?: unknown }).code;
    return {
      status: 'error',
      code:
        typeof code === 'string' && code.startsWith('SCALE_')
          ? (code as ScaleErrorCode)
          : 'SCALE_DISCONNECTED',
    };
  }

  const pollByte = SCALE_POLL_BYTE[config.protocol];
  let settled = false;
  let poller: ReturnType<typeof setInterval> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await new Promise<ScaleReadResult>(resolve => {
      let buffer = '';
      let lastIssue: ScaleErrorCode | null = null;
      let previousUnflagged: number | null = null;

      const finish = (result: ScaleReadResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      const accept = (frame: ScaleFrame) => {
        if (frame.kind !== 'weight') {
          lastIssue = ISSUE_CODES[frame.kind];
          previousUnflagged = null;
          return;
        }
        const stable = frame.stable ?? (pollByte !== null || previousUnflagged === frame.kilograms);
        if (!stable) {
          lastIssue = 'SCALE_UNSTABLE';
          previousUnflagged = frame.stable === null ? frame.kilograms : null;
          return;
        }
        finish(
          frame.kilograms > 0
            ? { status: 'ok', kilograms: frame.kilograms }
            : { status: 'error', code: 'SCALE_EMPTY' }
        );
      };

      const poll = () => {
        if (pollByte === null || settled) return;
        port
          .write(Uint8Array.of(pollByte))
          .catch(() => finish({ status: 'error', code: 'SCALE_DISCONNECTED' }));
      };

      timer = setTimeout(
        () => finish({ status: 'error', code: lastIssue ?? 'SCALE_NO_RESPONSE' }),
        timeoutMs
      );
      poll();
      if (pollByte !== null) poller = setInterval(poll, pollIntervalMs);

      void (async () => {
        while (!settled) {
          let chunk: Uint8Array;
          try {
            chunk = await port.read();
          } catch {
            finish({ status: 'error', code: 'SCALE_DISCONNECTED' });
            return;
          }
          buffer += Buffer.from(chunk).toString('latin1');
          const { frames, rest } = splitFrames(buffer);
          // A device that never sends a terminator must not grow the buffer forever.
          buffer = rest.slice(-256);
          for (const raw of frames) {
            const frame = parseScaleFrame(raw);
            if (frame) accept(frame);
            if (settled) return;
          }
        }
      })();
    });
  } finally {
    clearTimeout(timer);
    clearInterval(poller);
    await port.close().catch(() => {});
  }
}
