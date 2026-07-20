/** serialized inventory API schemas. */
import { z } from 'zod';

const isoDate = z
  .string()
  .trim()
  .min(1)
  .refine(value => !Number.isNaN(Date.parse(value)), 'Must be a valid ISO date');

export const receiveProductSerialsInput = z
  .object({
    siteId: z.string().min(1, 'Site is required'),
    productId: z.string().min(1, 'Product is required'),
    serialNumbers: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(120)
          .transform(value => value.normalize('NFKC').toLocaleUpperCase('en-US'))
      )
      .min(1)
      .max(100),
    unitCost: z.number().min(0, 'Unit cost cannot be negative'),
    warrantyExpiresAt: isoDate.nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((input, ctx) => {
    if (new Set(input.serialNumbers).size !== input.serialNumbers.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['serialNumbers'],
        message: 'Serial numbers must be unique within a receipt',
      });
    }
  });

export const listProductSerialsInput = z.object({
  siteId: z.string().min(1, 'Site is required'),
  productId: z.string().min(1, 'Product is required'),
  sellableOnly: z.boolean().default(false),
});

export const lookupProductSerialInput = z.object({
  serialNumber: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .transform(value => value.normalize('NFKC').toLocaleUpperCase('en-US')),
});
