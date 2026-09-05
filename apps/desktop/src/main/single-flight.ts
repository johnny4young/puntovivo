/**
 * Coalesce concurrent calls into one in-flight operation, then allow a fresh
 * attempt after that operation settles. Every caller observes the same success
 * or failure; no waiter can report success before the owned work completes.
 */
export function createSingleFlight<T>(): (operation: () => Promise<T>) => Promise<T> {
  let inFlight: Promise<T> | null = null;

  return operation => {
    if (inFlight) return inFlight;

    const started = Promise.resolve().then(operation);
    const tracked = started.finally(() => {
      if (inFlight === tracked) inFlight = null;
    });
    inFlight = tracked;
    return tracked;
  };
}
