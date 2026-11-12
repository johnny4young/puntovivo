/**
 * Soak mode (`PUNTOVIVO_SOAK=1`): `scripts/desktop-soak.mjs` drives sales over
 * HTTP and steers the app through files in `PUNTOVIVO_SOAK_CONTROL_DIR`.
 * Main prints a sample every 15 s and acts on `crash`, `backup` and `quit`.
 */
import { app, type WebContents } from 'electron';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { PuntovivoLogger } from '@puntovivo/server/desktop-main';
import { whenAppMounted } from './measurement-harness.js';
import type { EmbeddedServerHost } from './server-host/contract.ts';
import type { WorkerMemorySample } from './server-host/protocol.ts';
import type { EmbeddedServerState } from './server-lifecycle.ts';

const SAMPLE_INTERVAL_MS = 15_000;
const CONTROL_POLL_MS = 500;
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
  const stall = monitorEventLoopDelay({ resolution: 10 });
  stall.enable();
  let backupsRunning = 0;

  void whenAppMounted(deps.webContents).then(mounted => {
    const host = deps.getServerHost();
    if (!mounted || !host) {
      emit('SKIP', { reason: 'app-not-mounted' });
      return;
    }
    emit('READY', { serverUrl: host.url });
    setInterval(() => {
      emit('SAMPLE', {
        at: Date.now(),
        serverState: deps.getServerState(),
        mainMaxStallMs: Math.round(stall.max / 1e5) / 10,
        backupRunning: backupsRunning > 0,
        processes: app.getAppMetrics().map(metric => ({
          type: metric.type,
          pid: metric.pid,
          workingSetMb: toMb(metric.memory.workingSetSize),
          privateMb: toMb(metric.memory.privateBytes ?? 0),
        })),
        worker: deps.getWorkerStats(),
      });
      stall.reset();
    }, SAMPLE_INTERVAL_MS).unref();
    setInterval(() => void pollControl(), CONTROL_POLL_MS).unref();
  });

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
        deps.getServerHost()?.simulateCrash?.();
        emit('EVENT', { type: 'crash-injected', at: Date.now() });
      } else if (file.startsWith('backup')) {
        backupsRunning += 1;
        const startedAt = Date.now();
        // Its own histogram: a backup can start and end between two samples.
        const backupStall = monitorEventLoopDelay({ resolution: 10 });
        backupStall.enable();
        const report = (ok: boolean) => {
          backupStall.disable();
          emit('EVENT', {
            type: 'backup',
            ok,
            ms: Date.now() - startedAt,
            mainMaxStallMs: Math.round(backupStall.max / 1e5) / 10,
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
