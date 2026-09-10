/**
 * A hosted deployment must not let the caller choose its own `request.ip`.
 *
 * `trustProxy` was `true` for `site_hub`, which means "trust every proxy in the
 * chain". Fastify then resolves `request.ip` to the LEFTMOST `X-Forwarded-For`
 * entry — the one the client itself supplied — so any caller could pick its own
 * address and the IP-keyed rate-limit buckets stopped existing.
 *
 * This is not fixed by putting a correct reverse proxy in front: nginx's
 * `$proxy_add_x_forwarded_for` APPENDS to whatever header arrived rather than
 * replacing it, so the forged entry survives and stays leftmost.
 *
 * It matters more here than the CVSS would suggest, because the repository is
 * public. An attacker reads `create-server.ts`, sees the boolean, and knows the
 * IP bucket is decorative. The email bucket in `security/loginRateLimit` is
 * independent and kept single-account brute force capped throughout; what the
 * boolean left unbounded was spraying one password horizontally across many
 * accounts.
 *
 * @module __tests__/trust-proxy-hops.test
 */

import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';

import { resolveTrustProxy, SITE_HUB_TRUSTED_PROXY_HOPS } from '../server/create-server.js';

const REAL_CLIENT = '203.0.113.77';
const FORGED = '198.51.100.1';

/**
 * Ask a real Fastify instance what `request.ip` it resolves, so the assertions
 * are about the framework's behaviour rather than about our own arithmetic.
 *
 * `inject` reports the socket address as 127.0.0.1, which stands in for the
 * reverse proxy: it is the peer our server actually sees.
 */
async function resolveIp(
  trustProxy: ReturnType<typeof resolveTrustProxy>,
  forwardedFor?: string
): Promise<string> {
  const app = Fastify({ trustProxy: trustProxy as never, logger: false });
  app.get('/ip', request => ({ ip: request.ip }));
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/ip',
      ...(forwardedFor === undefined ? {} : { headers: { 'x-forwarded-for': forwardedFor } }),
    });
    return (response.json() as { ip: string }).ip;
  } finally {
    await app.close();
  }
}

const PROXY_PEER = '127.0.0.1';
const siteHubTrust = resolveTrustProxy('site_hub');

describe('site_hub trusted proxy hops', () => {
  it('ignores an address the client prepended behind one real proxy', async () => {
    // What nginx actually forwards after appending: the forged value the client
    // sent, then the address nginx itself observed.
    expect(await resolveIp(siteHubTrust, `${FORGED}, ${REAL_CLIENT}`)).toBe(REAL_CLIENT);
  });

  it('ignores a whole forged chain, however long', async () => {
    const chain = ['1.1.1.1', '2.2.2.2', '3.3.3.3', FORGED].join(', ');
    expect(await resolveIp(siteHubTrust, `${chain}, ${REAL_CLIENT}`)).toBe(REAL_CLIENT);
  });

  it('falls back to the peer address when no proxy header arrives', async () => {
    expect(await resolveIp(siteHubTrust)).toBe(PROXY_PEER);
  });

  it('would have believed the forged address under the old boolean', async () => {
    // Pins the defect itself, so the regression is legible without archaeology.
    expect(await resolveIp(true, `${FORGED}, ${REAL_CLIENT}`)).toBe(FORGED);
    expect(await resolveIp(siteHubTrust, `${FORGED}, ${REAL_CLIENT}`)).not.toBe(FORGED);
  });

  it('trusts nothing at all outside the hosted shape', () => {
    // device_local is a loopback server inside Electron; the renderer must never
    // be able to spoof its way out of a bucket.
    for (const mode of ['device_local', 'hub_client', 'anything-else']) {
      expect(resolveTrustProxy(mode)).toBe(false);
    }
  });

  it('trusts exactly one hop, and errs low by construction', () => {
    // Too low collapses every client onto the proxy's address - noisy but
    // closed. Too high hands the client its own IP back. The constant exists so
    // raising it is a deliberate edit next to that reasoning.
    expect(SITE_HUB_TRUSTED_PROXY_HOPS).toBe(1);
    const trust = resolveTrustProxy('site_hub') as (address: string, hop: number) => boolean;
    expect(trust(PROXY_PEER, 0)).toBe(true);
    expect(trust(REAL_CLIENT, 1)).toBe(false);
    expect(trust(FORGED, 2)).toBe(false);
  });
});
