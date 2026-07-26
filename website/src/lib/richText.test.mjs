// The React version built trusted React nodes, so copy could never inject
// markup. The Astro version inserts a string as HTML instead, which makes the
// escaping the load-bearing part — that is what these pin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRichText } from './richText.js';

test('plain copy passes through unchanged', () => {
  assert.equal(renderRichText('Una caja tranquila'), 'Una caja tranquila');
});

test('the three known tags become markup', () => {
  assert.equal(renderRichText('<b>F1</b> cobra'), '<b>F1</b> cobra');
  assert.equal(renderRichText('<pill>IVA</pill>'), '<span class="pill">IVA</span>');
  assert.match(renderRichText('<em>ya</em>'), /^<em style="font-style:normal">ya<\/em>$/);
});

test('any other tag in the copy stays literal text', () => {
  assert.equal(renderRichText('<script>alert(1)</script>'), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.equal(renderRichText('<img src=x onerror=y>'), '&lt;img src=x onerror=y&gt;');
});

test('an attribute breakout inside a known tag is neutralized', () => {
  assert.equal(
    renderRichText('<b>a" onmouseover="evil()</b>'),
    '<b>a&quot; onmouseover=&quot;evil()</b>'
  );
});

test('ampersands survive escaping without double-encoding the tags', () => {
  assert.equal(renderRichText('caja & <b>stock</b>'), 'caja &amp; <b>stock</b>');
});

test('a non-string is rendered as nothing rather than "undefined"', () => {
  assert.equal(renderRichText(undefined), '');
  assert.equal(renderRichText(null), '');
});
