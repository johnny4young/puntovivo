import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  buildMainWindowWebPreferences,
  MAIN_WINDOW_WEB_PREFERENCES,
} from '../window-config.ts';

// ENG-004 regression pin. These assertions encode the renderer security
// invariant: the main BrowserWindow runs sandboxed, contextIsolation stays
// on, and nodeIntegration stays off. Any edit to window-config.ts that
// weakens these must be blocked at CI.
//
// Run via `npm run test --workspace=@puntovivo/desktop` — the script
// invokes `node --test --experimental-strip-types` so no transpiler is
// needed. The import path uses `.ts` because strip-types consumes the
// source directly.
describe('MAIN_WINDOW_WEB_PREFERENCES (ENG-004)', () => {
  it('locks the main BrowserWindow to sandbox mode', () => {
    assert.equal(
      MAIN_WINDOW_WEB_PREFERENCES.sandbox,
      true,
      'sandbox must stay true; flipping it back to false re-exposes the renderer to the filesystem and Node APIs.'
    );
  });

  it('keeps contextIsolation on', () => {
    assert.equal(
      MAIN_WINDOW_WEB_PREFERENCES.contextIsolation,
      true,
      'contextIsolation is the second pillar of the renderer sandbox; disabling it lets preload state leak into the page.'
    );
  });

  it('keeps nodeIntegration off', () => {
    assert.equal(
      MAIN_WINDOW_WEB_PREFERENCES.nodeIntegration,
      false,
      'nodeIntegration: true would expose Node globals directly to the renderer; every capability must flow through the contextBridge instead.'
    );
  });

  it('builds the exact BrowserWindow webPreferences with the secure flags intact', () => {
    const preloadPath = '/tmp/puntovivo/preload/index.cjs';

    assert.deepEqual(buildMainWindowWebPreferences(preloadPath), {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    });
  });
});
