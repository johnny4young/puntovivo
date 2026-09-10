/** Real HTTP sandbox client. It never supplies local payment evidence or logs credentials/customer data. */
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { externalOrderEventSchema } from './contract.js';
import { signExternalOrderEnvelope, type ExternalOrderSignedEnvelope } from './signature.js';

const acknowledgementSchema = z
  .object({
    result: z
      .object({
        data: z
          .object({
            eventId: z.string(),
            orderId: z.string(),
            status: z.enum(['received', 'accepted', 'cancel_requested', 'cancelled', 'rejected']),
            version: z.number().int().safe().positive(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

/** HTTP success alone is not receipt evidence: require the exact submitted event and order identity. */
export function acknowledgesSandboxEnvelope(
  input: ExternalOrderSignedEnvelope,
  body: unknown
): boolean {
  const acknowledgement = acknowledgementSchema.safeParse(body);
  if (!acknowledgement.success) return false;
  try {
    const event = externalOrderEventSchema.parse(JSON.parse(input.body));
    return (
      acknowledgement.data.result.data.eventId === event.eventId &&
      acknowledgement.data.result.data.orderId === event.orderId
    );
  } catch {
    return false;
  }
}

/** Reuse body/event identity on retries; renew the short-lived timestamp and nonce when requested. */
export function prepareSandboxEnvelope(
  connectorId: string,
  secret: string,
  body: string
): ExternalOrderSignedEnvelope {
  externalOrderEventSchema.parse(JSON.parse(body));
  const bytes = Buffer.from(secret, 'base64url');
  if (bytes.length !== 32 || bytes.toString('base64url') !== secret)
    throw new Error('INVALID_SIGNING_KEY');
  const input = {
    connectorId,
    body,
    timestamp: Date.now(),
    nonce: randomBytes(24).toString('base64url'),
  };
  return { ...input, signature: signExternalOrderEnvelope(secret, input) };
}
/** Only an explicit TLS origin or local sandbox is supported; redirects must never forward signed intent. */
export function sandboxEndpoint(origin: string): URL {
  const url = new URL(origin);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    )
  )
    throw new Error('INVALID_SANDBOX_ORIGIN');
  return new URL('/api/trpc/externalOrders.receive', url);
}
/** Bounded HTTP call: the returned response is untrusted, and callers must not log arbitrary error bodies. */
export async function sendSandboxEnvelope(origin: string, input: ExternalOrderSignedEnvelope) {
  const response = await fetch(sandboxEndpoint(origin), {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const reader = response.body?.getReader();
  if (!reader) throw new Error('SANDBOX_RESPONSE_EMPTY');
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      // Content-Length is neither required nor trusted (chunked or decompressed responses).
      if (total > 64 * 1024) throw new Error('SANDBOX_RESPONSE_TOO_LARGE');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks, total).toString('utf8'));
  return { status: response.status, body };
}
