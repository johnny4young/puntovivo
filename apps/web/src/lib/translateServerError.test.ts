import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import enErrors from '../i18n/locales/en/errors.json';
import esErrors from '../i18n/locales/es/errors.json';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  KNOWN_SERVER_ERROR_CODES,
  extractServerErrorCode,
  isNetworkConnectivityError,
  isZodValidationError,
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
  // the server `SERVER_ERROR_CODES` map was split into two domain
  // halves (`errorCodes/codes-a.ts` + `codes-b.ts`) re-assembled in
  // `errorCodes/registry.ts` (`{ ...SERVER_ERROR_CODES_A, ...SERVER_ERROR_CODES_B }`).
  // Read both halves so this web allowlist stays in sync with the full
  // server enum.
  const codes: string[] = [];
  for (const half of ['codes-a', 'codes-b'] as const) {
    const relativePath = `packages/server/src/lib/errorCodes/${half}.ts`;
    const workspaceRelativePath = resolve(process.cwd(), `../../${relativePath}`);
    const rootRelativePath = resolve(process.cwd(), relativePath);
    const path = existsSync(workspaceRelativePath) ? workspaceRelativePath : rootRelativePath;
    const source = readFileSync(path, 'utf8');
    const match = source.match(/export const SERVER_ERROR_CODES_[AB] = \{([\s\S]*?)\n\} as const;/);
    if (!match) {
      throw new Error(`Could not locate SERVER_ERROR_CODES_* in ${relativePath}`);
    }
    // The `if (!match)` guard guarantees match is defined; group 1 is the
    // object body (required by the regex). Each inner match has group 1 as
    // the required `([A-Z0-9_]+)` code capture. `!` narrows for
    // `noUncheckedIndexedAccess`. reason: required-capture invariant.
    codes.push(...[...match[1]!.matchAll(/:\s*'([A-Z0-9_]+)'/g)].map(([, code]) => code!));
  }
  return codes;
}

describe('extractServerErrorCode', () => {
  it('keeps the duplicated web known-code allowlist in sync with the server enum', () => {
    expect([...KNOWN_SERVER_ERROR_CODES].sort()).toEqual(loadServerErrorCodesFromSource().sort());
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

  it('recognizes the optimistic-concurrency STALE_VERSION code', () => {
    // The catalog pages branch on this code to refetch the stale list.
    const error = { data: { errorCode: 'STALE_VERSION' } };
    expect(extractServerErrorCode(error)).toBe('STALE_VERSION');
  });

  it('recognizes normalized return and store-credit error codes', () => {
    expect(
      extractServerErrorCode({ data: { errorCode: 'SALE_RETURN_TAX_COMPONENT_MISMATCH' } })
    ).toBe('SALE_RETURN_TAX_COMPONENT_MISMATCH');
    expect(
      extractServerErrorCode({ data: { errorCode: 'SALE_RETURN_LOT_TRACKING_CHANGED' } })
    ).toBe('SALE_RETURN_LOT_TRACKING_CHANGED');
    expect(
      extractServerErrorCode({ data: { errorCode: 'SALE_RETURN_SERIAL_TRACKING_CHANGED' } })
    ).toBe('SALE_RETURN_SERIAL_TRACKING_CHANGED');
    expect(extractServerErrorCode({ data: { errorCode: 'STORE_CREDIT_BALANCE_CHANGED' } })).toBe(
      'STORE_CREDIT_BALANCE_CHANGED'
    );
    expect(
      extractServerErrorCode({ data: { errorCode: 'SALE_PAYMENT_STATUS_RETURN_MANAGED' } })
    ).toBe('SALE_PAYMENT_STATUS_RETURN_MANAGED');
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
      {
        data: { errorCode: 'AUTH_INVALID_CREDENTIALS' },
        message: 'Email or password is incorrect',
      },
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
      {
        data: { errorCode: 'TRANSFER_INSUFFICIENT_STOCK' },
        message: 'Insufficient stock at origin site for transfer',
      },
      t,
      fallback
    );
    expect(result).toBe('La sede origen no tiene stock suficiente.');
  });

  it('translates inventory-count and order-draft codes from the lazy controls namespace', () => {
    const t = makeFakeT({
      'inventoryControls:server.INVENTORY_COUNT_BALANCE_CHANGED':
        'El stock cambió después de iniciar el conteo.',
      'inventoryControls:server.INVENTORY_COUNT_CATALOG_CHANGED':
        'El producto o su unidad base cambió.',
      'inventoryControls:server.ORDER_DRAFT_INVALID_STATUS':
        'Solo puedes enviar un borrador de orden de compra.',
    });

    expect(
      translateServerError({ data: { errorCode: 'INVENTORY_COUNT_BALANCE_CHANGED' } }, t, fallback)
    ).toBe('El stock cambió después de iniciar el conteo.');
    expect(
      translateServerError({ data: { errorCode: 'INVENTORY_COUNT_CATALOG_CHANGED' } }, t, fallback)
    ).toBe('El producto o su unidad base cambió.');
    expect(
      translateServerError({ data: { errorCode: 'ORDER_DRAFT_INVALID_STATUS' } }, t, fallback)
    ).toBe('Solo puedes enviar un borrador de orden de compra.');
  });

  it('translates quotation and supplier-payable codes from the lazy domain namespace', () => {
    const t = makeFakeT({
      'quotationPayablesErrors:server.QUOTATION_ALREADY_CONVERTED':
        'Esta cotización ya está vinculada a una venta.',
      'quotationPayablesErrors:server.PROVIDER_PAYABLE_DOCUMENT_DUPLICATE':
        'Este documento del proveedor ya existe.',
    });

    expect(
      translateServerError({ data: { errorCode: 'QUOTATION_ALREADY_CONVERTED' } }, t, fallback)
    ).toBe('Esta cotización ya está vinculada a una venta.');
    expect(
      translateServerError(
        { data: { errorCode: 'PROVIDER_PAYABLE_DOCUMENT_DUPLICATE' } },
        t,
        fallback
      )
    ).toBe('Este documento del proveedor ya existe.');
  });

  it('translates return, exchange, and store-credit codes from the lazy domain namespace', () => {
    const t = makeFakeT({
      'returnErrors:server.SALE_RETURN_CHANGED':
        'La venta cambió mientras la devolución estaba abierta.',
      'returnErrors:server.SALE_EXCHANGE_ALREADY_LINKED':
        'Esta devolución ya tiene una venta de cambio.',
      'returnErrors:server.STORE_CREDIT_BALANCE_CHANGED': 'El saldo del crédito a favor cambió.',
    });

    expect(translateServerError({ data: { errorCode: 'SALE_RETURN_CHANGED' } }, t, fallback)).toBe(
      'La venta cambió mientras la devolución estaba abierta.'
    );
    expect(
      translateServerError({ data: { errorCode: 'SALE_EXCHANGE_ALREADY_LINKED' } }, t, fallback)
    ).toBe('Esta devolución ya tiene una venta de cambio.');
    expect(
      translateServerError({ data: { errorCode: 'STORE_CREDIT_BALANCE_CHANGED' } }, t, fallback)
    ).toBe('El saldo del crédito a favor cambió.');
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

  it('translates the STALE_VERSION optimistic-concurrency code', () => {
    const t = makeFakeT({
      'errors:server.STALE_VERSION':
        'Otro usuario modificó este registro mientras lo editabas. Recarga para ver la versión más reciente e intenta de nuevo.',
    });
    const result = translateServerError(
      {
        data: { errorCode: 'STALE_VERSION' },
        message: 'Stale customer version: no row matched version 0',
      },
      t,
      fallback
    );
    expect(result).toBe(
      'Otro usuario modificó este registro mientras lo editabas. Recarga para ver la versión más reciente e intenta de nuevo.'
    );
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
    expect(translateServerError(error, t, fallback)).toBe('Tu cuenta ha sido deshabilitada.');
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

  it('hides native SQLite lock text behind the critical-command retry copy', () => {
    const t = makeFakeT({
      'errors:server.COMMAND_DATABASE_BUSY': 'Vuelve a intentarlo.',
    });
    const result = translateServerError(
      {
        data: { errorCode: 'COMMAND_DATABASE_BUSY' },
        message: 'SqliteError: database is locked',
      },
      t,
      fallback
    );

    expect(result).toBe('Vuelve a intentarlo.');
    expect(result).not.toContain('database is locked');
  });

  it('never exposes an unclassified internal tRPC or SQLite message', () => {
    const t = makeFakeT({});
    const result = translateServerError(
      {
        data: { code: 'INTERNAL_SERVER_ERROR' },
        message: 'SqliteError: no such column provider_payable_invoices.secret',
      },
      t,
      fallback
    );

    expect(result).toBe(fallback);
    expect(result).not.toContain('SqliteError');
    expect(result).not.toContain('provider_payable_invoices');
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

  describe('Zod validation errors never leak raw JSON to the user', () => {
    // The exact shape observed in the desktop smoke: products.create without a
    // unit returns a BAD_REQUEST whose message is the stringified Zod issues.
    const zodIssuesMessage = JSON.stringify([
      {
        origin: 'string',
        code: 'too_small',
        minimum: 1,
        inclusive: true,
        path: ['unitAssignments', 0, 'unitId'],
        message: 'Unit is required',
      },
    ]);

    it('detects a stringified Zod issues array as a validation error', () => {
      expect(
        isZodValidationError({ data: { code: 'BAD_REQUEST' }, message: zodIssuesMessage })
      ).toBe(true);
      // message alone (no data) still classifies via the parsed shape.
      expect(isZodValidationError({ message: zodIssuesMessage })).toBe(true);
    });

    it('detects the structured data.zodError signal regardless of the message text', () => {
      // The server errorFormatter attaches cause.flatten() as data.zodError
      // (trpc/init.ts) — the durable signal even if message serialization
      // changes shape in a future tRPC version.
      expect(
        isZodValidationError({
          data: {
            code: 'BAD_REQUEST',
            zodError: { formErrors: [], fieldErrors: { unitId: ['Unit is required'] } },
          },
          message: 'whatever shape the client renders',
        })
      ).toBe(true);
      // null zodError (non-Zod BAD_REQUEST) does NOT classify via this signal.
      expect(
        isZodValidationError({
          data: { code: 'BAD_REQUEST', zodError: null },
          message: 'Sale is already voided',
        })
      ).toBe(false);
    });

    it('does NOT misclassify a normal message that merely starts with "["', () => {
      expect(isZodValidationError({ message: '[Demo] Could not save the product' })).toBe(false);
      expect(isZodValidationError({ message: 'Sale is already voided' })).toBe(false);
    });

    it('translates the Zod array to the localized validationFailed message, not the raw JSON', () => {
      const t = makeFakeT({
        'errors:server.validationFailed':
          'Hay campos vacíos o con datos inválidos. Revisa los campos marcados.',
      });
      const error = { data: { code: 'BAD_REQUEST' }, message: zodIssuesMessage };
      const result = translateServerError(error, t, fallback);
      expect(result).toBe('Hay campos vacíos o con datos inválidos. Revisa los campos marcados.');
      expect(result).not.toContain('too_small');
      expect(result).not.toContain('unitAssignments');
    });

    it('still prefers a stable errorCode over the validation fallback when both are present', () => {
      const t = makeFakeT({
        'errors:server.SALE_PAYMENTS_SUM_MISMATCH': 'Payments do not add up.',
        'errors:server.validationFailed': 'Check the fields.',
      });
      const error = {
        data: { code: 'BAD_REQUEST', errorCode: 'SALE_PAYMENTS_SUM_MISMATCH' },
        message: zodIssuesMessage,
      };
      expect(translateServerError(error, t, fallback)).toBe('Payments do not add up.');
    });
  });
});

/**
 * Renders against the SHIPPED locale files with real interpolation, so these
 * assertions fail when the copy and the supplied values drift apart. The
 * fake `t` above deliberately ignores params, which is why it cannot catch
 * the defect this block exists for.
 */
function makeInterpolatingT(bundle: Record<string, unknown>): TFunction {
  return ((key: string, params?: Record<string, unknown>): string => {
    const prefix = 'errors:server.';
    if (!key.startsWith(prefix)) return key;
    const value = (bundle.server as Record<string, unknown> | undefined)?.[
      key.slice(prefix.length)
    ];
    if (typeof value !== 'string') return key;
    return value.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
      params && name in params ? String(params[name]) : whole
    );
  }) as unknown as TFunction;
}

/** Every server key whose copy carries at least one placeholder. */
function placeholderKeys(bundle: Record<string, unknown>): [string, string][] {
  const server = (bundle.server ?? {}) as Record<string, unknown>;
  return Object.entries(server).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string' && /\{\{/.test(entry[1])
  );
}

describe('desktop session rejections map to localized copy', () => {
  const fallback = 'Something went wrong.';
  it.each([
    ['en', enErrors, 'Your session is no longer active on this device. Sign in again and retry.'],
    [
      'es',
      esErrors,
      'Tu sesión ya no está activa en este equipo. Inicia sesión de nuevo y vuelve a intentarlo.',
    ],
  ] as const)(
    'uses the real %s copy without leaking invoke internals',
    (_locale, bundle, expected) => {
      const result = translateServerError(
        new Error(
          "Error invoking remote method 'update-tray-settings': Error: SESSION_NOT_REGISTERED"
        ),
        makeInterpolatingT(bundle as Record<string, unknown>),
        fallback
      );

      expect(result).toBe(expected);
      expect(result).not.toMatch(/Error invoking remote method|SESSION_NOT_REGISTERED/);
    }
  );

  it('maps the Electron-wrapped SESSION_NOT_REGISTERED to the re-login nudge', () => {
    const t = makeFakeT({
      'errors:server.desktopSessionRequired':
        'Tu sesión ya no está activa en este equipo. Inicia sesión de nuevo y vuelve a intentarlo.',
    });
    const error = new Error(
      "Error invoking remote method 'update-tray-settings': Error: SESSION_NOT_REGISTERED"
    );
    const result = translateServerError(error, t, fallback);
    expect(result).toBe(
      'Tu sesión ya no está activa en este equipo. Inicia sesión de nuevo y vuelve a intentarlo.'
    );
    expect(result).not.toContain('SESSION_NOT_REGISTERED');
  });

  it('maps the bounded preload SESSION_NOT_REGISTERED without an Electron wrapper', () => {
    const t = makeFakeT({
      'errors:server.desktopSessionRequired': 'Sign in again and retry.',
    });
    expect(translateServerError(new Error('SESSION_NOT_REGISTERED'), t, fallback)).toBe(
      'Sign in again and retry.'
    );
  });

  it('maps SESSION_ROLE_FORBIDDEN to role copy, not the re-login nudge', () => {
    const t = makeFakeT({
      'errors:server.desktopSessionRequired': 'Sign in again and retry.',
      'errors:server.desktopRoleForbidden': 'Ask an administrator to perform it.',
    });
    const error = new Error(
      "Error invoking remote method 'rotate-db-encryption-key': Error: SESSION_ROLE_FORBIDDEN"
    );
    expect(translateServerError(error, t, fallback)).toBe('Ask an administrator to perform it.');
  });

  it('never maps a server error that merely quotes the token', () => {
    const t = makeFakeT({
      'errors:server.desktopSessionRequired': 'Sign in again and retry.',
    });
    // Neither an exact preload code nor Electron's wrapper: parsing must not fire.
    const error = new Error('audit note mentions SESSION_NOT_REGISTERED in payload');
    expect(translateServerError(error, t, fallback)).toBe(
      'audit note mentions SESSION_NOT_REGISTERED in payload'
    );
  });
});

describe('server error copy never reaches the operator with raw placeholders', () => {
  const fallback = 'Something went wrong';
  const locales: [string, Record<string, unknown>][] = [
    ['en', enErrors as Record<string, unknown>],
    ['es', esErrors as Record<string, unknown>],
  ];

  it('interpolates the insufficient-stock values a cashier needs to act on', () => {
    const error = {
      data: {
        code: 'CONFLICT',
        errorCode: 'SALE_INSUFFICIENT_STOCK',
        errorDetails: { productName: 'Arepa de queso', available: 2, requested: 5 },
      },
    };
    const result = translateServerError(error, makeInterpolatingT(enErrors as never), fallback);
    expect(result).toContain('Arepa de queso');
    expect(result).toContain('2');
    expect(result).toContain('5');
    expect(result).not.toContain('{{');
  });

  // The class guard: any future key that gains a placeholder is covered the
  // moment it is added, in both locales.
  for (const [locale, bundle] of locales) {
    it(`renders every ${locale} placeholder key without a leftover template`, () => {
      const keys = placeholderKeys(bundle);
      expect(keys.length, 'this guard is pointless if no key has placeholders').toBeGreaterThan(0);

      for (const [code, copy] of keys) {
        const details = Object.fromEntries(
          [...copy.matchAll(/\{\{(\w+)\}\}/g)].map(match => [match[1], `value-${match[1]}`])
        );
        const result = translateServerError(
          { data: { errorCode: code, errorDetails: details } },
          makeInterpolatingT(bundle),
          fallback
        );
        expect(result, `${locale}:${code} left a placeholder`).not.toContain('{{');
      }
    });
  }

  it('falls back rather than showing a template when the server omits the values', () => {
    const error = {
      data: { code: 'CONFLICT', errorCode: 'SALE_INSUFFICIENT_STOCK' },
      message: 'Insufficient stock for product "Arepa" at the active site.',
    };
    const result = translateServerError(error, makeInterpolatingT(enErrors as never), fallback);
    expect(result).not.toContain('{{');
    expect(result).toBe('Insufficient stock for product "Arepa" at the active site.');
  });
});
