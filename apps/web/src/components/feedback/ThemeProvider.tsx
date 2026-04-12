import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  isLoading: boolean;
  setPreference: (preference: ThemePreference) => Promise<void>;
}

const THEME_STORAGE_KEY = 'puntovivo-theme-preference';
const defaultPreference: ThemePreference = 'system';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

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
  const [isLoading, setIsLoading] = useState(() =>
    typeof window !== 'undefined' && Boolean(window.electron)
  );
  const resolvedTheme = preference === 'system' ? systemTheme : preference;

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  useEffect(() => {
    if (!window.electron) {
      return;
    }

    let isMounted = true;

    void window.electron
      .getThemePreference()
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
    setThemePreference(nextPreference);
    persistThemePreference(nextPreference);

    if (window.electron) {
      await window.electron.updateThemePreference(nextPreference);
    }
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

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }

  return context;
}
