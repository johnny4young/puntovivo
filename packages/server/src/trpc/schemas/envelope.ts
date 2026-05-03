/**
 * ENG-052 — Zod schema for the Command Envelope (ADR-0002).
 *
 * Critical mutations carry the envelope as a JSON header
 * `x-puntovivo-envelope`. The middleware
 * `trpc/middleware/commandEnvelope.ts` parses the header and validates
 * against this schema before any procedure body runs.
 *
 * Envelope fields are intentionally compact: a server-side audit row
 * already carries the full input + return value; the envelope only
 * needs enough metadata to correlate UI clicks → tRPC calls → DB
 * transactions, plus the idempotency primitives.
 */

import { z } from 'zod';

/**
 * Envelope shape carried by every critical-command request. Renderers
 * mint each field on the client side; the server validates but does
 * not generate.
 */
export const commandEnvelopeSchema = z.object({
  /**
   * UUID v4 minted per user intent (per click). One operation may
   * fan out into multiple downstream effects (sale row + audit row +
   * fiscal outbox row); they all share this id.
   */
  operationId: z.string().uuid(),
  /**
   * String key supplied by the client to make retries safe. Same
   * key + same canonical input hash returns the cached result; same
   * key + different hash raises `IDEMPOTENCY_KEY_CONFLICT`. Length
   * bounds match common UUID formats but are deliberately wider to
   * accept derived keys.
   */
  idempotencyKey: z.string().min(8).max(128),
  /**
   * ISO 8601 UTC timestamp from the cashier device clock. Used for
   * sync ordering (ENG-064) and clock-skew diagnostics. The
   * `created_at` column on each emitted row uses the server clock,
   * so this field is metadata only, not a substitute.
   */
  clientCreatedAt: z.string().datetime(),
});

export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;

/**
 * Header name used by the renderer + Electron preload to ship the
 * envelope. Single-source-of-truth string — both the server
 * middleware and the web client read from this constant.
 */
export const COMMAND_ENVELOPE_HEADER = 'x-puntovivo-envelope';

/**
 * Header name used to ship the device id. Set on every authenticated
 * request once `auth.registerDevice` returned an id; the middleware
 * cross-checks against `devices.tenant_id` per ADR-0001.
 */
export const DEVICE_ID_HEADER = 'x-device-id';
