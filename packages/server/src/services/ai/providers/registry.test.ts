import { describe, expect, it } from 'vitest';

import { anthropicProvider } from './anthropic.js';
import {
  DEFAULT_PROVIDER_ID,
  getProvider,
  listProviders,
  isNotImplemented,
} from './registry.js';

describe('ai/providers/registry', () => {
  describe('DEFAULT_PROVIDER_ID', () => {
    it('is anthropic', () => {
      expect(DEFAULT_PROVIDER_ID).toBe('anthropic');
    });
  });

  describe('getProvider', () => {
    it('returns the anthropic instance when called without an argument', () => {
      const provider = getProvider();
      expect(provider).toBe(anthropicProvider);
    });

    it('returns the anthropic instance when called with null', () => {
      const provider = getProvider(null);
      expect(provider).toBe(anthropicProvider);
    });

    it('returns the anthropic instance when explicitly asked for it', () => {
      const provider = getProvider('anthropic');
      expect(provider).toBe(anthropicProvider);
    });

    it('returns the openai instance flagged as implemented (ENG-044)', () => {
      const provider = getProvider('openai');
      expect(provider.id).toBe('openai');
      expect(isNotImplemented(provider)).toBe(false);
    });

    // ENG-040b slice 1 — Ollama provider activated. The
    // `isNotImplemented` flag flips to `false`; the registry can no
    // longer represent a stub provider here. A future stub (e.g. a
    // brand-new provider id) would land its own assertion when that
    // happens.
    it('returns the ollama instance flagged as implemented (ENG-040b)', () => {
      const provider = getProvider('ollama');
      expect(provider.id).toBe('ollama');
      expect(isNotImplemented(provider)).toBe(false);
    });
  });

  describe('listProviders', () => {
    it('returns one entry per registered provider', () => {
      const list = listProviders();
      expect(list).toHaveLength(3);
      expect(list.map(entry => entry.id)).toEqual(['anthropic', 'openai', 'ollama']);
    });

    it('flags every registered provider as implemented after ENG-040b', () => {
      const list = listProviders();
      const byId = Object.fromEntries(list.map(entry => [entry.id, entry] as const));
      expect(byId.anthropic.isImplemented).toBe(true);
      expect(byId.anthropic.availableInTicket).toBeUndefined();
      expect(byId.openai.isImplemented).toBe(true);
      expect(byId.openai.availableInTicket).toBeUndefined();
      expect(byId.ollama.isImplemented).toBe(true);
      expect(byId.ollama.availableInTicket).toBeUndefined();
    });
  });
});
