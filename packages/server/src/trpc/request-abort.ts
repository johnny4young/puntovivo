import { TRPCError } from '@trpc/server';
import type { FastifyReply } from 'fastify';

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return (
    error === signal.reason ||
    (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
  );
}

/**
 * Turn a lost HTTP response into an abort signal for AI work. IncomingMessage's
 * `close` only means the request body was read on modern Node; the response
 * remains open until the client has its answer or disconnects.
 *
 * The signal is admission-only downstream: services check it before they
 * reserve budget or dispatch, and never forward it to a provider call already
 * sent (that call settles its known cost instead of becoming an unknown-cost
 * liability). A cancellation surfaces as `CLIENT_CLOSED_REQUEST`, an expected
 * client rejection rather than a server incident.
 */
export async function withClientAbortSignal<T>(
  reply: FastifyReply,
  work: (signal: AbortSignal | undefined) => Promise<T>
): Promise<T> {
  const response = reply.raw;
  // Direct tRPC callers in server tests have no Fastify transport.
  if (!response || typeof response.once !== 'function') return work(undefined);

  const controller = new AbortController();
  const onClose = () => {
    // ServerResponse emits close after a normal reply as well as a disconnect.
    if (!response.writableFinished) controller.abort();
  };
  response.once('close', onClose);
  if (response.destroyed && !response.writableFinished) controller.abort();

  try {
    // Authentication and quota reads may finish after the client has gone.
    // Do not enter provider work (or reserve its budget) in that case.
    controller.signal.throwIfAborted();
    return await work(controller.signal);
  } catch (error) {
    if (controller.signal.aborted && isAbortError(error, controller.signal)) {
      throw new TRPCError({
        code: 'CLIENT_CLOSED_REQUEST',
        message: 'The client closed the request before AI work was admitted',
        cause: error,
      });
    }
    throw error;
  } finally {
    response.off('close', onClose);
  }
}
