import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { sanitisePrintHtml } from '../print-html-sanitizer.ts';

// the `print-receipt` IPC handler runs untrusted HTML through
// this sanitiser before loading it into the ephemeral print window.
// Even though that window already runs sandbox: true, dropping every
// active HTML construct at the trust boundary makes a corrupted template
// inert regardless of downstream changes.
//
// Run via `npm run test --workspace=@puntovivo/desktop` (node --test
// --experimental-strip-types). The import path uses `.ts` because
// strip-types consumes the source directly.
describe('sanitisePrintHtml', () => {
  it('strips <script> tags wholesale, not just unwrapping them', () => {
    const out = sanitisePrintHtml('<div>Total: $100</div><script>alert(1)</script>');
    assert.match(out, /<div>Total: \$100<\/div>/);
    assert.equal(/<script/i.test(out), false);
    assert.equal(/alert\(1\)/.test(out), false);
  });

  it('strips inline event handlers', () => {
    const out = sanitisePrintHtml(
      '<div onclick="evil()">Click me</div><img src="data:image/png;base64,AAA" onerror="alert(1)" />'
    );
    assert.equal(/onclick=/i.test(out), false);
    assert.equal(/onerror=/i.test(out), false);
  });

  it('strips <iframe>, <object>, <embed>', () => {
    const out = sanitisePrintHtml(
      '<iframe src="https://evil"></iframe><object data="x"></object><embed src="x" />'
    );
    assert.equal(/<(?:iframe|object|embed)\b/i.test(out), false);
  });

  it('drops caller <meta http-equiv> tags, preserves charset, and injects the locked print CSP', () => {
    const out = sanitisePrintHtml(
      '<meta charset="utf-8"><meta http-equiv="refresh" content="0;url=https://evil">'
    );
    assert.match(out, /<meta\s+charset="utf-8"/);
    assert.match(out, /http-equiv="Content-Security-Policy"/);
    assert.match(out, /default-src 'none'/);
    assert.equal(/refresh/i.test(out), false);
    assert.equal(/evil/i.test(out), false);
  });

  it('preserves inline <style> blocks (receipt CSS)', () => {
    const out = sanitisePrintHtml(
      '<style>body { font-family: monospace; }</style><div class="line">Item</div>'
    );
    assert.match(out, /<style>body \{ font-family: monospace; \}<\/style>/);
    assert.match(out, /<div class="line">Item<\/div>/);
  });

  it('preserves inline style attributes used by receipt templates', () => {
    const out = sanitisePrintHtml('<div style="font-weight:700;text-align:right">Total</div>');
    assert.match(out, /style="font-weight:700;text-align:right"/);
  });

  it('rejects non-data: image srcs', () => {
    const out = sanitisePrintHtml('<img src="https://tracker.example.com/p.gif" />');
    assert.equal(/tracker\.example\.com/.test(out), false);
  });

  it('keeps data: image srcs (receipt logos)', () => {
    const data =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const out = sanitisePrintHtml(`<img src="${data}" alt="logo" />`);
    assert.match(out, /src="data:image\/png;base64/);
    assert.match(out, /alt="logo"/);
  });

  it('preserves table layout and standard typography', () => {
    const out = sanitisePrintHtml(
      '<table><thead><tr><th>Item</th></tr></thead><tbody><tr><td>Coffee</td></tr></tbody></table>'
    );
    assert.match(out, /<table>/);
    assert.match(out, /<th>Item<\/th>/);
    assert.match(out, /<td>Coffee<\/td>/);
  });

  it('returns the empty string on empty or non-string input', () => {
    assert.equal(sanitisePrintHtml(''), '');
    // @ts-expect-error intentional invalid input
    assert.equal(sanitisePrintHtml(null), '');
    // @ts-expect-error intentional invalid input
    assert.equal(sanitisePrintHtml(undefined), '');
  });

  it('is idempotent on already-sanitised input', () => {
    const safe = '<div>Sale total: $42.00</div>';
    assert.equal(sanitisePrintHtml(sanitisePrintHtml(safe)), sanitisePrintHtml(safe));
  });
});
