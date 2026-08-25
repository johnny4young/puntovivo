import { afterEach, describe, expect, it } from 'vitest';
import {
  persistLanguagePreference,
  persistTenantLanguage,
  readLanguagePreference,
  readTenantLanguage,
  resolveBootLocale,
  resolveLocale,
  toSupportedAppLocale,
} from './resolveLocale';

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

describe('toSupportedAppLocale', () => {
  it('maps regional Spanish locales to the Electron-supported locale set', () => {
    expect(toSupportedAppLocale('es-CO')).toBe('es');
    expect(toSupportedAppLocale('es_MX')).toBe('es');
  });

  it('falls back to English for unknown or missing locales', () => {
    expect(toSupportedAppLocale('en-US')).toBe('en');
    expect(toSupportedAppLocale('pt-BR')).toBe('en');
    expect(toSupportedAppLocale(undefined)).toBe('en');
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

describe('tenant language cache', () => {
  it('round-trips a tenant language and normalizes regional tags', () => {
    persistTenantLanguage('es-CO');
    expect(readTenantLanguage()).toBe('es');

    persistTenantLanguage('en-US');
    expect(readTenantLanguage()).toBe('en');
  });

  it('returns null when the device has never completed a session', () => {
    expect(readTenantLanguage()).toBeNull();
  });

  it('ignores a corrupt cached value instead of booting into it', () => {
    window.localStorage.setItem('puntovivo-tenant-language', 'fr');
    expect(readTenantLanguage()).toBeNull();
  });
});

describe('resolveBootLocale', () => {
  function setNavigatorLanguage(language: string) {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { ...originalNavigator, language, languages: [language] },
    });
  }

  it('lets an explicit user preference beat the cached tenant language', () => {
    persistTenantLanguage('es');
    persistLanguagePreference('en');
    expect(resolveBootLocale()).toBe('en');
  });

  it('boots the cached tenant language over the OS language', () => {
    setNavigatorLanguage('en-US');
    persistTenantLanguage('es');
    expect(resolveBootLocale()).toBe('es');
  });

  it('falls back to the OS language on a device with no cached tenant', () => {
    setNavigatorLanguage('es-CO');
    expect(resolveBootLocale()).toBe('es-CO');
  });
});
