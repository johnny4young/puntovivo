/**
 * Playwright fixtures for the Electron smoke suite.
 *
 * Exposes two fixtures:
 *
 * - `desktopRenderer` — the renderer under test. Without
 * PUNTOVIVO_PACKAGED_APP it launches the dev bundle from
 * `apps/desktop/.vite/build/index.cjs`; with it, the packaged
 * build, driven over CDP. One app per test, each against its own
 * copy of the seeded userData template.
 * - `page` — the first window the Electron app opens, awaited via
 * `electronApp.firstWindow()`. One `page` per test.
 *
 * The renderer sandbox invariant still holds: Playwright
 * drives the renderer as a regular browser page via
 * `electronApp.firstWindow()`, NOT via any privileged channel.
 *
 * `ELECTRON_E2E_TEMPLATE_DIR` is shared with `global-setup.ts`: it
 * seeds the template once, and every test copies it. The constants
 * live in this module because fixtures run in a different worker
 * process than globalSetup — a cross-process env var would be
 * flaky; module-level constants both sides import are stable.
 *
 * @module e2e/electron/fixtures
 */

import {
  test as base,
  _electron,
  chromium,
  type Browser,
  type ElectronApplication,
  type Page,
} from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
// @ts-expect-error -- plain .mjs helper shared with the packaged smoke script.
import { resolvePackagedBinary } from '../../scripts/lib/packaged-binary.mjs';
// @ts-expect-error -- pure .mjs policy shared with Node's desktop quality gate.
import {
  classifyElectronStderrLine,
  classifyElectronStdoutLine,
} from '../../scripts/electron-process-log-policy.mjs';
// @ts-expect-error -- pure .mjs constants shared with the Playwright config.
import {
  ELECTRON_E2E_API_HOST,
  ELECTRON_E2E_API_PORT,
  ELECTRON_E2E_API_URL,
} from '../../scripts/electron-e2e-runtime.mjs';

/**
 * Per-suite Electron userData directory. Both the global-setup (which
 * pre-seeds the DB) and the fixtures (which launch Electron) compute
 * the same absolute path so they share the underlying sqlite file.
 *
 * Lives under `test-results/` because it is machine-local test output,
 * not source. Gitignored via the existing `test-results/` entry.
 */
/**
 * Seeded template built once by global-setup. Tests never launch against it —
 * they copy it — so its contents stay pristine for the whole run.
 */
export const ELECTRON_E2E_TEMPLATE_DIR = resolve(
  process.cwd(),
  'test-results',
  'electron-userdata-template'
);

/** Parent of the per-test userData directories. */
export const ELECTRON_E2E_USER_DATA_ROOT = resolve(
  process.cwd(),
  'test-results',
  'electron-userdata'
);

/**
 * A private userData directory for one test, copied from the seeded template.
 *
 * Sharing one directory across tests looked fine while the suite had a single
 * spec. With two, the device identity registered by whichever test ran first
 * leaked into the next one and surfaced as an unrelated 403 on the first
 * authenticated request — the suite became order-dependent. Copying the
 * template is what makes each test independent, and it is far cheaper than
 * re-running migrations and seeding per test.
 */
export function createIsolatedUserDataDir(label: string): string {
  const slug = label.replace(/[^a-z0-9]+/gi, '-').slice(0, 60);
  const dir = mkdtempSync(join(ELECTRON_E2E_USER_DATA_ROOT, `${slug}-`));
  cpSync(ELECTRON_E2E_TEMPLATE_DIR, dir, { recursive: true });
  return dir;
}
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

/**
 * Packaging output to run against, when the operator wants the journeys proven
 * on the artefact that actually ships rather than the dev bundle.
 *
 * The two targets differ in three ways that all have to move together:
 * the packaged app IS the executable (its main lives inside the asar, so there
 * is no entry argument), it carries its own native modules (so the ABI swap
 * must not run), and it serves the renderer from puntovivo-app://app (so the
 * Vite dev server is not involved).
 */
export const PACKAGED_APP_DIR = process.env.PUNTOVIVO_PACKAGED_APP ?? '';
export const IS_PACKAGED_RUN = PACKAGED_APP_DIR.length > 0;

/** Dev-bundle launch target. The packaged app is driven over CDP instead. */
function resolveDevLaunchTarget(): { executablePath: string; args: string[] } {
  return {
    executablePath: requireFromDesktopWorkspace('electron') as string,
    args: [ELECTRON_MAIN_ENTRY],
  };
}

/** Absolute path to the executable inside the packaging output. */
export function packagedExecutablePath(): string {
  return resolvePackagedBinary(resolve(process.cwd(), PACKAGED_APP_DIR));
}

/**
 * Isolate Chromium's own credential store for a packaged run.
 *
 * Chromium initialises cookie/password crypto before `app.whenReady`. On a
 * signed-but-not-notarized bundle macOS blocks on the global Chrome Safe
 * Storage item and the app never opens a window — the launch just times out —
 * and headless Linux runners may have no libsecret at all. The application's
 * own database key is already injected through PUNTOVIVO_DB_KEY, so this only
 * covers the layer underneath it. safeStorage itself has hermetic main-process
 * tests and never needs to touch the operator's keychain during E2E.
 */
function credentialStoreArgs(): string[] {
  if (process.platform === 'darwin') return ['--use-mock-keychain'];
  if (process.platform === 'linux') return ['--password-store=basic'];
  return [];
}

/**
 * The automation window is repeatedly reloaded and may be considered
 * backgrounded by macOS while Playwright owns focus. Keep Chromium from
 * changing renderer task policies during those transitions: besides making
 * timing deterministic, this avoids a macOS task_policy_set failure that
 * Chromium otherwise prints as an ERROR even though the journey succeeds.
 */
function e2eRendererSchedulingArgs(): string[] {
  return [
    '--disable-backgrounding-occluded-windows',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
  ];
}

function ensureNativeRuntime(runtime: 'node' | 'electron'): void {
  const result = spawnSync(process.execPath, ['scripts/ensure-native-runtime.mjs', runtime], {
    cwd: process.cwd(),
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`Unable to prepare ${runtime} native runtime for Electron E2E`);
  }
}

function forwardElectronProcessLogs(
  child: ChildProcess,
  options: {
    allowPackagedCdpStartupDiagnostic?: boolean;
    allowPackagedNetworkRaceDiagnostic?: boolean;
  } = {}
): { assertClean: () => void } {
  const unexpectedOutput: string[] = [];
  let stdoutBuffer = '';
  let stderrBuffer = '';
  const forwardStdoutLine = (line: string) => {
    if (line.length === 0) return;
    if (classifyElectronStdoutLine(line) === 'unexpected') {
      unexpectedOutput.push(line);
      process.stderr.write(`[electron:log] ${line}\n`);
    } else {
      process.stdout.write(`[electron:stdout] ${line}\n`);
    }
  };
  const forwardStderrLine = (line: string) => {
    const classification = classifyElectronStderrLine(line, options);
    if (classification === 'lifecycle') return;
    if (classification === 'informational') {
      process.stdout.write(`[electron:info] ${line}\n`);
    } else {
      unexpectedOutput.push(line);
      process.stderr.write(`[electron:stderr] ${line}\n`);
    }
  };
  const flushStdoutBuffer = () => {
    if (stdoutBuffer.length === 0) return;
    const trailingLine = stdoutBuffer;
    stdoutBuffer = '';
    forwardStdoutLine(trailingLine);
  };
  const flushStderrBuffer = () => {
    if (stderrBuffer.length === 0) return;
    const trailingLine = stderrBuffer;
    stderrBuffer = '';
    forwardStderrLine(trailingLine);
  };
  child.stdout?.on('data', chunk => {
    stdoutBuffer += String(chunk);
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      forwardStdoutLine(line);
    }
  });
  child.stdout?.once('end', () => {
    flushStdoutBuffer();
  });
  child.stderr?.on('data', chunk => {
    stderrBuffer += String(chunk);
    const lines = stderrBuffer.split(/\r?\n/);
    stderrBuffer = lines.pop() ?? '';
    for (const line of lines) {
      forwardStderrLine(line);
    }
  });
  child.stderr?.once('end', () => {
    flushStderrBuffer();
  });
  child.once('exit', (code, signal) => {
    if (code !== 0 || signal) {
      const line = `Electron exited before/after smoke with code=${String(code)} signal=${String(signal)}`;
      unexpectedOutput.push(line);
      process.stderr.write(`[electron:exit] ${line}\n`);
    }
  });
  return {
    assertClean: () => {
      flushStdoutBuffer();
      flushStderrBuffer();
      if (unexpectedOutput.length > 0) {
        throw new Error(
          `Electron emitted unexpected diagnostics:\n${unexpectedOutput
            .map(line => `- ${line}`)
            .join('\n')}`
        );
      }
    },
  };
}

function formatFirstWindowFailure(error: unknown, child: ChildProcess): Error {
  const originalMessage = error instanceof Error ? error.message : String(error);
  return new Error(
    [
      'Electron closed before opening the first renderer window.',
      `Electron process exitCode=${String(child.exitCode)} signal=${String(child.signalCode)}.`,
      `Common causes: stale Electron.app download, wrong native ABI for better-sqlite3 or argon2, macOS code-signing rejection, missing main/preload bundle, no renderer web server on port 3000, or no isolated API on ${ELECTRON_E2E_API_URL}.`,
      'First recovery path: npm run electron:ensure:binary --workspace=@puntovivo/desktop',
      'Second recovery path: npm run rebuild --workspace=@puntovivo/desktop',
      'If macOS DiagnosticReports mention CODESIGNING Invalid Page, rerun the Electron UI smoke from a normal terminal session with GUI launch permissions.',
      `Original Playwright error: ${originalMessage}`,
    ].join('\n')
  );
}

interface ElectronFixtures {
  page: Page;
  /**
   * The renderer under test, launched fresh for each test.
   *
   * A single fixture owns the dev/packaged branch on purpose: listing both as
   * dependencies of `page` would make Playwright set up BOTH targets for every
   * run, launching an app the suite is not testing.
   */
  desktopRenderer: Page;
}

interface ElectronWorkerFixtures {
  electronApp: ElectronApplication;
}

/**
 * Attach to the packaged application's renderer over CDP.
 *
 * Playwright's `_electron.launch()` cannot drive the shipped artefact: the
 * packaging fuses set RunAsNode and EnableNodeCliInspectArguments to Disabled,
 * which is exactly the hardening we want, so the main process is deliberately
 * not attachable. Weakening the fuses to let a test in would defeat their
 * purpose, so the packaged suite drives the renderer as an ordinary page —
 * the same surface a user has, and the same approach the packaged smoke uses.
 */
async function launchPackagedRenderer(userDataDir: string): Promise<{
  page: Page;
  dispose: () => Promise<void>;
}> {
  const port = await reserveLoopbackPort();
  const child = spawn(
    packagedExecutablePath(),
    [
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${port}`,
      '--remote-debugging-address=127.0.0.1',
      ...credentialStoreArgs(),
      ...e2eRendererSchedulingArgs(),
    ],
    {
      env: {
        ...process.env,
        ELECTRON_ENABLE_LOGGING: '1',
        PUNTOVIVO_DB_KEY: ELECTRON_E2E_DB_KEY,
        PUNTOVIVO_E2E: '1',
        PUNTOVIVO_LOG_LEVEL: 'warn',
        PUNTOVIVO_SUPPRESS_CREDENTIAL_BANNER: 'true',
        AUTO_UPDATE: 'false',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  const processLogs = forwardElectronProcessLogs(child, {
    allowPackagedCdpStartupDiagnostic: true,
    allowPackagedNetworkRaceDiagnostic: true,
  });

  const endpoint = `http://127.0.0.1:${port}`;
  let browser: Browser | null = null;
  try {
    await waitForDevtools(endpoint, child);
    const connectedBrowser = await chromium.connectOverCDP(endpoint);
    browser = connectedBrowser;
    const context = connectedBrowser.contexts()[0];
    if (!context) throw new Error('packaged renderer exposed no browser context');
    const page =
      context.pages().find(candidate => candidate.url().startsWith('puntovivo-app:')) ??
      context.pages()[0] ??
      (await context.waitForEvent('page', { timeout: 60_000 }));
    await page.waitForLoadState('domcontentloaded');
    const preloadContract = await page.evaluate(async () => {
      if (
        typeof window.electron?.getAppVersion !== 'function' ||
        typeof window.electron?.requestE2eAppQuit !== 'function'
      ) {
        return null;
      }
      return {
        version: await window.electron.getAppVersion(),
        hasE2eQuit: true,
      };
    });
    if (!preloadContract?.hasE2eQuit || !/^\d+\.\d+\.\d+/.test(preloadContract.version)) {
      throw new Error('packaged renderer did not expose a working preload IPC bridge');
    }

    return {
      page,
      dispose: async () => {
        const acknowledged = await page
          .evaluate(async () => window.electron?.requestE2eAppQuit?.())
          .catch(() => undefined);
        try {
          // A missing acknowledgement is itself a test failure, but cleanup
          // must still terminate the tray process before reporting it.
          await terminate(child, acknowledged?.ok === true);
        } finally {
          await connectedBrowser.close().catch(() => {});
        }
        processLogs.assertClean();
        if (!acknowledged?.ok) {
          throw new Error('packaged renderer did not acknowledge the E2E app-quit request');
        }
      },
    };
  } catch (error) {
    // Setup failures happen before Playwright owns the fixture and therefore
    // never reach dispose(). Always clean up the process/CDP connection here.
    try {
      await terminate(child);
    } finally {
      await browser?.close().catch(() => {});
    }
    processLogs.assertClean();
    throw error;
  }
}

/**
 * Stop the packaged app and make sure it is actually gone.
 *
 * The test-only preload IPC asks the real app lifecycle to quit first. Signals
 * remain a bounded fallback because a packaged build has no attachable main
 * process; without escalation a broken shutdown could leave live tray apps
 * accumulating across the suite.
 */
async function terminate(child: ChildProcess, gracefulRequested = false): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  if (gracefulRequested) {
    const completed = await Promise.race([
      exited.then(() => true),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 3_000)),
    ]);
    if (completed) return;
  }
  child.kill('SIGTERM');

  const escalated = await Promise.race([
    exited.then(() => false),
    new Promise<boolean>(resolve => setTimeout(() => resolve(true), 3_000)),
  ]);

  if (escalated) {
    child.kill('SIGKILL');
    await Promise.race([exited, new Promise<void>(resolve => setTimeout(resolve, 3_000))]);
  }
}

/** A free loopback port for the renderer's DevTools endpoint. */
async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(error => {
        if (error) reject(error);
        else if (port === null) reject(new Error('could not reserve a renderer port'));
        else resolvePort(port);
      });
    });
  });
}

/**
 * Chromium accepts the TCP connection before its DevTools HTTP handler is
 * ready, so each probe is bounded rather than allowed to consume the whole
 * budget on one half-open socket.
 */
async function waitForDevtools(endpoint: string, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`packaged app exited with code ${child.exitCode} before opening DevTools`);
    }
    try {
      const response = await fetch(`${endpoint}/json/version`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise(done => setTimeout(done, 200));
  }
  throw new Error('timed out waiting for the packaged renderer DevTools endpoint');
}

export const electronTest = base.extend<ElectronFixtures, ElectronWorkerFixtures>({
  desktopRenderer: [
    async ({}, use, testInfo) => {
      // One private, pre-seeded userData directory per test — see
      // createIsolatedUserDataDir for why sharing one broke the suite.
      const userDataDir = createIsolatedUserDataDir(testInfo.title);

      if (IS_PACKAGED_RUN) {
        const launched = await launchPackagedRenderer(userDataDir);
        try {
          await use(launched.page);
        } finally {
          await launched.dispose();
          if (testInfo.status === testInfo.expectedStatus) {
            rmSync(userDataDir, { recursive: true, force: true });
          } else {
            testInfo.annotations.push({
              type: 'diagnostic',
              description: `Electron userData retained at ${userDataDir}`,
            });
          }
        }
        return;
      }

      // Playwright globalSetup runs in Node and imports `better-sqlite3`
      // through the compiled DB bootstrap to seed the DB. Swap to
      // Electron's native ABI only after globalSetup has finished and
      // immediately before the Electron main process imports the
      // embedded server.
      ensureNativeRuntime('electron');
      let electronApp: ElectronApplication | null = null;
      let processLogs: ReturnType<typeof forwardElectronProcessLogs> | null = null;
      const target = resolveDevLaunchTarget();

      try {
        electronApp = await _electron.launch({
          executablePath: target.executablePath,
          args: [...target.args, `--user-data-dir=${userDataDir}`, ...e2eRendererSchedulingArgs()],
          // Disable the first-run update check + keep the smoke
          // deterministic by suppressing the auto-updater side-channel.
          env: {
            ...process.env,
            ELECTRON_ENABLE_LOGGING: '1',
            ELECTRON_ENABLE_STACK_DUMPING: '1',
            PUNTOVIVO_DB_KEY: ELECTRON_E2E_DB_KEY,
            PUNTOVIVO_E2E: '1',
            PUNTOVIVO_BIND_HOST: ELECTRON_E2E_API_HOST,
            PUNTOVIVO_BIND_PORT: String(ELECTRON_E2E_API_PORT),
            PUNTOVIVO_LOG_LEVEL: 'warn',
            PUNTOVIVO_SUPPRESS_CREDENTIAL_BANNER: 'true',
            AUTO_UPDATE: 'false',
          },
        });
        processLogs = forwardElectronProcessLogs(electronApp.process());

        let page: Page;
        try {
          page = await electronApp.firstWindow();
        } catch (error) {
          throw formatFirstWindowFailure(error, electronApp.process());
        }
        await use(page);
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
        processLogs?.assertClean();
        if (testInfo.status === testInfo.expectedStatus) {
          rmSync(userDataDir, { recursive: true, force: true });
        } else {
          testInfo.annotations.push({
            type: 'diagnostic',
            description: `Electron userData retained at ${userDataDir}`,
          });
        }
      }
    },
    // Test scope, not worker: each test gets a freshly launched app. A shared
    // instance carries the previous test's authenticated session into the next
    // spec file, which makes the suite order-dependent.
    { scope: 'test' },
  ],
  page: [
    // Both targets expose the same surface — an ordinary renderer page — so a
    // spec never needs to know which one it is running against.
    async ({ desktopRenderer }, use) => {
      // Every test relaunches the app, but the userData directory persists, so
      // the renderer would boot carrying the previous test's stored session and
      // language. That leaked an expired token into the next spec and surfaced
      // as an unrelated 403 on the first authenticated request. Start each test
      // from genuinely signed-out storage.
      await desktopRenderer.evaluate(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
      });
      await desktopRenderer.reload();
      await use(desktopRenderer);
    },
    { scope: 'test' },
  ],
});

export { expect } from '@playwright/test';
