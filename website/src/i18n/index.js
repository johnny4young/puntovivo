import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import es from './es.json';
import en from './en.json';

export const LANG_STORAGE_KEY = 'pv-lang';
export const SUPPORTED_LANGS = ['es', 'en'];
export const DEFAULT_LANG = 'es';

// i18n is initialised in the DEFAULT language unconditionally. This is the SSR
// default, and the client's first paint must match it exactly to hydrate
// without a text mismatch — so we deliberately do NOT read localStorage at
// init time. The stored language is applied AFTER hydration via
// restoreStoredLanguage() (called from a mount effect in AppShell), at which
// point react-i18next re-renders the tree into the user's language.
i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
  },
  lng: DEFAULT_LANG,
  fallbackLng: DEFAULT_LANG,
  supportedLngs: SUPPORTED_LANGS,
  interpolation: {
    // We render brand strings ourselves and never inject user input, so
    // disabling HTML escaping keeps interpolated values (e.g. the version
    // tag) verbatim. Rich-text answers are handled via <Trans>, not raw HTML.
    escapeValue: false,
  },
  returnObjects: true,
});

// Keep <html lang> in sync with the active language for a11y / SEO, and persist
// language changes. Guarded for SSR (no document on the server).
if (typeof document !== 'undefined') {
  document.documentElement.lang = i18n.language;
  i18n.on('languageChanged', lng => {
    document.documentElement.lang = lng;
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lng);
    } catch {
      /* ignore persistence failures */
    }
  });
}

/**
 * Read the user's stored language preference and switch to it. Call this once
 * on the client AFTER hydration (never during SSR or first paint) so the
 * server-rendered Spanish markup hydrates cleanly before any language swap.
 * No-op when the stored language is missing, unsupported, or already active.
 */
export function restoreStoredLanguage() {
  let stored;
  try {
    stored = localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    /* localStorage may be unavailable (private mode) */
    return;
  }
  if (stored && SUPPORTED_LANGS.includes(stored) && stored !== i18n.language) {
    i18n.changeLanguage(stored);
  }
}

export default i18n;
