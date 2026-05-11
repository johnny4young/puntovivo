/**
 * ENG-030 — Ollama provider stub (notImplemented).
 *
 * Type-completeness placeholder for the offline / local-LLM path.
 * Real implementation lands with ENG-040 (AI Wave 2) where the
 * operator can opt into a local model for receipts that must not
 * leave the building.
 *
 * @module services/ai/providers/ollama
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
    message: 'Ollama provider lands with ENG-040 (AI Wave 2 — vision + voice)',
  });
}

export const ollamaProvider: NotImplementedProvider = {
  id: 'ollama',
  defaultModelId: 'llama3.2',
  pricing: EMPTY_PRICING,
  notImplemented: true,
  availableInTicket: 'ENG-040',

  isConfigured(): boolean {
    return false;
  },

  languageModel(_modelId: string): LanguageModelV3 {
    refuse();
  },

  // ENG-040a — vision capability deliberately UNDEFINED for the Ollama
  // stub. The `extractInvoiceFromImage` service tests
  // `typeof provider.visionModel === 'function'` and surfaces the
  // documented `AI_VISION_NOT_AVAILABLE` for the operator. Live local-
  // vision wiring lands with ENG-040b alongside the Whisper voice slice.

  cacheControlForSystemPrompt(): undefined {
    return undefined;
  },
};
