/**
 * Runs `createBackupBundle` in a short-lived worker thread so the checkpoint,
 * `VACUUM INTO`, integrity check and zip never block main (ADR 0035).
 */
import { Worker } from 'node:worker_threads';
import type { CreateBackupBundleArgs, CreateBackupBundleResult } from './backup-bundle.ts';
import type { BackupWorkerMessage, BackupWorkerReply } from './backup-worker-protocol.ts';

/** The part of `worker_threads.Worker` the host relies on. */
export interface BackupWorkerLike {
  postMessage(message: BackupWorkerMessage): void;
  on(event: 'message', listener: (reply: BackupWorkerReply) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  terminate(): Promise<number>;
}

const createNodeWorker = (path: string): BackupWorkerLike =>
  new Worker(path) as unknown as BackupWorkerLike;

/** Same contract as `createBackupBundle`, executed on its own thread. */
export function createWorkerBackupBundle(deps: {
  workerPath: string;
  createWorker?: (path: string) => BackupWorkerLike;
}): (args: CreateBackupBundleArgs) => Promise<CreateBackupBundleResult> {
  return args =>
    new Promise((resolve, reject) => {
      const { signal, ...workerArgs } = args;
      if (signal?.aborted) {
        reject(signal.reason ?? new Error('BACKUP_CANCELLED'));
        return;
      }
      const worker = (deps.createWorker ?? createNodeWorker)(deps.workerPath);
      let settled = false;
      let lastError: Error | null = null;
      const onAbort = () => worker.postMessage({ type: 'cancel' });
      signal?.addEventListener('abort', onAbort, { once: true });
      const settle = (outcome: () => void) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', onAbort);
        outcome();
      };

      worker.on('message', reply => {
        if (reply.ok) {
          settle(() => resolve(reply.value));
          return;
        }
        const error = Object.assign(new Error(reply.error.message), {
          name: reply.error.name,
          ...(reply.error.code ? { code: reply.error.code } : {}),
        });
        settle(() => reject(error));
      });
      worker.on('error', error => {
        lastError = error;
      });
      worker.on('exit', code => {
        settle(() => reject(lastError ?? new Error(`BACKUP_WORKER_EXITED: code ${code}`)));
      });
      worker.postMessage({ type: 'create', args: workerArgs });
    });
}
