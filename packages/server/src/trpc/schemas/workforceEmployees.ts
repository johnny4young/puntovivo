/** Shared minimal manager picker contract, not the administrator user directory. */
import { z } from 'zod';
const identifier = z.string().trim().min(1).max(100);
export const listWorkforceEmployeesInput = z
  .object({
    search: z.string().trim().max(100).default(''),
    cursor: identifier.optional(),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .strict();
