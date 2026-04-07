import { z } from 'zod';

const documentTypeEnum = z.enum(['sale', 'purchase', 'order']);

export const listSequentialsInput = z
  .object({
    siteId: z.string().optional(),
    documentType: documentTypeEnum.optional(),
  })
  .optional();

export const upsertSequentialInput = z.object({
  siteId: z.string().min(1, 'Site is required'),
  documentType: documentTypeEnum,
  prefix: z.string().max(20, 'Prefix must be 20 characters or fewer'),
  currentValue: z.number().int().min(0, 'Current value must be zero or greater'),
});

export const deleteSequentialInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export type UpsertSequentialInput = z.infer<typeof upsertSequentialInput>;
