/**
 * Workload for the main-thread gate: one cashier sells back to back for the
 * budget window, so the kit measures main while the server is saturated.
 *
 * @module scripts/electron-budget-sales-workload
 */

import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { createSaleWorkload } from './check-electron-main-thread.mjs';

/** The window load event can come before the embedded server listens. */
export async function waitForServer(serverUrl, { timeoutMs = 60_000, fetchImpl = fetch } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await fetchImpl(`${serverUrl}/api/health`)).ok) return;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline)
      throw new Error(`the embedded server never answered at ${serverUrl}`);
    await delay(250);
  }
}

export default async ({ phase }) => {
  const serverUrl = process.env.PUNTOVIVO_BUDGET_SERVER_URL;
  const windowMs = Number(process.env.PUNTOVIVO_BUDGET_WINDOW_MS);
  const minSales = Number(process.env.PUNTOVIVO_BUDGET_MIN_SALES);
  if (!serverUrl || !(windowMs > 0) || !(minSales > 0)) {
    throw new Error(
      'the sales workload needs PUNTOVIVO_BUDGET_SERVER_URL, _WINDOW_MS and _MIN_SALES'
    );
  }
  await waitForServer(serverUrl);
  const workload = createSaleWorkload({ serverUrl });
  await workload.warmUp();
  const startedAt = performance.now();
  const result = await workload.run(() => performance.now() - startedAt >= windowMs);
  console.log(
    `sales (${phase}): ${result.salesInWindow} ok, ${result.failures} failed, ` +
      `HTTP sale p50 ${result.saleLatency.p50} / p95 ${result.saleLatency.p95} ms` +
      (result.firstFailure ? ` (first failure: ${result.firstFailure})` : '')
  );
  // Too few sales means the server was not under load; the window proves nothing.
  if (result.salesInWindow < minSales) {
    throw new Error(
      `only ${result.salesInWindow} sales in the window; at least ${minSales} needed`
    );
  }
};
