import { TRPCError } from '@trpc/server';

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return error === signal.reason || (error instanceof Error && error.name === 'AbortError');
}

/**
 * Run AI work under the procedure's request signal. tRPC aborts that signal
 * when the HTTP response closes (or the request is aborted) before the
 * procedure has answered; direct `createCaller` users may pass one too, and
 * callers without a signal run unchanged.
 *
 * The signal is admission-only downstream: services check it before they
 * reserve budget or dispatch, and never forward it to a provider call already
 * sent (that call settles its known cost instead of becoming an unknown-cost
 * liability). A cancellation surfaces as `CLIENT_CLOSED_REQUEST`, an expected
 * client rejection rather than a server incident.
 */
export async function withClientAbortSignal<T>(
  signal: AbortSignal | undefined,
  work: (signal: AbortSignal | undefined) => Promise<T>
): Promise<T> {
  if (!signal) return work(undefined);

  try {
    // Authentication and quota reads may finish after the client has gone.
    // Do not enter provider work (or reserve its budget) in that case.
    signal.throwIfAborted();
    return await work(signal);
  } catch (error) {
    if (signal.aborted && isAbortError(error, signal)) {
      throw new TRPCError({
        code: 'CLIENT_CLOSED_REQUEST',
        message: 'The client closed the request before AI work was admitted',
        cause: error,
      });
    }
    throw error;
  }
}
