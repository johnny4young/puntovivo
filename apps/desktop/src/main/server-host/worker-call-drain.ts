/**
 * Admission and drain boundary for calls received over the server worker port.
 * Fastify only drains HTTP requests; direct host operations can also be async.
 */
export function createWorkerCallDrain() {
  const pending = new Set<Promise<void>>();
  let accepting = true;

  return {
    dispatch(operation: () => Promise<void>): boolean {
      if (!accepting) return false;
      const call = Promise.resolve().then(operation);
      pending.add(call);
      void call.then(
        () => pending.delete(call),
        () => pending.delete(call)
      );
      return true;
    },
    async stop(): Promise<void> {
      // Close admission before yielding so a later port message cannot race
      // into the database while the accepted calls are being drained.
      accepting = false;
      await Promise.allSettled([...pending]);
    },
  };
}
