/**
 * ENG-134 — Unit coverage for the contrast CI gate.
 *
 * The real script runs in `ci:web` against `apps/web/src/styles/theme.css`.
 * This colocated test pins the pieces that would silently break
 * under a design-system token refactor:
 *
 *   - OkLCh parser (`oklch(L C H)` shape).
 *   - WCAG luminance + contrast formulas.
 *   - Scope walker (`:root`, `.dark`).
 *   - Default 4.5:1 floor for shared button token pairs.
 *
 * @module scripts/check-contrast.test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WCAG_AA_RATIO,
  parseOklch,
  oklchToLinearRgb,
  wcagLuminance,
  contrastRatio,
  extractScopes,
  evaluateScope,
} from './check-contrast.mjs';

test('parseOklch reads the canonical oklch triplet', () => {
  const triplet = parseOklch('oklch(0.98 0.008 84)');
  assert.deepEqual(triplet, { L: 0.98, C: 0.008, H: 84 });
});

test('parseOklch tolerates surrounding whitespace and the optional alpha slash', () => {
  assert.deepEqual(parseOklch('  oklch( 0.5  0.1  220 )  '), {
    L: 0.5,
    C: 0.1,
    H: 220,
  });
  assert.deepEqual(parseOklch('oklch(0.5 0.1 220 / 0.8)'), {
    L: 0.5,
    C: 0.1,
    H: 220,
  });
});

test('parseOklch returns null for non-oklch inputs', () => {
  assert.equal(parseOklch('hsl(220 13% 91%)'), null);
  assert.equal(parseOklch('#ffffff'), null);
  assert.equal(parseOklch('rgb(255 255 255)'), null);
});

test('contrastRatio matches the WCAG formula and is direction-agnostic', () => {
  // White luminance is 1, black luminance is 0 → ratio (1+0.05)/(0+0.05) = 21.
  const yWhite = wcagLuminance({ r: 1, g: 1, b: 1 });
  const yBlack = wcagLuminance({ r: 0, g: 0, b: 0 });
  assert.equal(contrastRatio(yWhite, yBlack), 21);
  // Swapping the arguments produces the same ratio.
  assert.equal(contrastRatio(yBlack, yWhite), 21);
});

test('oklchToLinearRgb produces near-white for a fully-bright achromatic input', () => {
  // L=1, C=0 → the achromatic axis at the top end of OkLab. After
  // mapping through the OkLab → LMS → linear sRGB chain we expect
  // the channels to land very close to 1.
  const linear = oklchToLinearRgb({ L: 1, C: 0, H: 0 });
  assert.ok(linear.r > 0.95, `r should be ~1, got ${linear.r}`);
  assert.ok(linear.g > 0.95, `g should be ~1, got ${linear.g}`);
  assert.ok(linear.b > 0.95, `b should be ~1, got ${linear.b}`);
});

test('extractScopes recovers per-scope declarations from theme-shaped CSS', () => {
  const css = `
    :root {
      --background: oklch(1 0 0);
      --foreground: oklch(0.2 0 0);
    }
    .dark {
      --background: oklch(0.2 0 0);
      --foreground: oklch(1 0 0);
    }
  `;
  const scopes = extractScopes(css);
  assert.equal(scopes.length, 2);
  assert.equal(scopes[0].selector, ':root');
  assert.equal(scopes[0].declarations.background, 'oklch(1 0 0)');
  assert.equal(scopes[1].selector, '.dark');
  assert.equal(scopes[1].declarations.foreground, 'oklch(1 0 0)');
});

test('evaluateScope flags a body-text pair that falls under 4.5:1', () => {
  // Pick two oklch lightnesses that produce a ~3:1 contrast — well
  // under the body-text floor for `background / foreground`.
  const declarations = {
    background: 'oklch(0.95 0 0)',
    foreground: 'oklch(0.65 0 0)',
  };
  const result = evaluateScope({ selector: ':root', declarations });
  const bgFgRow = [...result.regressions, ...result.ok].find(
    r => r.pair === 'background / foreground'
  );
  assert.ok(bgFgRow, 'expected background / foreground to be evaluated');
  assert.ok(bgFgRow.ratio < WCAG_AA_RATIO);
  assert.equal(bgFgRow.floor, WCAG_AA_RATIO);
  assert.ok(
    result.regressions.some(r => r.pair === 'background / foreground'),
    'expected a regression for the body-text pair under floor'
  );
});

test('evaluateScope keeps shared button token pairs on the 4.5:1 floor', () => {
  // primary / primary-foreground at ~3.3:1 must fail because shared
  // buttons are text-sm, not WCAG large text.
  const declarations = {
    primary: 'oklch(0.63 0.126 244)',
    'primary-foreground': 'oklch(0.985 0.005 84)',
  };
  const result = evaluateScope({ selector: ':root', declarations });
  const primaryRow = [...result.regressions, ...result.ok].find(
    r => r.pair === 'primary / primary-foreground'
  );
  assert.ok(primaryRow, 'expected primary / primary-foreground to be evaluated');
  assert.equal(primaryRow.floor, WCAG_AA_RATIO);
  assert.ok(
    result.regressions.some(r => r.pair === 'primary / primary-foreground'),
    'expected primary / primary-foreground to fail below 4.5:1'
  );
});

test('evaluateScope keeps the badge-warning pair on the 4.5:1 floor', () => {
  // ENG-134c: warning-50 / warning-700 at ~4.27:1 must fail because
  // `.badge-warning` ships uppercase tracking-wide labels that
  // routinely render at body-text size on transactional surfaces.
  const declarations = {
    'warning-50': 'oklch(0.98 0.03 85)',
    'warning-700': 'oklch(0.57 0.11 72)',
  };
  const result = evaluateScope({ selector: ':root', declarations });
  const warningRow = [...result.regressions, ...result.ok].find(
    r => r.pair === 'warning-50 / warning-700'
  );
  assert.ok(warningRow, 'expected warning-50 / warning-700 to be evaluated');
  assert.equal(warningRow.floor, WCAG_AA_RATIO);
  assert.ok(
    result.regressions.some(r => r.pair === 'warning-50 / warning-700'),
    'expected warning-50 / warning-700 to fail below 4.5:1'
  );
});

test('evaluateScope warns when one side of a pair is missing', () => {
  const result = evaluateScope({
    selector: ':root',
    declarations: { background: 'oklch(1 0 0)' },
  });
  const warning = result.warnings.find(
    w => w.pair === 'background / foreground'
  );
  assert.ok(warning);
  assert.match(warning.reason, /missing side/);
});
