import { z } from 'zod';

export const listSitesInput = z
  .object({
    search: z.string().optional(),
    isActive: z.boolean().optional(),
    includeInactive: z.boolean().optional(),
  })
  .optional();

export const createSiteInput = z.object({
  companyId: z.string().min(1, 'Company is required'),
  name: z.string().min(1, 'Site name is required').max(255),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
});

export const updateSiteInput = z.object({
  id: z.string().min(1, 'ID is required'),
  companyId: z.string().min(1, 'Company is required').optional(),
  name: z.string().min(1, 'Site name is required').max(255).optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const deleteSiteInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export type CreateSiteInput = z.infer<typeof createSiteInput>;
export type UpdateSiteInput = z.infer<typeof updateSiteInput>;
