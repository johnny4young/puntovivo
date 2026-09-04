import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  EXTERNAL_ORDER_MAX_BODY_BYTES,
  EXTERNAL_ORDER_SIGNATURE_WINDOW_MS,
  signExternalOrderEnvelope,
  verifyExternalOrderEnvelope,
} from './signature.js';

describe('External order signed sandbox envelope', () => {
  const secret = randomBytes(32).toString('base64url');
  const input = {
    connectorId: 'connector_1',
    timestamp: 1_800_000_000_000,
    nonce: 'nonce_0123456789abcdef',
    body: '{"order":"A","note":"Café"}',
  };
  const signed = { ...input, signature: signExternalOrderEnvelope(secret, input) };
  it('authenticates exact body bytes and domain-bound connector identity', () => {
    expect(verifyExternalOrderEnvelope(secret, signed, input.timestamp)).toBe(true);
    for (const mutation of [
      { connectorId: 'connector_2' },
      { body: input.body + ' ' },
      { nonce: 'nonce_1123456789abcdef' },
      { timestamp: input.timestamp + 1 },
    ])
      expect(verifyExternalOrderEnvelope(secret, { ...signed, ...mutation }, input.timestamp)).toBe(
        false
      );
    expect(verifyExternalOrderEnvelope('wrong-secret', signed, input.timestamp)).toBe(false);
  });
  it.each([-1, 1])('rejects stale or future envelopes beyond the window (%s)', direction => {
    expect(
      verifyExternalOrderEnvelope(
        secret,
        signed,
        input.timestamp + direction * EXTERNAL_ORDER_SIGNATURE_WINDOW_MS
      )
    ).toBe(true);
    expect(
      verifyExternalOrderEnvelope(
        secret,
        signed,
        input.timestamp + direction * (EXTERNAL_ORDER_SIGNATURE_WINDOW_MS + 1)
      )
    ).toBe(false);
  });
  it.each(['', 'v2=' + 'a'.repeat(64), 'v1=aa', 'v1=' + 'g'.repeat(64)])(
    'fails closed for malformed signatures: %s',
    signature => {
      expect(verifyExternalOrderEnvelope(secret, { ...signed, signature }, input.timestamp)).toBe(
        false
      );
    }
  );
  it('bounds UTF-8 bytes rather than JavaScript character count before authentication', () => {
    expect(() =>
      signExternalOrderEnvelope(secret, {
        ...input,
        body: 'é'.repeat(EXTERNAL_ORDER_MAX_BODY_BYTES / 2 + 1),
      })
    ).toThrow('INVALID_EXTERNAL_ORDER_ENVELOPE');
    expect(
      verifyExternalOrderEnvelope(
        secret,
        { ...signed, body: 'x'.repeat(EXTERNAL_ORDER_MAX_BODY_BYTES + 1) },
        input.timestamp
      )
    ).toBe(false);
    expect(
      verifyExternalOrderEnvelope(
        secret,
        { ...signed, nonce: 'bad\nnonce_0123456789' },
        input.timestamp
      )
    ).toBe(false);
  });
});
