/**
 * Soak mode (`PUNTOVIVO_SOAK=1`): `scripts/desktop-soak.mjs` drives sales over
 * HTTP and steers the app through files in `PUNTOVIVO_SOAK_CONTROL_DIR`.
 * Main prints a sample every 15 s and acts on `crash`, `backup` and `quit`.
 */
import { app, type WebContents } from 'electron';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { PuntovivoLogger } from '@puntovivo/server/desktop-main';
import { whenAppMounted } from './measurement-harness.js';
import { createStallSampler } from './main-thread-probe.js';
import type { EmbeddedServerHost } from './server-host/contract.ts';
import type { WorkerMemorySample } from './server-host/protocol.ts';
import type { EmbeddedServerState } from './server-lifecycle.ts';

const SAMPLE_INTERVAL_MS = 15_000;
const CONTROL_POLL_MS = 500;
const CRASH_CONFIRM_MS = 5_000;
const toMb = (kb: number) => Math.round(kb / 102.4) / 10;

function emit(name: string, value: unknown): void {
  process.stdout.write(`PUNTOVIVO_SOAK_${name}=${JSON.stringify(value)}\n`);
}

export function installSoakMode(deps: {
  webContents: WebContents;
  controlDir: string;
  log: PuntovivoLogger;
  getServerHost: () => EmbeddedServerHost | null;
  getServerState: () => EmbeddedServerState;
  getWorkerStats: () => WorkerMemorySample | null;
  runBackup: (tenantId: string) => Promise<{ success: boolean }>;
}): void {
  deps.webContents.setBackgroundThrottling(false);
  // Same stall definition as the main-thread budget: lateness beyond the tick.
  let stall = createStallSampler();
  stall.start();
  let backupsRunning = 0;
  let polling = false;

  void whenAppMounted(deps.webContents).then(mounted => {
    const host = deps.getServerHost();
    if (!mounted || !host) {
      emit('SKIP', { reason: 'app-not-mounted' });
      return;
    }
    emit('READY', { serverUrl: host.url });
    setInterval(() => {
      const { maxStallMs } = stall.stop();
      stall = createStallSampler();
      stall.start();
      emit('SAMPLE', {
        at: Date.now(),
        serverState: deps.getServerState(),
        mainMaxStallMs: maxStallMs,
        backupRunning: backupsRunning > 0,
        processes: app.getAppMetrics().map(metric => ({
          type: metric.type,
          pid: metric.pid,
          workingSetMb: toMb(metric.memory.workingSetSize),
          privateMb: toMb(metric.memory.privateBytes ?? 0),
        })),
        worker: deps.getWorkerStats(),
      });
    }, SAMPLE_INTERVAL_MS).unref();
    setInterval(() => {
      // An overlapping poll would see the same file and act on it twice.
      if (polling) return;
      polling = true;
      void pollControl().finally(() => (polling = false));
    }, CONTROL_POLL_MS).unref();
  });

  /** Emits only once the lifecycle has seen the worker die, or after a timeout. */
  async function injectCrash(): Promise<void> {
    const simulateCrash = deps.getServerHost()?.simulateCrash;
    if (!simulateCrash) {
      deps.log.warn('soak crash requested but the server host cannot simulate one');
      return;
    }
    simulateCrash();
    const deadline = Date.now() + CRASH_CONFIRM_MS;
    while (deps.getServerState() === 'running' && Date.now() < deadline) await delay(10);
    emit('EVENT', {
      type: 'crash-injected',
      at: Date.now(),
      stateAfter: deps.getServerState(),
    });
  }

  async function pollControl(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(deps.controlDir);
    } catch {
      return;
    }
    for (const file of files.sort()) {
      const path = join(deps.controlDir, file);
      const body = await readFile(path, 'utf8').catch(() => '');
      await rm(path, { force: true });
      if (file.startsWith('crash')) {
        await injectCrash();
      } else if (file.startsWith('backup')) {
        backupsRunning += 1;
        const startedAt = Date.now();
        // Its own sampler: a backup can start and end between two samples.
        const backupStall = createStallSampler();
        backupStall.start();
        const report = (ok: boolean) => {
          emit('EVENT', {
            type: 'backup',
            ok,
            ms: Date.now() - startedAt,
            mainMaxStallMs: backupStall.stop().maxStallMs,
          });
        };
        void deps
          .runBackup(body.trim())
          .then(
            result => report(result.success),
            () => report(false)
          )
          .finally(() => (backupsRunning -= 1));
      } else if (file.startsWith('quit')) {
        deps.log.info('soak run asked the app to quit');
        app.quit();
      }
    }
  }
}
