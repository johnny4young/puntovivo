import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const THEME_STORAGE_KEY = 'pv-theme';
const ThemeContext = createContext(null);

// The SSR default. The server has no localStorage / matchMedia, so it always
// renders light; the client's FIRST paint must match that exactly to hydrate
// without a mismatch (the theme toggle's Sun/Moon icon is theme-derived markup).
// The real stored/system preference is applied in a post-mount effect below, and
// the anti-FOUC inline script in index.html has already put the right .dark class
// on <html> before paint, so a dark-mode user sees no flash.
const SSR_THEME = 'light';

function readPreferredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* localStorage may be unavailable */
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return SSR_THEME;
}

export function ThemeProvider({ children }) {
  // Start at the SSR default so server markup === client first paint. The effect
  // below reconciles to the user's actual preference right after hydration.
  const [theme, setTheme] = useState(SSR_THEME);

  // On mount, adopt the stored/system theme. Runs once; subsequent toggles are
  // driven by setTheme. Splitting "read preference" (mount-only) from "reflect
  // theme" (every change) keeps the first client render deterministic.
  useEffect(() => {
    setTheme(readPreferredTheme());
  }, []);

  // Reflect the active theme onto <html> so the `.dark` token block applies, and
  // persist it. The anti-FOUC script set the initial class pre-hydration; this
  // keeps it in sync once React owns the value.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* ignore persistence failures */
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
