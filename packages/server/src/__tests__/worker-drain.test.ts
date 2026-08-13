/** Background workers must drain admitted database work before stop resolves. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { createFiscalWorker, type FiscalWorker } from '../services/fiscal/fiscal-worker.js';
import {
  createHardwareWorker,
  type HardwareWorker,
} from '../services/peripherals/hardware-worker.js';

let server: PuntovivoServer;

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', seedData: false });
});

afterAll(async () => {
  await server.close();
});

async function expectTimerWorkerToDrain(
  createWorker: (tenantIdsProvider: () => Promise<string[]>) => FiscalWorker | HardwareWorker
): Promise<void> {
  let providerStarted!: () => void;
  const started = new Promise<void>(resolve => {
    providerStarted = resolve;
  });
  let releaseProvider!: () => void;
  const providerGate = new Promise<void>(resolve => {
    releaseProvider = resolve;
  });
  const worker = createWorker(async () => {
    providerStarted();
    await providerGate;
    return [];
  });

  worker.start();
  await started;
  let stopResolved = false;
  const stop = worker.stop().then(() => {
    stopResolved = true;
  });
  await Promise.resolve();
  expect(stopResolved).toBe(false);

  releaseProvider();
  await stop;
  expect(stopResolved).toBe(true);
  await expect(worker.tickOnce('after-stop')).resolves.toEqual({ processed: false });
}

describe('background worker drain', () => {
  it('drains the fiscal periodic tenant scan before stop resolves', async () => {
    await expectTimerWorkerToDrain(tenantIdsProvider =>
      createFiscalWorker({ db: getDatabase(), intervalMs: 1, tenantIdsProvider })
    );
  });

  it('drains the hardware periodic tenant scan before stop resolves', async () => {
    await expectTimerWorkerToDrain(tenantIdsProvider =>
      createHardwareWorker({ db: getDatabase(), intervalMs: 1, tenantIdsProvider })
    );
  });
});
