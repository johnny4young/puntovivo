export type LanguagePreference = 'system' | 'en' | 'es';
const LANGUAGE_STORAGE_KEY = 'puntovivo-language-preference';
/**
 * Last language the tenant resolved to on this device. Distinct from the
 * preference key above: that one holds what the USER pinned, this one
 * caches what the SERVER answered, and the user's choice always wins.
 */
const TENANT_LANGUAGE_STORAGE_KEY = 'puntovivo-tenant-language';
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

function readStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;

  try {
    const storage = window.localStorage;
    if (!storage || typeof storage.getItem !== 'function') {
      return null;
    }
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function isLanguagePreference(value: unknown): value is LanguagePreference {
  return value === 'system' || value === 'en' || value === 'es';
}

export function readLanguagePreference(): LanguagePreference {
  const stored = readStorage(LANGUAGE_STORAGE_KEY);
  return isLanguagePreference(stored) ? stored : 'system';
}

/**
 * Language the tenant resolved to the last time this device completed a
 * session, or null when the device has never seen one.
 */
export function readTenantLanguage(): SupportedAppLocale | null {
  const stored = readStorage(TENANT_LANGUAGE_STORAGE_KEY);
  return stored === 'en' || stored === 'es' ? stored : null;
}

/**
 * Remember the tenant language so the NEXT boot paints it on the first
 * frame. Without this cache a shop whose workstation runs an English OS
 * but whose tenant resolves to Spanish boots English, and the language
 * swap that lands with `tenantLocale.get` re-renders the whole tree and
 * reflows every string that wraps differently — a visible jump on every
 * single launch. Survives logout on purpose: the next operator on a POS
 * terminal is overwhelmingly the same shop, and a wrong guess costs one
 * corrected frame on the following boot instead of one on every boot.
 */
export function persistTenantLanguage(language: string | null | undefined): void {
  if (typeof window === 'undefined') return;

  try {
    const storage = window.localStorage;
    if (!storage || typeof storage.setItem !== 'function') {
      return;
    }
    storage.setItem(TENANT_LANGUAGE_STORAGE_KEY, toSupportedAppLocale(language));
  } catch {
    // Ignore storage write failures (private mode, disabled storage, or test stubs).
  }
}

/**
 * Language the app must BOOT in, in precedence order: what the user
 * pinned, then the tenant language this device last saw, then the OS /
 * browser language. Only the first two are stable across boots, which is
 * exactly why the cached tenant language sits above `navigator`.
 */
export function resolveBootLocale(): string {
  const preference = readLanguagePreference();
  if (preference !== 'system') return preference;
  return readTenantLanguage() ?? resolveLocale('system');
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
