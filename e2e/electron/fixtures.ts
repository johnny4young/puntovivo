/**
 * Playwright fixtures for the Electron smoke suite.
 *
 * Exposes two fixtures:
 *
 * - `electronApp` — an `ElectronApplication` launched from
 * `apps/desktop/.vite/build/index.cjs` with its `userData` dir
 * pointed at `ELECTRON_E2E_USER_DATA_DIR`. The launch happens
 * once per test file (scope `worker`) and closes in `afterAll`.
 * - `page` — the first window the Electron app opens, awaited via
 * `electronApp.firstWindow()`. One `page` per test.
 *
 * The renderer sandbox invariant still holds: Playwright
 * drives the renderer as a regular browser page via
 * `electronApp.firstWindow()`, NOT via any privileged channel.
 *
 * `ELECTRON_E2E_USER_DATA_DIR` is shared with `global-setup.ts` so
 * the DB materialised there is the one the launched Electron sees.
 * The constant lives in this module because fixtures run in a
 * different worker process than globalSetup — a cross-process env
 * var would be flaky; a module-level constant both sides import is
 * stable.
 *
 * @module e2e/electron/fixtures
 */

import { test as base, _electron, type ElectronApplication, type Page } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

/**
 * Per-suite Electron userData directory. Both the global-setup (which
 * pre-seeds the DB) and the fixtures (which launch Electron) compute
 * the same absolute path so they share the underlying sqlite file.
 *
 * Lives under `test-results/` because it is machine-local test output,
 * not source. Gitignored via the existing `test-results/` entry.
 */
export const ELECTRON_E2E_USER_DATA_DIR = resolve(
  process.cwd(),
  'test-results',
  'electron-userdata'
);
export const ELECTRON_E2E_DB_KEY =
  'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';

/**
 * Compiled Electron main entry. Electron Forge's Vite plugin emits
 * this during `npm run dev:desktop` and `npm run package:desktop`.
 * `test:e2e:electron` verifies the artefact exists before Playwright
 * starts and prints the rebuild command when it is missing.
 */
const ELECTRON_MAIN_ENTRY = resolve(process.cwd(), 'apps/desktop/.vite/build/index.cjs');
const requireFromDesktopWorkspace = createRequire(
  resolve(process.cwd(), 'apps/desktop/package.json')
);
const ELECTRON_EXECUTABLE_PATH = requireFromDesktopWorkspace('electron') as string;

function ensureNativeRuntime(runtime: 'node' | 'electron'): void {
  const result = spawnSync(process.execPath, ['scripts/ensure-native-runtime.mjs', runtime], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`Unable to prepare ${runtime} native runtime for Electron E2E`);
  }
}

function forwardElectronProcessLogs(child: ChildProcess): void {
  child.stdout?.on('data', chunk => {
    process.stdout.write(`[electron:stdout] ${String(chunk)}`);
  });
  child.stderr?.on('data', chunk => {
    process.stderr.write(`[electron:stderr] ${String(chunk)}`);
  });
  child.once('exit', (code, signal) => {
    if (code !== 0 || signal) {
      process.stderr.write(
        `[electron:exit] Electron exited before/after smoke with code=${String(code)} signal=${String(signal)}\n`
      );
    }
  });
}

function formatFirstWindowFailure(error: unknown, child: ChildProcess): Error {
  const originalMessage = error instanceof Error ? error.message : String(error);
  return new Error(
    [
      'Electron closed before opening the first renderer window.',
      `Electron process exitCode=${String(child.exitCode)} signal=${String(child.signalCode)}.`,
      'Common causes: stale Electron.app download, wrong native ABI for better-sqlite3 or argon2, macOS code-signing rejection, missing main/preload bundle, or no renderer web server on port 3000.',
      'First recovery path: npm run electron:ensure:binary --workspace=@puntovivo/desktop',
      'Second recovery path: npm run rebuild --workspace=@puntovivo/desktop',
      'If macOS DiagnosticReports mention CODESIGNING Invalid Page, rerun the Electron UI smoke from a normal terminal session with GUI launch permissions.',
      `Original Playwright error: ${originalMessage}`,
    ].join('\n')
  );
}

interface ElectronFixtures {
  page: Page;
}

interface ElectronWorkerFixtures {
  electronApp: ElectronApplication;
}

export const electronTest = base.extend<ElectronFixtures, ElectronWorkerFixtures>({
  electronApp: [
    async ({}, use) => {
      // Playwright globalSetup runs in Node and imports `better-sqlite3`
      // through the compiled DB bootstrap to seed the DB. Swap to
      // Electron's native ABI only after globalSetup has finished and
      // immediately before the Electron main process imports the
      // embedded server.
      ensureNativeRuntime('electron');
      let electronApp: ElectronApplication | null = null;

      try {
        electronApp = await _electron.launch({
          executablePath: ELECTRON_EXECUTABLE_PATH,
          args: [ELECTRON_MAIN_ENTRY, `--user-data-dir=${ELECTRON_E2E_USER_DATA_DIR}`],
          // Disable the first-run update check + keep the smoke
          // deterministic by suppressing the auto-updater side-channel.
          env: {
            ...process.env,
            ELECTRON_ENABLE_LOGGING: '1',
            ELECTRON_ENABLE_STACK_DUMPING: '1',
            PUNTOVIVO_DB_KEY: ELECTRON_E2E_DB_KEY,
            PUNTOVIVO_E2E: '1',
          },
        });
        forwardElectronProcessLogs(electronApp.process());

        await use(electronApp);
      } finally {
        if (electronApp) {
          // On macOS the default Electron contract keeps the app process
          // alive after the last BrowserWindow closes. Playwright's
          // ElectronApplication.close() closes the window, but that is not
          // enough for Puntovivo's tray-aware main process to reach
          // `will-quit`, so the smoke can hang after the assertion already
          // passed. Ask the real app to quit first, then let Playwright wait
          // for the process teardown.
          await electronApp.evaluate(({ app }) => {
            app.quit();
            setTimeout(() => {
              app.exit(0);
            }, 1_000);
          });
          await electronApp.close();
        }
        // Leave the checkout ready for Node-based server tests after a
        // local Electron smoke run.
        ensureNativeRuntime('node');
      }
    },
    { scope: 'worker' },
  ],
  page: [
    async ({ electronApp }, use) => {
      let page: Page;
      try {
        page = await electronApp.firstWindow();
      } catch (error) {
        throw formatFirstWindowFailure(error, electronApp.process());
      }
      await use(page);
    },
    { scope: 'test' },
  ],
});

export { expect } from '@playwright/test';
