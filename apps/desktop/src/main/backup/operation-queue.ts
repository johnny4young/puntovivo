/**
 * single-flight boundary for every operation that can stop or
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
  pendingCount(): number;
}

export const DEFAULT_MAX_PENDING_BACKUP_OPERATIONS = 16;

export class BackupOperationQueueFullError extends Error {
  constructor(maxPendingOperations: number) {
    super(
      `Backup operation queue is full (${maxPendingOperations} operations). Wait for the active backup or restore to finish.`
    );
    this.name = 'BackupOperationQueueFullError';
  }
}

export function createBackupOperationQueue(
  maxPendingOperations = DEFAULT_MAX_PENDING_BACKUP_OPERATIONS
): BackupOperationQueue {
  if (!Number.isInteger(maxPendingOperations) || maxPendingOperations < 1) {
    throw new RangeError('maxPendingOperations must be a positive integer');
  }
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;

  return {
    run<T>(operation: () => Promise<T>): Promise<T> {
      if (pending >= maxPendingOperations) {
        return Promise.reject(new BackupOperationQueueFullError(maxPendingOperations));
      }
      pending += 1;
      const execute = async () => {
        try {
          return await operation();
        } finally {
          pending -= 1;
        }
      };
      const result = tail.then(execute, execute);
      tail = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    },
    drain(): Promise<void> {
      return tail;
    },
    pendingCount(): number {
      return pending;
    },
  };
}
