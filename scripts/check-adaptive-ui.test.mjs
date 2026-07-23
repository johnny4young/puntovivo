import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  auditAdaptiveUi,
  DEFAULT_COMPONENT_CSS,
  renderAdaptiveUiReport,
} from './check-adaptive-ui.mjs';

test('reports missing adaptive operating contracts', () => {
  const violations = auditAdaptiveUi('.btn-primary { color: blue; }');
  assert.deepEqual(violations, [
    'reduced-motion: missing @media (prefers-reduced-motion: reduce)',
    'forced-colors: missing @media (forced-colors: active)',
  ]);
});

test('rejects declarations that exist outside their required selector', () => {
  const source = `
    @media (prefers-reduced-motion: reduce) {
      .drawer-shell { color: CanvasText; }
      .btn-primary { color: CanvasText; }
      html:focus-within { color: CanvasText; }
      .unrelated { animation: none; transition: none; scroll-behavior: auto; }
    }
    @media (forced-colors: active) {
      .btn-primary { color: ButtonText; }
      :focus-visible { color: ButtonText; }
      .pv-strip { color: ButtonText; }
      .unrelated {
        color: HighlightText;
        outline: 3px solid Highlight;
        border-left-width: 4px;
        forced-color-adjust: auto;
      }
    }
  `;
  const violations = auditAdaptiveUi(source);
  assert.ok(violations.some(item => item.includes('drawer animation')));
  assert.ok(violations.some(item => item.includes('control transitions')));
  assert.ok(violations.some(item => item.includes('scroll behavior')));
  assert.ok(violations.some(item => item.includes('system button colors')));
  assert.ok(violations.some(item => item.includes('system focus ring')));
  assert.ok(violations.some(item => item.includes('semantic strip boundary')));
});

test('the shared component CSS preserves adaptive operating modes', () => {
  const violations = auditAdaptiveUi(readFileSync(DEFAULT_COMPONENT_CSS, 'utf8'));
  assert.equal(violations.length, 0, renderAdaptiveUiReport(violations));
});
