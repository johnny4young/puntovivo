import { afterEach, describe, expect, it } from 'vitest';
import { persistLanguagePreference, readLanguagePreference, resolveLocale } from './resolveLocale';

const originalNavigator = navigator;
const originalLocalStorage = window.localStorage;

afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: originalNavigator,
  });

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: originalLocalStorage,
  });

  originalLocalStorage.clear();
});

describe('resolveLocale', () => {
  it('returns the explicit preference when one is provided', () => {
    expect(resolveLocale('es')).toBe('es');
    expect(resolveLocale('en')).toBe('en');
  });

  it('preserves the browser regional locale for system preference', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        languages: ['es-CO', 'es'],
        language: 'en-US',
      },
    });

    expect(resolveLocale('system')).toBe('es-CO');
  });

  it('falls back to English when navigator provides no usable locale', () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        languages: [''],
        language: '',
      },
    });

    expect(resolveLocale('system')).toBe('en');
  });
});

describe('language preference storage', () => {
  it('reads a valid persisted preference', () => {
    originalLocalStorage.setItem('puntovivo-language-preference', 'es');

    expect(readLanguagePreference()).toBe('es');
  });

  it('falls back to system when localStorage is not a real Storage implementation', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {},
    });

    expect(readLanguagePreference()).toBe('system');
  });

  it('ignores storage write attempts when setItem is unavailable', () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {},
    });

    expect(() => persistLanguagePreference('en')).not.toThrow();
  });
});
