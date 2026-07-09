/**
 * ENG-193 — checkout sound feedback.
 *
 * The invariants that matter: audio must never break checkout (no-op when
 * disabled or when the runtime has no AudioContext), the preference is
 * device-local and defaults to OFF, and enabling actually drives the
 * oscillator pipeline.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isSoundEnabled,
  playSaleComplete,
  playScanError,
  playScanSuccess,
  setSoundEnabled,
} from './sound';

function makeAudioContextMock() {
  const oscillator = {
    type: 'sine',
    frequency: { value: 0 },
    connect: vi.fn(() => ({ connect: vi.fn() })),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const gain = {
    gain: {
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    },
    connect: vi.fn(),
  };
  const ctx = {
    state: 'running',
    currentTime: 0,
    destination: {},
    resume: vi.fn(),
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain),
  };
  return { ctx, oscillator };
}

describe('sound', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to OFF and persists the device-local toggle', () => {
    expect(isSoundEnabled()).toBe(false);
    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
    expect(window.localStorage.getItem('puntovivo-sound-enabled')).toBe('true');
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);
  });

  it('is a silent no-op while disabled (never touches AudioContext)', () => {
    const ctor = vi.fn();
    vi.stubGlobal('AudioContext', ctor);
    playScanSuccess();
    playScanError();
    playSaleComplete();
    expect(ctor).not.toHaveBeenCalled();
  });

  it('never throws when the runtime has no AudioContext (jsdom/webviews)', () => {
    setSoundEnabled(true);
    // jsdom ships no AudioContext by default; if one leaked in, remove it.
    vi.stubGlobal('AudioContext', undefined);
    expect(() => {
      playScanSuccess();
      playScanError();
      playSaleComplete();
    }).not.toThrow();
  });

  it('drives the oscillator pipeline when enabled', () => {
    setSoundEnabled(true);
    const { ctx } = makeAudioContextMock();
    // A regular function (not an arrow) so `new AudioContext()` is
    // constructable; returning an object from a constructor overrides `this`.
    vi.stubGlobal(
      'AudioContext',
      vi.fn(function AudioContextMock() {
        return ctx;
      })
    );
    playScanSuccess();
    expect(ctx.createOscillator).toHaveBeenCalledTimes(1);
    playScanError();
    // Two pulses for the error cue, on top of the success beep.
    expect(ctx.createOscillator).toHaveBeenCalledTimes(3);
  });
});
