/**
 * Bounded local record of server worker exits (`worker-crashes.ndjson`).
 * Holds only codes, timings and counts: no tenant data, messages or secrets.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CODE_PATTERN } from './protocol.ts';
import type { WorkerExitKind, WorkerFatalCause } from './restart-policy.ts';

export const WORKER_CRASH_LOG_FILE = 'worker-crashes.ndjson';
const MAX_ENTRIES = 50;
const WEEK_MS = 7 * 24 * 60 * 60_000;

export type WorkerCrashOutcome = 'restarted' | 'restart-failed' | 'fatal';

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
    const entries = [...(await read()), entry].slice(-MAX_ENTRIES);
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
        lastCrashAt: entries.at(-1)?.at ?? null,
        entries,
      };
    },
  };
}
