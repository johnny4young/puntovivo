export type LanguagePreference = 'system' | 'en' | 'es';
const LANGUAGE_STORAGE_KEY = 'puntovivo-language-preference';
const DEFAULT_LANGUAGE = 'en';
export type SupportedAppLocale = 'en' | 'es';

/**
 * Resolves the active language from the user preference or browser/OS language.
 * Returns a language code compatible with i18next fallback chain: es-CO → es → en.
 */
export function resolveLocale(preference: LanguagePreference): string {
  if (preference !== 'system') return preference;

  if (typeof navigator === 'undefined') {
    return DEFAULT_LANGUAGE;
  }

  // navigator is available in both browser and Electron renderer
  const browserLang = navigator.languages?.[0] ?? navigator.language ?? DEFAULT_LANGUAGE;

  // Keep regional variants (es-CO, es-MX) so i18next fallback chain works:
  // es-CO → es → en
  return typeof browserLang === 'string' && browserLang.length > 0 ? browserLang : DEFAULT_LANGUAGE;
}

/**
 * Collapse any resolved locale tag into the set supported by the Electron main
 * process resources.
 */
export function toSupportedAppLocale(locale: string | null | undefined): SupportedAppLocale {
  return typeof locale === 'string' && locale.toLowerCase().startsWith('es') ? 'es' : 'en';
}

function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'system' || value === 'en' || value === 'es';
}

export function readLanguagePreference(): LanguagePreference {
  if (typeof window === 'undefined') return 'system';

  try {
    const storage = window.localStorage;
    if (!storage || typeof storage.getItem !== 'function') {
      return 'system';
    }

    const stored = storage.getItem(LANGUAGE_STORAGE_KEY);
    return isLanguagePreference(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function persistLanguagePreference(preference: LanguagePreference): void {
  if (typeof window === 'undefined') return;

  try {
    const storage = window.localStorage;
    if (!storage || typeof storage.setItem !== 'function') {
      return;
    }

    storage.setItem(LANGUAGE_STORAGE_KEY, preference);
  } catch {
    // Ignore storage write failures (private mode, disabled storage, or test stubs).
  }
}
