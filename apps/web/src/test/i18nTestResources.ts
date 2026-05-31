import i18next from '@/i18n';

/**
 * ENG-170b — test-only synchronous priming of every i18n namespace.
 *
 * Production lazy-loads each non-bootstrap namespace through the
 * resourcesToBackend glob loader, but unit tests assert translated strings
 * synchronously and never await a namespace load. This eager glob lives ONLY
 * under `src/test` (never reachable from the `main.tsx` entry, so never part
 * of the production graph) — it cannot defeat the lazy-loading it stands in
 * for.
 *
 * Call once from the global test setup. Also call it again after a
 * `vi.resetModules()` block that re-imports a component tree: `resetModules`
 * rebuilds the `@/i18n` singleton with only the bootstrap namespaces inlined,
 * so the fresh instance must be re-primed before the re-imported component
 * renders or its `useTranslation('<feature-ns>')` suspends with no boundary.
 */
export function registerAllNamespacesForTest(): void {
  const resources = import.meta.glob<Record<string, unknown>>(
    '../i18n/locales/{en,es}/*.json',
    { eager: true, import: 'default' }
  );
  for (const [filePath, resource] of Object.entries(resources)) {
    const match = /\/locales\/(en|es)\/([^/]+)\.json$/.exec(filePath);
    if (!match) continue;
    const [, language, namespace] = match;
    if (!language || !namespace) continue;
    i18next.addResourceBundle(language, namespace, resource, true, true);
  }
}
