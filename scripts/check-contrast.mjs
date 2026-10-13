#!/usr/bin/env node
/**
 * Contrast CI gate.
 *
 * Reads `apps/web/src/styles/theme.css`, walks each top-level scope
 * (`:root`, `.dark`, etc.), extracts CSS custom properties of the
 * shape `--<role>` plus `--<role>-foreground`, converts each value
 * from `oklch(L C H)` to linear sRGB, computes WCAG 2.x relative
 * luminance + contrast ratio, and asserts every pair meets the AA
 * floor for body text (>= 4.5:1). Exit code 1 on regression.
 *
 * The parser supports `oklch(L C H)` (the format the design system uses
 * today) and resolves `var(--token)` aliases, with fallbacks, before
 * parsing. Both `:root` and `.dark` must exist. The light theme is every
 * `:root` block merged in source order; the dark theme is every `:root` and
 * `.dark` block merged in source order, because the dark class is toggled on
 * the root element and both selectors share one specificity. Every enforced
 * pair in both themes must be measurable; a missing token or unsupported
 * color fails the gate instead of reporting a false green. Only opaque colors
 * are supported: translucent contrast needs a compositing backdrop that this
 * static token-only check does not know.
 *
 * Wired into `ci:web` after the bundle-size gate.
 *
 * @module scripts/check-contrast
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_THEME_FILE = join(REPO_ROOT, 'apps', 'web', 'src', 'styles', 'theme.css');

/**
 * WCAG 2.x body-text floor. The default applies to every pair unless
 * an entry in `PAIR_FLOOR_OVERRIDES` lowers it for a token pair that
 * demonstrably only backs large text (>= 18pt regular or 14pt bold).
 * The shared button styles in this repo use `text-sm font-semibold`,
 * so the primary and destructive token pairs must meet the full 4.5:1
 * body-text floor.
 */
export const WCAG_AA_RATIO = 4.5;

export const PAIR_FLOOR_OVERRIDES = {};

export const ENFORCED_PAIRS = [
  ['background', 'foreground'],
  ['card', 'card-foreground'],
  ['popover', 'popover-foreground'],
  ['muted', 'muted-foreground'],
  ['accent', 'accent-foreground'],
  ['primary', 'primary-foreground'],
  ['secondary', 'secondary-foreground'],
  ['destructive', 'destructive-foreground'],
  // slice B: `text-muted-foreground` is the canonical "dim
  // body" text token in this codebase. It renders against three
  // surface colors in practice — the page `--background`, the
  // `--card` background of any Card-family component, and the
  // `--popover` background of any floating panel. Auditing it only
  // against its self-pair (`--muted`) missed the regression the
  // Playwright a11y smoke caught. Add the three cross-surface pairs
  // explicitly so a future token relax fails the gate, not a route
  // smoke.
  ['background', 'muted-foreground'],
  ['card', 'muted-foreground'],
  ['popover', 'muted-foreground'],
  // Operator Deck semantic action fills are intentionally custom rather
  // than aliases of the broader success/danger ramps. Pin their small-text
  // contrast so future palette tuning cannot trade professionalism for
  // unreadable labels in approval and destructive controls.
  ['operator-positive-control', 'operator-semantic-control-foreground'],
  ['operator-critical-control', 'operator-semantic-control-foreground'],
  // Operational strips use quiet near-neutral surfaces. Their semantic ink
  // must remain readable because it carries icons and compact action labels.
  ['operator-info-surface', 'operator-info-ink'],
  ['operator-positive-surface', 'operator-positive-ink'],
  ['operator-warning-surface', 'operator-warning-ink'],
  ['operator-critical-surface', 'operator-critical-ink'],
  // : the `.badge-warning` design-system surface renders
  // `text-warning-700` on `bg-warning-50`. The Playwright a11y smoke
  // caught this pair at 4.27:1 — below the 4.5:1 body-text floor —
  // on the `/sales` admin and `/purchases` history rows. Adding the
  // pair here means a future relax of either token surfaces as a CI
  // failure, not as a route smoke regression.
  ['warning-50', 'warning-700'],
];

function floorForPair(pairLabel) {
  return PAIR_FLOOR_OVERRIDES[pairLabel] ?? WCAG_AA_RATIO;
}

export function parseOklch(value) {
  const match = value
    .trim()
    .match(/^oklch\(\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)(?:\s*\/\s*([-\d.]+%?))?\s*\)$/);
  if (!match) return null;
  // Never drop alpha: treating transparent text as opaque yields false green.
  if (match[4] !== undefined) {
    const alpha = match[4].endsWith('%') ? Number(match[4].slice(0, -1)) / 100 : Number(match[4]);
    // CSS clamps alpha above 1 to opaque; anything lower (or NaN) is not.
    if (!(alpha >= 1)) return null;
  }
  const [L, C, H] = match.slice(1, 4).map(Number);
  if (![L, C, H].every(Number.isFinite)) return null;
  // CSS clamps lightness and negative chroma before rendering. Treating
  // those values as unrestricted coordinates can produce false AA passes.
  return { L: Math.min(1, Math.max(0, L)), C: Math.max(0, C), H };
}

const VAR_REFERENCE = /^var\(\s*--([a-zA-Z0-9_-]+)\s*(?:,\s*([\s\S]*))?\)$/;

/**
 * Follow a `var(--token[, fallback])` chain through the given declarations.
 * Returns the first non-`var()` value, or null for an undefined reference
 * without fallback or a reference cycle (both invalid at computed time).
 */
export function resolveCustomProperty(value, declarations, seen = new Set()) {
  const trimmed = value.trim();
  const match = trimmed.match(VAR_REFERENCE);
  if (!match) return trimmed;
  const [, name, fallback] = match;
  if (seen.has(name)) return null;
  const referenced = declarations[name];
  if (referenced !== undefined) {
    return resolveCustomProperty(referenced, declarations, new Set([...seen, name]));
  }
  return fallback === undefined ? null : resolveCustomProperty(fallback, declarations, seen);
}

export function oklchToLinearRgb({ L, C, H }) {
  // Display gamut mapping makes the lightness endpoints black or white,
  // regardless of chroma. Raw channel clipping is not equivalent here.
  if (L <= 0) return { r: 0, g: 0, b: 0 };
  if (L >= 1) return { r: 1, g: 1, b: 1 };
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  const lTerm = L + 0.3963377774 * a + 0.2158037573 * b;
  const mTerm = L - 0.1055613458 * a - 0.0638541728 * b;
  const sTerm = L - 0.0894841775 * a - 1.291485548 * b;

  const lLms = lTerm * lTerm * lTerm;
  const mLms = mTerm * mTerm * mTerm;
  const sLms = sTerm * sTerm * sTerm;

  return {
    r: 4.0767416621 * lLms - 3.3077115913 * mLms + 0.2309699292 * sLms,
    g: -1.2684380046 * lLms + 2.6097574011 * mLms - 0.3413193965 * sLms,
    b: -0.0041960863 * lLms - 0.7034186147 * mLms + 1.707614701 * sLms,
  };
}

const clamp01 = v => Math.min(1, Math.max(0, v));

export function wcagLuminance({ r, g, b }) {
  return 0.2126 * clamp01(r) + 0.7152 * clamp01(g) + 0.0722 * clamp01(b);
}

export function contrastRatio(y1, y2) {
  const lighter = Math.max(y1, y2);
  const darker = Math.min(y1, y2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function extractScopes(cssSource) {
  const scopes = [];
  // Comments may contain braces and at-rule text. Remove them before looking
  // for blocks, then discard any preceding semicolon-terminated at-statements
  // (such as @custom-variant) from each selector candidate.
  const source = cssSource.replace(/\/\*[\s\S]*?\*\//g, '');
  let i = 0;
  const len = source.length;
  while (i < len) {
    const openIdx = source.indexOf('{', i);
    if (openIdx === -1) break;
    const selectorRaw = source.slice(i, openIdx).split(';').at(-1).trim();
    let depth = 1;
    let closeIdx = openIdx + 1;
    while (closeIdx < len && depth > 0) {
      const ch = source[closeIdx];
      if (ch === '{') depth += 1;
      else if (ch === '}') depth -= 1;
      if (depth === 0) break;
      closeIdx += 1;
    }
    if (closeIdx >= len) break;
    const body = source.slice(openIdx + 1, closeIdx);
    if (selectorRaw && !selectorRaw.startsWith('@') && selectorRaw.match(/^[:.\[a-zA-Z][^{]*$/)) {
      const declarations = {};
      // The final declaration in a block may omit its semicolon; it still
      // wins the cascade, so it must not be dropped.
      const declMatcher = /--([a-zA-Z0-9_-]+)\s*:\s*([^;{}]+)/g;
      let m;
      while ((m = declMatcher.exec(body)) !== null) {
        declarations[m[1]] = m[2].trim();
      }
      scopes.push({ selector: selectorRaw, declarations });
    }
    i = closeIdx + 1;
  }
  return scopes;
}

export function evaluateScope({ selector, declarations }) {
  const regressions = [];
  const warnings = [];
  const ok = [];
  for (const [bg, fg] of ENFORCED_PAIRS) {
    const bgRaw = declarations[bg];
    const fgRaw = declarations[fg];
    if (!bgRaw || !fgRaw) {
      warnings.push({
        scope: selector,
        pair: `${bg} / ${fg}`,
        reason: `missing side (${!bgRaw ? bg : fg})`,
      });
      continue;
    }
    const bgValue = resolveCustomProperty(bgRaw, declarations);
    const fgValue = resolveCustomProperty(fgRaw, declarations);
    if (bgValue === null || fgValue === null) {
      warnings.push({
        scope: selector,
        pair: `${bg} / ${fg}`,
        reason: `unresolvable var() reference (--${bgValue === null ? bg : fg}: ${
          bgValue === null ? bgRaw : fgRaw
        })`,
      });
      continue;
    }
    const bgOkl = parseOklch(bgValue);
    const fgOkl = parseOklch(fgValue);
    if (!bgOkl || !fgOkl) {
      warnings.push({
        scope: selector,
        pair: `${bg} / ${fg}`,
        reason: `unmeasurable color (--${!bgOkl ? bg : fg}: ${
          !bgOkl ? bgValue : fgValue
        }); only opaque oklch(L C H) values are measured`,
      });
      continue;
    }
    const bgRgb = oklchToLinearRgb(bgOkl);
    const fgRgb = oklchToLinearRgb(fgOkl);
    // Finite inputs can still overflow during conversion. Reject before
    // clamping hides infinities or a NaN comparison falls into the ok branch.
    if (![...Object.values(bgRgb), ...Object.values(fgRgb)].every(Number.isFinite)) {
      warnings.push({
        scope: selector,
        pair: `${bg} / ${fg}`,
        reason: 'non-finite RGB conversion',
      });
      continue;
    }
    const yBg = wcagLuminance(bgRgb);
    const yFg = wcagLuminance(fgRgb);
    const ratio = contrastRatio(yBg, yFg);
    const pairLabel = `${bg} / ${fg}`;
    const floor = floorForPair(pairLabel);
    const row = { scope: selector, pair: pairLabel, ratio, floor };
    if (ratio < floor) {
      regressions.push(row);
    } else {
      ok.push(row);
    }
  }
  return { regressions, warnings, ok };
}

export function renderReport(perScopeResults) {
  const lines = [];
  let totalRegressions = 0;
  for (const { selector, regressions, warnings, ok } of perScopeResults) {
    // Skip scopes that have zero relevant pairs — typography utility
    // classes (.display, .kicker, etc.) declare no color tokens so
    // the gate has nothing meaningful to say about them.
    if (regressions.length === 0 && ok.length === 0) continue;
    lines.push(`### ${selector}`);
    if (regressions.length > 0) {
      lines.push('Contrast regression:');
      lines.push('| pair | ratio | floor |');
      lines.push('| --- | ---: | ---: |');
      for (const r of regressions) {
        lines.push(`| ${r.pair} | ${r.ratio.toFixed(2)} | ${r.floor} |`);
      }
      totalRegressions += regressions.length;
    } else {
      lines.push('PASS — every enforced pair meets its WCAG AA floor.');
      lines.push('| pair | ratio | floor |');
      lines.push('| --- | ---: | ---: |');
      for (const o of ok) {
        lines.push(`| ${o.pair} | ${o.ratio.toFixed(2)} | ${o.floor} |`);
      }
    }
    if (warnings.length > 0) {
      lines.push('');
      lines.push('Warnings (did not fail):');
      for (const w of warnings) {
        lines.push(`  - ${w.pair}: ${w.reason}`);
      }
    }
    lines.push('');
  }
  return { text: lines.join('\n'), totalRegressions };
}

const THEME_SELECTORS = [':root', '.dark'];

/**
 * Compute the effective light and dark token maps. `.dark` is toggled on the
 * root element, so every `:root` and `.dark` block applies to it in dark mode
 * and, at equal specificity, the later block wins.
 */
export function resolveThemeScopes(scopes) {
  const light = {};
  const dark = {};
  for (const { selector, declarations } of scopes) {
    if (selector === ':root') {
      Object.assign(light, declarations);
      Object.assign(dark, declarations);
    } else if (selector === '.dark') {
      Object.assign(dark, declarations);
    }
  }
  return [
    { selector: ':root', declarations: light },
    { selector: '.dark', declarations: dark },
  ];
}

export async function runCli({ themeFile = DEFAULT_THEME_FILE } = {}) {
  let source;
  try {
    source = readFileSync(themeFile, 'utf8');
  } catch (err) {
    console.error(`check-contrast: cannot read theme file at ${themeFile}: ${err.message}`);
    return 1;
  }
  const scopes = extractScopes(source);
  const missingScopes = THEME_SELECTORS.filter(
    required => !scopes.some(scope => scope.selector === required)
  );
  if (missingScopes.length > 0) {
    console.error(
      `check-contrast: required CSS scope(s) missing from ${themeFile}: ${missingScopes.join(', ')}.`
    );
    return 1;
  }
  const themeResults = resolveThemeScopes(scopes).map(scope => ({
    selector: scope.selector,
    ...evaluateScope(scope),
  }));
  const unmeasuredThemePairs = themeResults.flatMap(result =>
    result.warnings.map(warning => `  - ${result.selector}: ${warning.pair}: ${warning.reason}`)
  );
  if (unmeasuredThemePairs.length > 0) {
    console.error(
      `check-contrast: cannot verify enforced theme pair(s) in ${themeFile}:\n${unmeasuredThemePairs.join('\n')}`
    );
    return 1;
  }
  const perScopeResults = [
    ...themeResults,
    ...scopes
      .filter(scope => !THEME_SELECTORS.includes(scope.selector))
      .map(scope => ({ selector: scope.selector, ...evaluateScope(scope) })),
  ];
  const report = renderReport(perScopeResults);
  if (report.totalRegressions > 0) {
    console.error(report.text);
    return 1;
  }
  console.log(report.text);
  return 0;
}

const isDirectInvocation =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectInvocation) {
  runCli().then(code => process.exit(code));
}
