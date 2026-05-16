/**
 * ENG-030 — Zod schemas for the AI router.
 *
 * @module trpc/schemas/ai
 */
import { z } from 'zod';

export const aiProviderIdSchema = z.enum(['anthropic', 'openai', 'ollama']);

/**
 * Per-feature flag patch shape — added 2026-05-15 per AI Núcleo
 * handoff §1.4. Sent by AiConfigPage when an admin toggles a switch
 * or picks a different OCR provider.
 */
export const aiFeatureFlagsPatchSchema = z
  .object({
    copilot: z.object({ enabled: z.boolean() }).optional(),
    anomalies: z
      .object({
        enabled: z.boolean().optional(),
        alertSeverityThreshold: z.enum(['media', 'alta']).optional(),
      })
      .optional(),
    semanticSearch: z.object({ enabled: z.boolean() }).optional(),
    invoiceOcr: z
      .object({
        enabled: z.boolean().optional(),
        provider: z.enum(['textract', 'docai', 'azure']).optional(),
      })
      .optional(),
    privacy: z
      .object({
        modelLocation: z.enum(['us', 'on-prem']).optional(),
      })
      .optional(),
  })
  .optional();

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
  features: aiFeatureFlagsPatchSchema,
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

export const copilotChatMessageInput = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(4_000),
});

export const copilotChatInput = z.object({
  messages: z.array(copilotChatMessageInput).min(1).max(20),
  context: z
    .object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
      siteId: z.string().min(1).nullable().optional(),
    })
    .optional(),
});

/**
 * ENG-032 — input para `ai.anomalies.list`. `from` / `to` son ISO
 * strings opcionales; cuando faltan, el router computa una ventana de
 * `ANALYSIS_WINDOW_DAYS` (30) días terminando en `now`.
 *
 * Validación: si ambos están presentes y `from > to`, el handler
 * rechaza con `BAD_REQUEST` (no requiere errorCode dedicado, es un
 * error de input plano).
 */
export const anomalyListInput = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

/**
 * ENG-047 — input para `ai.anomalies.snooze`. La clave del snooze es
 * `(kind, cashierId, evidenceRef?)`; un manager elige por cuántos días
 * silenciar el patrón (1-90).
 */
export const anomalySnoozeInput = z.object({
  kind: z.enum(['ticketsPerHourSpike', 'voidRate', 'refundAmount', 'noSaleSessions']),
  cashierId: z.string().min(1).nullable(),
  evidenceRef: z.string().min(1).nullable().optional(),
  durationDays: z.number().int().min(1).max(90),
  reason: z.string().trim().min(1).max(500).optional(),
});
