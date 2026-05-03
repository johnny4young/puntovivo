/**
 * ENG-052b — Headers Proxy used by the test fixtures + the dev seed.
 *
 * Returns a `Record<string, string>` Proxy that mints a fresh
 * Command Envelope on every read of `x-puntovivo-envelope`, and
 * resolves `x-device-id` / `x-site-id` through getters so callers
 * can mutate the underlying values inside `beforeAll` (the test
 * file sets `testDeviceId` after the seed user is loaded; the
 * Proxy reads that variable lazily through the getter).
 *
 * Why a Proxy: the `commandEnvelope` middleware reads each header
 * once per request — re-running `mutate()` on the SAME caller
 * across different critical procedures must NOT collide on
 * `idempotency_keys`, so the envelope must be fresh on every
 * access. Building a static headers object once and reusing it
 * would only work if every caller call also rebuilt the context,
 * which is verbose and noisy in tests + seed paths.
 *
 * Pass `getDeviceId: () => string | null | undefined` so the live
 * value flows through without a setter API; the same goes for
 * `getSiteId`. Both getters are evaluated on every header read,
 * letting `beforeAll` populate them post-construction.
 *
 * @module lib/envelopeHeadersProxy
 */

import { randomUUID } from 'node:crypto';
import {
  COMMAND_ENVELOPE_HEADER,
  DEVICE_ID_HEADER,
} from '../trpc/schemas/envelope.js';

export interface EnvelopeHeadersProxyOptions {
  getDeviceId: () => string | null | undefined;
  getSiteId?: () => string | null | undefined;
}

export function makeEnvelopeHeadersProxy(
  opts: EnvelopeHeadersProxyOptions
): Record<string, string> {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === 'x-site-id') {
          const s = opts.getSiteId?.();
          return s ?? undefined;
        }
        if (prop === DEVICE_ID_HEADER) {
          const d = opts.getDeviceId();
          return d ?? undefined;
        }
        if (prop === COMMAND_ENVELOPE_HEADER) {
          // Without a registered device the middleware short-circuits
          // before reading the envelope; producing the JSON anyway is
          // cheap but emitting nothing keeps the wire honest.
          if (!opts.getDeviceId()) return undefined;
          return JSON.stringify({
            operationId: randomUUID(),
            idempotencyKey: randomUUID(),
            clientCreatedAt: new Date().toISOString(),
          });
        }
        return undefined;
      },
    }
  ) as Record<string, string>;
}
