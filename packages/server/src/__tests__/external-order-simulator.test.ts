import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  prepareSandboxEnvelope,
  sandboxEndpoint,
  sendSandboxEnvelope,
} from '../services/external-orders/simulator.js';
import { verifyExternalOrderEnvelope } from '../services/external-orders/signature.js';
describe('External sandbox simulator', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('cancels oversized chunked responses before unbounded JSON allocation', async () => {
    const cancel = vi.fn();
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads++;
        if (reads <= 8) controller.enqueue(new Uint8Array(16 * 1024).fill(32));
        else {
          controller.enqueue(new TextEncoder().encode('{}'));
          controller.close();
        }
      },
      cancel,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(stream)));
    const body = JSON.stringify({
      schemaVersion: 1,
      eventId: 'cancel',
      orderId: 'one',
      kind: 'order.cancelled',
      reason: 'Test',
    });
    const envelope = prepareSandboxEnvelope(
      'connector',
      randomBytes(32).toString('base64url'),
      body
    );
    await expect(sendSandboxEnvelope('https://example.test', envelope)).rejects.toThrow(
      'SANDBOX_RESPONSE_TOO_LARGE'
    );
    expect(cancel).toHaveBeenCalledOnce();
    expect(reads).toBeLessThan(8);
  });
  it('renews transport identity without changing event bytes', () => {
    const body = JSON.stringify({
      schemaVersion: 1,
      eventId: 'cancel-1',
      orderId: 'order-1',
      kind: 'order.cancelled',
      reason: 'Sandbox cancellation',
    });
    const secret = randomBytes(32).toString('base64url');
    const first = prepareSandboxEnvelope('connector', secret, body),
      retry = prepareSandboxEnvelope('connector', secret, body);
    expect(first.body).toBe(body);
    expect(retry.body).toBe(body);
    expect(retry.nonce).not.toBe(first.nonce);
    expect(verifyExternalOrderEnvelope(secret, first, Date.now())).toBe(true);
    expect(verifyExternalOrderEnvelope(secret, retry, Date.now())).toBe(true);
  });
  it.each([
    'http://example.test',
    'https://user:password@example.test',
    'https://example.test/path',
    'https://example.test?query=1',
    'https://example.test/#fragment',
    'file:///tmp/foo',
  ])('rejects unsafe origin %s', origin => {
    expect(() => sandboxEndpoint(origin)).toThrow();
  });
  it('allows explicit HTTPS or loopback and selects only the signed tRPC ingress', () => {
    expect(sandboxEndpoint('https://example.test').href).toBe(
      'https://example.test/api/trpc/externalOrders.receive'
    );
    expect(sandboxEndpoint('http://127.0.0.1:8090').pathname).toBe(
      '/api/trpc/externalOrders.receive'
    );
  });
  it('rejects payloads claiming payment authority before sending', () => {
    expect(() =>
      prepareSandboxEnvelope(
        'connector',
        randomBytes(32).toString('base64url'),
        JSON.stringify({
          schemaVersion: 1,
          eventId: 'x',
          orderId: 'y',
          kind: 'order.cancelled',
          reason: 'Test',
          paid: true,
        })
      )
    ).toThrow();
  });
});
