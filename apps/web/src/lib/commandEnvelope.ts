/**
 * ENG-052 — Command Envelope minting + per-call header injection
 * (ADR-0002).
 *
 * Critical mutations require an envelope (`operationId`,
 * `idempotencyKey`, `clientCreatedAt`) sent as the
 * `x-puntovivo-envelope` JSON header. The server-side middleware
 * validates the shape, looks up `idempotency_keys`, and either
 * short-circuits with a cached result or runs the procedure and
 * persists the result.
 *
 * The renderer does NOT modify procedure inputs — the envelope
 * lives entirely in headers, set per-request via the helper here.
 *
 * @module lib/commandEnvelope
 */

export const COMMAND_ENVELOPE_HEADER = 'x-puntovivo-envelope';
export const DEVICE_ID_HEADER = 'x-device-id';

export interface MintedEnvelope {
  operationId: string;
  idempotencyKey: string;
  clientCreatedAt: string;
}

/**
 * Best-effort UUID v4. Uses `crypto.randomUUID()` when available
 * (modern browsers + Node 20+), falls back to a Math.random shim
 * for older runtimes — the shim still produces a v4-shaped string
 * good enough for the server's Zod check.
 */
function generateUuid(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  // RFC4122 v4 fallback.
  const hex = (n: number) => Math.floor(n).toString(16).padStart(2, '0');
  const bytes = Array.from({ length: 16 }, () => Math.random() * 256);
  // `Array.from({ length: 16 }, …)` builds a length-16 array so indices
  // 6 + 8 are guaranteed; `!` narrows for `noUncheckedIndexedAccess`.
  // reason: fixed-length seed buffer.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return [
    bytes.slice(0, 4).map(hex).join(''),
    bytes.slice(4, 6).map(hex).join(''),
    bytes.slice(6, 8).map(hex).join(''),
    bytes.slice(8, 10).map(hex).join(''),
    bytes.slice(10, 16).map(hex).join(''),
  ].join('-');
}

/**
 * Mint a fresh envelope for a single critical mutation. Each
 * `mutate()` call should mint its own — replays for retry control
 * are intentionally orchestrated via the same mutation hook
 * keeping the same envelope.
 */
export function mintEnvelope(): MintedEnvelope {
  return {
    operationId: generateUuid(),
    idempotencyKey: generateUuid(),
    clientCreatedAt: new Date().toISOString(),
  };
}

/**
 * Serialize an envelope into the JSON header value. Pure helper so
 * tests can assert the wire shape without touching the network.
 */
export function envelopeToHeaderValue(envelope: MintedEnvelope): string {
  return JSON.stringify(envelope);
}

/**
 * Build the per-call headers object for a critical mutation. The
 * tRPC client merges this with the global headers from
 * `getTrpcHeaders()` (which already carries auth + site + csrf).
 */
export function buildCriticalCommandHeaders(
  deviceId: string,
  envelope: MintedEnvelope
): Record<string, string> {
  return {
    [DEVICE_ID_HEADER]: deviceId,
    [COMMAND_ENVELOPE_HEADER]: envelopeToHeaderValue(envelope),
  };
}
