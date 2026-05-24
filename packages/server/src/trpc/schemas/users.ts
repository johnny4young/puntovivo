import { z } from 'zod';
import { emailField, paginationInput } from './common.js';
import { strongPasswordSchema } from './auth.js';

const userRoleEnum = z.enum(['admin', 'manager', 'cashier', 'viewer']);

export const listUsersInput = paginationInput
  .extend({
    search: z.string().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const createUserInput = z
  .object({
    email: emailField(),
    name: z.string().min(1, 'Name is required').max(255),
    password: strongPasswordSchema,
    role: userRoleEnum,
    isActive: z.boolean().default(true),
  })
  .strict();

export const updateUserInput = z
  .object({
    id: z.string().min(1, 'ID is required'),
    email: emailField().optional(),
    name: z.string().min(1, 'Name is required').max(255).optional(),
    role: userRoleEnum.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const resetUserPasswordInput = z
  .object({
    id: z.string().min(1, 'ID is required'),
    newPassword: strongPasswordSchema,
  })
  .strict();

export type CreateUserInput = z.infer<typeof createUserInput>;
