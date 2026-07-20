/**
 * pass 1 (item #6) — unit tests for `flipAnimate` helper.
 *
 * The helper runs under jsdom so DOMRects are deterministic (all
 * zeros unless we set them). We assert the decision logic (reduced
 * motion short-circuit, missing-key skip, delta-computation) without
 * depending on a real layout engine.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { captureFlipSnapshot, playFlip, prefersReducedMotion } from '../flipAnimate';

function makeContainer(): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

function addChild(container: HTMLElement, key: string, rect: Partial<DOMRect>): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('data-flip-key', key);
  // jsdom returns all-zero rects; stub getBoundingClientRect to drive
  // the helper deterministically.
  el.getBoundingClientRect = () =>
    ({
      left: rect.left ?? 0,
      top: rect.top ?? 0,
      right: rect.right ?? 0,
      bottom: rect.bottom ?? 0,
      width: rect.width ?? 0,
      height: rect.height ?? 0,
      x: rect.left ?? 0,
      y: rect.top ?? 0,
      toJSON: () => ({}),
    }) as DOMRect;
  container.appendChild(el);
  return el;
}

function mockMatchMedia(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('flipAnimate ( pass 1 item #6)', () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = makeContainer();
    mockMatchMedia(false);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  it('prefersReducedMotion returns false when the media query is not matched', () => {
    expect(prefersReducedMotion()).toBe(false);
  });

  it('prefersReducedMotion returns true when the media query matches', () => {
    mockMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
  });

  it('captureFlipSnapshot indexes elements by their flip key', () => {
    addChild(container, 'a', { top: 10, left: 20 });
    addChild(container, 'b', { top: 30, left: 40 });
    const snapshot = captureFlipSnapshot(container, '[data-flip-key]');
    expect(snapshot.size).toBe(2);
    expect(snapshot.get('a')!.top).toBe(10);
    expect(snapshot.get('b')!.left).toBe(40);
  });

  it('captureFlipSnapshot skips elements without a flip key', () => {
    const el = document.createElement('div');
    container.appendChild(el);
    addChild(container, 'only', { top: 5, left: 5 });
    const snapshot = captureFlipSnapshot(container, 'div');
    expect(snapshot.size).toBe(1);
    expect(snapshot.get('only')).toBeDefined();
  });

  it('playFlip short-circuits to an empty array under prefers-reduced-motion', () => {
    const before = captureFlipSnapshot(container, '[data-flip-key]');
    mockMatchMedia(true);
    const animations = playFlip(container, '[data-flip-key]', before);
    expect(animations).toEqual([]);
  });

  it('playFlip returns no animations when nothing moved (zero delta)', () => {
    const el = addChild(container, 'stays', { top: 100, left: 100 });
    el.animate = vi.fn();
    const before = captureFlipSnapshot(container, '[data-flip-key]');
    const animations = playFlip(container, '[data-flip-key]', before);
    expect(animations).toEqual([]);
    expect(el.animate).not.toHaveBeenCalled();
  });

  it('playFlip animates moved elements with the correct inverse translate', () => {
    const moved = addChild(container, 'moved', { top: 100, left: 50 });
    const before = captureFlipSnapshot(container, '[data-flip-key]');

    // Simulate re-render: element now at a new position.
    moved.getBoundingClientRect = () =>
      ({
        left: 80,
        top: 140,
        right: 80,
        bottom: 140,
        width: 0,
        height: 0,
        x: 80,
        y: 140,
        toJSON: () => ({}),
      }) as DOMRect;

    const animateSpy = vi.fn((keyframes: Keyframe[], timing: KeyframeAnimationOptions | number) => {
      void keyframes;
      void timing;
      return { finished: Promise.resolve() } as unknown as Animation;
    });
    moved.animate = animateSpy;

    const animations = playFlip(container, '[data-flip-key]', before);
    expect(animations.length).toBe(1);
    expect(animateSpy).toHaveBeenCalledOnce();
    const call = animateSpy.mock.calls[0];
    expect(call).toBeDefined();
    const [keyframes, timing] = call!;
    // dx = 50 - 80 = -30; dy = 100 - 140 = -40
    expect(keyframes).toEqual([
      { transform: 'translate(-30px, -40px)' },
      { transform: 'translate(0, 0)' },
    ]);
    expect(timing).toMatchObject({ duration: 180, easing: 'ease-out' });
  });

  it('playFlip skips elements that are new (not in previous snapshot)', () => {
    const before = captureFlipSnapshot(container, '[data-flip-key]');
    const added = addChild(container, 'fresh', { top: 0, left: 0 });
    const animateSpy = vi.fn();
    added.animate = animateSpy;
    playFlip(container, '[data-flip-key]', before);
    expect(animateSpy).not.toHaveBeenCalled();
  });

  it('accepts a null container without crashing (defensive)', () => {
    expect(captureFlipSnapshot(null, '[data-flip-key]').size).toBe(0);
    expect(playFlip(null, '[data-flip-key]', new Map())).toEqual([]);
  });
});
