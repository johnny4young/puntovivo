import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readRepoFile(relativePath) {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('the isolated-journey lane remains complete, serial, and single-attempt', () => {
  const packageJson = JSON.parse(readRepoFile('package.json'));
  const ordinaryCommand = packageJson.scripts['test:e2e:web'];

  assert.equal(typeof ordinaryCommand, 'string');
  assert.match(ordinaryCommand, /--grep-invert ["']@long-shift-soak\|@isolated-journey["']/);
  assert.match(ordinaryCommand, /--grep @isolated-journey --workers=1 --forbid-only/);
  assert.match(ordinaryCommand, /--config=playwright\.web-heavy\.config\.ts/);
  assert.doesNotMatch(ordinaryCommand, /--retries(?:=| )/);

  const config = readRepoFile('playwright.web.config.ts');
  assert.match(config, /retries:\s*0/);
  const heavyConfig = readRepoFile('playwright.web-heavy.config.ts');
  assert.match(heavyConfig, /playwright\.web\.config\.js/);
  assert.match(heavyConfig, /test-results\/playwright-web-heavy/);
  assert.match(heavyConfig, /playwright-report\/web-heavy/);

  const isolatedSpecs = [
    'e2e/web/pharmacy-operations.spec.ts',
    'e2e/web/pharmacy-roles.spec.ts',
    'e2e/web/pharmacy-transfers.spec.ts',
    'e2e/web/first-owner-retail.spec.ts',
    'e2e/web/fiscal-intent-recovery.spec.ts',
  ];
  const isolated = isolatedSpecs.map(readRepoFile).join('\n');
  assert.equal((isolated.match(/@isolated-journey/g) ?? []).length, isolatedSpecs.length);
  const pharmacy = isolatedSpecs.slice(0, 3).map(readRepoFile).join('\n');
  for (const journey of [
    'runPharmacyOtcCustodyJourney',
    'runPharmacyPrescriptionJourney',
    'runPharmacyRecallReturnJourney',
    'runPharmacyExpiryPolicyJourney',
  ]) {
    assert.match(pharmacy, new RegExp(journey));
  }
});
