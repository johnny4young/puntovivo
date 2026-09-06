import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import viteWebConfig from '../apps/web/vite.config.ts';
import { SALES_INITIAL_NAMESPACES } from '../apps/web/src/features/sales/salesInitialNamespaces.ts';

const config = viteWebConfig({
  command: 'build',
  isPreview: false,
  isSsrBuild: false,
  mode: 'production',
});
const output = config.build.rolldownOptions.output;
const dataGroup = output.codeSplitting.groups.find(group => typeof group.name === 'function');
const groupName = dataGroup.name;

test('web chunks use native Rolldown grouping without recursive dependency overrides', () => {
  assert.equal(config.build.rollupOptions, undefined);
  assert.equal(output.manualChunks, undefined);
  assert.equal(output.codeSplitting.includeDependenciesRecursively, undefined);
  assert.equal(dataGroup.includeDependenciesRecursively, undefined);
});

test('the shared Vite loader is claimed before any lazy vendor dependencies', () => {
  const helper = output.codeSplitting.groups.find(group => group.name === 'preload-runtime');
  assert.equal(helper.test('\0vite/preload-helper.js'), true);
  assert.equal(helper.test('/repo/src/preload-helper.js'), false);
  assert.ok(helper.priority > (dataGroup.priority ?? 0));
});

test('Table and its private stores are separate from the eager query and virtualizer runtime', () => {
  for (const separator of ['/', '\\']) {
    for (const prefix of [
      '/repo/node_modules/',
      '/repo/node_modules/.pnpm/example/node_modules/',
    ]) {
      for (const name of ['react-table', 'table-core', 'react-store', 'store']) {
        const id = `${prefix}@tanstack/${name}/dist/index.js`.replaceAll('/', separator);
        assert.equal(groupName(id), 'table-runtime', id);
      }
      for (const name of [
        '@tanstack/react-query',
        '@tanstack/query-core',
        '@tanstack/react-virtual',
        '@tanstack/virtual-core',
        '@trpc/client',
        '@trpc/react-query',
      ]) {
        const id = `${prefix}${name}/dist/index.js`.replaceAll('/', separator);
        assert.equal(groupName(id), 'data-runtime', id);
      }
    }
  }
  assert.equal(groupName('/repo/src/table-core/example.ts'), undefined);
  assert.equal(
    groupName('/repo/node_modules/@tanstack/react-table-extra/index.js'),
    'data-runtime'
  );
});

test('split data vendor budgets retain the previous combined ceiling and tolerance', () => {
  const budget = JSON.parse(readFileSync(new URL('../perf-budget.json', import.meta.url), 'utf8'));
  assert.equal(budget.bundleSize.thresholdPercent, 5);
  const limits = budget.bundleSize.perChunkGzKb;
  assert.ok(limits['data-runtime'] > 0);
  assert.ok(limits['table-runtime'] > 0);
  assert.ok(limits['data-runtime'] + limits['table-runtime'] <= 54);
});

// Read the artifact actually built by ci:web, rather than equating a chunk's name
// with lazy loading. Only static import edges affect first paint; dynamic imports
// stay available for interactions and are verified separately below.
test('the production shell and initial POS do not statically load the Table registry', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../apps/web/dist/.vite/manifest.json', import.meta.url), 'utf8')
  );
  const tables = Object.keys(manifest).filter(key => /^_table-runtime-/.test(key));
  assert.equal(tables.length, 1, 'the qualified artifact must contain the Table runtime');
  const tableKey = tables[0];
  const pdfs = Object.keys(manifest).filter(key => /^_pdf-/.test(key));
  assert.equal(pdfs.length, 1, 'PDF export must remain in the qualified artifact');
  const pdfKey = pdfs[0];
  const closure = entry => {
    const visited = new Set();
    const visit = key => {
      assert.ok(Object.hasOwn(manifest, key), `missing manifest entry ${key}`);
      if (visited.has(key)) return;
      visited.add(key);
      for (const dependency of manifest[key].imports ?? []) visit(dependency);
    };
    visit(entry);
    return visited;
  };
  for (const entry of ['index.html', 'src/features/sales/SalesPage.tsx']) {
    assert.equal(closure(entry).has(tableKey), false, `${entry} must not eagerly load tables`);
    assert.equal(closure(entry).has(pdfKey), false, `${entry} must not eagerly load PDF`);
  }
  assert.equal(
    closure('src/features/sales/SalesHistoryDrawerContent.tsx').has(tableKey),
    true,
    'opening history must still load its full Table implementation'
  );
});

test('only the initial POS support dictionaries share each language chunk', () => {
  for (const separator of ['/', '\\']) {
    for (const language of ['en', 'es']) {
      for (const namespace of SALES_INITIAL_NAMESPACES) {
        const id = `/repo/apps/web/src/i18n/locales/${language}/${namespace}.json`.replaceAll(
          '/',
          separator
        );
        assert.equal(
          groupName(id),
          namespace === 'sales' ? undefined : `sales-support-${language}`
        );
      }
      for (const namespace of [
        'common',
        'auth',
        'errors',
        'fiscal',
        'settings',
        'customersExtra',
      ]) {
        const id = `/repo/apps/web/src/i18n/locales/${language}/${namespace}.json`.replaceAll(
          '/',
          separator
        );
        assert.notEqual(groupName(id), `sales-support-${language}`);
      }
    }
  }
  assert.equal(groupName('/repo/apps/web/src/i18n/locales/fr/customers.json'), undefined);
});

test('POS support copy remains dynamic and language-separated in the built artifact', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../apps/web/dist/.vite/manifest.json', import.meta.url), 'utf8')
  );
  const support = new Set(
    Object.values(manifest)
      .filter(row => /sales-support-(en|es)-/.test(row.file))
      .map(row => row.file)
  );
  assert.equal(support.size, 2);
  const visited = new Set();
  function visit(key) {
    assert.ok(manifest[key], key);
    if (visited.has(key)) return;
    visited.add(key);
    assert.equal(support.has(manifest[key].file), false, `eager copy at ${key}`);
    for (const dependency of manifest[key].imports ?? []) visit(dependency);
  }
  visit('index.html');
  visit('src/features/sales/SalesPage.tsx');
  for (const language of ['en', 'es']) {
    const entry = Object.entries(manifest).find(
      ([, row]) => row.name === `sales-support-${language}`
    );
    assert.ok(entry, language);
    const [key, row] = entry;
    assert.ok(
      Object.values(manifest).some(source => source.dynamicImports?.includes(key)),
      `${language} support must remain reachable via dynamic import`
    );
    for (const imported of row.imports ?? []) {
      assert.equal(
        support.has(manifest[imported].file),
        false,
        'languages must not import each other'
      );
    }
  }
});
