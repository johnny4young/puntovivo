/**
 * ENG-136a — single-flight boundary for every operation that can stop or
 * replace the embedded database.
 *
 * Manual backups, scheduled snapshots and restores all share the same
 * embedded Fastify lifecycle. Running two of them concurrently would let one
 * operation restart the server while the other still expects it to be down.
 * This tiny FIFO keeps that choreography serial without coupling the backup
 * modules to Electron.
 */

export interface BackupOperationQueue {
  run<T>(operation: () => Promise<T>): Promise<T>;
  drain(): Promise<void>;
}

export function createBackupOperationQueue(): BackupOperationQueue {
  let tail: Promise<void> = Promise.resolve();

  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      const result = tail.then(operation, operation);
      tail = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
    drain(): Promise<void> {
      return tail;
    },
  };
}
