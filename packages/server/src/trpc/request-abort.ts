import type { FastifyReply } from 'fastify';

/**
 * Forward a lost HTTP response to slow provider work. IncomingMessage's
 * `close` only means the request body was read on modern Node; the response
 * remains open until the client has its answer or disconnects.
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
  } finally {
    response.off('close', onClose);
  }
}
