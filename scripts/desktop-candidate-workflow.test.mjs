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

test('manual macOS evidence is pinned to Sequoia and Tahoe on Apple Silicon', () => {
  assert.match(workflow, /- os: macos-15[\s\S]*support_target: macos-15-sequoia-arm64/);
  assert.match(workflow, /- os: macos-26[\s\S]*support_target: macos-26-tahoe-arm64/);
  assert.match(workflow, /actual_version="\$\(sw_vers -productVersion\)"/);
  assert.match(workflow, /test "\$\(uname -m\)" = arm64/);
  assert.doesNotMatch(workflow, /runs-on: macos-latest/);
  assert.match(workflow, /--host-os-version "\$host_os_version"/);
  assert.match(workflow, /--support-target "\$\{\{ matrix\.support_target \}\}"/);
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
    2,
    'macOS and Windows must prove the packaged renderer journey directly'
  );
  assert.equal(
    (
      workflow.match(
        /node scripts\/run-desktop-smoke\.mjs --against-packaged apps\/desktop\/out-builder/g
      ) ?? []
    ).length,
    4
  );
  assert.doesNotMatch(workflow, /run-desktop-smoke\.mjs[^\n]*--structure-only/);
  assert.match(
    workflow,
    /xvfb-run -a -s "-screen 0 1280x1024x24 -extension MIT-SHM" dbus-run-session -- node scripts\/run-linux-desktop-smoke\.mjs --against-packaged apps\/desktop\/out-builder/
  );
  assert.doesNotMatch(workflow, /dbus-run-session -- xvfb-run/);
  assert.match(workflow, /python3-dbus python3-gi/);
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
  assert.equal(
    (workflow.match(/node scripts\/run-packaged-recovery-rehearsal\.mjs/g) ?? []).length,
    3,
    'every packaged platform must execute recovery inside its Electron binary'
  );
  assert.match(
    workflow,
    /xvfb-run -a -s "-screen 0 1280x1024x24 -extension MIT-SHM" dbus-run-session -- node scripts\/run-packaged-recovery-rehearsal\.mjs/
  );
  assert.equal((workflow.match(/--recovery-evidence /g) ?? []).length, 3);
  assert.doesNotMatch(workflow, /--renderer-smoke not-assessed/);
  assert.doesNotMatch(workflow, /--distribution-trust/);
  assert.equal((workflow.match(/if-no-files-found: error/g) ?? []).length, 3);
  assert.equal(
    (workflow.match(/apps\/desktop\/out-builder\/candidate-evidence-\*\.json/g) ?? []).length,
    3
  );
  assert.equal(
    (workflow.match(/apps\/desktop\/out-builder\/packaged-recovery-\*\.json/g) ?? []).length,
    3
  );
  assert.equal(
    (workflow.match(/if: \$\{\{ !cancelled\(\) && !inputs\.validate_only \}\}/g) ?? []).length,
    3,
    'artifact upload must retain sanitized failure evidence after a blocking rehearsal'
  );
});
