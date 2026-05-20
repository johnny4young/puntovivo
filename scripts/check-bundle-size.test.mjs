/**
 * ENG-133 — Unit coverage for the bundle-size CI gate.
 *
 * The script itself runs in `ci:web` against the real `vite build`
 * output. This colocated test pins the pieces that would silently
 * break under a Vite upgrade or a refactor of the comparison logic:
 *
 *   - The chunk-name hash strip regex (Rolldown hash format).
 *   - The pass / fail classification against thresholdPercent.
 *   - The new-chunk and missing-chunk warning paths.
 *
 * Lives outside vitest because the script is Node-only and we want
 * to keep the gate's runtime independent of the web workspace.
 *
 * @module scripts/check-bundle-size.test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  stripHash,
  measureChunks,
  compareToBudget,
} from './check-bundle-size.mjs';

test('stripHash strips Rolldown-style content hashes', () => {
  assert.equal(stripHash('SalesPage-Br3xY9Q_.js'), 'SalesPage');
  assert.equal(stripHash('index-PsvtasHJ.js'), 'index');
  assert.equal(stripHash('exceljs.bare.min-BAt46mfP.js'), 'exceljs.bare.min');
  assert.equal(stripHash('jspdf.es.min-Bi663D0h.js'), 'jspdf.es.min');
});

test('stripHash leaves names without a hash suffix unchanged', () => {
  // Defensive: if a chunk ever lands without a hash (custom output
  // option), the strip must not eat the legitimate part of the name.
  assert.equal(stripHash('SalesPage.js'), 'SalesPage.js');
  // Short suffixes (< 6 chars) are part of the name, not a hash.
  assert.equal(stripHash('Some-x.js'), 'Some-x.js');
});

test('measureChunks emits per-file gz size in descending order', () => {
  const dir = mkdtempSync(join(tmpdir(), 'check-bundle-test-'));
  try {
    // Two synthetic chunks: one small, one larger.
    writeFileSync(join(dir, 'SmallChunk-AAAAAAAA.js'), 'a'.repeat(500));
    writeFileSync(join(dir, 'LargeChunk-BBBBBBBB.js'), 'b'.repeat(20_000));
    const measured = measureChunks(dir);
    assert.equal(measured.length, 2);
    // Largest first.
    assert.equal(measured[0].name, 'LargeChunk');
    assert.equal(measured[1].name, 'SmallChunk');
    assert.ok(measured[0].gzKb > measured[1].gzKb);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compareToBudget flags a chunk that overshoots budget + threshold', () => {
  const result = compareToBudget({
    measured: [{ name: 'SalesPage', gzKb: 35 }],
    budget: { SalesPage: 30 },
    thresholdPercent: 5, // ceiling = 31.5
  });
  assert.equal(result.regressions.length, 1);
  assert.equal(result.regressions[0].name, 'SalesPage');
  assert.equal(result.regressions[0].budget, 30);
  assert.equal(result.regressions[0].actual, 35);
  assert.ok(result.regressions[0].deltaPercent > 5);
  assert.equal(result.ok.length, 0);
});

test('compareToBudget keeps a chunk within threshold in the ok bucket', () => {
  const result = compareToBudget({
    measured: [{ name: 'SalesPage', gzKb: 31 }], // 30 * 1.05 = 31.5, fits
    budget: { SalesPage: 30 },
    thresholdPercent: 5,
  });
  assert.equal(result.regressions.length, 0);
  assert.equal(result.ok.length, 1);
  assert.equal(result.ok[0].name, 'SalesPage');
});

test('compareToBudget warns about new chunks not present in the budget', () => {
  const result = compareToBudget({
    measured: [{ name: 'NewlyAddedRoute', gzKb: 12 }],
    budget: {},
    thresholdPercent: 5,
  });
  assert.equal(result.newChunks.length, 1);
  assert.equal(result.newChunks[0].name, 'NewlyAddedRoute');
  // New chunks never count as regressions — only warnings.
  assert.equal(result.regressions.length, 0);
});

test('compareToBudget reports chunks present in budget but missing from the build', () => {
  const result = compareToBudget({
    measured: [{ name: 'SalesPage', gzKb: 20 }],
    budget: { SalesPage: 25, DeletedRoute: 8 },
    thresholdPercent: 5,
  });
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0].name, 'DeletedRoute');
  assert.equal(result.missing[0].budget, 8);
  // The surviving chunk lands in `ok` because it is under budget.
  assert.equal(result.ok.length, 1);
  assert.equal(result.ok[0].name, 'SalesPage');
});
