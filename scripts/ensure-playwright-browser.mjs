import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const browsersPath =
  process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(repoRoot, '.playwright-browsers');

function hasInstalledChromium(installPath) {
  if (!existsSync(installPath)) {
    return false;
  }

  return readdirSync(installPath, { withFileTypes: true }).some(entry => (
    entry.isDirectory() &&
    (entry.name.startsWith('chromium-') || entry.name.startsWith('chromium_headless_shell-'))
  ));
}

if (hasInstalledChromium(browsersPath)) {
  process.exit(0);
}

const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const installResult = spawnSync(npxCommand, ['playwright', 'install', 'chromium'], {
  cwd: repoRoot,
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: browsersPath,
  },
  stdio: 'inherit',
});

if (installResult.status !== 0) {
  process.exit(installResult.status ?? 1);
}
