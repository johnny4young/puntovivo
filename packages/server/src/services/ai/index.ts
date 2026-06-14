/**
 * ENG-030 — AI foundation barrel.
 *
 * Downstream tickets (ENG-031 co-pilot, ENG-033 semantic search,
 * ENG-040 vision/voice) import from this module. Internal modules
 * (`auditLog`, `client`, provider files) are not re-exported here —
 * the barrel intentionally surfaces only the agreed external API.
 *
 * @module services/ai
 */
export {
  completeAI,
  resolveAISettings,
  writeAISettings,
  type AIInvocationContext,
  type ProviderFactory,
} from './client.js';

export {
  byBreakdown,
  currentMonthSpend,
  listUsage,
  recordCall,
  type BreakdownEntry,
  type BreakdownScope,
  type ListUsageOptions,
  type ListUsagePage,
} from './auditLog.js';

export {
  copilotLimits,
  runCopilotChat,
  runReadOnlySQL,
  validateReadOnlySQL,
  type CopilotChart,
  type CopilotChatInput,
  type CopilotChatMessage,
  type CopilotChatResult,
  type CopilotContextInput,
  type CopilotRow,
  type CopilotSQLResult,
} from './copilot.js';

export {
  ANALYSIS_WINDOW_DAYS,
  anomalyDetectionConstants,
  detectAnomalies,
  type AnomalyAlert,
  type AnomalyDetectionInput,
  type AnomalyDetectionResult,
  type AnomalyKind,
  type AnomalySeverity,
} from './anomalyDetection/index.js';

export {
  embedText,
  regenerateProductEmbeddings,
  semanticSearchProducts,
  suggestProductCategory,
} from './embeddings.js';

export type {
  AICompletionInput,
  AICompletionResult,
  AIFeature,
  AIFeatureFlags,
  AISettings,
} from './types.js';
export { DEFAULT_AI_FEATURE_FLAGS, DEFAULT_AI_SETTINGS } from './types.js';

export {
  DEFAULT_PROVIDER_ID,
  getProvider,
  isNotImplemented,
  listProviders,
  type ProviderListing,
} from './providers/registry.js';
export type {
  AIProvider,
  AIProviderId,
  ModelPricing,
  ProviderPricing,
  TokenUsage,
} from './providers/types.js';
