import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyElectronStderrLine,
  classifyElectronStdoutLine,
} from './electron-process-log-policy.mjs';

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
