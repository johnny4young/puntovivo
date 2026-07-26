// Pins the two-prefix rule: the locale prefix belongs to the site, the deploy
// base belongs to the host, and every emitted href must carry both. The
// regression this guards is a bare "/sobre" shipping to the GitHub Pages
// sub-path deploy and 404-ing at the domain root.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assetHref, joinBase, localizedHref, sectionHref } from './paths.js';

test('joinBase collapses the slash between base and path', () => {
  assert.equal(joinBase('/puntovivo/', '/sobre'), '/puntovivo/sobre');
  assert.equal(joinBase('/puntovivo', '/sobre'), '/puntovivo/sobre');
  assert.equal(joinBase('/', '/sobre'), '/sobre');
  assert.equal(joinBase('/', '/'), '/');
});

test('the default locale keeps the bare route, other locales are prefixed', () => {
  assert.equal(localizedHref('/', 'es', '/sobre'), '/sobre');
  assert.equal(localizedHref('/', 'en', '/sobre'), '/en/sobre');
});

test('the deploy base stacks in front of the locale prefix', () => {
  assert.equal(localizedHref('/puntovivo/', 'es', '/sobre'), '/puntovivo/sobre');
  assert.equal(localizedHref('/puntovivo/', 'en', '/sobre'), '/puntovivo/en/sobre');
});

test('the landing resolves to the base itself, never to a bare slash', () => {
  assert.equal(localizedHref('/', 'es', '/'), '/');
  assert.equal(localizedHref('/puntovivo/', 'es', '/'), '/puntovivo/');
  assert.equal(localizedHref('/puntovivo/', 'en', '/'), '/puntovivo/en/');
});

test('section anchors target the localized landing plus the hash', () => {
  assert.equal(sectionHref('/', 'es', '#features'), '/#features');
  assert.equal(sectionHref('/', 'en', '#features'), '/en/#features');
  assert.equal(sectionHref('/puntovivo/', 'es', '#caja'), '/puntovivo/#caja');
  assert.equal(sectionHref('/puntovivo/', 'en', '#caja'), '/puntovivo/en/#caja');
});

test('root assets carry the deploy base but never a locale', () => {
  assert.equal(assetHref('/', '/favicon.svg'), '/favicon.svg');
  assert.equal(assetHref('/puntovivo/', '/favicon.svg'), '/puntovivo/favicon.svg');
});
