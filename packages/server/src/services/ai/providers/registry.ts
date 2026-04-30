/**
 * ENG-030 — AI provider registry (Strategy + Factory).
 *
 * Single source of truth for which providers exist, which one is the
 * default, and how to look one up by id. Mirrors the
 * `services/fiscal/registry.ts` precedent — module-level singleton,
 * one factory function for callers.
 *
 * @module services/ai/providers/registry
 */
import { throwServerError } from '../../../lib/errorCodes.js';

import { anthropicProvider } from './anthropic.js';
import { ollamaProvider } from './ollama.js';
import { openaiProvider } from './openai.js';
import { isNotImplemented } from './types.js';
import type { AIProvider, AIProviderId, NotImplementedProvider } from './types.js';

/**
 * Default provider when the tenant has not selected an override.
 * Operator-approved at ENG-030 plan time: Anthropic Sonnet 4.x for
 * best tool-calling reliability + neutral-LATAM Spanish.
 */
export const DEFAULT_PROVIDER_ID: AIProviderId = 'anthropic';

const PROVIDERS: Record<AIProviderId, AIProvider | NotImplementedProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  ollama: ollamaProvider,
};

/**
 * Resolve a provider by id, falling back to the default when no id is
 * supplied. Throws `AI_PROVIDER_ERROR` for an unknown id (defensive —
 * Zod validation on the tRPC input should reject unknown ids first).
 */
export function getProvider(id?: AIProviderId | null): AIProvider | NotImplementedProvider {
  const resolved = id ?? DEFAULT_PROVIDER_ID;
  const provider = PROVIDERS[resolved];
  if (!provider) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AI_PROVIDER_ERROR',
      message: `Unknown AI provider: ${resolved}`,
    });
  }
  return provider;
}

export interface ProviderListing {
  id: AIProviderId;
  defaultModelId: string;
  isImplemented: boolean;
  /** Ticket id where the implementation lands; only set for stubs. */
  availableInTicket?: string;
}

export function listProviders(): ReadonlyArray<ProviderListing> {
  return (Object.keys(PROVIDERS) as AIProviderId[]).map(id => {
    const provider = PROVIDERS[id];
    return {
      id,
      defaultModelId: provider.defaultModelId,
      isImplemented: !isNotImplemented(provider),
      availableInTicket: isNotImplemented(provider)
        ? provider.availableInTicket
        : undefined,
    };
  });
}

export { isNotImplemented };
