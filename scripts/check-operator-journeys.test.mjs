import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { validateOperatorJourneyContract } from './check-operator-journeys.mjs';

let root;

before(() => {
  root = mkdtempSync(join(tmpdir(), 'puntovivo-journeys-'));
  writeFileSync(
    join(root, 'journey.spec.ts'),
    "test('round trip', async ({ page }) => { await page.reload(); })\n"
  );
});

after(() => rmSync(root, { recursive: true, force: true }));

function fixture() {
  return {
    version: 1,
    requiredJourneyIds: ['round-trip'],
    variantAxes: {
      languages: ['en'],
      viewports: ['desktop'],
      interactionModes: ['keyboard'],
      continuity: ['reload'],
    },
    journeys: [
      {
        id: 'round-trip',
        owner: 'cashier',
        area: 'sell',
        evidenceFile: 'journey.spec.ts',
        testTitle: 'round trip',
        languages: ['en'],
        viewports: ['desktop'],
        interactionModes: ['keyboard'],
        continuity: ['reload'],
      },
    ],
  };
}

test('accepts a complete contract with exact executable evidence', () => {
  assert.deepEqual(validateOperatorJourneyContract(fixture(), { repoRoot: root }), []);
});

test('rejects missing journeys, matrix variants and drifted titles', () => {
  const contract = fixture();
  contract.requiredJourneyIds.push('refund');
  contract.variantAxes.languages.push('es');
  contract.journeys[0].testTitle = 'renamed test';
  const issues = validateOperatorJourneyContract(contract, { repoRoot: root });
  assert.ok(issues.some(issue => issue.includes('required journey is missing: refund')));
  assert.ok(issues.some(issue => issue.includes('languages variant: es')));
  assert.ok(issues.some(issue => issue.includes('exact test title drifted')));
});

test('rejects continuity metadata that has no matching runtime assertion', () => {
  const contract = fixture();
  const issues = validateOperatorJourneyContract(contract, {
    repoRoot: root,
    readSource: () => "test('round trip', async () => {})\n",
  });
  assert.ok(issues.some(issue => issue.includes('without a reload assertion')));
});

test('does not mistake Playwright test.step for the next test declaration', () => {
  const issues = validateOperatorJourneyContract(fixture(), {
    repoRoot: root,
    readSource: () =>
      "test('round trip', async ({ page }) => { await test.step('prepare', async () => {}); await page.reload(); })\n",
  });
  assert.deepEqual(issues, []);
});

test('rejects a title that appears only in commentary or as a partial test title', () => {
  const contract = fixture();
  for (const source of [
    "// test coverage for round trip\ntest('different title', async ({ page }) => page.reload())\n",
    "test('round trip with an extra suffix', async ({ page }) => page.reload())\n",
  ]) {
    const issues = validateOperatorJourneyContract(contract, {
      repoRoot: root,
      readSource: () => source,
    });
    assert.ok(issues.some(issue => issue.includes('exact test title drifted')));
  }
});
