// Build-time i18n for the static site.
//
// The React build shipped i18next + react-i18next and swapped languages in the
// browser, which meant the English copy existed only after hydration and was
// invisible to crawlers. Astro renders one HTML file per locale instead, so
// translation happens entirely at build time and no i18n runtime is served.
//
// The locale JSON files are unchanged: same dotted keys, same values.

import es from './es.json';
import en from './en.json';
import { DEFAULT_LANG, LANG_STORAGE_KEY, SUPPORTED_LANGS } from './config.js';

export { DEFAULT_LANG, LANG_STORAGE_KEY, SUPPORTED_LANGS };

const RESOURCES = { es, en };

/** Walk a dotted path ("footer.productLinks") through a plain object. */
function lookup(bundle, key) {
  let node = bundle;
  for (const part of key.split('.')) {
    if (node === null || typeof node !== 'object' || !(part in node)) return undefined;
    node = node[part];
  }
  return node;
}

/** Replace {{name}} placeholders. Values are inserted verbatim, as before. */
function interpolate(value, vars) {
  if (typeof value !== 'string' || !vars) return value;
  return value.replace(/\{\{(\w+)\}\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole
  );
}

/**
 * Translator bound to one locale. A missing key falls back to the default
 * language and then throws: a marketing page that silently renders a raw key
 * is a defect that ships looking like copy.
 *
 * Arrays come back as arrays (the old `returnObjects: true` call sites), and
 * objects come back untouched for callers that walk them.
 */
export function useTranslations(lang) {
  const primary = RESOURCES[lang] ?? RESOURCES[DEFAULT_LANG];
  const fallback = RESOURCES[DEFAULT_LANG];

  return function t(key, vars) {
    let value = lookup(primary, key);
    if (value === undefined) value = lookup(fallback, key);
    if (value === undefined) {
      throw new Error(`i18n: missing key "${key}" for locale "${lang}".`);
    }
    if (Array.isArray(value)) return value.map(item => interpolate(item, vars));
    return interpolate(value, vars);
  };
}

/** True when `lang` is one we actually build. */
export function isSupportedLang(lang) {
  return SUPPORTED_LANGS.includes(lang);
}

export { es, en };
