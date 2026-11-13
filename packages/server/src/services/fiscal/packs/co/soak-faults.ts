/**
 * Provider latency and failures for the desktop soak. Applies only to the
 * mock adapter, and only when the process runs with `PUNTOVIVO_SOAK=1`.
 */
import { setTimeout as delay } from 'node:timers/promises';
import { FiscalProviderError } from '../../errors.js';

function positiveInt(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

let issueCalls = 0;

/** Runs before a mock emission: waits, then fails every Nth call with a recoverable error. */
export async function applySoakFiscalFaults(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (env.PUNTOVIVO_SOAK !== '1') return;
  const latencyMs = positiveInt(env.PUNTOVIVO_SOAK_FISCAL_LATENCY_MS);
  const failEvery = positiveInt(env.PUNTOVIVO_SOAK_FISCAL_FAIL_EVERY);
  if (latencyMs > 0) await delay(latencyMs);
  issueCalls += 1;
  if (failEvery > 0 && issueCalls % failEvery === 0) {
    throw new FiscalProviderError('PROVIDER_5XX', {
      message: 'soak: injected provider failure',
      providerCode: 'SOAK_INJECTED',
    });
  }
}
