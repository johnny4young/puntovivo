import { test as base, expect } from '@playwright/test';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Test-owned server with no business identities; its capability never enters a public API. */
interface EmptyInstallation {
  databasePath: string;
  token: string;
}

export const test = base.extend<{ installation: EmptyInstallation }>({
  installation: async ({ page }, use, testInfo) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'puntovivo-ui-installation-'));
    const databasePath = path.join(directory, 'local.db');
    const child = fork(path.resolve('e2e/shared/installation-server.mjs'), [databasePath], {
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PUNTOVIVO_E2E: '1',
        // Match both existing E2E runners: this accelerated business journey
        // is not a load test. Production/default throttle tests stay separate.
        PUNTOVIVO_GLOBAL_RATE_LIMIT_MAX: '10000',
        PUNTOVIVO_LOG_LEVEL: 'warn',
        PUNTOVIVO_SUPPRESS_CREDENTIAL_BANNER: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const failures: string[] = [];
    child.stderr?.on('data', chunk => failures.push(String(chunk)));
    const exited = once(child, 'exit');
    let completed = false;
    try {
      const ready = await new Promise<{ url: string; token: string }>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Empty installation did not start')),
          30_000
        );
        child.once('error', error => {
          clearTimeout(timeout);
          reject(error);
        });
        child.once('exit', code => {
          clearTimeout(timeout);
          reject(new Error(`Empty installation exited: ${code}`));
        });
        child.once('message', message => {
          clearTimeout(timeout);
          resolve(message as { url: string; token: string });
        });
      });
      // Real browser requests reach a real isolated Fastify process. No API
      // response or business identity is fabricated by this forwarding seam.
      await page.route('**/api/**', async route => {
        const original = new URL(route.request().url());
        const response = await route.fetch({
          url: `${ready.url}${original.pathname}${original.search}`,
        });
        await route.fulfill({ response });
      });
      await use({ databasePath, token: ready.token });
      expect(failures).toEqual([]);
      completed = true;
    } finally {
      await page.unrouteAll({ behavior: 'wait' });
      let forcedExit = false;
      const deadline = setTimeout(() => {
        forcedExit = true;
        child.kill('SIGKILL');
      }, 5_000);
      try {
        if (child.connected) child.send('close');
        else if (child.exitCode === null) child.kill('SIGTERM');
        await exited;
      } finally {
        clearTimeout(deadline);
        if (completed && testInfo.status === testInfo.expectedStatus && !forcedExit) {
          await rm(directory, { recursive: true, force: true });
        } else {
          testInfo.annotations.push({
            type: 'diagnostic',
            description: `Empty installation retained at ${directory}`,
          });
        }
      }
      expect(forcedExit, 'the owned fixture server must shut down gracefully').toBe(false);
    }
  },
});

export { expect };
