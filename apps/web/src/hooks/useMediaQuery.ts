import { useSyncExternalStore } from 'react';

// One list per query, so a snapshot read is a property access; rebuilt when matchMedia is replaced.
let source: typeof window.matchMedia | null = null;
const lists = new Map<string, MediaQueryList>();

function mediaList(query: string): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  if (source !== window.matchMedia) {
    source = window.matchMedia;
    lists.clear();
  }
  let list = lists.get(query);
  if (!list) {
    list = window.matchMedia(query);
    lists.set(query, list);
  }
  return list;
}

/** Live `matchMedia` result; `fallback` applies where there is no window or matchMedia. */
export function useMediaQuery(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    onChange => {
      const list = mediaList(query);
      list?.addEventListener('change', onChange);
      return () => list?.removeEventListener('change', onChange);
    },
    () => mediaList(query)?.matches ?? fallback,
    () => fallback
  );
}
