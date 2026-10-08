/**
 * Unit coverage for the contrast CI gate.
 *
 * The real script runs in `ci:web` against `apps/web/src/styles/theme.css`.
 * This colocated test pins the pieces that would silently break
 * under a design-system token refactor:
 *
 * - OkLCh parser (`oklch(L C H)` shape).
 * - WCAG luminance + contrast formulas.
 * - Scope walker (`:root`, `.dark`).
 * - Default 4.5:1 floor for shared button token pairs.
 *
 * @module scripts/check-contrast.test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  WCAG_AA_RATIO,
  parseOklch,
  oklchToLinearRgb,
  wcagLuminance,
  contrastRatio,
  extractScopes,
  evaluateScope,
  resolveCustomProperty,
  resolveThemeScopes,
  runCli,
} from './check-contrast.mjs';

async function runWithTheme(source, errors = []) {
  const directory = mkdtempSync(join(tmpdir(), 'puntovivo-contrast-test-'));
  const themeFile = join(directory, 'theme.css');
  writeFileSync(themeFile, source);
  const originalLog = console.log;
  const originalError = console.error;
  console.log = () => {};
  console.error = message => errors.push(String(message));
  try {
    return await runCli({ themeFile });
  } finally {
    console.log = originalLog;
    console.error = originalError;
    rmSync(directory, { recursive: true, force: true });
  }
}

test('parseOklch reads the canonical oklch triplet', () => {
  const triplet = parseOklch('oklch(0.98 0.008 84)');
  assert.deepEqual(triplet, { L: 0.98, C: 0.008, H: 84 });
});

test('parseOklch tolerates surrounding whitespace and explicit opaque alpha', () => {
  assert.deepEqual(parseOklch('  oklch( 0.5  0.1  220 )  '), {
    L: 0.5,
    C: 0.1,
    H: 220,
  });
  assert.deepEqual(parseOklch('oklch(0.5 0.1 220 / 1)'), {
    L: 0.5,
    C: 0.1,
    H: 220,
  });
});

test('parseOklch refuses transparency and malformed alpha instead of discarding it', () => {
  for (const alpha of ['0', '0.8', '80%', 'invalid', '1..0']) {
    assert.equal(parseOklch(`oklch(0.5 0.1 220 / ${alpha})`), null, alpha);
  }
  assert.deepEqual(parseOklch('oklch(0.5 0.1 220 / 100%)'), { L: 0.5, C: 0.1, H: 220 });
  // CSS clamps alpha above 1 to fully opaque.
  assert.deepEqual(parseOklch('oklch(0.5 0.1 220 / 1.5)'), { L: 0.5, C: 0.1, H: 220 });
});

test('parseOklch clamps negative chroma to the CSS achromatic value', () => {
  assert.deepEqual(parseOklch('oklch(0.65 -0.5 75)'), { L: 0.65, C: 0, H: 75 });
});

test('negative chroma cannot turn low-contrast gray text into a false AA pass', () => {
  const result = evaluateScope({
    selector: ':root',
    declarations: { background: 'oklch(1 0 0)', foreground: 'oklch(0.65 -0.5 75)' },
  });
  const pair = result.regressions.find(row => row.pair === 'background / foreground');
  assert.ok(pair, 'CSS clamps negative chroma to zero, so this gray pair must fail');
  assert.ok(pair.ratio < WCAG_AA_RATIO);
  assert.ok(!result.ok.some(row => row.pair === 'background / foreground'));
});

test('parseOklch clamps CSS lightness to its display range', () => {
  assert.deepEqual(parseOklch('oklch(-0.2 0.1 240)'), { L: 0, C: 0.1, H: 240 });
  assert.deepEqual(parseOklch('oklch(2 2 240)'), { L: 1, C: 2, H: 240 });
});

test('display lightness endpoints stay black or white regardless of chroma', () => {
  for (const H of [0, 90, 240]) {
    assert.deepEqual(oklchToLinearRgb({ L: 0, C: 2, H }), { r: 0, g: 0, b: 0 });
    assert.deepEqual(oklchToLinearRgb({ L: 1, C: 2, H }), { r: 1, g: 1, b: 1 });
  }
});

test('out-of-range lightness cannot make white-on-white text appear AA compliant', () => {
  const result = evaluateScope({
    selector: ':root',
    declarations: { background: 'oklch(1 0 0)', foreground: 'oklch(2 2 240)' },
  });
  const pair = result.regressions.find(row => row.pair === 'background / foreground');
  assert.ok(pair, 'clamped white text on white must fail AA regardless of chroma');
  assert.equal(pair.ratio, 1);
});

test('parseOklch returns null for non-oklch inputs', () => {
  assert.equal(parseOklch('hsl(220 13% 91%)'), null);
  assert.equal(parseOklch('#ffffff'), null);
  assert.equal(parseOklch('rgb(255 255 255)'), null);
  assert.equal(parseOklch('oklch(1..2 0 0)'), null);
  assert.equal(parseOklch('oklch(. 0 0)'), null);
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

test('extractScopes finds the real light and dark theme after comments and at-rules', () => {
  const themeSource = readFileSync(
    new URL('../apps/web/src/styles/theme.css', import.meta.url),
    'utf8'
  );
  const scopes = extractScopes(themeSource);
  assert.deepEqual(
    scopes
      .filter(scope => scope.selector === ':root' || scope.selector === '.dark')
      .map(scope => scope.selector),
    [':root', '.dark']
  );
  assert.equal(
    scopes.find(scope => scope.selector === ':root').declarations.surface,
    'oklch(0.992 0.003 225)'
  );
});

test('extractScopes ignores comment braces and semicolon-terminated at-statements', () => {
  const scopes = extractScopes(`
    /* Not a selector: { --background: oklch(0 0 0); } */
    @custom-variant dark (&:where(.dark, .dark *));
    :root { --background: oklch(1 0 0); --foreground: oklch(0 0 0); }
    .dark { --background: oklch(0 0 0); --foreground: oklch(1 0 0); }
  `);
  assert.deepEqual(
    scopes.map(scope => scope.selector),
    [':root', '.dark']
  );
});

test('contrast gate fails closed when the light theme scope is missing', async () => {
  assert.equal(
    await runWithTheme('.dark { --background: oklch(0.2 0 0); --foreground: oklch(1 0 0); }'),
    1
  );
});

test('contrast gate fails closed when the dark theme scope is missing', async () => {
  assert.equal(
    await runWithTheme(':root { --background: oklch(1 0 0); --foreground: oklch(0.2 0 0); }'),
    1
  );
});

test('contrast gate rejects a named theme with no measurable base text pair', async () => {
  assert.equal(
    await runWithTheme(`
      :root { --surface: oklch(1 0 0); }
      .dark { --background: oklch(0.2 0 0); --foreground: oklch(1 0 0); }
    `),
    1
  );
});

test('contrast gate rejects a base text pair with malformed numeric components', async () => {
  assert.equal(
    await runWithTheme(`
      :root { --background: oklch(1..2 0 0); --foreground: oklch(0 0 0); }
      .dark { --background: oklch(0 0 0); --foreground: oklch(1 0 0); }
    `),
    1
  );
});

test('contrast gate catches a light-only token regression in the real theme', async () => {
  const source = readFileSync(new URL('../apps/web/src/styles/theme.css', import.meta.url), 'utf8');
  const regressed = source.replace(
    '--destructive-foreground: oklch(0.985 0.005 84);',
    '--destructive-foreground: oklch(0.57 0.192 24);'
  );
  assert.notEqual(regressed, source, 'the light destructive token must exist in the real theme');
  assert.equal(await runWithTheme(regressed), 1);
});

test('contrast gate rejects a missing enforced pair outside the base text pair', async () => {
  const source = readFileSync(new URL('../apps/web/src/styles/theme.css', import.meta.url), 'utf8');
  const missing = source.replace('--destructive-foreground: oklch(0.985 0.005 84);', '');
  assert.notEqual(missing, source, 'the light destructive token must exist in the real theme');
  assert.equal(await runWithTheme(missing), 1);
});

test('contrast gate rejects malformed numeric color in a non-base enforced pair', async () => {
  const source = readFileSync(new URL('../apps/web/src/styles/theme.css', import.meta.url), 'utf8');
  const malformed = source.replace(
    '--operator-warning-ink: oklch(0.39 0.085 72);',
    '--operator-warning-ink: oklch(0.39.. 0.085 72);'
  );
  assert.notEqual(malformed, source, 'the light warning ink token must exist in the real theme');
  assert.equal(await runWithTheme(malformed), 1);
});

test('contrast gate rejects unsupported color syntax in an enforced theme pair', async () => {
  const source = readFileSync(new URL('../apps/web/src/styles/theme.css', import.meta.url), 'utf8');
  const unsupported = source.replace(
    '--operator-warning-ink: oklch(0.39 0.085 72);',
    '--operator-warning-ink: hsl(42 60% 30%);'
  );
  assert.notEqual(unsupported, source, 'the light warning ink token must exist in the real theme');
  assert.equal(await runWithTheme(unsupported), 1);
});

for (const [label, color] of [
  ['transparent alpha', 'oklch(0.985 0.005 84 / 0)'],
  ['malformed alpha', 'oklch(0.985 0.005 84 / invalid)'],
  ['overflowing RGB conversion', `oklch(0.985 ${'9'.repeat(200)} 84)`],
]) {
  test(`contrast gate rejects ${label} in an enforced pair`, async () => {
    const source = readFileSync(
      new URL('../apps/web/src/styles/theme.css', import.meta.url),
      'utf8'
    );
    const changed = source.replace(
      '--destructive-foreground: oklch(0.985 0.005 84);',
      `--destructive-foreground: ${color};`
    );
    assert.notEqual(changed, source, 'the light destructive token must exist in the real theme');
    assert.equal(await runWithTheme(changed), 1);
  });
}

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

test('evaluateScope enforces Operator Deck semantic control contrast', () => {
  const declarations = {
    'operator-positive-control': 'oklch(0.43 0.075 154)',
    'operator-critical-control': 'oklch(0.45 0.1 24)',
    'operator-semantic-control-foreground': 'oklch(0.98 0.004 225)',
  };
  const result = evaluateScope({ selector: ':root', declarations });

  for (const pair of [
    'operator-positive-control / operator-semantic-control-foreground',
    'operator-critical-control / operator-semantic-control-foreground',
  ]) {
    const row = [...result.regressions, ...result.ok].find(candidate => candidate.pair === pair);
    assert.ok(row, `expected ${pair} to be evaluated`);
    assert.equal(row.floor, WCAG_AA_RATIO);
    assert.ok(row.ratio >= WCAG_AA_RATIO, `expected ${pair} to clear AA`);
  }
});

test('evaluateScope enforces Operator Deck operational strip contrast', () => {
  const declarations = {
    'operator-info-surface': 'oklch(0.955 0.014 244)',
    'operator-info-ink': 'oklch(0.35 0.075 244)',
    'operator-positive-surface': 'oklch(0.955 0.018 154)',
    'operator-positive-ink': 'oklch(0.34 0.07 154)',
    'operator-warning-surface': 'oklch(0.965 0.025 78)',
    'operator-warning-ink': 'oklch(0.39 0.085 72)',
    'operator-critical-surface': 'oklch(0.96 0.018 24)',
    'operator-critical-ink': 'oklch(0.39 0.085 24)',
  };
  const result = evaluateScope({ selector: ':root', declarations });

  for (const pair of [
    'operator-info-surface / operator-info-ink',
    'operator-positive-surface / operator-positive-ink',
    'operator-warning-surface / operator-warning-ink',
    'operator-critical-surface / operator-critical-ink',
  ]) {
    const row = [...result.regressions, ...result.ok].find(candidate => candidate.pair === pair);
    assert.ok(row, `expected ${pair} to be evaluated`);
    assert.equal(row.floor, WCAG_AA_RATIO);
    assert.ok(row.ratio >= WCAG_AA_RATIO, `expected ${pair} to clear AA`);
  }
});

test('evaluateScope keeps the badge-warning pair on the 4.5:1 floor', () => {
  // : warning-50 / warning-700 at ~4.27:1 must fail because
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
  const warning = result.warnings.find(w => w.pair === 'background / foreground');
  assert.ok(warning);
  assert.match(warning.reason, /missing side/);
});

const REAL_THEME_URL = new URL('../apps/web/src/styles/theme.css', import.meta.url);

test('extractScopes keeps a final declaration that omits its semicolon', () => {
  const [scope] = extractScopes(
    ':root { --background: oklch(1 0 0); --foreground: oklch(0.9 0 0) }'
  );
  assert.equal(scope.declarations.foreground, 'oklch(0.9 0 0)');
});

test('contrast gate measures a final unterminated declaration instead of an earlier value', async () => {
  const source = readFileSync(REAL_THEME_URL, 'utf8');
  const changed = source.replace(
    '--print-paper: #fff;\n}',
    '--print-paper: #fff;\n  --warning-700: oklch(0.93 0.11 72)\n}'
  );
  assert.notEqual(changed, source, 'the light theme must end with the print paper token');
  assert.equal(await runWithTheme(changed), 1);
});

test('contrast gate catches a dark-only token regression in the real theme', async () => {
  const source = readFileSync(REAL_THEME_URL, 'utf8');
  const regressed = source.replace(
    '--destructive-foreground: oklch(0.17 0.018 255);',
    '--destructive-foreground: oklch(0.7 0.17 24);'
  );
  assert.notEqual(regressed, source, 'the dark destructive token must exist in the real theme');
  assert.equal(await runWithTheme(regressed), 1);
});

test('resolveThemeScopes applies :root and .dark blocks in source order', () => {
  const [light, dark] = resolveThemeScopes(
    extractScopes(`
      :root { --background: oklch(1 0 0); --foreground: oklch(0.2 0 0); --ring: oklch(0.5 0 0); }
      .dark { --background: oklch(0.2 0 0); --foreground: oklch(1 0 0); }
      :root { --foreground: oklch(0.1 0 0); }
    `)
  );
  assert.equal(light.declarations.foreground, 'oklch(0.1 0 0)');
  assert.equal(dark.declarations.background, 'oklch(0.2 0 0)');
  // Both selectors match the root element at equal specificity: later wins.
  assert.equal(dark.declarations.foreground, 'oklch(0.1 0 0)');
  // Tokens the dark block does not redeclare inherit the light value.
  assert.equal(dark.declarations.ring, 'oklch(0.5 0 0)');
});

test('contrast gate fails a dark pair overridden by a later :root block', async () => {
  const source = readFileSync(REAL_THEME_URL, 'utf8');
  // Restating the light foreground after `.dark` keeps light mode identical
  // but wins the cascade on the root element in dark mode too.
  assert.equal(await runWithTheme(`${source}\n:root { --foreground: oklch(0.24 0.02 255); }\n`), 1);
});

test('resolveCustomProperty follows var() chains, fallbacks, and rejects cycles', () => {
  const declarations = {
    surface: 'oklch(0.9 0 0)',
    card: 'var(--surface)',
    panel: 'var( --card )',
    loop: 'var(--loop)',
  };
  assert.equal(resolveCustomProperty('var(--panel)', declarations), 'oklch(0.9 0 0)');
  assert.equal(resolveCustomProperty('var(--missing, oklch(0 0 0))', declarations), 'oklch(0 0 0)');
  assert.equal(resolveCustomProperty('var(--missing)', declarations), null);
  assert.equal(resolveCustomProperty('var(--loop)', declarations), null);
  assert.equal(resolveCustomProperty('oklch(1 0 0)', declarations), 'oklch(1 0 0)');
});

test('contrast gate measures enforced tokens declared as var() aliases', async () => {
  const source = readFileSync(REAL_THEME_URL, 'utf8');
  const aliased = source.replace('--card: oklch(0.225 0.018 255);', '--card: var(--surface);');
  assert.notEqual(aliased, source, 'the dark card token must exist in the real theme');
  assert.equal(await runWithTheme(aliased), 0);
  const dangling = source.replace('--card: oklch(0.225 0.018 255);', '--card: var(--nope);');
  const errors = [];
  assert.equal(await runWithTheme(dangling, errors), 1);
  assert.match(
    errors.join('\n'),
    /\.dark: card \/ card-foreground: unresolvable var\(\) reference/
  );
});

test('contrast gate explains why an enforced theme pair cannot be measured', async () => {
  const source = readFileSync(REAL_THEME_URL, 'utf8');
  const translucent = source.replace(
    '--destructive-foreground: oklch(0.985 0.005 84);',
    '--destructive-foreground: oklch(0.985 0.005 84 / 0.5);'
  );
  const errors = [];
  assert.equal(await runWithTheme(translucent, errors), 1);
  assert.match(
    errors.join('\n'),
    /:root: destructive \/ destructive-foreground: unmeasurable color \(--destructive-foreground: oklch\(0\.985 0\.005 84 \/ 0\.5\)\)/
  );
});
