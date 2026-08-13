/**
 * Admission control and deterministic draining for asynchronous workers.
 *
 * A worker closes admission before clearing its database owner. Operations
 * admitted before shutdown are awaited; operations attempted afterwards are
 * refused. Reopening is supported for the explicit stop/start chaos probes.
 */
export class WorkerActivityTracker {
  private readonly active = new Set<Promise<unknown>>();
  private accepting = true;
  private stopPromise: Promise<void> | null = null;
  private abortController = new AbortController();

  tryRun<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> | null {
    if (!this.accepting) return null;
    const signal = this.abortController.signal;

    const tracked = Promise.resolve()
      .then(() => operation(signal))
      .finally(() => {
        this.active.delete(tracked);
      });
    this.active.add(tracked);
    return tracked;
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.accepting = false;
    this.abortController.abort();
    const current = this.drain();
    const wrapped = current.finally(() => {
      if (this.stopPromise === wrapped) this.stopPromise = null;
    });
    this.stopPromise = wrapped;
    return wrapped;
  }

  reopen(): void {
    if (this.accepting) return;
    if (this.active.size > 0 || this.stopPromise) {
      throw new Error('Cannot restart a worker before its previous activity has drained.');
    }
    this.abortController = new AbortController();
    this.accepting = true;
  }

  private async drain(): Promise<void> {
    while (this.active.size > 0) {
      await Promise.allSettled([...this.active]);
    }
  }
}
