import { describe, expect, it } from 'vitest';

import { anthropicProvider } from './anthropic.js';

describe('ai/providers/anthropic', () => {
  describe('pricing.calculateCostUsd', () => {
    it('computes Sonnet 4.6 cost from input + output tokens', () => {
      // 1000 input → 1000/1e6 * $3 = $0.003
      // 500 output → 500/1e6 * $15 = $0.0075
      // Total = $0.0105
      const cost = anthropicProvider.pricing.calculateCostUsd('claude-sonnet-4-6', {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      expect(cost).toBeCloseTo(0.0105, 6);
    });

    it('separates Sonnet cache-read and cache-write at the published prices', () => {
      // 1M cache-read tokens → $0.30
      // 1M cache-write tokens → $3.75
      const cost = anthropicProvider.pricing.calculateCostUsd('claude-sonnet-4-6', {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
      });
      expect(cost).toBeCloseTo(0.3 + 3.75, 6);
    });

    it('computes Haiku 4.5 cost (the default model) from input + output tokens', () => {
      // 1000 input → 1000/1e6 * $1 = $0.001
      // 500 output → 500/1e6 * $5 = $0.0025
      // Total = $0.0035
      const cost = anthropicProvider.pricing.calculateCostUsd('claude-haiku-4-5', {
        inputTokens: 1000,
        outputTokens: 500,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      expect(cost).toBeCloseTo(0.0035, 6);
    });

    it('falls back to Haiku 4.5 pricing for an unknown model id', () => {
      // 1M input tokens at Haiku rate ($1) = $1.00
      const cost = anthropicProvider.pricing.calculateCostUsd('claude-future-9000', {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      expect(cost).toBeCloseTo(1, 6);
    });

    it('uses Opus pricing when the operator selects Opus 4.7', () => {
      // 1M input → $15
      // 1M output → $75
      const cost = anthropicProvider.pricing.calculateCostUsd('claude-opus-4-7', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      });
      expect(cost).toBeCloseTo(15 + 75, 6);
    });
  });

  describe('cacheControlForSystemPrompt', () => {
    it('returns the Anthropic ephemeral cache marker', () => {
      expect(anthropicProvider.cacheControlForSystemPrompt()).toEqual({
        anthropic: { cacheControl: { type: 'ephemeral' } },
      });
    });
  });

  describe('isConfigured', () => {
    it('reads ANTHROPIC_API_KEY from process.env', () => {
      const original = process.env.ANTHROPIC_API_KEY;
      try {
        process.env.ANTHROPIC_API_KEY = '';
        expect(anthropicProvider.isConfigured()).toBe(false);
        process.env.ANTHROPIC_API_KEY = '   ';
        expect(anthropicProvider.isConfigured()).toBe(false);
        process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
        expect(anthropicProvider.isConfigured()).toBe(true);
      } finally {
        if (original === undefined) {
          delete process.env.ANTHROPIC_API_KEY;
        } else {
          process.env.ANTHROPIC_API_KEY = original;
        }
      }
    });
  });

  describe('defaultModelId', () => {
    it('is claude-haiku-4-5', () => {
      expect(anthropicProvider.defaultModelId).toBe('claude-haiku-4-5');
    });
  });
});
