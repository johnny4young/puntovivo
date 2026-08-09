/**
 * Retryable LIFO ownership for resources acquired during server bootstrap.
 *
 * Every cleanup is attempted even when an earlier one fails. Successful
 * entries are retired; failed entries remain available for an explicit retry.
 */
type Cleanup = () => void | Promise<void>;

interface CleanupEntry {
  name: string;
  cleanup: Cleanup;
  completed: boolean;
}

export class ServerLifecycleOwner {
  private readonly entries: CleanupEntry[] = [];
  private disposePromise: Promise<void> | null = null;
  private disposalStarted = false;

  defer(name: string, cleanup: Cleanup): void {
    if (this.disposalStarted) {
      throw new Error('Cannot acquire a server resource after lifecycle cleanup started.');
    }
    this.entries.push({ name, cleanup, completed: false });
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposalStarted = true;
    const current = this.runCleanup();
    const wrapped = current.finally(() => {
      if (this.disposePromise === wrapped) this.disposePromise = null;
    });
    this.disposePromise = wrapped;
    return wrapped;
  }

  private async runCleanup(): Promise<void> {
    const errors: Error[] = [];
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      const entry = this.entries[index];
      if (!entry || entry.completed) continue;
      try {
        await entry.cleanup();
        entry.completed = true;
      } catch (error) {
        errors.push(
          new Error(`Server lifecycle cleanup failed for ${entry.name}.`, { cause: error })
        );
      }
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Multiple server lifecycle cleanups failed.', {
        cause: errors[0],
      });
    }
  }
}

export async function rethrowAfterLifecycleCleanup(
  owner: ServerLifecycleOwner,
  primaryError: unknown,
  context: string
): Promise<never> {
  let cleanupError: unknown;
  try {
    await owner.dispose();
  } catch (error) {
    cleanupError = error;
  }
  if (cleanupError !== undefined) {
    throw new AggregateError(
      [primaryError, cleanupError],
      `${context}; lifecycle cleanup also failed.`,
      { cause: primaryError }
    );
  }
  throw primaryError;
}
