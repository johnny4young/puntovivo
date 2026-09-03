/** Bounded kitchen-only wire snapshots shared by writer and read-side validation. */
import { z } from 'zod';
import { throwServerError } from '../../lib/errorCodes.js';
import { KDS_MAX_LINES } from './common.js';
const label = z
  .string()
  .min(1)
  .max(500)
  .refine(value => value.trim().length > 0);
const id = z.string().min(1).max(128);
const quantity = z.number().finite().positive().max(1_000_000_000);
/** No price, tender, customer or regulatory evidence enters a kitchen snapshot. */
export const kitchenItemSnapshotSchema = z.object({
  saleItemId: id,
  productId: id,
  productName: label,
  quantity,
  unitLabel: z.string().max(80).nullable(),
  notes: z.string().max(8_192).nullable(),
  roundId: id.nullable(),
  roundLabel: label.nullable(),
  courseKey: z.string().max(80).nullable(),
  dinerLabel: label.nullable(),
  modifiers: z.array(z.object({ name: label, quantity })).max(20),
});
/** Frozen preparation projection; operational ownership/status live separately. */
export type KitchenItemSnapshot = z.infer<typeof kitchenItemSnapshotSchema>;
/** Validate before persisting so no partially omitted or oversized order can be cooked. */
export function validateKitchenSnapshots(input: unknown): KitchenItemSnapshot[] {
  const result = z.array(kitchenItemSnapshotSchema).min(1).max(KDS_MAX_LINES).safeParse(input);
  if (
    !result.success ||
    new Set(result.data.map(item => item.saleItemId)).size !== result.data.length ||
    Buffer.byteLength(JSON.stringify(result.data), 'utf8') > 512 * 1024
  ) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'KDS_SNAPSHOT_INVALID',
      message: 'Kitchen submission contains invalid or oversized preparation data',
    });
  }
  return result.data;
}
