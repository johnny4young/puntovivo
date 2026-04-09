import { z } from 'zod';

export const listLogosInput = z.object({
  includeInactive: z.boolean().optional(),
  search: z.string().optional(),
});

export const createLogoInput = z.object({
  name: z.string().min(1, 'Logo name is required').max(255),
  imageUrl: z.string().url('Invalid image URL'),
  isActive: z.boolean().default(true),
});

export const updateLogoInput = z.object({
  id: z.string().min(1, 'ID is required'),
  name: z.string().min(1, 'Logo name is required').max(255).optional(),
  imageUrl: z.string().url('Invalid image URL').optional(),
  isActive: z.boolean().optional(),
});

export const deleteLogoInput = z.object({
  id: z.string().min(1, 'ID is required'),
});
