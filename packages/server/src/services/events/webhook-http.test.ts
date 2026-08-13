import { describe, expect, it } from 'vitest';
import { postPinnedWebhook } from './webhook-http.js';

describe('postPinnedWebhook lifecycle', () => {
  it('refuses an already-aborted delivery before opening a socket', async () => {
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      postPinnedWebhook({
        url: new URL('https://hooks.example.test/puntovivo'),
        pinnedAddress: { address: '93.184.216.34', family: 4 },
        headers: { 'content-type': 'application/json' },
        body: '{}',
        timeoutMs: 10_000,
        signal: abortController.signal,
      })
    ).rejects.toThrow('WEBHOOK_DELIVERY_ABORTED');
  });
});
