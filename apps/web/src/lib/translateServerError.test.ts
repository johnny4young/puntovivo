import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  KNOWN_SERVER_ERROR_CODES,
  extractServerErrorCode,
  isNetworkConnectivityError,
  translateServerError,
} from './translateServerError';

/**
 * A minimal `t`-shaped function that records its calls so tests can assert
 * the helper resolves keys from the expected namespace. Keeps tests free of
 * any i18next bootstrap.
 */
function makeFakeT(map: Record<string, string>): TFunction {
  const t = ((key: string): string => map[key] ?? key) as unknown as TFunction;
  return t;
}

function loadServerErrorCodesFromSource(): string[] {
  const workspaceRelativePath = resolve(
    process.cwd(),
    '../../packages/server/src/lib/errorCodes.ts'
  );
  const rootRelativePath = resolve(process.cwd(), 'packages/server/src/lib/errorCodes.ts');
  const path = existsSync(workspaceRelativePath) ? workspaceRelativePath : rootRelativePath;
  const source = readFileSync(path, 'utf8');
  const match = source.match(/export const SERVER_ERROR_CODES = \{([\s\S]*?)\n\} as const;/);
  if (!match) {
    throw new Error('Could not locate SERVER_ERROR_CODES in packages/server/src/lib/errorCodes.ts');
  }
  // The outer `if (!match)` guard guarantees match is defined; group 1
  // is required by the regex `\{([\s\S]*?)\n\} as const;` so `match[1]`
  // is non-undefined when `match` is truthy. Each inner match has group
  // 1 as the required `([A-Z0-9_]+)` capture. `!` narrows for
  // `noUncheckedIndexedAccess`. reason: required-capture invariant.
  return [...match[1]!.matchAll(/:\s*'([A-Z0-9_]+)'/g)].map(([, code]) => code!);
}

describe('extractServerErrorCode', () => {
  it('keeps the duplicated web known-code allowlist in sync with the server enum', () => {
    expect([...KNOWN_SERVER_ERROR_CODES].sort()).toEqual(
      loadServerErrorCodesFromSource().sort()
    );
  });

  it('returns the code from `data.errorCode` (typical tRPC client shape)', () => {
    const error = { data: { errorCode: 'AUTH_INVALID_CREDENTIALS' } };
    expect(extractServerErrorCode(error)).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('returns the code from `shape.data.errorCode` (serialized variants)', () => {
    const error = { shape: { data: { errorCode: 'AUTH_USER_DISABLED' } } };
    expect(extractServerErrorCode(error)).toBe('AUTH_USER_DISABLED');
  });

  it('returns the code from a flat `errorCode` field (test fixtures)', () => {
    const error = { errorCode: 'AUTH_TENANT_DISABLED' };
    expect(extractServerErrorCode(error)).toBe('AUTH_TENANT_DISABLED');
  });

  it('recognizes the auth rate-limit server error code', () => {
    const error = { data: { errorCode: 'AUTH_RATE_LIMIT_EXCEEDED' } };
    expect(extractServerErrorCode(error)).toBe('AUTH_RATE_LIMIT_EXCEEDED');
  });

  it('returns null when the code is unknown / unrecognized', () => {
    expect(extractServerErrorCode({ data: { errorCode: 'NOT_A_REAL_CODE' } })).toBeNull();
  });

  it('recognizes transfer-domain server error codes', () => {
    const error = { data: { errorCode: 'TRANSFER_INSUFFICIENT_STOCK' } };
    expect(extractServerErrorCode(error)).toBe('TRANSFER_INSUFFICIENT_STOCK');
  });

  it('recognizes peripheral registry server error codes', () => {
    const error = { data: { errorCode: 'PERIPHERAL_ACTIVE_DUPLICATE' } };
    expect(extractServerErrorCode(error)).toBe('PERIPHERAL_ACTIVE_DUPLICATE');
  });

  it('returns null when there is no errorCode field anywhere', () => {
    expect(extractServerErrorCode({ data: {} })).toBeNull();
    expect(extractServerErrorCode(new Error('boom'))).toBeNull();
    expect(extractServerErrorCode(null)).toBeNull();
    expect(extractServerErrorCode('string')).toBeNull();
  });
});

describe('translateServerError', () => {
  const fallback = 'Something went wrong (fallback)';

  it('returns the translated message for a known errorCode', () => {
    const t = makeFakeT({
      'errors:server.AUTH_INVALID_CREDENTIALS': 'Correo o contraseña incorrectos.',
    });
    const result = translateServerError(
      { data: { errorCode: 'AUTH_INVALID_CREDENTIALS' }, message: 'Email or password is incorrect' },
      t,
      fallback
    );
    expect(result).toBe('Correo o contraseña incorrectos.');
  });

  it('translates transfer-domain error codes from the errors namespace', () => {
    const t = makeFakeT({
      'errors:server.TRANSFER_INSUFFICIENT_STOCK': 'La sede origen no tiene stock suficiente.',
    });
    const result = translateServerError(
      { data: { errorCode: 'TRANSFER_INSUFFICIENT_STOCK' }, message: 'Insufficient stock at origin site for transfer' },
      t,
      fallback
    );
    expect(result).toBe('La sede origen no tiene stock suficiente.');
  });

  it('translates peripheral registry error codes from the errors namespace', () => {
    const t = makeFakeT({
      'errors:server.PERIPHERAL_ACTIVE_DUPLICATE':
        'Ya hay otro periférico activo de este tipo en esta sede.',
    });
    const result = translateServerError(
      {
        data: { errorCode: 'PERIPHERAL_ACTIVE_DUPLICATE' },
        message: 'Another active peripheral of this kind already exists.',
      },
      t,
      fallback
    );
    expect(result).toBe('Ya hay otro periférico activo de este tipo en esta sede.');
  });

  it('falls back to the server English message when the code is unknown', () => {
    const t = makeFakeT({});
    const error = new Error('Something specific from the server');
    const result = translateServerError(error, t, fallback);
    expect(result).toBe('Something specific from the server');
  });

  it('falls back to the fallback string when neither code nor message is present', () => {
    const t = makeFakeT({});
    expect(translateServerError({}, t, fallback)).toBe(fallback);
    expect(translateServerError(null, t, fallback)).toBe(fallback);
    expect(translateServerError(undefined, t, fallback)).toBe(fallback);
  });

  it('prefers the translated code over the English server message', () => {
    const t = makeFakeT({
      'errors:server.AUTH_USER_DISABLED': 'Tu cuenta ha sido deshabilitada.',
    });
    const error = {
      data: { errorCode: 'AUTH_USER_DISABLED' },
      message: 'Your account has been disabled. Please contact an administrator.',
    };
    expect(translateServerError(error, t, fallback)).toBe(
      'Tu cuenta ha sido deshabilitada.'
    );
  });

  it('translates the new auth rate-limit code instead of showing the raw server message', () => {
    const t = makeFakeT({
      'errors:server.AUTH_RATE_LIMIT_EXCEEDED':
        'Demasiados intentos. Espera un momento y vuelve a intentarlo.',
    });
    const error = {
      data: { errorCode: 'AUTH_RATE_LIMIT_EXCEEDED' },
      message: 'Too many login attempts. Try again in 60 seconds.',
    };

    expect(translateServerError(error, t, fallback)).toBe(
      'Demasiados intentos. Espera un momento y vuelve a intentarlo.'
    );
  });

  it('translates browser fetch failures instead of showing the raw network message', () => {
    const t = makeFakeT({
      'errors:server.networkUnavailable': 'No se pudo alcanzar el servicio de datos.',
    });

    expect(translateServerError(new TypeError('Failed to fetch'), t, fallback)).toBe(
      'No se pudo alcanzar el servicio de datos.'
    );
    expect(translateServerError(new Error('TRPCClientError: Failed to fetch'), t, fallback)).toBe(
      'No se pudo alcanzar el servicio de datos.'
    );
    expect(isNetworkConnectivityError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('detects nested network failures from wrapped tRPC errors', () => {
    const t = makeFakeT({
      'errors:server.networkUnavailable': 'Data service is unavailable.',
    });
    const error = {
      message: 'Unable to complete request',
      cause: new TypeError('Load failed'),
    };

    expect(translateServerError(error, t, fallback)).toBe('Data service is unavailable.');
  });

  it('falls back to the server message when the translation key is missing', () => {
    const t = makeFakeT({});
    const error = {
      data: { errorCode: 'AUTH_USER_DISABLED' },
      message: 'Your account has been disabled. Please contact an administrator.',
    };

    expect(translateServerError(error, t, fallback)).toBe(
      'Your account has been disabled. Please contact an administrator.'
    );
  });

  it('handles object-shaped errors without an Error prototype', () => {
    const t = makeFakeT({});
    const error = { message: 'Plain object error' };
    expect(translateServerError(error, t, fallback)).toBe('Plain object error');
  });

  it('ignores empty / whitespace-only server messages and uses fallback', () => {
    const t = makeFakeT({});
    expect(translateServerError({ message: '   ' }, t, fallback)).toBe(fallback);
    expect(translateServerError(new Error('   '), t, fallback)).toBe(fallback);
  });
});
