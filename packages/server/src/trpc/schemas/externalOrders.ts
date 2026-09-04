import { z } from 'zod';
import { externalOrderStatusEnum } from '../../db/schema.js';
import { EXTERNAL_ORDER_MAX_BODY_BYTES } from '../../services/external-orders/signature.js';
const id = z.string().trim().min(1).max(128);
const version = z
  .number()
  .int()
  .min(1)
  .max(Number.MAX_SAFE_INTEGER - 1);
// The renderer generates 32 random bytes and displays them once. No mutation
// response/idempotency result ever stores or replays the plaintext credential.
const secret = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .refine(value => {
    const bytes = Buffer.from(value, 'base64url');
    return bytes.length === 32 && bytes.toString('base64url') === value;
  });
export const externalSiteInput = z.object({ siteId: id }).strict();
export const externalTargetInput = externalSiteInput.extend({ id }).strict();
export const createExternalConnectorInput = externalSiteInput
  .extend({ name: z.string().trim().min(1).max(100), adapter: z.literal('sandbox_v1'), secret })
  .strict();
export const updateExternalConnectorInput = externalTargetInput
  .extend({ expectedVersion: version, enabled: z.boolean(), secret: secret.optional() })
  .strict();
export const receiveExternalOrderInput = z
  .object({
    connectorId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    timestamp: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
    body: z
      .string()
      .max(EXTERNAL_ORDER_MAX_BODY_BYTES)
      .refine(value => Buffer.byteLength(value, 'utf8') <= EXTERNAL_ORDER_MAX_BODY_BYTES),
    signature: z.string().max(67),
  })
  .strict();
export const listExternalOrdersInput = externalSiteInput
  .extend({
    status: z.enum(externalOrderStatusEnum).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    cursor: z
      .object({ createdAt: z.string().max(40), id })
      .strict()
      .optional(),
  })
  .strict();
export const rejectExternalOrderInput = externalTargetInput
  .extend({ expectedVersion: version, reason: z.string().trim().min(1).max(500) })
  .strict();
/** Operator-controlled connector creation, scoped to one owned site. */
export type CreateExternalConnectorInput = z.infer<typeof createExternalConnectorInput>;
/** CAS disable/enable or key rotation. Re-enabling does not erase the durable inbox. */
export type UpdateExternalConnectorInput = z.infer<typeof updateExternalConnectorInput>;

export const acceptExternalOrderInput = externalTargetInput
  .extend({
    expectedVersion: version,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    confirmedLocalPricing: z.literal(true),
  })
  .strict();
