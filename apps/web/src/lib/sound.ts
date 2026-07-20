/**
 * checkout sound feedback.
 *
 * Pure Web Audio (oscillators — no assets, no deps). Three cues:
 * - scan success: one short high beep.
 * - scan error: two low pulses (clearly distinct from success).
 * - sale complete: a brief ascending arpeggio.
 *
 * Design constraints:
 * - OFF by default; the preference is device-local (localStorage) because
 * sound is a property of the till hardware, not of the tenant or user.
 * - The AudioContext is created lazily on first playback, which in practice
 * happens after a user gesture (scan/keypress/click), so the autoplay
 * policy never blocks it.
 * - Every entry point is a silent no-op when disabled or when the runtime
 * has no AudioContext (jsdom/tests, odd webviews) — audio must never
 * break checkout.
 */

const STORAGE_KEY = 'puntovivo-sound-enabled';

let audioContext: AudioContext | null = null;
let volatileSoundEnabled: boolean | null = null;

function getAudioContext(): AudioContext | null {
  if (audioContext) return audioContext;
  const Ctor = typeof window !== 'undefined' ? window.AudioContext : undefined;
  if (!Ctor) return null;
  try {
    audioContext = new Ctor();
  } catch {
    return null;
  }
  return audioContext;
}

/** Device-local preference; defaults to OFF until the operator opts in. */
export function isSoundEnabled(): boolean {
  try {
    const stored = window.localStorage?.getItem(STORAGE_KEY);
    if (stored !== null && stored !== undefined) {
      volatileSoundEnabled = stored === 'true';
      return volatileSoundEnabled;
    }
  } catch {
    // Fall through to the in-memory preference when storage is unavailable.
  }
  return volatileSoundEnabled ?? false;
}

export function setSoundEnabled(enabled: boolean): void {
  // Keep sound usable for the current app lifetime even when private mode or
  // a hardened webview rejects localStorage writes.
  volatileSoundEnabled = enabled;
  try {
    window.localStorage?.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // Storage unavailable — the toggle remains session-local.
  }
}

interface Tone {
  /** Oscillator frequency in Hz. */
  frequency: number;
  /** Offset from now when the tone starts, in seconds. */
  at: number;
  /** Tone duration in seconds. */
  duration: number;
}

function playTones(tones: Tone[]): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const now = ctx.currentTime;
    for (const tone of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = tone.frequency;
      // Quick attack + exponential release keeps the beep click-free at
      // register volume without competing with the operator's voice.
      gain.gain.setValueAtTime(0.0001, now + tone.at);
      gain.gain.exponentialRampToValueAtTime(0.18, now + tone.at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + tone.at + tone.duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + tone.at);
      osc.stop(now + tone.at + tone.duration + 0.02);
    }
  } catch {
    // Never let audio break the checkout path.
  }
}

/** One short high beep — item scanned and added to the cart. */
export function playScanSuccess(): void {
  playTones([{ frequency: 880, at: 0, duration: 0.08 }]);
}

/** Two low pulses — product not found / cannot be added. */
export function playScanError(): void {
  playTones([
    { frequency: 220, at: 0, duration: 0.12 },
    { frequency: 220, at: 0.18, duration: 0.12 },
  ]);
}

/** Brief ascending arpeggio — sale completed. */
export function playSaleComplete(): void {
  playTones([
    { frequency: 523.25, at: 0, duration: 0.09 },
    { frequency: 659.25, at: 0.09, duration: 0.09 },
    { frequency: 783.99, at: 0.18, duration: 0.14 },
  ]);
}
