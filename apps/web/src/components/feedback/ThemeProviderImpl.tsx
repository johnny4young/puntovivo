import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ThemeContext,
  type ResolvedTheme,
  type ThemeContextValue,
  type ThemePreference,
} from './ThemeContext';

const THEME_STORAGE_KEY = 'puntovivo-theme-preference';
const defaultPreference: ThemePreference = 'system';

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') {
    return defaultPreference;
  }

  const storedPreference = window.localStorage.getItem(THEME_STORAGE_KEY);
  return isThemePreference(storedPreference) ? storedPreference : defaultPreference;
}

function persistThemePreference(preference: ThemePreference) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(THEME_STORAGE_KEY, preference);
}

interface ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [preference, setThemePreference] = useState<ThemePreference>(() => readStoredPreference());
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => getSystemTheme());
  const [isLoading, setIsLoading] = useState(
    () => typeof window !== 'undefined' && typeof window.electron?.getThemePreference === 'function'
  );
  const resolvedTheme = preference === 'system' ? systemTheme : preference;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    const getThemePreference = window.electron?.getThemePreference;
    if (typeof getThemePreference !== 'function') {
      return;
    }

    let isMounted = true;

    void getThemePreference()
      .then(nextPreference => {
        if (!isMounted) {
          return;
        }

        setThemePreference(nextPreference);
        persistThemePreference(nextPreference);
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (preference !== 'system') {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      setSystemTheme(getSystemTheme());
    };

    mediaQuery.addEventListener('change', handleChange);

    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, [preference]);

  const setPreference = useCallback(async (nextPreference: ThemePreference) => {
    // Persist through the session-gated desktop channel FIRST: if main
    // rejects (no registered session), nothing was committed locally, so
    // localStorage and app_settings cannot diverge until the next launch.
    const updateThemePreference = window.electron?.updateThemePreference;
    if (typeof updateThemePreference === 'function') {
      await updateThemePreference(nextPreference);
    }

    setThemePreference(nextPreference);
    persistThemePreference(nextPreference);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolvedTheme,
      isLoading,
      setPreference,
    }),
    [isLoading, preference, resolvedTheme, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
