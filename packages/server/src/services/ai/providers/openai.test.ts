import { describe, expect, it } from 'vitest';

import { openaiProvider } from './openai.js';

describe('ai/providers/openai', () => {
  describe('pricing.calculateCostUsd', () => {
    it('computes gpt-4.1-mini cost from input + output tokens (default model)', () => {
      // 1M input → 1M/1e6 * $0.40 = $0.40
      // 0.5M output → 0.5M/1e6 * $1.60 = $0.80
      // Total = $1.20
      const cost = openaiProvider.pricing.calculateCostUsd('gpt-4.1-mini', {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      expect(cost).toBeCloseTo(1.2, 6);
    });

    it('separates gpt-4.1-mini cache-read and cache-write at the published prices', () => {
      // 1M cache-read → $0.10
      // 1M cache-write → $0.40 (same as input — no separate write surcharge)
      const cost = openaiProvider.pricing.calculateCostUsd('gpt-4.1-mini', {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      });
      expect(cost).toBeCloseTo(0.1 + 0.4, 6);
    });

    it('computes gpt-4o-mini cost (operator override path — cheapest)', () => {
      // 1M input → $0.15
      // 0.5M output → $0.30
      // Total = $0.45
      const cost = openaiProvider.pricing.calculateCostUsd('gpt-4o-mini', {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      expect(cost).toBeCloseTo(0.45, 6);
    });

    it('computes gpt-4o cost (operator override path — production flagship)', () => {
      // 1M input → $2.50
      // 0.5M output → $5.00
      // Total = $7.50
      const cost = openaiProvider.pricing.calculateCostUsd('gpt-4o', {
        inputTokens: 1_000_000,
        outputTokens: 500_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      expect(cost).toBeCloseTo(7.5, 6);
    });

    it('computes gpt-4.1 cost (operator override path — premium 4.1)', () => {
      // 1M input → $2.00
      // 1M output → $8.00
      // Total = $10.00
      const cost = openaiProvider.pricing.calculateCostUsd('gpt-4.1', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      expect(cost).toBeCloseTo(10, 6);
    });

    it('falls back to gpt-4.1-mini pricing for an unknown model id', () => {
      // 1M input tokens at gpt-4.1-mini rate ($0.40) = $0.40
      const cost = openaiProvider.pricing.calculateCostUsd('gpt-future-9000', {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      expect(cost).toBeCloseTo(0.4, 6);
    });
  });

  describe('cacheControlForSystemPrompt', () => {
    it('returns undefined (OpenAI auto-caches prompts >= 1024 tokens server-side)', () => {
      expect(openaiProvider.cacheControlForSystemPrompt()).toBeUndefined();
    });
  });

  describe('isConfigured', () => {
    it('reads OPENAI_API_KEY from process.env', () => {
      const original = process.env.OPENAI_API_KEY;
      try {
        process.env.OPENAI_API_KEY = '';
        expect(openaiProvider.isConfigured()).toBe(false);
        process.env.OPENAI_API_KEY = '   ';
        expect(openaiProvider.isConfigured()).toBe(false);
        process.env.OPENAI_API_KEY = 'sk-test';
        expect(openaiProvider.isConfigured()).toBe(true);
      } finally {
        if (original === undefined) {
          delete process.env.OPENAI_API_KEY;
        } else {
          process.env.OPENAI_API_KEY = original;
        }
      }
    });
  });

  describe('defaultModelId', () => {
    it('is gpt-4.1-mini', () => {
      expect(openaiProvider.defaultModelId).toBe('gpt-4.1-mini');
    });
  });

  describe('embeddingModel', () => {
    // ENG-033 — OpenAI provider activated `embeddingModel(modelId)` so
    // semantic product search and auto-categorize can consume the
    // OpenAI embeddings endpoint via the AI SDK. Anthropic leaves it
    // undefined; ENG-040b slice 2 activated Ollama with its own
    // default.
    it('is implemented and returns a model factory (ENG-033)', () => {
      expect(openaiProvider.embeddingModel).toBeDefined();
      expect(typeof openaiProvider.embeddingModel).toBe('function');
      const model = openaiProvider.embeddingModel?.('text-embedding-3-small');
      expect(model).toBeDefined();
    });

    it('advertises text-embedding-3-small as the canonical embedding model id (ENG-040b slice 2 contract)', () => {
      expect(openaiProvider.defaultEmbeddingModelId).toBe('text-embedding-3-small');
    });
  });

  describe('transcriptionModel (ENG-040c slice 1)', () => {
    it('is implemented and returns a TranscriptionModelV4 factory', () => {
      expect(openaiProvider.transcriptionModel).toBeDefined();
      expect(typeof openaiProvider.transcriptionModel).toBe('function');
      const model = openaiProvider.transcriptionModel?.('whisper-1');
      expect(model).toBeDefined();
    });

    it('advertises whisper-1 as the canonical transcription model id', () => {
      expect(openaiProvider.defaultTranscriptionModelId).toBe('whisper-1');
    });

    it('publishes per-minute pricing for the supported Whisper variants', () => {
      const pricing = openaiProvider.transcriptionPricing;
      expect(pricing).toBeDefined();
      expect(pricing?.['whisper-1']?.perMinuteUsd).toBe(0.006);
      expect(pricing?.['gpt-4o-mini-transcribe']?.perMinuteUsd).toBe(0.003);
      expect(pricing?.['gpt-4o-transcribe']?.perMinuteUsd).toBe(0.006);
    });

    it('60s of whisper-1 audio costs $0.006', () => {
      const perMinute = openaiProvider.transcriptionPricing?.['whisper-1']?.perMinuteUsd ?? 0;
      const audioSeconds = 60;
      const cost = (audioSeconds / 60) * perMinute;
      expect(cost).toBeCloseTo(0.006, 6);
    });
  });
});
