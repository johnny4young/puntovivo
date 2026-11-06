/**
 * On Windows, safeStorage's key lives in `Local State`, which Chromium creates
 * at startup and saves about 10 s later. Anything sealed before that save is
 * unreadable after a crash or a power loss, so first seals wait for it.
 */
import { readFile } from 'node:fs/promises';
import type { PuntovivoLogger } from '@puntovivo/server';

const TIMEOUT_MS = 30_000;
const POLL_MS = 200;

interface OsKeyGateOptions {
  platform: NodeJS.Platform;
  localStatePath: string;
  log: Pick<PuntovivoLogger, 'info'>;
  /** Called once when the key is not on disk yet and the wait begins. */
  onWait?: () => void;
  /** Aborting stops the wait; nothing has been sealed at that point. */
  signal?: AbortSignal;
  timeoutMs?: number;
  pollMs?: number;
  readLocalState?: (path: string) => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

async function hasSavedOsKey(
  localStatePath: string,
  read: (path: string) => Promise<string>
): Promise<boolean> {
  try {
    const key = JSON.parse(await read(localStatePath))?.os_crypt?.encrypted_key;
    return typeof key === 'string' && key.length > 0;
  } catch {
    return false;
  }
}

/** Resolves once `Local State` on disk holds the key; immediately outside Windows. */
export function createOsKeyGate({
  platform,
  localStatePath,
  log,
  onWait,
  signal,
  timeoutMs = TIMEOUT_MS,
  pollMs = POLL_MS,
  readLocalState = path => readFile(path, 'utf8'),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now,
}: OsKeyGateOptions): () => Promise<void> {
  let saved: Promise<void> | null = null;

  async function waitForSavedKey(): Promise<void> {
    if (await hasSavedOsKey(localStatePath, readLocalState)) return;
    const started = now();
    log.info('waiting for Windows to save the safeStorage key before the first seal');
    onWait?.();
    while (!(await hasSavedOsKey(localStatePath, readLocalState))) {
      signal?.throwIfAborted();
      if (now() - started >= timeoutMs) {
        throw new Error(
          `Windows did not save the safeStorage key to ${localStatePath} within ${timeoutMs / 1000} s; ` +
            'nothing was sealed. Check that the user profile folder is writable, then restart Puntovivo.'
        );
      }
      await sleep(pollMs);
    }
    log.info({ waitedMs: now() - started }, 'Windows saved the safeStorage key');
  }

  return () => {
    if (platform !== 'win32') return Promise.resolve();
    saved ??= waitForSavedKey().catch(error => {
      saved = null;
      throw error;
    });
    return saved;
  };
}
