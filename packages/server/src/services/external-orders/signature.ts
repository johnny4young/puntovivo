/** Generic sandbox transport contract, not a claim of compatibility with a real aggregator. */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const EXTERNAL_ORDER_SIGNATURE_WINDOW_MS = 5 * 60 * 1000;
export const EXTERNAL_ORDER_MAX_BODY_BYTES = 64 * 1024;
/** Exact UTF-8 body bytes are signed before JSON parsing; IDs and timestamp are part of the MAC. */
export interface ExternalOrderSignedEnvelope {
  connectorId: string;
  timestamp: number;
  nonce: string;
  body: string;
  signature: string;
}
function validEnvelope(input: Omit<ExternalOrderSignedEnvelope, 'signature'>): boolean {
  return (
    /^[A-Za-z0-9_-]{1,128}$/.test(input.connectorId) &&
    /^[A-Za-z0-9_-]{16,128}$/.test(input.nonce) &&
    Number.isSafeInteger(input.timestamp) &&
    input.timestamp >= 0 &&
    Buffer.byteLength(input.body, 'utf8') <= EXTERNAL_ORDER_MAX_BODY_BYTES
  );
}
function digest(secret: string, input: Omit<ExternalOrderSignedEnvelope, 'signature'>): Buffer {
  return createHmac('sha256', secret)
    .update('puntovivo:external-order:v1\n')
    .update(input.connectorId)
    .update('\n')
    .update(String(input.timestamp))
    .update('\n')
    .update(input.nonce)
    .update('\n')
    .update(input.body, 'utf8')
    .digest();
}
/** Sandbox signing utility. Production receive handlers never return or log signing material. */
export function signExternalOrderEnvelope(
  secret: string,
  input: Omit<ExternalOrderSignedEnvelope, 'signature'>
): string {
  if (!validEnvelope(input)) throw new Error('INVALID_EXTERNAL_ORDER_ENVELOPE');
  return `v1=${digest(secret, input).toString('hex')}`;
}
/** Authentication alone is insufficient: the caller must also persist nonce/event replay evidence atomically. */
export function verifyExternalOrderEnvelope(
  secret: string,
  input: ExternalOrderSignedEnvelope,
  nowMs: number
): boolean {
  if (
    !validEnvelope(input) ||
    !Number.isSafeInteger(nowMs) ||
    Math.abs(nowMs - input.timestamp) > EXTERNAL_ORDER_SIGNATURE_WINDOW_MS ||
    !/^v1=[a-f0-9]{64}$/.test(input.signature)
  )
    return false;
  return timingSafeEqual(digest(secret, input), Buffer.from(input.signature.slice(3), 'hex'));
}
