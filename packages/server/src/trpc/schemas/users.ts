import { z } from 'zod';
import { paginationInput } from './common.js';

const userRoleEnum = z.enum(['admin', 'manager', 'cashier', 'viewer']);

export const listUsersInput = paginationInput.extend({
  search: z.string().optional(),
  isActive: z.boolean().optional(),
});

export const createUserInput = z.object({
  email: z.string().email('Invalid email address'),
  name: z.string().min(1, 'Name is required').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  role: userRoleEnum,
  isActive: z.boolean().default(true),
});

export const updateUserInput = z.object({
  id: z.string().min(1, 'ID is required'),
  email: z.string().email('Invalid email address').optional(),
  name: z.string().min(1, 'Name is required').max(255).optional(),
  role: userRoleEnum.optional(),
  isActive: z.boolean().optional(),
});

export const resetUserPasswordInput = z.object({
  id: z.string().min(1, 'ID is required'),
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

export type CreateUserInput = z.infer<typeof createUserInput>;
