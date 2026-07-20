/**
 * Background worker registration.
 *
 * Creates the five outbox/cleanup worker daemons (fiscal, hardware,
 * payment, login-attempts, data-retention) and wires their onClose teardown — plus the
 * rate-limit sweeper teardown — in the exact order createServer ran them
 * inline. The periodic timers are NOT armed here: createServer's
 * `listen()` starts them via the returned handles so a server built
 * without listening (most tests) never accumulates background timers.
 *
 * @module server/workers
 */

import type { FastifyInstance } from 'fastify';
import type { DatabaseInstance } from '../db/index.js';
import type { LoginAttemptsCleanupHandle } from '../services/cleanup/loginAttemptsCleanup.js';
import { createLoginAttemptsCleanup } from '../services/cleanup/loginAttemptsCleanup.js';
import type { DataRetentionCleanupHandle } from '../services/cleanup/dataRetentionCleanup.js';
import { createDataRetentionCleanup } from '../services/cleanup/dataRetentionCleanup.js';
import type { PaymentWorker } from '../services/payments/payment-worker.js';
import { createPaymentWorker } from '../services/payments/payment-worker.js';
import type { HardwareWorker } from '../services/peripherals/hardware-worker.js';
import {
  createHardwareWorker,
  setDefaultHardwareWorker,
} from '../services/peripherals/hardware-worker.js';
import type { FiscalWorker } from '../services/fiscal/fiscal-worker.js';
import { createFiscalWorker, setDefaultFiscalWorker } from '../services/fiscal/fiscal-worker.js';

/** Teardown handles createServer threads into this registration. */
export interface RegisterWorkersOptions {
  /** Releases the procedure rate-limit sweeper timer (created before Fastify). */
  stopRateLimitSweep: () => void;
}

/** The five worker daemon handles createServer's `listen()` starts. */
export interface RegisteredWorkers {
  fiscalWorker: FiscalWorker;
  hardwareWorker: HardwareWorker;
  paymentWorker: PaymentWorker;
  // `& { start }` mirrors the factory return: the periodic timer is
  // armed by createServer's listen() (the public handle only exposes
  // tickOnce/stop), so the start method must survive on this type.
  loginAttemptsCleanup: LoginAttemptsCleanupHandle & { start: () => void };
  dataRetentionCleanup: DataRetentionCleanupHandle & { start: () => void };
}

/**
 * Build the worker daemons + register their onClose teardown on `app`,
 * preserving the inline order (fiscal, rate-limit sweep, hardware,
 * payment, login-cleanup, data-retention). Returns the handles so `listen()` can arm the
 * periodic timers and `close()` runs the onClose chain.
 */
export function registerWorkers(
  app: FastifyInstance,
  db: DatabaseInstance,
  { stopRateLimitSweep }: RegisterWorkersOptions
): RegisteredWorkers {
  // boot the fiscal outbox worker daemon. Registered as the
  // default singleton so `safelyEmitFiscalDocument` can fire-and-forget
  // an immediate tick after enqueue without taking a worker reference
  // through every call site. The periodic interval starts on `listen`
  // (below) so test harnesses that build the server without listening
  // do not accumulate background timers.
  const fiscalWorker = createFiscalWorker({ db });
  setDefaultFiscalWorker(fiscalWorker);
  app.addHook('onClose', async () => {
    await fiscalWorker.stop();
    setDefaultFiscalWorker(null);
  });

  // release the rate-limit sweeper timer on server close so
  // tests do not leak timers when they tear down a server instance.
  app.addHook('onClose', async () => {
    stopRateLimitSweep();
  });

  // boot the hardware outbox worker daemon parallel to the
  // fiscal worker. Same boot/teardown pattern; the periodic interval
  // starts on `listen` so test harnesses that build without listening
  // never accumulate background timers.
  const hardwareWorker = createHardwareWorker({ db });
  setDefaultHardwareWorker(hardwareWorker);
  app.addHook('onClose', async () => {
    await hardwareWorker.stop();
    setDefaultHardwareWorker(null);
  });

  // boot the payment worker. v1 ships the housekeeping +
  // statement-import skeleton without a live `fetchStatement` wired —
  // production calls `createPaymentWorker` directly when a real
  // provider client lands, and the test harness injects a stub
  // fixture fetcher. Without `fetchStatement` Timer B + catch-up
  // short-circuit on `skippedReason='fetcher-missing'`.
  const paymentWorker = createPaymentWorker({ db });
  app.addHook('onClose', async () => {
    await paymentWorker.stop();
  });

  // login_attempts cleanup worker. Same pattern as the
  // outbox workers above: the factory builds the handle, the periodic
  // timer is armed only inside listen(), and onClose releases it.
  const loginAttemptsCleanup = createLoginAttemptsCleanup({ db });
  app.addHook('onClose', async () => {
    loginAttemptsCleanup.stop();
  });

  // daily tenant-scoped retention enforcement. The handle
  // owns no timer until listen() starts it, keeping direct-router tests hermetic.
  const dataRetentionCleanup = createDataRetentionCleanup({ db });
  app.addHook('onClose', async () => {
    await dataRetentionCleanup.stop();
  });

  return {
    fiscalWorker,
    hardwareWorker,
    paymentWorker,
    loginAttemptsCleanup,
    dataRetentionCleanup,
  };
}
