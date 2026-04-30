/**
 * ENG-030 — Shared types for the AI foundation.
 *
 * @module services/ai/types
 */
import type { AIProviderId } from './providers/types.js';

/** Stable feature label persisted in `ai_audit_log.feature`. */
export type AIFeature = 'completeTest' | 'copilot' | 'autoCategorize' | 'embeddings';

export interface AICompletionInput {
  feature: AIFeature;
  /** Optional system prompt; provider-specific cache markers are
   *  applied automatically by the pipeline when supported. */
  system?: string;
  prompt: string;
  /** Override; defaults to `settings.modelId ?? provider.defaultModelId`. */
  modelId?: string;
  maxOutputTokens?: number;
}

export interface AICompletionResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  durationMs: number;
  provider: AIProviderId;
  model: string;
  auditLogId: string;
}

/**
 * Resolved AI configuration for a tenant. Read with `resolveAISettings`
 * from `tenants.settings.ai`; write via the `ai.settings.update` tRPC
 * mutation.
 */
export interface AISettings {
  enabled: boolean;
  monthlyBudgetUsd: number;
  /** null = use `DEFAULT_PROVIDER_ID`. */
  providerId: AIProviderId | null;
  /** null = use `provider.defaultModelId`. */
  modelId: string | null;
}

/** Defaults applied to a tenant that has no `ai` block in settings yet. */
export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  monthlyBudgetUsd: 0,
  providerId: null,
  modelId: null,
};
