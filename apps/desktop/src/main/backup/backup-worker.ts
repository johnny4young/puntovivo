/**
 * Worker-thread entry that builds one backup bundle off the main thread.
 * Must never import Electron. The key arrives by message and dies with the thread.
 */
import { parentPort } from 'node:worker_threads';
import { createBackupBundle } from './backup-bundle.ts';
import type { BackupWorkerMessage, BackupWorkerReply } from './backup-worker-protocol.ts';

if (!parentPort) throw new Error('The backup worker must run in a worker thread');
const port = parentPort;
const abort = new AbortController();

port.on('message', (message: BackupWorkerMessage) => {
  if (message.type === 'cancel') {
    // Checked between steps; a native call already running finishes first.
    abort.abort(new Error('BACKUP_CANCELLED'));
    return;
  }
  void createBackupBundle({ ...message.args, signal: abort.signal }).then(
    value => post({ type: 'result', ok: true, value }),
    (error: unknown) =>
      post({
        type: 'result',
        ok: false,
        error: {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error),
          ...(typeof (error as { code?: unknown })?.code === 'string'
            ? { code: (error as { code: string }).code }
            : {}),
        },
      })
  );
});

function post(reply: BackupWorkerReply): void {
  port.postMessage(reply);
  port.close();
}
