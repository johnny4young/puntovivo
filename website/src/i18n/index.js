import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import es from './es.json';
import en from './en.json';

export const LANG_STORAGE_KEY = 'pv-lang';
export const SUPPORTED_LANGS = ['es', 'en'];
const DEFAULT_LANG = 'es';

function readStoredLang() {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY);
    if (stored && SUPPORTED_LANGS.includes(stored)) return stored;
  } catch {
    /* localStorage may be unavailable (private mode / SSR-like envs) */
  }
  return DEFAULT_LANG;
}

const initialLang = readStoredLang();

i18n.use(initReactI18next).init({
  resources: {
    es: { translation: es },
    en: { translation: en },
  },
  lng: initialLang,
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

// Keep <html lang> in sync with the active language for a11y / SEO.
if (typeof document !== 'undefined') {
  document.documentElement.lang = initialLang;
  i18n.on('languageChanged', lng => {
    document.documentElement.lang = lng;
    try {
      localStorage.setItem(LANG_STORAGE_KEY, lng);
    } catch {
      /* ignore persistence failures */
    }
  });
}

export default i18n;
