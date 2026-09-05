import {
  configureExternalOrderSecretKey,
  hasExternalOrderSecretKey,
} from '../services/external-orders/secret-box.js';
/** Server bootstrap ownership and failure-cleanup regressions. */
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearActiveRuntimeConfig, getActiveRuntimeConfig } from '../config/runtime.js';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import { createServer } from '../index.js';
import {
  configureWebhookSecretKey,
  hasWebhookSecretKey,
  openWebhookSecret,
  sealWebhookSecret,
} from '../services/events/secret-box.js';
import {
  configurePharmacyEvidenceKey,
  hasPharmacyEvidenceKey,
  openPharmacyEvidence,
  sealPharmacyEvidence,
} from '../services/pharmacy/evidence-box.js';

const runtime = {
  authorityMode: 'device_local' as const,
  bindHost: '127.0.0.1',
  bindPort: 0,
  hubUrl: null,
  siteId: 'bootstrap-lifecycle-probe',
  deviceId: null,
  allowedLanOrigins: [],
};

afterEach(() => {
  closeDatabase();
  configureWebhookSecretKey(undefined);
  configureExternalOrderSecretKey(undefined);
  configurePharmacyEvidenceKey(undefined);
  clearActiveRuntimeConfig();
});

describe('createServer lifecycle ownership', () => {
  it('releases database and process-wide boot state on normal close', async () => {
    const server = await createServer({
      dbPath: ':memory:',
      seedData: false,
      webhookSecretKey: 'bootstrap-secret',
      runtime,
    });

    expect(getDatabase()).toBe(server.db);
    expect(hasWebhookSecretKey()).toBe(true);
    expect(hasExternalOrderSecretKey()).toBe(true);
    expect(hasPharmacyEvidenceKey()).toBe(true);
    expect(getActiveRuntimeConfig().siteId).toBe(runtime.siteId);

    await server.close();
    await server.close();

    expect(() => getDatabase()).toThrow(/not initialized/i);
    expect(hasWebhookSecretKey()).toBe(false);
    expect(hasExternalOrderSecretKey()).toBe(false);
    expect(hasPharmacyEvidenceKey()).toBe(false);
    expect(getActiveRuntimeConfig().siteId).toBeNull();
  });

  it('does not close SQLite until the registered worker group drains', async () => {
    const server = await createServer({
      dbPath: ':memory:',
      seedData: false,
      runtime,
    });
    const originalStop = server.fiscalWorker.stop.bind(server.fiscalWorker);
    let drainStarted!: () => void;
    const started = new Promise<void>(resolve => {
      drainStarted = resolve;
    });
    let releaseDrain!: () => void;
    const drainGate = new Promise<void>(resolve => {
      releaseDrain = resolve;
    });
    server.fiscalWorker.stop = async () => {
      drainStarted();
      await drainGate;
      await originalStop();
    };

    const closing = server.close();
    await started;
    try {
      expect(getDatabase()).toBe(server.db);
    } finally {
      releaseDrain();
    }
    await closing;
    expect(() => getDatabase()).toThrow(/not initialized/i);
  });

  it('attempts every worker cleanup when one worker stop fails', async () => {
    const server = await createServer({
      dbPath: ':memory:',
      seedData: false,
      runtime,
    });
    let hardwareStopped = false;
    const originalHardwareStop = server.hardwareWorker.stop.bind(server.hardwareWorker);
    server.fiscalWorker.stop = async () => {
      throw new Error('forced fiscal stop failure');
    };
    server.hardwareWorker.stop = async () => {
      hardwareStopped = true;
      await originalHardwareStop();
    };

    const closeError = await server.close().catch(error => error);
    expect(closeError).toBeInstanceOf(Error);
    expect((closeError as Error).message).toMatch(/Fastify application/i);
    expect((closeError as Error).cause).toBeInstanceOf(Error);
    expect(((closeError as Error).cause as Error).message).toMatch(/fiscal/i);
    expect(hardwareStopped).toBe(true);
    expect(() => getDatabase()).toThrow(/not initialized/i);
  });

  it('cleans every acquired resource when bootstrap fails after database init', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-server-bootstrap-'));
    const dbPath = join(dir, 'broken-login-cache.db');
    try {
      const prepared = await initDatabase({ dbPath, seedData: false });
      const client = (prepared as unknown as { $client: { exec(sql: string): void } }).$client;
      client.exec('DROP TABLE login_attempts');
      client.exec(
        'CREATE TABLE login_attempts (' +
          'kind TEXT NOT NULL, ' +
          'key TEXT NOT NULL, ' +
          'count INTEGER NOT NULL, ' +
          'first_at INTEGER NOT NULL, ' +
          'PRIMARY KEY (kind, key))'
      );
      closeDatabase();

      await expect(
        createServer({
          dbPath,
          seedData: false,
          webhookSecretKey: 'bootstrap-secret',
          runtime,
        })
      ).rejects.toThrow(/expires_at|no such column/i);

      expect(() => getDatabase()).toThrow(/not initialized/i);
      expect(hasWebhookSecretKey()).toBe(false);
      expect(hasExternalOrderSecretKey()).toBe(false);
      expect(hasPharmacyEvidenceKey()).toBe(false);
      expect(getActiveRuntimeConfig().siteId).toBeNull();

      // The failed server relinquished the singleton and native file handle;
      // an explicit repair/inspection boot can own the same file immediately.
      await initDatabase({ dbPath, runMigrations: false, seedData: false });
      closeDatabase();
    } finally {
      closeDatabase();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not clobber an active server when a duplicate boot is rejected', async () => {
    const activeRuntime = { ...runtime, siteId: 'active-server' };
    const active = await createServer({
      dbPath: ':memory:',
      seedData: false,
      webhookSecretKey: 'active-secret',
      runtime: activeRuntime,
    });
    const sealedByActiveServer = sealWebhookSecret('custody-proof');
    const evidenceContext = {
      purpose: 'prescription' as const,
      tenantId: 'active-tenant',
      subjectId: 'active-evidence',
    };
    const sealedEvidenceByActiveServer = sealPharmacyEvidence(
      { reference: 'RX-ACTIVE' },
      evidenceContext
    );

    try {
      await expect(
        createServer({
          dbPath: ':memory:',
          seedData: false,
          webhookSecretKey: 'refused-secret',
          runtime: { ...runtime, siteId: 'refused-server' },
        })
      ).rejects.toThrow(/already initialized|already in progress/i);

      expect(getDatabase()).toBe(active.db);
      expect(getActiveRuntimeConfig().siteId).toBe(activeRuntime.siteId);
      expect(openWebhookSecret(sealedByActiveServer)).toBe('custody-proof');
      expect(openPharmacyEvidence(sealedEvidenceByActiveServer, evidenceContext)).toEqual({
        reference: 'RX-ACTIVE',
      });
    } finally {
      await active.close();
    }
  });

  it('cleans the server when its requested port is already occupied', async () => {
    const blocker = createNetServer();
    await new Promise<void>((resolve, reject) => {
      blocker.once('error', reject);
      blocker.listen(0, '127.0.0.1', resolve);
    });
    const address = blocker.address();
    if (!address || typeof address === 'string') {
      blocker.close();
      throw new Error('Expected the port blocker to expose a TCP address.');
    }

    try {
      const server = await createServer({
        dbPath: ':memory:',
        seedData: false,
        webhookSecretKey: 'bootstrap-secret',
        runtime: { ...runtime, bindPort: address.port },
      });

      await expect(server.listen()).rejects.toHaveProperty('code', 'EADDRINUSE');

      expect(() => getDatabase()).toThrow(/not initialized/i);
      expect(hasWebhookSecretKey()).toBe(false);
      expect(hasExternalOrderSecretKey()).toBe(false);
      expect(hasPharmacyEvidenceKey()).toBe(false);
      expect(getActiveRuntimeConfig().siteId).toBeNull();
    } finally {
      await new Promise<void>((resolve, reject) => {
        blocker.close(error => (error ? reject(error) : resolve()));
      });
    }
  });
});
