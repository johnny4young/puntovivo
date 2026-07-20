/**
 * pass 1 (item #6) — small FLIP animation helper.
 *
 * FLIP (First, Last, Invert, Play) lets the caller snapshot DOM
 * positions before a layout change, then re-animate the invert back
 * to identity after the change so elements appear to slide into the
 * new position. Used by `ReceiptTemplateEditor` to animate the
 * `↑`/`↓` block moves, but intentionally framework-agnostic so
 * downstream features can reuse it.
 *
 * ## Usage
 *
 * ```ts
 * const flip = captureFlipSnapshot(container, '[data-flip-key]');
 * // ... mutate DOM / re-render ...
 * playFlip(container, '[data-flip-key]', flip);
 * ```
 *
 * Each element inside `container` that matches the selector must carry
 * a stable `data-flip-key` (or whatever attribute the caller picks)
 * identifying it across the before/after reflow. Elements that appear
 * or disappear between frames are ignored — the helper only animates
 * elements present in BOTH snapshots.
 *
 * ## Reduced-motion contract
 *
 * When `prefers-reduced-motion: reduce` is active, `playFlip` returns
 * immediately without scheduling animations. Callers get identical
 * behaviour (moves are instant) but never see the inverse transform.
 *
 * ## Pure-helper constraints
 *
 * - No React / framework imports: this helper is a plain DOM utility.
 * - No globals beyond `window` / `document` / `matchMedia`.
 * - Uses the standard Web Animations API (`Element.animate`) so no
 * extra dependency is needed.
 *
 * @module lib/flipAnimate
 */

/**
 * Snapshot of an element's bounding box, keyed by its flip key. Passed
 * between `captureFlipSnapshot` and `playFlip`.
 */
export type FlipSnapshot = Map<string, DOMRect>;

/** Default animation duration in ms. Matches the ~180ms micro-interaction cadence. */
export const FLIP_DURATION_MS = 180;
/** Default easing — ease-out looks natural for "settle into place". */
export const FLIP_EASING = 'ease-out';

/**
 * Whether the caller's environment asks for reduced motion. Extracted
 * so it can be mocked in tests (Vitest / jsdom lets you stub
 * `window.matchMedia`).
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Capture the current bounding rects of every element in `container`
 * matching `selector`. Each element must expose a `data-flip-key`
 * attribute (or the attribute named by `keyAttribute`) so the helper
 * can correlate the element across before/after states.
 */
export function captureFlipSnapshot(
  container: Element | null | undefined,
  selector: string,
  keyAttribute = 'data-flip-key'
): FlipSnapshot {
  const snapshot: FlipSnapshot = new Map();
  if (!container) return snapshot;
  const nodes = container.querySelectorAll(selector);
  nodes.forEach(node => {
    if (!(node instanceof HTMLElement)) return;
    const key = node.getAttribute(keyAttribute);
    if (!key) return;
    snapshot.set(key, node.getBoundingClientRect());
  });
  return snapshot;
}

/**
 * Given a previous snapshot and the current DOM, compute each matching
 * element's delta and animate it from the inverted origin back to
 * identity. No-op for elements that are new (not in `previous`) or
 * removed (in `previous` but not in the DOM).
 *
 * Returns the array of `Animation` objects so callers can `.finished`
 * them for tests; under reduced motion it returns an empty array.
 */
export function playFlip(
  container: Element | null | undefined,
  selector: string,
  previous: FlipSnapshot,
  options: { duration?: number; easing?: string; keyAttribute?: string } = {}
): Animation[] {
  if (!container) return [];
  if (prefersReducedMotion()) return [];

  const duration = options.duration ?? FLIP_DURATION_MS;
  const easing = options.easing ?? FLIP_EASING;
  const keyAttribute = options.keyAttribute ?? 'data-flip-key';

  const animations: Animation[] = [];
  const nodes = container.querySelectorAll(selector);
  nodes.forEach(node => {
    if (!(node instanceof HTMLElement)) return;
    const key = node.getAttribute(keyAttribute);
    if (!key) return;
    const before = previous.get(key);
    if (!before) return; // newly inserted element — skip (FLIP only animates moves)

    const after = node.getBoundingClientRect();
    const dx = before.left - after.left;
    const dy = before.top - after.top;
    // Short-circuit: nothing moved.
    if (dx === 0 && dy === 0) return;

    // The Web Animations API returns an Animation we can await.
    // `fill: 'none'` (default) lets the final state remain identity —
    // the element is already in its new position; we just re-show the
    // journey.
    if (typeof node.animate !== 'function') return;
    const animation = node.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      { duration, easing }
    );
    animations.push(animation);
  });
  return animations;
}
