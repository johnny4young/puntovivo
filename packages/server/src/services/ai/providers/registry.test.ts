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

    it('returns the openai stub flagged as notImplemented', () => {
      const provider = getProvider('openai');
      expect(provider.id).toBe('openai');
      expect(isNotImplemented(provider)).toBe(true);
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

    it('flags only anthropic as implemented in this ticket', () => {
      const list = listProviders();
      const byId = Object.fromEntries(list.map(entry => [entry.id, entry] as const));
      expect(byId.anthropic.isImplemented).toBe(true);
      expect(byId.anthropic.availableInTicket).toBeUndefined();
      expect(byId.openai.isImplemented).toBe(false);
      expect(byId.openai.availableInTicket).toBe('ENG-033');
      expect(byId.ollama.isImplemented).toBe(false);
      expect(byId.ollama.availableInTicket).toBe('ENG-040');
    });
  });

  describe('notImplemented stubs', () => {
    it('throws AI_PROVIDER_ERROR with the ticket hint when languageModel is called', () => {
      const provider = getProvider('openai');
      let caught: unknown;
      try {
        provider.languageModel('gpt-4o-mini');
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TRPCError);
      const cause = (caught as TRPCError).cause;
      expect(cause).toBeInstanceOf(ServerErrorWithCode);
      expect((cause as ServerErrorWithCode).errorCode).toBe('AI_PROVIDER_ERROR');
      expect((caught as TRPCError).message).toContain('ENG-033');
    });

    it('reports isConfigured() === false', () => {
      expect(getProvider('openai').isConfigured()).toBe(false);
      expect(getProvider('ollama').isConfigured()).toBe(false);
    });
  });
});
