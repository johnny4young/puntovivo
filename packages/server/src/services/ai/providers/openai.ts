/**
 * ENG-030 — OpenAI provider stub (notImplemented).
 *
 * Type-completeness placeholder so the registry can return a stable
 * shape and the admin card can render `openai` in the selector with a
 * disabled-with-hint UX. Real implementation lands with ENG-033 when
 * embeddings + auto-categorization need OpenAI's `text-embedding-3-small`.
 *
 * @module services/ai/providers/openai
 */
import type { LanguageModelV3 } from '@ai-sdk/provider';

import { throwServerError } from '../../../lib/errorCodes.js';

import type { NotImplementedProvider, ProviderPricing, TokenUsage } from './types.js';

const EMPTY_PRICING: ProviderPricing = {
  models: {},
  calculateCostUsd: (_modelId: string, _usage: TokenUsage): number => 0,
};

function refuse(): never {
  throwServerError({
    trpcCode: 'BAD_REQUEST',
    errorCode: 'AI_PROVIDER_ERROR',
    message:
      'OpenAI provider lands with ENG-033 (embeddings + auto-categorization)',
  });
}

export const openaiProvider: NotImplementedProvider = {
  id: 'openai',
  defaultModelId: 'gpt-4o-mini',
  pricing: EMPTY_PRICING,
  notImplemented: true,
  availableInTicket: 'ENG-033',

  isConfigured(): boolean {
    return false;
  },

  languageModel(_modelId: string): LanguageModelV3 {
    refuse();
  },

  cacheControlForSystemPrompt(): undefined {
    return undefined;
  },
};
