/** Scale wire protocols: pure framing and parsing, no I/O. */

export const SCALE_PROTOCOLS = ['continuous', 'toledo', 'enq'] as const;
export const SCALE_BAUD_RATES = [2400, 4800, 9600, 19200] as const;
export const SCALE_FRAMINGS = ['8N1', '7E1'] as const;

export type ScaleProtocol = (typeof SCALE_PROTOCOLS)[number];
export type ScaleFraming = (typeof SCALE_FRAMINGS)[number];

export interface ScaleConfig {
  path: string;
  protocol: ScaleProtocol;
  baudRate: (typeof SCALE_BAUD_RATES)[number];
  framing: ScaleFraming;
}

export type ScaleErrorCode =
  | 'SCALE_NOT_CONFIGURED'
  | 'SCALE_DRIVER_UNAVAILABLE'
  | 'SCALE_DISCONNECTED'
  | 'SCALE_BUSY'
  | 'SCALE_NO_RESPONSE'
  | 'SCALE_UNSTABLE'
  | 'SCALE_OVERLOAD'
  | 'SCALE_NEGATIVE'
  | 'SCALE_EMPTY'
  | 'SCALE_UNSUPPORTED_UNIT';

export type ScaleReadResult =
  { status: 'ok'; kilograms: number } | { status: 'error'; code: ScaleErrorCode };

export type ScaleFrame =
  | { kind: 'weight'; kilograms: number; stable: boolean | null }
  | { kind: 'unstable' | 'overload' | 'negative' | 'unit' };

/** Request byte for polled protocols: Toledo 8217 answers W, ECR-style scales answer ENQ. */
export const SCALE_POLL_BYTE: Record<ScaleProtocol, number | null> = {
  continuous: null,
  toledo: 0x57,
  enq: 0x05,
};

export function framingOptions(framing: ScaleFraming) {
  return framing === '7E1'
    ? { dataBits: 7 as const, parity: 'even' as const, stopBits: 1 as const }
    : { dataBits: 8 as const, parity: 'none' as const, stopBits: 1 as const };
}

const MAX_PATH_LENGTH = 256;

export function isScalePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_PATH_LENGTH &&
    ![...value].some(character => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    })
  );
}

export function isScaleConfig(value: unknown): value is ScaleConfig {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 4 &&
    isScalePath(candidate.path) &&
    (SCALE_PROTOCOLS as readonly unknown[]).includes(candidate.protocol) &&
    (SCALE_BAUD_RATES as readonly unknown[]).includes(candidate.baudRate) &&
    (SCALE_FRAMINGS as readonly unknown[]).includes(candidate.framing)
  );
}

/** Splits buffered text on CR, LF or ETX; the last element is the unfinished remainder. */
export function splitFrames(buffer: string): { frames: string[]; rest: string } {
  // eslint-disable-next-line no-control-regex -- ETX ends a scale frame
  const parts = buffer.split(/[\r\n\x03]/);
  const rest = parts.pop() ?? '';
  return { frames: parts.filter(part => part.length > 0), rest };
}

// Toledo 8217 status byte after «?»: bit 1 over capacity, bit 2 under zero, otherwise in motion.
function toledoStatus(status: number): ScaleFrame {
  if (status & 0x02) return { kind: 'overload' };
  if (status & 0x04) return { kind: 'negative' };
  return { kind: 'unstable' };
}

/**
 * Reads one ASCII frame from Toledo 8217, ECR polled or continuous scales
 * (e.g. «ST,GS,+  0.250kg», «\x020.250», «  250 g»). Null when it carries no weight.
 */
export function parseScaleFrame(raw: string): ScaleFrame | null {
  const statusAt = raw.indexOf('?');
  if (statusAt >= 0 && statusAt + 1 < raw.length && !/\d/.test(raw.slice(0, statusAt))) {
    return toledoStatus(raw.charCodeAt(statusAt + 1));
  }
  // eslint-disable-next-line no-control-regex -- STX and friends wrap the weight
  const text = raw.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
  if (!text) return null;
  if (/\bOL\b|OVER/i.test(text)) return { kind: 'overload' };

  const match = /([+-])?\s*(\d+(?:[.,]\d+)?)\s*(kg|g|lb|oz)?\b/i.exec(text);
  if (!match) return null;
  const unit = match[3]?.toLowerCase() ?? 'kg';
  if (unit === 'lb' || unit === 'oz') return { kind: 'unit' };

  const digits = match[2]!;
  let value = Number(digits.replace(',', '.'));
  // Toledo sends five digits with an implied three-decimal point when no point is present.
  if (!match[3] && !/[.,]/.test(digits) && digits.length === 5) value /= 1000;
  if (unit === 'g') value /= 1000;
  if (!Number.isFinite(value)) return null;
  if (match[1] === '-' && value > 0) return { kind: 'negative' };

  const stable = /\bUS\b|\bM\b/.test(text) ? false : /\bST\b/.test(text) ? true : null;
  return { kind: 'weight', kilograms: Math.round(value * 1000) / 1000, stable };
}
