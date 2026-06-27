import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Router glue for anchor + route scroll behavior:
//  - On a plain route change (no #hash) scroll to the top, so navigating from a
//    deep secondary page to another page doesn't land mid-scroll.
//  - When the URL carries a #hash (e.g. landing arrived via /#features) wait a
//    tick for the target section to mount, then scroll it into view.
export function ScrollToHash() {
  const { pathname, hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const id = hash.slice(1);
      // Defer until the lazy route has painted its sections.
      const raf = requestAnimationFrame(() => {
        const el = document.getElementById(id);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      return () => cancelAnimationFrame(raf);
    }
    window.scrollTo({ top: 0, left: 0 });
    return undefined;
  }, [pathname, hash]);

  return null;
}
