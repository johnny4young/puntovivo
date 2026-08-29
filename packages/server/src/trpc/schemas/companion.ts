import { z } from 'zod';
import { operationsNeedsAttentionOutputSchema } from './operations.js';
import { dayClosePreviewInput, dayCloseSignoffMetadataOutput } from './reports.js';

const isoDateTime = z.string().datetime({ offset: true });

export const companionSnapshotInput = dayClosePreviewInput;

/** Minimal read model consumed by the phone-width Companion surface. */
export const companionSnapshotOutput = z.object({
  businessDate: dayClosePreviewInput.shape.date,
  generatedAt: isoDateTime,
  stats: z.object({
    revenue: z.number().finite(),
    orders: z.number().int().nonnegative(),
  }),
  recentSales: z
    .array(
      z.object({
        id: z.string().min(1),
        saleNumber: z.string().min(1),
        total: z.number().finite(),
        completedAt: isoDateTime,
      })
    )
    .max(12),
  attention: operationsNeedsAttentionOutputSchema,
  dayClose: dayCloseSignoffMetadataOutput.nullable(),
});

export type CompanionSnapshotOutput = z.infer<typeof companionSnapshotOutput>;
