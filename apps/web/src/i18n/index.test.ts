import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('web i18n Electron sync', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: undefined,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: undefined,
    });
  });

  it('syncs the initial persisted locale to the Electron main process', async () => {
    const updateMainLocale = vi.fn().mockResolvedValue('es');

    window.localStorage.setItem('puntovivo-language-preference', 'es');
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { updateMainLocale },
    });

    await import('./index');

    expect(updateMainLocale).toHaveBeenCalledWith('es');
  });

  it('normalizes regional locales before syncing language changes to Electron', async () => {
    const updateMainLocale = vi.fn().mockResolvedValue('en');

    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: { updateMainLocale },
    });

    const module = await import('./index');
    await module.default.changeLanguage('es-CO');

    expect(updateMainLocale).toHaveBeenLastCalledWith('es');
  });
});
