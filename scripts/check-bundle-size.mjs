#!/usr/bin/env node
/**
 * ENG-133 — Bundle-size CI gate.
 *
 * Reads `apps/web/dist/assets/*.js` after `vite build`, computes the
 * gzipped size of every chunk, strips Rolldown's content-hash suffix,
 * and compares the measured value against the budget declared in the
 * repo's `perf-budget.json`. A regression past `thresholdPercent` is
 * a hard fail; new or removed chunks emit a warning so the operator
 * can update the baseline in the same PR.
 *
 * The script lives outside vitest because it consumes the artifacts
 * vite emitted in `npm run build` and the CI chain wires it after
 * the build step (see root `package.json::ci:web`).
 *
 * Exit codes:
 *   0 — every tracked chunk fits inside budget + threshold; new /
 *       removed chunks may have warned.
 *   1 — at least one chunk overshot budget OR the artifacts dir
 *       could not be read OR the budget file is malformed.
 *
 * The helpers are also exported for the colocated `node --test`
 * suite so the strip-hash regex + comparison logic stay pinned.
 *
 * @module scripts/check-bundle-size
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUDGET_PATH = join(REPO_ROOT, 'perf-budget.json');
const DEFAULT_ASSETS_DIR = join(REPO_ROOT, 'apps', 'web', 'dist', 'assets');

/**
 * Vite + Rolldown tree-shaking emits dozens of tiny chunks for
 * lucide icons + utility splits that we don't want to track in the
 * budget (typical 0.1-0.5 KB gz). Filter the "new chunks" warning to
 * only flag entries above this size so the operator doesn't see 60+
 * lines of icon noise on every PR.
 */
const NEW_CHUNK_WARN_MIN_GZ_KB = 5;

/**
 * Strip Rolldown's `-<hash>.js` suffix to recover the canonical
 * chunk name used as the budget key. The hash is the trailing
 * `-<6+ char base64-ish blob>.js` segment. Anchored so a chunk
 * named `SalesPage-Detail.js` (no hash) survives unchanged.
 */
export function stripHash(filename) {
  return filename.replace(/-[A-Za-z0-9_-]{6,}\.js$/, '');
}

/**
 * Measure each `.js` file in `assetsDir` and return an array of
 * `{ name, gzKb }` rows sorted descending by size. `name` already
 * has its hash stripped.
 */
export function measureChunks(assetsDir) {
  const entries = readdirSync(assetsDir).filter(f => f.endsWith('.js'));
  return entries
    .map(file => {
      const buf = readFileSync(join(assetsDir, file));
      const gzBytes = gzipSync(buf).length;
      return {
        name: stripHash(file),
        gzKb: gzBytes / 1024,
      };
    })
    .sort((a, b) => b.gzKb - a.gzKb);
}

/**
 * Compare measured chunk sizes against the budget. Returns:
 *
 *   {
 *     regressions: [{ name, budget, actual, deltaPercent }],
 *     newChunks:   [{ name, gzKb }],
 *     missing:     [{ name, budget }],
 *     ok:          [{ name, budget, actual, deltaPercent }],
 *   }
 *
 * `regressions` carries every chunk that exceeded budget * (1 +
 * threshold/100). `newChunks` are chunks present in the build but
 * absent from budget (operator should add them). `missing` are
 * chunks present in budget but absent from the build (operator
 * should remove them).
 */
export function compareToBudget({ measured, budget, thresholdPercent }) {
  const ceiling = key =>
    budget[key] !== undefined
      ? budget[key] * (1 + thresholdPercent / 100)
      : null;
  const measuredByName = new Map(measured.map(m => [m.name, m.gzKb]));
  const result = { regressions: [], newChunks: [], missing: [], ok: [] };
  for (const { name, gzKb } of measured) {
    const ceil = ceiling(name);
    if (ceil === null) {
      result.newChunks.push({ name, gzKb });
      continue;
    }
    const deltaPercent = ((gzKb - budget[name]) / budget[name]) * 100;
    const row = {
      name,
      budget: budget[name],
      actual: gzKb,
      deltaPercent,
    };
    if (gzKb > ceil) {
      result.regressions.push(row);
    } else {
      result.ok.push(row);
    }
  }
  for (const name of Object.keys(budget)) {
    if (!measuredByName.has(name)) {
      result.missing.push({ name, budget: budget[name] });
    }
  }
  return result;
}

/**
 * Render the comparison result as a human-readable markdown table.
 * Useful for the CI log so the regressing chunk is identifiable at
 * a glance.
 */
export function renderReport({ regressions, newChunks, missing, ok }, threshold) {
  const lines = [];
  if (regressions.length > 0) {
    lines.push('| chunk | budget (kB gz) | actual (kB gz) | delta % |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const r of regressions) {
      lines.push(
        `| ${r.name} | ${r.budget} | ${r.actual.toFixed(2)} | +${r.deltaPercent.toFixed(1)}% |`
      );
    }
    lines.unshift(`Bundle-size regression past ${threshold}% threshold:`);
  }
  const noteworthyNewChunks = newChunks.filter(
    c => c.gzKb >= NEW_CHUNK_WARN_MIN_GZ_KB
  );
  if (noteworthyNewChunks.length > 0) {
    if (lines.length) lines.push('');
    lines.push(
      `New chunks >= ${NEW_CHUNK_WARN_MIN_GZ_KB} kB not in perf-budget.json (warning, did not fail):`
    );
    for (const c of noteworthyNewChunks) {
      lines.push(`  + ${c.name}  (${c.gzKb.toFixed(2)} kB gz)`);
    }
  }
  if (missing.length > 0) {
    if (lines.length) lines.push('');
    lines.push(`Budget entries with no matching build artifact (warning):`);
    for (const m of missing) {
      lines.push(`  - ${m.name}  (was ${m.budget} kB gz)`);
    }
  }
  if (regressions.length === 0 && ok.length > 0) {
    lines.push('Bundle-size PASS — tracked chunks within budget:');
    lines.push('| chunk | budget (kB gz) | actual (kB gz) | delta % |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const o of ok) {
      const sign = o.deltaPercent >= 0 ? '+' : '';
      lines.push(
        `| ${o.name} | ${o.budget} | ${o.actual.toFixed(2)} | ${sign}${o.deltaPercent.toFixed(1)}% |`
      );
    }
  }
  return lines.join('\n');
}

/**
 * CLI entry. Resolves the assets dir + budget file, runs the
 * comparison, prints the report, exits with the right code.
 *
 * `assetsDir` defaults to the canonical Vite output path; tests can
 * pass a fixture directory to exercise the logic in isolation.
 */
export async function runCli({ assetsDir = DEFAULT_ASSETS_DIR } = {}) {
  let budgetFile;
  try {
    budgetFile = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'));
  } catch (err) {
    console.error(
      `check-bundle-size: cannot read budget file at ${BUDGET_PATH}: ${err.message}`
    );
    return 1;
  }
  const budget = budgetFile?.bundleSize?.perChunkGzKb;
  const thresholdPercent = budgetFile?.bundleSize?.thresholdPercent;
  if (!budget || typeof thresholdPercent !== 'number') {
    console.error(
      'check-bundle-size: perf-budget.json is missing bundleSize.perChunkGzKb or bundleSize.thresholdPercent'
    );
    return 1;
  }
  let measured;
  try {
    const stat = statSync(assetsDir);
    if (!stat.isDirectory()) {
      throw new Error('not a directory');
    }
    measured = measureChunks(assetsDir);
    if (measured.length === 0) {
      console.error(
        `check-bundle-size: assets dir ${assetsDir} has no .js files. Did vite build succeed?`
      );
      return 1;
    }
  } catch (err) {
    console.error(
      `check-bundle-size: cannot read assets dir ${assetsDir}: ${err.message}`
    );
    return 1;
  }
  const result = compareToBudget({
    measured,
    budget,
    thresholdPercent,
  });
  const report = renderReport(result, thresholdPercent);
  if (result.regressions.length > 0) {
    console.error(report);
    return 1;
  }
  console.log(report);
  return 0;
}

// Direct invocation guard — when imported by the test suite the CLI
// must NOT execute.
const isDirectInvocation =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectInvocation) {
  runCli().then(code => process.exit(code));
}
