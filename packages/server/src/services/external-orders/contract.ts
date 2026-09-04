/** Versioned sandbox protocol. External amounts are quotes, never evidence of local payment. */
import { z } from 'zod';

const externalId = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);
const quantity = z
  .number()
  .finite()
  .positive()
  .max(1_000_000)
  .refine(value => Math.abs(value * 1000 - Math.round(value * 1000)) < 0.00001);
const money = z
  .number()
  .finite()
  .min(0)
  .max(1_000_000_000)
  .refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001);
export const externalOrderSnapshotSchema = z
  .object({
    customerName: z.string().trim().min(1).max(160),
    phone: z.string().trim().max(40).optional(),
    address: z.string().trim().min(1).max(500),
    notes: z.string().trim().max(500).optional(),
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
    quotedTotal: money,
    items: z
      .array(
        z
          .object({
            productCode: z.string().trim().min(1).max(128),
            quantity,
          })
          .strict()
      )
      .min(1)
      .max(100),
  })
  .strict();
const common = { schemaVersion: z.literal(1), eventId: externalId, orderId: externalId };
export const externalOrderEventSchema = z.discriminatedUnion('kind', [
  z
    .object({ ...common, kind: z.literal('order.created'), order: externalOrderSnapshotSchema })
    .strict(),
  z
    .object({
      ...common,
      kind: z.literal('order.cancelled'),
      reason: z.string().trim().min(1).max(500),
    })
    .strict(),
]);
/** Frozen intent supplied by the connector; product codes refer to local base-unit SKUs. */
export type ExternalOrderSnapshot = z.infer<typeof externalOrderSnapshotSchema>;
/** Immutable source identity: retry with the same event id and exact payload, but a fresh signature. */
export type ExternalOrderEvent = z.infer<typeof externalOrderEventSchema>;
