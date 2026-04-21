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
});
