import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import test from 'node:test';
import { matchesSearch, normalizeSearch } from './manualSearch.js';

const locales = Object.fromEntries(
  ['es', 'en'].map(lang => [
    lang,
    JSON.parse(readFileSync(new URL(`../content/manual/${lang}.json`, import.meta.url), 'utf8')),
  ])
);
const ids = [
  'start',
  'setup',
  'profiles',
  'products',
  'inventory',
  'purchasing',
  'cash',
  'sales',
  'returns',
  'users',
  'printing',
  'backup',
  'optional',
  'faq',
];

function shape(value) {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, shape(value[key])])
    );
  return typeof value;
}

test('manual has full EN/ES task and UI parity without fallback', () => {
  assert.deepEqual(shape(locales.en), shape(locales.es));
  for (const [lang, { ui, tasks }] of Object.entries(locales)) {
    assert.deepEqual(
      tasks.map(task => task.id),
      ids
    );
    assert.ok(ui.results.includes('{count}'));
    assert.equal(tasks.find(task => task.id === 'profiles').details.length, 7);
    for (const task of tasks) {
      assert.ok(task.steps.length >= 5, `${lang} ${task.id} needs operational steps`);
      assert.ok(existsSync(new URL(`../../../${task.source}`, import.meta.url)), task.source);
      assert.ok(task.check.length > 40, `${lang} ${task.id} needs its limits`);
      for (const target of task.related)
        assert.ok(ids.includes(target), `${task.id} links to ${target}`);
      assert.notEqual(
        task.title,
        locales[lang === 'es' ? 'en' : 'es'].tasks.find(other => other.id === task.id).title
      );
    }
  }
});

test('manual search handles accents, multiple terms, whitespace and literal punctuation', () => {
  assert.equal(normalizeSearch('  Configuración  '), 'configuracion');
  assert.ok(matchesSearch('Configuración de impresión y caja', 'CAJA impresion'));
  assert.ok(matchesSearch('Café', 'cafe'));
  assert.ok(matchesSearch('Open register', ' \t '));
  assert.ok(!matchesSearch('Open register', 'register backup'));
  assert.ok(matchesSearch('ESC/POS (TCP)', '(TCP)'));
  assert.ok(!matchesSearch('Open register', '<script>'));
});
