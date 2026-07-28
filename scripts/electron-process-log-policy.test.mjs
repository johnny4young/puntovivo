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
