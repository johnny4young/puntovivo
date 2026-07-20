import { describe, it, expect } from 'vitest';
import i18next, { BOOTSTRAP_NAMESPACES } from './index';

/**
 * pins the lazy-i18n bootstrap contract.
 *
 * Production lazy-loads every non-bootstrap namespace through the
 * resourcesToBackend glob loader, so only the bootstrap set is preloaded /
 * statically inlined into the entry chunk. The test environment eager-loads
 * EVERY namespace (see `src/test/setup.ts`) so unit tests can assert strings
 * synchronously — which means the live i18next store / `options.resources`
 * are polluted and cannot prove the static-bundle contract here. These
 * assertions therefore pin the env-independent facts: the bootstrap CONSTANT
 * (which is the `ns` preload list), the lazy mechanism flag, and on-demand
 * resolvability. The "entry no longer ships fiscal/kds/aiSettings" claim is a
 * build-graph fact verified by the bundle gate + the live smoke.
 */
describe(' — i18n lazy bootstrap contract', () => {
  it('declares exactly the audited bootstrap namespace set', () => {
    expect([...BOOTSTRAP_NAMESPACES].sort()).toEqual(
      ['auth', 'common', 'errors', 'nav', 'palette', 'setup', 'workspaces'].sort()
    );
  });

  it('keeps the heavy feature namespaces OUT of the bootstrap (they lazy-load)', () => {
    for (const ns of [
      'fiscal',
      'kds',
      'aiSettings',
      'restaurants',
      'copilot',
      'sales',
      'products',
    ]) {
      expect(BOOTSTRAP_NAMESPACES).not.toContain(ns);
    }
  });

  it('bootstrap is a strict subset of the on-disk namespaces', () => {
    const files = import.meta.glob('./locales/en/*.json', { eager: true });
    const onDisk = Object.keys(files)
      .map(path => /\/([^/]+)\.json$/.exec(path)?.[1])
      .filter((ns): ns is string => typeof ns === 'string');
    for (const ns of BOOTSTRAP_NAMESPACES) {
      expect(onDisk).toContain(ns);
    }
    // Materially more namespaces exist than the bootstrap set, so the
    // majority load lazily rather than at startup.
    expect(onDisk.length).toBeGreaterThan(BOOTSTRAP_NAMESPACES.length);
  });

  it('enables partial-bundled languages so lazy namespaces resolve via the backend', () => {
    expect(i18next.options.partialBundledLanguages).toBe(true);
  });

  it('keeps a feature namespace resolvable on demand (no raw keys)', async () => {
    await i18next.loadNamespaces('fiscal');
    const resolved =
      i18next.hasResourceBundle('es', 'fiscal') || i18next.hasResourceBundle('en', 'fiscal');
    expect(resolved).toBe(true);
  });
});
