import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import {
  classifyElectronStderrLine,
  classifyElectronStdoutLine,
  createElectronStderrClassifier,
} from './electron-process-log-policy.mjs';

// The four lines of the one benign macOS run on record (macos-26 release
// runner, 2026-09-04): a cold spell server, then the teardown task policy pair.
const SPELL_TIMED_OUT =
  '2026-09-04 15:08:21.025 puntovivo[35397:58957] NSSpellServer dataFromCheckingString timed out, index is 1';
const SPELL_SUCCEEDED =
  '2026-09-04 15:08:21.536 puntovivo[35397:58957] NSSpellServer dataFromCheckingString succeeded, index is 0';
const TASK_CATEGORY_POLICY =
  '[35397:0904/150825.687043:ERROR:base/process/process_mac.cc:53] task_policy_set TASK_CATEGORY_POLICY: (os/kern) invalid argument (4)';
const TASK_SUPPRESSION_POLICY =
  '[35397:0904/150825.687108:ERROR:base/process/process_mac.cc:98] task_policy_set TASK_SUPPRESSION_POLICY: (os/kern) invalid argument (4)';

describe('Electron process log policy', () => {
  it('keeps Chromium console INFO visible without treating it as a failure', () => {
    assert.equal(
      classifyElectronStderrLine(
        '[35017:0727/182537.795879:INFO:CONSOLE:851] "[vite] connecting...", source: http://localhost:3000/@vite/client (851)'
      ),
      'informational'
    );
    assert.equal(
      classifyElectronStderrLine(
        '[35017:0727/182537.819082:INFO:CONSOLE:14336] "%cDownload the React DevTools", source: http://localhost:3000/react-dom_client.js (14336)'
      ),
      'informational'
    );
    assert.equal(
      classifyElectronStderrLine(
        'DevTools listening on ws://127.0.0.1:49321/devtools/browser/7c313064-41f5-43fa-a8e8-ce4d92a9ce8c'
      ),
      'informational'
    );
    assert.equal(
      classifyElectronStderrLine(
        'DevTools listening on ws://127.0.0.1:49321/7c313064-41f5-43fa-a8e8-ce4d92a9ce8c'
      ),
      'unexpected'
    );
  });

  it('recognizes only the requested inspector shutdown epilogue as lifecycle noise', () => {
    assert.equal(
      classifyElectronStderrLine(
        'Debugger ending on ws://127.0.0.1:5858/7c313064-41f5-43fa-a8e8-ce4d92a9ce8c'
      ),
      'lifecycle'
    );
    assert.equal(
      classifyElectronStderrLine('Waiting for the debugger to disconnect...'),
      'lifecycle'
    );
  });

  it('keeps the exact upstream macOS netmask diagnostic visible and narrowly non-blocking', () => {
    // Chromium 150 (Electron 43) emits this from line 458; the previous pin
    // was 457 under Chromium 148. Adjacent lines and any other message stay
    // unexpected so each Chromium rebase forces a deliberate re-pin.
    assert.equal(
      classifyElectronStderrLine(
        '[27778:0729/104424.682426:WARNING:net/dns/address_sorter_posix.cc:458] FromSockAddr failed on netmask'
      ),
      'informational'
    );
    assert.equal(
      classifyElectronStderrLine(
        '[27778:0729/104424.682426:WARNING:net/dns/address_sorter_posix.cc:457] FromSockAddr failed on netmask'
      ),
      'unexpected'
    );
    assert.equal(
      classifyElectronStderrLine(
        '[27778:0729/104424.682426:WARNING:net/dns/address_sorter_posix.cc:458] FromSockAddr failed on address'
      ),
      'unexpected'
    );
  });

  it('accepts the headless VA-API probe miss and nothing else from that file', () => {
    assert.equal(
      classifyElectronStderrLine(
        '[5303:0820/035327.571525:WARNING:media/gpu/vaapi/vaapi_wrapper.cc:1655] drmGetDevices2() has not found any devices'
      ),
      'informational'
    );
    // Adjacent line and different message stay blocking, per the exact-pin rule.
    assert.equal(
      classifyElectronStderrLine(
        '[5303:0820/035327.571525:WARNING:media/gpu/vaapi/vaapi_wrapper.cc:1656] drmGetDevices2() has not found any devices'
      ),
      'unexpected'
    );
    assert.equal(
      classifyElectronStderrLine(
        '[5303:0820/035327.571525:WARNING:media/gpu/vaapi/vaapi_wrapper.cc:1655] vaInitialize failed'
      ),
      'unexpected'
    );
  });

  it('accepts the Sequoia backupd XPC refusal only for that exact service', () => {
    assert.equal(
      classifyElectronStderrLine(
        '2026-08-20 03:53:56.839 Puntovivo Helper[23585:38734] XPC error for connection com.apple.backupd.sandbox.xpc: Connection invalid'
      ),
      'informational'
    );
    // Any other XPC service or process stays blocking.
    assert.equal(
      classifyElectronStderrLine(
        '2026-08-20 03:53:56.839 Puntovivo Helper[23585:38734] XPC error for connection com.apple.securityd.xpc: Connection invalid'
      ),
      'unexpected'
    );
    assert.equal(
      classifyElectronStderrLine(
        '2026-08-20 03:53:56.839 Puntovivo[23585:38734] XPC error for connection com.apple.backupd.sandbox.xpc: Connection invalid'
      ),
      'unexpected'
    );
  });

  it('blocks the macOS spell server lines now that the spellchecker is off', () => {
    // These were accepted while Electron's builtin spellchecker was on, from the
    // packaged browser process asking the system spell server to check typed text
    // (macos-26 release runner, 2026-09-04, job 101069511807). Puntovivo turns
    // that spellchecker off for every window and for the session, and the v1.14.3
    // release job logged none of these lines. They stay blocking so a
    // reappearance, which would mean the spellchecker came back, fails the smoke.
    for (const line of [
      SPELL_TIMED_OUT,
      SPELL_SUCCEEDED,
      '2026-09-04 15:08:21.025 puntovivo[35397:58957] NSSpellServer dataFromCheckingString failed, index is 1',
      '2026-09-04 15:08:21.025 puntovivo Helper (Renderer)[35398:58960] NSSpellServer dataFromCheckingString timed out, index is 1',
    ]) {
      assert.equal(classifyElectronStderrLine(line), 'unexpected', line);
    }
  });

  it('names the macOS helper after the packaging config that produces it', () => {
    // The backupd rule matches the helper by productName in
    // apps/desktop/electron-builder.yml. A rename there would turn the rule into
    // dead code and fail the mac smoke with no hint of the cause.
    const config = readFileSync(
      new URL('../apps/desktop/electron-builder.yml', import.meta.url),
      'utf8'
    );
    const productName = config.match(/^productName: (.+?)\s*$/m)?.[1];
    assert.ok(productName, 'expected productName in electron-builder.yml');
    assert.equal(
      classifyElectronStderrLine(
        `2026-08-20 18:41:07.512 ${productName} Helper[4711:58960] XPC error for connection com.apple.backupd.sandbox.xpc: Connection invalid`
      ),
      'informational'
    );
  });

  it('accepts the Chromium 150 task policy teardown pair and nothing else from that file', () => {
    // Lines 53 and 98 of base/process/process_mac.cc in Chromium 150.0.7871.224
    // (Electron 43.4.1); logged once during app quit on the same 2026-09-04 run.
    assert.equal(
      classifyElectronStderrLine(
        '[35397:0904/150825.687043:ERROR:base/process/process_mac.cc:53] task_policy_set TASK_CATEGORY_POLICY: (os/kern) invalid argument (4)'
      ),
      'informational'
    );
    assert.equal(
      classifyElectronStderrLine(
        '[35397:0904/150825.687108:ERROR:base/process/process_mac.cc:98] task_policy_set TASK_SUPPRESSION_POLICY: (os/kern) invalid argument (4)'
      ),
      'informational'
    );
    // Adjacent lines, swapped messages, other kern results, and the reading
    // counterpart stay blocking, so a Chromium rebase forces a deliberate re-pin.
    for (const line of [
      '[35397:0904/150825.687043:ERROR:base/process/process_mac.cc:54] task_policy_set TASK_CATEGORY_POLICY: (os/kern) invalid argument (4)',
      '[35397:0904/150825.687108:ERROR:base/process/process_mac.cc:97] task_policy_set TASK_SUPPRESSION_POLICY: (os/kern) invalid argument (4)',
      '[35397:0904/150825.687043:ERROR:base/process/process_mac.cc:53] task_policy_set TASK_SUPPRESSION_POLICY: (os/kern) invalid argument (4)',
      '[35397:0904/150825.687043:ERROR:base/process/process_mac.cc:53] task_policy_set TASK_CATEGORY_POLICY: (os/kern) failure (5)',
      '[35397:0904/150825.687043:ERROR:base/process/process_mac.cc:38] task_policy_get TASK_CATEGORY_POLICY: (os/kern) invalid argument (4)',
    ]) {
      assert.equal(classifyElectronStderrLine(line), 'unexpected', line);
    }
  });

  it('keeps the recorded benign macOS run clean under the per-run budget', () => {
    const run = createElectronStderrClassifier();
    for (const line of [TASK_CATEGORY_POLICY, TASK_SUPPRESSION_POLICY]) {
      assert.equal(run.classify(line), 'informational', line);
    }
    assert.deepEqual(run.exceededLimits(), []);
  });

  it('blocks a bounded macOS diagnostic once it repeats past its limit in one run', () => {
    // Repetition is the signal a persistent failure gives: task policy calls
    // failing for live children rather than once for an exiting one.
    const run = createElectronStderrClassifier();

    // Both task policy lines share one budget, so two teardown pairs fit and
    // the next line of either kind does not.
    for (let pair = 0; pair < 2; pair += 1) {
      assert.equal(run.classify(TASK_CATEGORY_POLICY), 'informational');
      assert.equal(run.classify(TASK_SUPPRESSION_POLICY), 'informational');
    }
    assert.equal(run.classify(TASK_SUPPRESSION_POLICY), 'unexpected');
    assert.equal(run.classify(TASK_CATEGORY_POLICY), 'unexpected');

    assert.deepEqual(
      run.exceededLimits().map(({ id, count, limit }) => ({ id, count, limit })),
      [{ id: 'chromium-task-policy-teardown', count: 6, limit: 4 }]
    );
    for (const { description } of run.exceededLimits()) {
      assert.match(description, /\S/);
    }
  });

  it('starts every process run with its own budget and counts nothing else', () => {
    const first = createElectronStderrClassifier();
    for (let index = 0; index < 5; index += 1) first.classify(TASK_CATEGORY_POLICY);
    assert.equal(first.exceededLimits().length, 1);

    const second = createElectronStderrClassifier();
    assert.equal(second.classify(TASK_CATEGORY_POLICY), 'informational');
    assert.deepEqual(second.exceededLimits(), []);

    // Unbounded informational lines never spend a budget, unexpected lines stay
    // unexpected, and the per-line classifier itself remains stateless.
    const devtools =
      'DevTools listening on ws://127.0.0.1:9222/devtools/browser/0f6e5b1c-1d1c-4d5e-9c3b-9d2f0b8a7a61';
    for (let index = 0; index < 50; index += 1) {
      assert.equal(second.classify(devtools), 'informational');
    }
    assert.equal(second.classify('[1:2:ERROR:foo.cc:1] something broke'), 'unexpected');
    assert.deepEqual(second.exceededLimits(), []);
    for (let index = 0; index < 10; index += 1) {
      assert.equal(classifyElectronStderrLine(TASK_CATEGORY_POLICY), 'informational');
    }
  });

  it('carries the scoped diagnostics options into a run classifier', () => {
    const raceLine =
      '[33558:0729/105016.628130:WARNING:net/spdy/spdy_session.cc:3154] Received HEADERS for invalid stream 5';
    assert.equal(createElectronStderrClassifier().classify(raceLine), 'unexpected');
    assert.equal(
      createElectronStderrClassifier({ allowPackagedNetworkRaceDiagnostic: true }).classify(
        raceLine
      ),
      'informational'
    );
  });

  it('allows only the exact packaged-CDP startup diagnostic behind an explicit scope', () => {
    const bundleFailure =
      '[33558:0729/105016.628130:INFO:CONSOLE:2] "Electron sandboxed_renderer.bundle.js script failed to run", source: node:electron/js2c/sandbox_bundle (2)';
    const missingStartupData =
      '[33558:0729/105016.628157:INFO:CONSOLE:2] "TypeError: Cannot destructure property \'preloadScripts\' of \'binding.startupData\' as it is null.", source: node:electron/js2c/sandbox_bundle (2)';

    assert.equal(classifyElectronStderrLine(bundleFailure), 'unexpected');
    assert.equal(classifyElectronStderrLine(missingStartupData), 'unexpected');
    assert.equal(
      classifyElectronStderrLine(bundleFailure, {
        allowPackagedCdpStartupDiagnostic: true,
      }),
      'informational'
    );
    assert.equal(
      classifyElectronStderrLine(missingStartupData, {
        allowPackagedCdpStartupDiagnostic: true,
      }),
      'informational'
    );
    assert.equal(
      classifyElectronStderrLine(
        '[33558:0729/105016.628157:INFO:CONSOLE:2] "TypeError: Cannot destructure property \'preloadScripts\' of \'binding.startupData\' as it is undefined.", source: node:electron/js2c/sandbox_bundle (2)',
        { allowPackagedCdpStartupDiagnostic: true }
      ),
      'unexpected'
    );
  });

  it('allows only the exact packaged cancelled-stream diagnostic behind an explicit scope', () => {
    const cancelledStream =
      '[80418:0729/111422.313936:WARNING:net/spdy/spdy_session.cc:3154] Received HEADERS for invalid stream 1';

    assert.equal(classifyElectronStderrLine(cancelledStream), 'unexpected');
    assert.equal(
      classifyElectronStderrLine(cancelledStream, {
        allowPackagedNetworkRaceDiagnostic: true,
      }),
      'informational'
    );
    assert.equal(
      classifyElectronStderrLine(
        '[80418:0729/111422.313936:WARNING:net/spdy/spdy_session.cc:3155] Received HEADERS for invalid stream 1',
        { allowPackagedNetworkRaceDiagnostic: true }
      ),
      'unexpected'
    );
    assert.equal(
      classifyElectronStderrLine(
        '[80418:0729/111422.313936:WARNING:net/spdy/spdy_session.cc:3154] Received HEADERS for invalid stream 0',
        { allowPackagedNetworkRaceDiagnostic: true }
      ),
      'unexpected'
    );
    assert.equal(
      classifyElectronStderrLine(
        '[80418:0729/111422.313936:WARNING:net/spdy/spdy_session.cc:3154] Received DATA for invalid stream 1',
        { allowPackagedNetworkRaceDiagnostic: true }
      ),
      'unexpected'
    );
  });

  it('keeps warnings, errors, crashes, and unknown stderr blocking', () => {
    assert.equal(
      classifyElectronStderrLine('[35017:0727/182537.795879:WARNING:CONSOLE:851] renderer warning'),
      'unexpected'
    );
    assert.equal(
      classifyElectronStderrLine('[35017:0727/182537.795879:ERROR:CONSOLE:851] renderer error'),
      'unexpected'
    );
    assert.equal(classifyElectronStderrLine('dyld: Library not loaded'), 'unexpected');
    assert.equal(classifyElectronStderrLine('Segmentation fault: 11'), 'unexpected');
    assert.equal(
      classifyElectronStderrLine(
        '[41916:0727/214743.048395:INFO:CONSOLE:1] "Connecting to http://127.0.0.1:53990 violates Content Security Policy. The action has been blocked."'
      ),
      'unexpected'
    );
    assert.equal(
      classifyElectronStderrLine(
        '[41916:0727/214743.048513:INFO:CONSOLE:1] "Fetch API cannot load the request. Refused to connect."'
      ),
      'unexpected'
    );
    assert.equal(
      classifyElectronStderrLine(
        '[92525:0727/221205.771432:INFO:CONSOLE:2] "Electron sandboxed_renderer.bundle.js script failed to run", source: node:electron/js2c/sandbox_bundle (2)'
      ),
      'unexpected'
    );
    assert.equal(
      classifyElectronStderrLine(
        '[92525:0727/221205.771457:INFO:CONSOLE:2] "TypeError: Cannot destructure property preloadScripts of binding.startupData as it is null.", source: node:electron/js2c/sandbox_bundle (2)'
      ),
      'unexpected'
    );
  });

  it('blocks structured warning and error logs written to stdout', () => {
    assert.equal(
      classifyElectronStdoutLine('{"level":40,"module":"sync","msg":"retrying"}'),
      'unexpected'
    );
    assert.equal(
      classifyElectronStdoutLine('{"level":50,"module":"trpc","msg":"procedure error"}'),
      'unexpected'
    );
    assert.equal(
      classifyElectronStdoutLine('{"level":30,"module":"trpc","msg":"procedure ok"}'),
      'informational'
    );
    assert.equal(classifyElectronStdoutLine('ordinary tool output'), 'informational');
  });
});
