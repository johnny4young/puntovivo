/**
 * ENG-040b slice 1 — Ollama provider activation tests.
 *
 * The provider routes through the community `ollama-ai-provider-v2`
 * package, which constructs a Vercel AI SDK language-model factory.
 * Network round-trips are deliberately not exercised here — the
 * factory only fires real HTTP traffic when the caller invokes
 * `generateText` / `generateObject`, which is the integration surface
 * of `completeAI` / `extractInvoiceFromImage` / `matchInvoiceLinesToProducts`.
 *
 * What this test pins:
 *  - `id`, `defaultModelId`, free pricing for any usage shape.
 *  - `isConfigured()` is unconditionally `true` (no API key surface;
 *    the daemon either answers on the configured base URL or it
 *    doesn't, and the first real call surfaces that).
 *  - The base-URL resolver honours `OLLAMA_BASE_URL` and falls back to
 *    `http://localhost:11434` when the env var is unset or blank.
 *  - `languageModel` and `visionModel` exist and return non-null
 *    builders (so the existing vision-capability check in
 *    `extractInvoiceFromImage` passes).
 *  - `cacheControlForSystemPrompt()` returns `undefined`.
 *  - `embeddingModel` returns the Ollama embedding factory and
 *    advertises `nomic-embed-text` as the provider default.
 */
import { describe, expect, it } from 'vitest';

import { __ollamaInternals, ollamaProvider } from './ollama.js';

describe('ai/providers/ollama (ENG-040b slice 1)', () => {
  describe('identity + pricing', () => {
    it('id is ollama', () => {
      expect(ollamaProvider.id).toBe('ollama');
    });

    it('defaultModelId is llama3.2', () => {
      expect(ollamaProvider.defaultModelId).toBe('llama3.2');
    });

    it('returns zero cost for any token usage shape', () => {
      const cost = ollamaProvider.pricing.calculateCostUsd('llama3.2', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      });
      expect(cost).toBe(0);
    });

    it('returns zero cost for an unknown model id', () => {
      const cost = ollamaProvider.pricing.calculateCostUsd('does-not-exist', {
        inputTokens: 999,
        outputTokens: 999,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      expect(cost).toBe(0);
    });
  });

  describe('isConfigured', () => {
    it('returns true regardless of OLLAMA_BASE_URL env var presence', () => {
      const original = process.env.OLLAMA_BASE_URL;
      try {
        delete process.env.OLLAMA_BASE_URL;
        expect(ollamaProvider.isConfigured()).toBe(true);
        process.env.OLLAMA_BASE_URL = 'https://gpu.lan:11434';
        expect(ollamaProvider.isConfigured()).toBe(true);
        process.env.OLLAMA_BASE_URL = '';
        expect(ollamaProvider.isConfigured()).toBe(true);
      } finally {
        if (original === undefined) {
          delete process.env.OLLAMA_BASE_URL;
        } else {
          process.env.OLLAMA_BASE_URL = original;
        }
      }
    });
  });

  describe('resolveBaseUrl (test internals)', () => {
    it('returns http://localhost:11434 by default', () => {
      const original = process.env.OLLAMA_BASE_URL;
      try {
        delete process.env.OLLAMA_BASE_URL;
        expect(__ollamaInternals.resolveBaseUrl()).toBe(
          'http://localhost:11434'
        );
        expect(__ollamaInternals.DEFAULT_OLLAMA_BASE_URL).toBe(
          'http://localhost:11434'
        );
      } finally {
        if (original === undefined) {
          delete process.env.OLLAMA_BASE_URL;
        } else {
          process.env.OLLAMA_BASE_URL = original;
        }
      }
    });

    it('honours OLLAMA_BASE_URL when set to a non-empty string', () => {
      const original = process.env.OLLAMA_BASE_URL;
      try {
        process.env.OLLAMA_BASE_URL = 'https://gpu.lan:11434';
        expect(__ollamaInternals.resolveBaseUrl()).toBe(
          'https://gpu.lan:11434'
        );
      } finally {
        if (original === undefined) {
          delete process.env.OLLAMA_BASE_URL;
        } else {
          process.env.OLLAMA_BASE_URL = original;
        }
      }
    });

    it('treats whitespace-only OLLAMA_BASE_URL as unset', () => {
      const original = process.env.OLLAMA_BASE_URL;
      try {
        process.env.OLLAMA_BASE_URL = '   ';
        expect(__ollamaInternals.resolveBaseUrl()).toBe(
          'http://localhost:11434'
        );
      } finally {
        if (original === undefined) {
          delete process.env.OLLAMA_BASE_URL;
        } else {
          process.env.OLLAMA_BASE_URL = original;
        }
      }
    });
  });

  describe('language + vision model factories', () => {
    it('languageModel returns a non-null model builder', () => {
      const model = ollamaProvider.languageModel('llama3.2');
      expect(model).toBeDefined();
      expect(model).not.toBeNull();
    });

    it('visionModel is defined as a function (capability hint)', () => {
      // `extractInvoiceFromImage` short-circuits when
      // `typeof provider.visionModel !== 'function'`; this assertion
      // pins the capability so a future regression cannot accidentally
      // drop the method.
      expect(typeof ollamaProvider.visionModel).toBe('function');
    });

    it('visionModel returns a non-null model builder', () => {
      const model = ollamaProvider.visionModel?.('llava');
      expect(model).toBeDefined();
      expect(model).not.toBeNull();
    });
  });

  describe('cacheControlForSystemPrompt', () => {
    it('returns undefined (Ollama exposes no provider-side cache control today)', () => {
      expect(ollamaProvider.cacheControlForSystemPrompt()).toBeUndefined();
    });
  });

  describe('embeddingModel', () => {
    // ENG-040b slice 2 — Ollama embeddings activated via
    // `ollama-ai-provider-v2.embedding(modelId)`. The factory itself
    // doesn't hit the network until `embedMany({ model, ... })` runs,
    // so the unit assertion is limited to the contract shape.
    it('is implemented and returns a model factory (ENG-040b slice 2)', () => {
      expect(ollamaProvider.embeddingModel).toBeDefined();
      expect(typeof ollamaProvider.embeddingModel).toBe('function');
      const model = ollamaProvider.embeddingModel?.('nomic-embed-text');
      expect(model).toBeDefined();
      expect(model).not.toBeNull();
    });

    it('advertises nomic-embed-text as the canonical embedding model id', () => {
      // Cross-check against the test-internals constant so a future
      // change to `FALLBACK_EMBEDDING_MODEL_ID` (e.g. switching the
      // default to `mxbai-embed-large`) flips this assertion in one
      // place instead of letting the hard-coded literal silently
      // diverge from the provider object.
      expect(ollamaProvider.defaultEmbeddingModelId).toBe(
        __ollamaInternals.FALLBACK_EMBEDDING_MODEL_ID
      );
      expect(__ollamaInternals.FALLBACK_EMBEDDING_MODEL_ID).toBe(
        'nomic-embed-text'
      );
    });
  });
});
