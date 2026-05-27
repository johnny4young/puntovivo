/**
 * ENG-006 — unit coverage for `packages/server/src/logging/logger.ts`.
 *
 * Each test spins up a fresh pino instance with the same config as the
 * production `rootLogger` but a custom sink so we can read every
 * emitted record synchronously. We intentionally do not import the
 * module-level `rootLogger` singleton in these tests: the production
 * instance writes to stdout and its level is cached at import time, so
 * env-var overrides have to be observed through a fresh factory per
 * test.
 */

import { describe, expect, it } from 'vitest';
import pino from 'pino';
import { __REDACT_PATHS_FOR_TESTS, createModuleLogger } from '../logging/logger.js';

interface CapturedRecord {
  level: number;
  msg?: string;
  module?: string;
  [key: string]: unknown;
}

/**
 * Returns a fresh pino logger that mirrors the production redact + child
 * config but writes to an in-memory buffer. Avoids flaky test-to-test
 * leaks through the real stdout singleton.
 */
function createCapturingLogger(): {
  logger: pino.Logger;
  records: CapturedRecord[];
} {
  const records: CapturedRecord[] = [];
  const sink = {
    write(chunk: string) {
      records.push(JSON.parse(chunk) as CapturedRecord);
    },
  };
  const logger = pino(
    {
      level: 'trace',
      redact: {
        paths: [...__REDACT_PATHS_FOR_TESTS],
        censor: '[Redacted]',
      },
    },
    sink
  );
  return { logger, records };
}

describe('logger (ENG-006)', () => {
  describe('createModuleLogger', () => {
    it('stamps a stable module field on every record', () => {
      const log = createModuleLogger('sync');
      expect(log.bindings()).toMatchObject({ module: 'sync' });
    });

    it('child bindings compose (module + ad-hoc context)', () => {
      const log = createModuleLogger('sales').child({ tenantId: 't-123' });
      expect(log.bindings()).toMatchObject({ module: 'sales', tenantId: 't-123' });
    });
  });

  describe('redact policy', () => {
    it.each([
      'password',
      'passwordHash',
      'token',
      'refreshToken',
      'jwtSecret',
      'email',
      'authorization',
      'cookie',
    ])('masks top-level %s to [Redacted]', field => {
      const { logger, records } = createCapturingLogger();
      logger.info({ [field]: 'plaintext-secret' }, 'probe');
      expect(records).toHaveLength(1);
      const first = records[0] as CapturedRecord;
      expect(first[field]).toBe('[Redacted]');
    });

    it('masks nested headers.authorization and headers.cookie', () => {
      const { logger, records } = createCapturingLogger();
      logger.info(
        {
          headers: {
            authorization: 'Bearer abc.def.ghi',
            cookie: 'puntovivo_refresh=secret',
            'content-type': 'application/json',
          },
        },
        'incoming request'
      );
      const first = records[0] as CapturedRecord;
      const headers = first.headers as Record<string, string>;
      expect(headers.authorization).toBe('[Redacted]');
      expect(headers.cookie).toBe('[Redacted]');
      // Non-sensitive headers must survive redaction untouched.
      expect(headers['content-type']).toBe('application/json');
    });

    it('masks one-level-deep wildcards (e.g. credentials.password)', () => {
      const { logger, records } = createCapturingLogger();
      logger.info(
        {
          credentials: {
            email: 'user@example.com',
            password: 'plaintext',
            refreshToken: 'tok',
          },
        },
        'seed default admin'
      );
      const creds = (records[0] as CapturedRecord).credentials as Record<string, unknown>;
      expect(creds.email).toBe('[Redacted]');
      expect(creds.password).toBe('[Redacted]');
      expect(creds.refreshToken).toBe('[Redacted]');
    });

    it('leaves non-sensitive siblings untouched', () => {
      const { logger, records } = createCapturingLogger();
      logger.info({ tenantId: 't-99', password: 'plaintext' }, 'probe');
      const first = records[0] as CapturedRecord;
      expect(first.tenantId).toBe('t-99');
      expect(first.password).toBe('[Redacted]');
    });
  });

  describe('REDACT_PATHS surface', () => {
    it('includes every field the ROADMAP + SECURITY.md policy mandates', () => {
      // Lock the surface so adding a new path must come with a plan note.
      for (const required of [
        'password',
        'passwordHash',
        'token',
        'refreshToken',
        'jwtSecret',
        'email',
        'authorization',
        'cookie',
      ]) {
        expect(__REDACT_PATHS_FOR_TESTS).toContain(required);
      }
    });
  });

  // ENG-181 — Error.cause chain redaction. Plain operational context
  // (tenantId, siteId, errorCode, kind) survives so diagnostics keep
  // working; sensitive nested fields get censored.
  describe('ENG-181 — cause chain redaction', () => {
    it('preserves operational context inside cause (tenantId / siteId / errorCode)', () => {
      const { logger, records } = createCapturingLogger();
      logger.error(
        {
          cause: {
            tenantId: 't-acme',
            siteId: 'site-mx-01',
            errorCode: 'FISCAL_TENANT_SETTINGS_MISSING',
            kind: 'cfdi_40',
          },
        },
        'fiscal emit failed'
      );
      const first = records[0] as CapturedRecord;
      const cause = first.cause as Record<string, unknown>;
      expect(cause.tenantId).toBe('t-acme');
      expect(cause.siteId).toBe('site-mx-01');
      expect(cause.errorCode).toBe('FISCAL_TENANT_SETTINGS_MISSING');
      expect(cause.kind).toBe('cfdi_40');
    });

    it.each([
      'password',
      'passwordHash',
      'token',
      'refreshToken',
      'email',
      'jwtSecret',
      'authorization',
    ])('redacts cause.%s when it leaks through', field => {
      const { logger, records } = createCapturingLogger();
      logger.error({ cause: { [field]: 'plaintext-leak', tenantId: 't-ok' } }, 'leak');
      const cause = (records[0] as CapturedRecord).cause as Record<string, unknown>;
      expect(cause[field]).toBe('[Redacted]');
      expect(cause.tenantId).toBe('t-ok');
    });

    it('redacts one-level-deep wildcards under cause (cause.details.password)', () => {
      const { logger, records } = createCapturingLogger();
      logger.error(
        {
          cause: {
            tenantId: 't-99',
            details: {
              password: 'plaintext',
              token: 'tok',
              jwtSecret: 'secret',
              authorization: 'Bearer secret',
              note: 'safe operational text',
            },
          },
        },
        'leak inside cause.details'
      );
      const cause = (records[0] as CapturedRecord).cause as Record<string, unknown>;
      const details = cause.details as Record<string, unknown>;
      expect(cause.tenantId).toBe('t-99');
      expect(details.password).toBe('[Redacted]');
      expect(details.token).toBe('[Redacted]');
      expect(details.jwtSecret).toBe('[Redacted]');
      expect(details.authorization).toBe('[Redacted]');
      expect(details.note).toBe('safe operational text');
    });

    // Note on shape: pino's default error serializer (pino.stdSerializers.err)
    // emits `{ type, message, stack }` and intentionally drops `cause` from
    // Error instances. App code that wants `cause` redaction goes through
    // `logger.error({ cause }, ...)` (Categoría A: ServerErrorWithCode bound
    // to a plain `details` object; Categoría B: helpers wrap a plain object
    // literal under `cause`). Both reach the redact policy as top-level
    // `cause.*` and `cause.*.*` paths — which is what the cases above pin.
  });
});
