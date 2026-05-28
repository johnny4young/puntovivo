/**
 * ENG-030 — Shared types for the AI foundation.
 *
 * @module services/ai/types
 */
import type { AIProviderId } from './providers/types.js';

/** Stable feature label persisted in `ai_audit_log.feature`. */
export type AIFeature =
  | 'completeTest'
  | 'copilot'
  | 'autoCategorize'
  | 'embeddings'
  | 'invoiceOcr'
  | 'invoiceLineMatch'
  | 'paymentReconciliation';

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

export interface AIFeatureFlags {
  copilot: { enabled: boolean };
  anomalies: {
    enabled: boolean;
    /** Lower bound for surfacing — only show alerts at or above this band. */
    alertSeverityThreshold: 'media' | 'alta';
  };
  semanticSearch: { enabled: boolean };
  invoiceOcr: {
    enabled: boolean;
    provider: 'textract' | 'docai' | 'azure';
  };
  privacy: {
    piiRedaction: true;
    modelLocation: 'us' | 'on-prem';
  };
}

export const DEFAULT_AI_FEATURE_FLAGS: AIFeatureFlags = {
  copilot: { enabled: false },
  anomalies: { enabled: false, alertSeverityThreshold: 'media' },
  semanticSearch: { enabled: false },
  invoiceOcr: { enabled: false, provider: 'textract' },
  privacy: { piiRedaction: true, modelLocation: 'us' },
};

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
  /** Per-feature opt-in flags. Added 2026-05-15. */
  // ENG-179b — explicit `| undefined` on optional features field.
  features?: AIFeatureFlags | undefined;
}

/** Defaults applied to a tenant that has no `ai` block in settings yet. */
export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: false,
  monthlyBudgetUsd: 0,
  providerId: null,
  modelId: null,
  features: DEFAULT_AI_FEATURE_FLAGS,
};
