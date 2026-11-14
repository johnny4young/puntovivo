/**
 * Bounded local record of server worker exits (`worker-crashes.ndjson`).
 * Holds only codes, timings and counts: no tenant data, messages or secrets.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CODE_PATTERN, type HostStats } from '@electron-stagewright/host-supervisor';
import type { WorkerExitKind, WorkerFatalCause } from './fatal-cause.ts';

export const WORKER_CRASH_LOG_FILE = 'worker-crashes.ndjson';
const MAX_ENTRIES = 50;
const WEEK_MS = 7 * 24 * 60 * 60_000;

export type WorkerCrashOutcome = 'restarted' | 'restart-failed' | 'fatal' | 'memory-alert';

export interface WorkerCrashEntry {
  at: string;
  kind: WorkerExitKind;
  exitCode: number;
  errorCode: string | null;
  uptimeMs: number;
  pendingCalls: number;
  restartAttempt: number;
  outcome: WorkerCrashOutcome;
  fatalCause: WorkerFatalCause | 'restart-loop' | null;
  appVersion: string;
  /** Worker heap and process RSS from its last report, in MB. */
  memory?: WorkerCrashMemory | null;
}

export type WorkerCrashMemory = Pick<HostStats, 'rssMb' | 'heapUsedMb' | 'heapLimitMb'>;

export function crashMemory(sample: HostStats | null | undefined): WorkerCrashMemory | null {
  return sample
    ? { rssMb: sample.rssMb, heapUsedMb: sample.heapUsedMb, heapLimitMb: sample.heapLimitMb }
    : null;
}

export interface WorkerRestartStats {
  restartsLast7Days: number;
  lastCrashAt: string | null;
  entries: WorkerCrashEntry[];
}

/** Keeps a closed error code (own or as the whole message) and nothing else. */
export function crashErrorCode(error: Error): string | null {
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && CODE_PATTERN.test(code)) return code;
  const message = error.message.trim();
  return CODE_PATTERN.test(message) ? message : null;
}

function parseEntries(text: string): WorkerCrashEntry[] {
  const entries: WorkerCrashEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as WorkerCrashEntry;
      if (typeof value?.at === 'string') entries.push(value);
    } catch {
      // A torn last line from a crash mid-write is skipped.
    }
  }
  return entries;
}

export function createWorkerCrashLog(deps: { getPath: () => string; now?: () => number }) {
  const now = deps.now ?? Date.now;
  let writes: Promise<void> = Promise.resolve();

  async function read(): Promise<WorkerCrashEntry[]> {
    try {
      return parseEntries(await readFile(deps.getPath(), 'utf8'));
    } catch {
      return [];
    }
  }

  async function write(entry: WorkerCrashEntry): Promise<void> {
    const path = deps.getPath();
    const entries = [...(await read()), entry];
    // Memory alerts give way first, so a noisy episode cannot evict real exits.
    while (entries.length > MAX_ENTRIES) {
      const alert = entries.findIndex(item => item.outcome === 'memory-alert');
      entries.splice(alert === -1 ? 0 : alert, 1);
    }
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.tmp`;
    await writeFile(temp, entries.map(item => JSON.stringify(item)).join('\n') + '\n', 'utf8');
    await rename(temp, path);
  }

  return {
    /** Appends one entry; writes are serialized so none is lost. */
    append(entry: WorkerCrashEntry): Promise<void> {
      writes = writes.then(() => write(entry)).catch(() => undefined);
      return writes;
    },
    async stats(): Promise<WorkerRestartStats> {
      await writes;
      const entries = await read();
      const cutoff = now() - WEEK_MS;
      return {
        restartsLast7Days: entries.filter(
          entry => entry.outcome === 'restarted' && Date.parse(entry.at) >= cutoff
        ).length,
        lastCrashAt: entries.filter(entry => entry.outcome !== 'memory-alert').at(-1)?.at ?? null,
        entries,
      };
    },
  };
}
