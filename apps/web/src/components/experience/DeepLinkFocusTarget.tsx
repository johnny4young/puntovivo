import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface DeepLinkFocusTargetProps {
  active: boolean;
  children: ReactNode;
  id: string;
  label: string;
  testId: string;
}

const ALIGNMENT_WATCH_MS = 4_000;
const VIEWPORT_TOP_GUTTER_PX = 96;
const VIEWPORT_BOTTOM_GUTTER_PX = 24;

/**
 * Turns a broad route into an accessible handoff to one exact surface.
 *
 * The target stays out of the sequential tab order, but receives focus when a
 * trusted in-app deep link names it. This gives keyboard and screen-reader
 * users the same destination context as the visual scroll.
 */
export function DeepLinkFocusTarget({
  active,
  children,
  id,
  label,
  testId,
}: DeepLinkFocusTargetProps): React.ReactElement {
  const targetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active || !targetRef.current) return;

    const target = targetRef.current;
    const alignTarget = (force = false): void => {
      const rect = target.getBoundingClientRect();
      const isFullyFramed =
        rect.top >= VIEWPORT_TOP_GUTTER_PX &&
        rect.bottom <= window.innerHeight - VIEWPORT_BOTTOM_GUTTER_PX;

      if ((force || !isFullyFramed) && typeof target.scrollIntoView === 'function') {
        target.scrollIntoView({ block: 'start' });
      }
    };

    alignTarget(true);
    target.focus({ preventScroll: true });

    // A lazy route can commit the target before Chromium has completed its
    // first layout for the newly selected tab. In that window the synchronous
    // scrollIntoView call is allowed to be a no-op and no resize necessarily
    // follows. Force one more alignment on the first painted frame.
    const firstPaintFrame = window.requestAnimationFrame(() => alignTarget(true));

    if (typeof ResizeObserver === 'undefined') {
      return () => window.cancelAnimationFrame(firstPaintFrame);
    }

    // Lazy siblings above a handoff can resolve after the first paint and move
    // the focused target back outside the viewport. Observe the full ancestor
    // chain: watching only the target's immediate card misses growth in a
    // preceding sibling elsewhere in the tab panel.
    const observer = new ResizeObserver(() => alignTarget());
    let containingElement: HTMLElement | null = target;
    while (containingElement) {
      observer.observe(containingElement);
      containingElement = containingElement.parentElement;
    }
    const stopWatching = window.setTimeout(() => observer.disconnect(), ALIGNMENT_WATCH_MS);

    return () => {
      window.cancelAnimationFrame(firstPaintFrame);
      window.clearTimeout(stopWatching);
      observer.disconnect();
    };
  }, [active]);

  return (
    <div
      ref={targetRef}
      id={id}
      role="region"
      aria-label={label}
      tabIndex={-1}
      data-testid={testId}
      className={cn(
        'scroll-mt-24 rounded-2xl outline-none transition-shadow',
        'focus:ring-2 focus:ring-primary-400/80 focus:ring-offset-4'
      )}
    >
      {children}
    </div>
  );
}
