import { z } from 'zod';

export const upsertCompanyInput = z.object({
  name: z.string().min(1, 'Company name is required').max(255),
  taxId: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().email('Invalid email address').nullable().optional(),
  logoUrl: z.string().url('Invalid logo URL').nullable().optional(),
});

export type UpsertCompanyInput = z.infer<typeof upsertCompanyInput>;
