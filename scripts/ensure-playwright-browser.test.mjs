import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { hasRequiredChromium } from './ensure-playwright-browser.mjs';

test('hasRequiredChromium checks the exact Playwright executable', () => {
  const root = mkdtempSync(join(tmpdir(), 'puntovivo-playwright-'));

  try {
    const staleBrowser = join(root, 'chromium-older');
    const requiredExecutable = join(root, 'chromium-current', 'chrome');
    mkdirSync(staleBrowser, { recursive: true });

    assert.equal(hasRequiredChromium(requiredExecutable), false);

    mkdirSync(join(root, 'chromium-current'), { recursive: true });
    writeFileSync(requiredExecutable, 'browser');
    assert.equal(hasRequiredChromium(requiredExecutable), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
