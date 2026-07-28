import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(
  new URL('../.github/workflows/build-desktop.yml', import.meta.url),
  'utf8'
);

test('manual desktop builds require and verify one immutable candidate SHA', () => {
  assert.match(
    workflow,
    /candidate_sha:\s*\n\s+description: 'Immutable 40-character commit SHA to validate\/package'\s*\n\s+type: string\s*\n\s+required: true/
  );
  assert.match(workflow, /\^\[0-9a-fA-F\]\{40\}\$/);
  assert.match(workflow, /ACTUAL_SHA=\$\(git rev-parse HEAD\)/);
  assert.match(workflow, /checked-out HEAD \$ACTUAL_SHA does not match requested candidate/);

  const candidateCheckouts =
    workflow.match(/ref: \$\{\{ needs\.verify-candidate\.outputs\.sha \}\}/g) ?? [];
  assert.equal(candidateCheckouts.length, 3, 'every platform must checkout the verified SHA');
});

test('every full platform build starts clean, smokes the package, and uploads evidence', () => {
  assert.equal(
    (workflow.match(/node scripts\/clean-paths\.mjs apps\/desktop\/out-builder/g) ?? []).length,
    3
  );
  assert.equal(
    (
      workflow.match(
        /run-desktop-smoke\.mjs --against-packaged apps\/desktop\/out-builder --renderer/g
      ) ?? []
    ).length,
    3,
    'every platform must prove the packaged renderer journey'
  );
  assert.equal(
    (
      workflow.match(
        /node scripts\/run-desktop-smoke\.mjs --against-packaged apps\/desktop\/out-builder/g
      ) ?? []
    ).length,
    6
  );
  assert.doesNotMatch(workflow, /run-desktop-smoke\.mjs[^\n]*--structure-only/);
  assert.equal(
    (
      workflow.match(
        /xvfb-run -a dbus-run-session -- node scripts\/run-desktop-smoke\.mjs --against-packaged apps\/desktop\/out-builder/g
      ) ?? []
    ).length,
    2,
    'Linux portal activation must inherit the Xvfb display for both smoke journeys'
  );
  assert.doesNotMatch(workflow, /dbus-run-session -- xvfb-run/);
  assert.match(
    workflow,
    /sudo chown root:root apps\/desktop\/out-builder\/linux-unpacked\/chrome-sandbox/
  );
  assert.match(
    workflow,
    /sudo chmod 4755 apps\/desktop\/out-builder\/linux-unpacked\/chrome-sandbox/
  );
  assert.match(
    workflow,
    /electron-builder --mac --publish never -c\.mac\.identity=-[\s\S]*CSC_IDENTITY_AUTO_DISCOVERY: 'false'/
  );
  assert.equal((workflow.match(/uses:\s+pnpm\/action-setup/g) ?? []).length, 0);
  assert.equal(
    (
      workflow.match(
        /npm install --global "pnpm@\$pnpmVersion" --ignore-scripts --no-audit --no-fund/g
      ) ?? []
    ).length,
    3
  );
  assert.equal(
    (workflow.match(/node scripts\/collect-desktop-candidate-evidence\.mjs/g) ?? []).length,
    3
  );
  assert.equal((workflow.match(/--structure-smoke passed/g) ?? []).length, 3);
  assert.equal((workflow.match(/--runtime-smoke passed/g) ?? []).length, 3);
  assert.equal((workflow.match(/--renderer-smoke passed/g) ?? []).length, 3);
  assert.doesNotMatch(workflow, /--renderer-smoke not-assessed/);
  assert.doesNotMatch(workflow, /--distribution-trust/);
  assert.equal((workflow.match(/if-no-files-found: error/g) ?? []).length, 3);
  assert.equal(
    (workflow.match(/apps\/desktop\/out-builder\/candidate-evidence-\*\.json/g) ?? []).length,
    3
  );
});
