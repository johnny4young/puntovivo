// Locale constants, deliberately free of any JSON import.
//
// routeMeta.js and the node --test suite both need these, and a plain Node ESM
// run cannot `import` a .json file without an import attribute — keeping the
// constants here lets the tests load them without dragging in the 1300-key
// locale bundles that only the Astro build needs.

export const LANG_STORAGE_KEY = 'pv-lang';
export const SUPPORTED_LANGS = ['es', 'en'];
export const DEFAULT_LANG = 'es';
