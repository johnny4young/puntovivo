/** Measurement mode for the main-thread gate (`PUNTOVIVO_MEASURE_MAIN_THREAD=1`). */

import type { WebContents } from 'electron';
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { PuntovivoLogger } from '@puntovivo/server';
import { exitAfterMeasurement, whenAppMounted } from './measurement-harness.js';
import { measureMainThreadWindow } from './main-thread-probe.js';
import { getServerUrl } from './runtime.js';

const START_POLL_MS = 50;
const START_TIMEOUT_MS = 180_000;
const DEFAULT_WINDOW_MS = 15_000;

function resolveWindowMs(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1_000), 120_000) : DEFAULT_WINDOW_MS;
}

async function waitForFile(path: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) return true;
    await delay(START_POLL_MS);
  }
  return false;
}

/**
 * Prints `PUNTOVIVO_MAIN_THREAD_READY` once the app is mounted, waits for the
 * gate to create its start file, measures one window and quits. Must be
 * installed before the renderer URL loads.
 */
export function installMainThreadMeasurement(deps: {
  webContents: WebContents;
  stopEmbeddedServer: () => Promise<void>;
  log: PuntovivoLogger;
  env?: NodeJS.ProcessEnv;
}): void {
  const { webContents, stopEmbeddedServer, log, env = process.env } = deps;
  // A covered or unfocused window must not throttle the renderer probe.
  webContents.setBackgroundThrottling(false);
  const shutdown = () =>
    exitAfterMeasurement({ stopEmbeddedServer, log, label: 'main-thread measurement' });

  void whenAppMounted(webContents).then(async mounted => {
    if (!mounted) {
      process.stdout.write('PUNTOVIVO_MAIN_THREAD_SKIP=app-not-mounted\n');
      shutdown();
      return;
    }
    process.stdout.write(
      `PUNTOVIVO_MAIN_THREAD_READY=${JSON.stringify({ serverUrl: getServerUrl() })}\n`
    );
    const startFile = env.PUNTOVIVO_MAIN_THREAD_START_FILE;
    if (!startFile || !(await waitForFile(startFile, START_TIMEOUT_MS))) {
      process.stdout.write('PUNTOVIVO_MAIN_THREAD_SKIP=no-start-signal\n');
      shutdown();
      return;
    }
    try {
      const metrics = await measureMainThreadWindow({
        durationMs: resolveWindowMs(env.PUNTOVIVO_MAIN_THREAD_WINDOW_MS),
        runRendererScript: script => webContents.executeJavaScript(script, true),
      });
      process.stdout.write(`PUNTOVIVO_MAIN_THREAD_METRICS=${JSON.stringify(metrics)}\n`);
    } catch (err) {
      log.warn({ err }, 'main-thread measurement failed');
      process.stdout.write('PUNTOVIVO_MAIN_THREAD_SKIP=probe-failed\n');
    }
    shutdown();
  });
}
