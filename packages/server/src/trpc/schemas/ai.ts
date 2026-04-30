/**
 * ENG-030 — Zod schemas for the AI router.
 *
 * @module trpc/schemas/ai
 */
import { z } from 'zod';

export const aiProviderIdSchema = z.enum(['anthropic', 'openai', 'ollama']);

export const updateAISettingsInput = z.object({
  enabled: z.boolean().optional(),
  monthlyBudgetUsd: z.number().min(0).max(100_000).optional(),
  providerId: aiProviderIdSchema.nullable().optional(),
  modelId: z
    .string()
    .min(1)
    .max(120)
    .nullable()
    .optional(),
});

export const aiUsageInput = z.object({
  limit: z.number().int().min(1).max(200).default(50).optional(),
  cursor: z.string().min(1).optional(),
});

export const aiBreakdownInput = z.object({
  scope: z.enum(['site', 'user', 'feature', 'provider']),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
