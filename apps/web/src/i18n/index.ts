import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import { readLanguagePreference, resolveLocale, toSupportedAppLocale } from './resolveLocale';

// ENG-170b — Bootstrap namespaces are bundled at build time (static
// imports below) so login + the always-mounted shell render synchronously
// and offline. Every OTHER namespace lazy-loads on first use through the
// resourcesToBackend glob loader, so the entry chunk no longer carries
// fiscal / kds / aiSettings / restaurants / copilot / … strings.
import enCommon from './locales/en/common.json';
import enAuth from './locales/en/auth.json';
import enNav from './locales/en/nav.json';
import enErrors from './locales/en/errors.json';
import enWorkspaces from './locales/en/workspaces.json';
import enSetup from './locales/en/setup.json';
import enPalette from './locales/en/palette.json';

import esCommon from './locales/es/common.json';
import esAuth from './locales/es/auth.json';
import esNav from './locales/es/nav.json';
import esErrors from './locales/es/errors.json';
import esWorkspaces from './locales/es/workspaces.json';
import esSetup from './locales/es/setup.json';
import esPalette from './locales/es/palette.json';

/**
 * Namespaces eagerly bundled into the entry chunk and available
 * synchronously at startup.
 *
 * The set is intentionally limited to namespaces consumed by components
 * that render OUTSIDE a route-level `<Suspense>` boundary — i.e. the
 * persistent app shell plus the error boundary, none of which has a
 * suspense fallback of its own:
 *   - common      — Header, GlobalStatusStrip, ToastProvider, WhatsNewOverlay, route fallbacks
 *   - auth        — Header, ProtectedRoute, login route fallback
 *   - nav         — Sidebar, Header
 *   - errors      — AppErrorBoundary (an error boundary must never suspend)
 *   - workspaces  — Sidebar workspace groups
 *   - setup       — GlobalStatusStrip onboarding banner
 *   - palette     — Command palette (triggerable from any screen)
 *
 * Invariant: adding a non-bootstrap `useTranslation()` to always-mounted
 * chrome requires adding that namespace here. The root `<Suspense>` in
 * `main.tsx` is the safety net if one is ever missed — a missed namespace
 * degrades to a brief fallback instead of an unbounded suspend.
 */
export const BOOTSTRAP_NAMESPACES = [
  'common',
  'auth',
  'nav',
  'errors',
  'workspaces',
  'setup',
  'palette',
] as const;

/**
 * Non-eager Vite glob over the lazy (non-bootstrap) namespace files. Each
 * entry is a `() => Promise<module>` that Vite emits as its own relative
 * dynamic-import chunk — which loads fine over `file://` in the packaged
 * Electron renderer (unlike i18next-http-backend, which needs an HTTP
 * server). The bootstrap files are excluded so they live ONLY in the entry
 * (static imports above), never double-bundled as a lazy chunk.
 */
const lazyNamespaceModules = import.meta.glob<{ default: Record<string, unknown> }>([
  './locales/{en,es}/*.json',
  '!./locales/{en,es}/{common,auth,nav,errors,workspaces,setup,palette}.json',
]);

const preference = readLanguagePreference();
const lng = resolveLocale(preference);

function syncDocumentLanguage(language: string) {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.lang = language;
}

function syncElectronMainLocale(language: string) {
  if (typeof window === 'undefined') {
    return;
  }

  void window.electron?.updateMainLocale?.(toSupportedAppLocale(language));
}

void i18next
  // ENG-170b — lazy backend for every non-bootstrap namespace. Resolves a
  // regional tag (es-CO) to its base locale file (es); rejects when no
  // bundled file matches so i18next walks the fallback chain (es-CO → es →
  // en) instead of caching an empty bundle.
  .use(
    resourcesToBackend(
      (
        language: string,
        namespace: string,
        callback: (error: Error | null, resources: Record<string, unknown> | null) => void
      ) => {
        const baseLanguage = language.split('-')[0] ?? language;
        const loader =
          lazyNamespaceModules[`./locales/${language}/${namespace}.json`] ??
          lazyNamespaceModules[`./locales/${baseLanguage}/${namespace}.json`];

        if (!loader) {
          callback(new Error(`i18n: no bundled namespace ${language}/${namespace}`), null);
          return;
        }

        loader()
          .then(module => callback(null, module.default))
          .catch((error: unknown) =>
            callback(error instanceof Error ? error : new Error(String(error)), null)
          );
      }
    )
  )
  .use(initReactI18next)
  .init({
    lng,
    // Fallback chain: es-CO → es → en
    // i18next resolves regional tags automatically: "es-CO" falls back to "es" then "en"
    fallbackLng: {
      'es-CO': ['es', 'en'],
      'es-MX': ['es', 'en'],
      'es-AR': ['es', 'en'],
      es: ['en'],
      default: ['en'],
    },
    defaultNS: 'common',
    // Only the bootstrap namespaces are preloaded; everything else loads on
    // demand via the backend above.
    ns: [...BOOTSTRAP_NAMESPACES],
    // Required so i18next still queries the backend for namespaces that are
    // absent from the inline `resources` (the lazy ones).
    partialBundledLanguages: true,
    resources: {
      en: {
        common: enCommon,
        auth: enAuth,
        nav: enNav,
        errors: enErrors,
        workspaces: enWorkspaces,
        setup: enSetup,
        palette: enPalette,
      },
      es: {
        common: esCommon,
        auth: esAuth,
        nav: esNav,
        errors: esErrors,
        workspaces: esWorkspaces,
        setup: esSetup,
        palette: esPalette,
      },
    },
    interpolation: {
      // React already escapes values — disable double-escaping
      escapeValue: false,
    },
    react: {
      // Feature namespaces suspend on first use until their chunk loads;
      // the route-level <Suspense> boundaries in App.tsx catch them.
      useSuspense: true,
    },
  });

syncDocumentLanguage(lng);
syncElectronMainLocale(lng);
i18next.on('languageChanged', syncDocumentLanguage);
i18next.on('languageChanged', syncElectronMainLocale);

export default i18next;
