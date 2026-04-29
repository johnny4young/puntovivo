import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { onErrorToast } from './mutationHelpers';

type Toast = {
  error: ReturnType<typeof vi.fn>;
  success: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warning: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  dismiss: ReturnType<typeof vi.fn>;
};

function buildToast(): Toast {
  return {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    show: vi.fn(),
    dismiss: vi.fn(),
  };
}

// Identity translator: returns the key when the key is "unknown" or unmapped,
// otherwise returns a recognizable `translated:<key>` value so we can assert
// resolution paths.
function buildTranslator(map: Record<string, string> = {}): TFunction {
  const t = ((key: string) => map[key] ?? key) as unknown as TFunction;
  return t;
}

describe('onErrorToast', () => {
  it('emits a translated error toast with default title and fallback keys', () => {
    const toast = buildToast();
    const t = buildTranslator({
      'common:toast.error': 'Something went wrong',
      'errors:server.unknown': 'Unknown server error',
    });

    onErrorToast(toast as never, t)(new Error(''));

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith({
      title: 'Something went wrong',
      description: 'Unknown server error',
    });
  });

  it('resolves a known errorCode to errors:server.<CODE>', () => {
    const toast = buildToast();
    const t = buildTranslator({
      'common:toast.error': 'Error',
      'errors:server.CASH_SESSION_ALREADY_OPEN_FOR_CASHIER':
        'Ya tienes una sesión de caja abierta',
    });

    onErrorToast(toast as never, t)({
      data: { errorCode: 'CASH_SESSION_ALREADY_OPEN_FOR_CASHIER' },
      message: 'unused English message',
    });

    expect(toast.error).toHaveBeenCalledWith({
      title: 'Error',
      description: 'Ya tienes una sesión de caja abierta',
    });
  });

  it('routes a network connectivity error to errors:server.networkUnavailable', () => {
    const toast = buildToast();
    const t = buildTranslator({
      'common:toast.error': 'Error',
      'errors:server.networkUnavailable': 'Sin conexión',
      'errors:server.unknown': 'Unknown',
    });

    onErrorToast(toast as never, t)(new TypeError('Failed to fetch'));

    expect(toast.error).toHaveBeenCalledWith({
      title: 'Error',
      description: 'Sin conexión',
    });
  });

  it('falls back to the server error message when no code is present', () => {
    const toast = buildToast();
    const t = buildTranslator({
      'common:toast.error': 'Error',
      'errors:server.unknown': 'Unknown',
    });

    onErrorToast(toast as never, t)(new Error('FORBIDDEN'));

    expect(toast.error).toHaveBeenCalledWith({
      title: 'Error',
      description: 'FORBIDDEN',
    });
  });

  it('honors caller-supplied titleKey and fallbackKey', () => {
    const toast = buildToast();
    const t = buildTranslator({
      'sales:cashSession.toast.openErrorTitle': 'No se pudo abrir caja',
      'sales:cashSession.toast.openErrorFallback': 'Intenta de nuevo',
    });

    onErrorToast(toast as never, t, {
      titleKey: 'sales:cashSession.toast.openErrorTitle',
      fallbackKey: 'sales:cashSession.toast.openErrorFallback',
    })(null);

    expect(toast.error).toHaveBeenCalledWith({
      title: 'No se pudo abrir caja',
      description: 'Intenta de nuevo',
    });
  });

  it('runs the extra callback with the resolved description and original error', () => {
    const toast = buildToast();
    const t = buildTranslator({
      'common:toast.error': 'Error',
      'errors:server.unknown': 'Unknown',
    });
    const extra = vi.fn();
    const original = new Error('boom');

    onErrorToast(toast as never, t, { extra })(original);

    expect(extra).toHaveBeenCalledTimes(1);
    expect(extra).toHaveBeenCalledWith('boom', original);
  });

  it('does not invoke extra when none was provided', () => {
    const toast = buildToast();
    const t = buildTranslator({});
    expect(() => onErrorToast(toast as never, t)(null)).not.toThrow();
  });

  it('exposes the raw key when the title key is not in the locale (regression: ensure project locales include common:toast.error)', () => {
    // i18next's default fallback returns the supplied key as a string when no
    // translation is found. The helper passes that string through to the
    // toast title — a real-world miss shows the operator the raw i18n key.
    // This test pins the behavior so we notice when the default `titleKey`
    // is added or removed from the project's locale files.
    const toast = buildToast();
    const t = buildTranslator({
      // intentionally do NOT register 'common:toast.error' so we observe the
      // fallback. Locale parity tests separately enforce that the real
      // namespaces include this key.
      'errors:server.unknown': 'Unknown',
    });
    onErrorToast(toast as never, t)(null);
    expect(toast.error).toHaveBeenCalledWith({
      title: 'common:toast.error',
      description: 'Unknown',
    });
  });
});
