import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export function hasRequiredChromium(executablePath) {
  return existsSync(executablePath);
}

export async function runCli({ env = process.env } = {}) {
  const browsersPath = env.PLAYWRIGHT_BROWSERS_PATH ?? join(repoRoot, '.playwright-browsers');

  // Playwright pins an exact browser revision. A cache restored from an older
  // Playwright version can contain chromium-* directories while still missing
  // the executable required by the currently installed package. Resolve the
  // current package's executable instead of treating any Chromium directory as
  // a cache hit.
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
  const { chromium } = await import('playwright');

  if (hasRequiredChromium(chromium.executablePath())) {
    return 0;
  }

  const npxCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const installResult = spawnSync(npxCommand, ['playwright', 'install', 'chromium'], {
    cwd: repoRoot,
    env: {
      ...env,
      PLAYWRIGHT_BROWSERS_PATH: browsersPath,
    },
    stdio: 'inherit',
  });

  return installResult.status ?? 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runCli();
}
