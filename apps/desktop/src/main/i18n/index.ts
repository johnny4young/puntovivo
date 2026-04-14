import en from './locales/en.json';
import es from './locales/es.json';

export type MainLocale = 'en' | 'es';

type Resource = typeof en;

const resources: Record<MainLocale, Resource> = { en, es };

let currentLocale: MainLocale = 'en';

type Primitive = string | number | boolean;

type PathsOf<T, Prefix extends string = ''> = {
  [K in keyof T & string]: T[K] extends Primitive
    ? `${Prefix}${K}`
    : T[K] extends object
      ? PathsOf<T[K], `${Prefix}${K}.`>
      : never;
}[keyof T & string];

export type MainTranslationKey = PathsOf<Resource>;

/**
 * Normalize any BCP-47 tag ("en-US", "es-CO", "es") into one of the supported
 * main-process locales. Unknown tags fall back to English.
 */
export function normalizeMainLocale(tag: string | null | undefined): MainLocale {
  if (!tag) return 'en';
  const primary = tag.toLowerCase().split(/[-_]/, 1)[0];
  return primary === 'es' ? 'es' : 'en';
}

export function setMainLocale(locale: MainLocale): void {
  currentLocale = locale;
}

export function getMainLocale(): MainLocale {
  return currentLocale;
}

function resolveKey(locale: MainLocale, key: string): string | undefined {
  const segments = key.split('.');
  let cursor: unknown = resources[locale];
  for (const segment of segments) {
    if (cursor && typeof cursor === 'object' && segment in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return typeof cursor === 'string' ? cursor : undefined;
}

function interpolate(template: string, vars: Record<string, Primitive> | undefined): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
    const value = vars[name];
    return value === undefined ? `{{${name}}}` : String(value);
  });
}

/**
 * Translate a key for the current main-process locale with {{var}} interpolation.
 * Falls back to English, then to the key itself, so missing translations never
 * crash the process.
 */
export function t(key: MainTranslationKey, vars?: Record<string, Primitive>): string {
  const template = resolveKey(currentLocale, key) ?? resolveKey('en', key) ?? key;
  return interpolate(template, vars);
}
