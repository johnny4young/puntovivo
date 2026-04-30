import { describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';

import { ServerErrorWithCode } from '../../../lib/errorCodes.js';

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

    it('returns the ollama stub flagged as notImplemented', () => {
      const provider = getProvider('ollama');
      expect(provider.id).toBe('ollama');
      expect(isNotImplemented(provider)).toBe(true);
    });
  });

  describe('listProviders', () => {
    it('returns one entry per registered provider', () => {
      const list = listProviders();
      expect(list).toHaveLength(3);
      expect(list.map(entry => entry.id)).toEqual(['anthropic', 'openai', 'ollama']);
    });

    it('flags anthropic and openai as implemented; ollama parked for ENG-040', () => {
      const list = listProviders();
      const byId = Object.fromEntries(list.map(entry => [entry.id, entry] as const));
      expect(byId.anthropic.isImplemented).toBe(true);
      expect(byId.anthropic.availableInTicket).toBeUndefined();
      expect(byId.openai.isImplemented).toBe(true);
      expect(byId.openai.availableInTicket).toBeUndefined();
      expect(byId.ollama.isImplemented).toBe(false);
      expect(byId.ollama.availableInTicket).toBe('ENG-040');
    });
  });

  describe('notImplemented stubs', () => {
    it('throws AI_PROVIDER_ERROR with the ticket hint when languageModel is called', () => {
      // Ollama is the only remaining notImplemented provider after
      // ENG-044 turned OpenAI on. Tested here so the rejection flow is
      // pinned regardless of which provider stays parked.
      const provider = getProvider('ollama');
      let caught: unknown;
      try {
        provider.languageModel('llama3.2');
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TRPCError);
      const cause = (caught as TRPCError).cause;
      expect(cause).toBeInstanceOf(ServerErrorWithCode);
      expect((cause as ServerErrorWithCode).errorCode).toBe('AI_PROVIDER_ERROR');
      expect((caught as TRPCError).message).toContain('ENG-040');
    });

    it('reports isConfigured() === false for the ollama stub', () => {
      expect(getProvider('ollama').isConfigured()).toBe(false);
    });
  });
});
