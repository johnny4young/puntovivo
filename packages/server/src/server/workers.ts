/**
 * Background worker registration.
 *
 * Creates the outbox/cleanup worker daemons (fiscal, hardware, payment,
 * webhooks, operational alerts, login-attempts, and data-retention) and wires
 * their coordinated onClose teardown. The periodic timers are NOT armed here:
 * createServer's
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
import type { WebhookWorker } from '../services/events/webhook-worker.js';
import { createWebhookWorker } from '../services/events/webhook-worker.js';
import type { OperationalAlertWorker } from '../services/operations/alert-worker.js';
import { createOperationalAlertWorker } from '../services/operations/alert-worker.js';

/** Worker daemon handles createServer's `listen()` starts. */
export interface RegisteredWorkers {
  fiscalWorker: FiscalWorker;
  hardwareWorker: HardwareWorker;
  paymentWorker: PaymentWorker;
  webhookWorker: WebhookWorker;
  operationalAlertWorker: OperationalAlertWorker;
  // `& { start }` mirrors the factory return: the periodic timer is
  // armed by createServer's listen() (the public handle only exposes
  // tickOnce/stop), so the start method must survive on this type.
  loginAttemptsCleanup: LoginAttemptsCleanupHandle & { start: () => void };
  dataRetentionCleanup: DataRetentionCleanupHandle & { start: () => void };
}

/**
 * Build the worker daemons and register one coordinated onClose teardown.
 * Every worker first closes admission and cancels its timer, then the group
 * drains concurrently before Fastify returns control to the database owner.
 */
export function registerWorkers(app: FastifyInstance, db: DatabaseInstance): RegisteredWorkers {
  // Register ownership before constructing the first worker. If a later
  // factory ever throws, createServer's Fastify cleanup still drains every
  // worker already acquired instead of leaking a default singleton or timer.
  const cleanups: Array<[name: string, cleanup: () => void | Promise<void>]> = [];
  app.addHook('onClose', async () => {
    // Withdraw on-demand singleton entry points before stopping the workers so
    // no sale/print hook can admit fresh work during the drain boundary.
    setDefaultFiscalWorker(null);
    setDefaultHardwareWorker(null);

    const results = await Promise.allSettled(
      cleanups.map(async ([, cleanup]) => {
        await cleanup();
      })
    );
    const errors = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [
            new Error(`Worker cleanup failed for ${cleanups[index]?.[0] ?? 'unknown'}.`, {
              cause: result.reason,
            }),
          ]
        : []
    );
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) {
      throw new AggregateError(errors, 'Multiple background worker cleanups failed.', {
        cause: errors[0],
      });
    }
  });

  // boot the fiscal outbox worker daemon. Registered as the
  // default singleton so `safelyEmitFiscalDocument` can fire-and-forget
  // an immediate tick after enqueue without taking a worker reference
  // through every call site. The periodic interval starts on `listen`
  // (below) so test harnesses that build the server without listening
  // do not accumulate background timers.
  const fiscalWorker = createFiscalWorker({ db });
  cleanups.push(['fiscal', () => fiscalWorker.stop()]);
  setDefaultFiscalWorker(fiscalWorker);

  // boot the hardware outbox worker daemon parallel to the
  // fiscal worker. Same boot/teardown pattern; the periodic interval
  // starts on `listen` so test harnesses that build without listening
  // never accumulate background timers.
  const hardwareWorker = createHardwareWorker({ db });
  cleanups.push(['hardware', () => hardwareWorker.stop()]);
  setDefaultHardwareWorker(hardwareWorker);

  // boot the payment worker. v1 ships the housekeeping +
  // statement-import skeleton without a live `fetchStatement` wired —
  // production calls `createPaymentWorker` directly when a real
  // provider client lands, and the test harness injects a stub
  // fixture fetcher. Without `fetchStatement` Timer B + catch-up
  // short-circuit on `skippedReason='fetcher-missing'`.
  const paymentWorker = createPaymentWorker({ db });
  cleanups.push(['payment', () => paymentWorker.stop()]);

  const webhookWorker = createWebhookWorker({ db });
  cleanups.push(['webhook', () => webhookWorker.stop()]);

  const operationalAlertWorker = createOperationalAlertWorker({ db });
  cleanups.push(['operational-alert', () => operationalAlertWorker.stop()]);

  // login_attempts cleanup worker. Same pattern as the
  // outbox workers above: the factory builds the handle, the periodic
  // timer is armed only inside listen(), and onClose releases it.
  const loginAttemptsCleanup = createLoginAttemptsCleanup({ db });
  cleanups.push(['login-attempts', () => loginAttemptsCleanup.stop()]);

  // daily tenant-scoped retention enforcement. The handle
  // owns no timer until listen() starts it, keeping direct-router tests hermetic.
  const dataRetentionCleanup = createDataRetentionCleanup({ db });
  cleanups.push(['data-retention', () => dataRetentionCleanup.stop()]);

  return {
    fiscalWorker,
    hardwareWorker,
    paymentWorker,
    webhookWorker,
    operationalAlertWorker,
    loginAttemptsCleanup,
    dataRetentionCleanup,
  };
}
