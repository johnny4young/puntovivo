/**
 * Workload for the memory gate: fail unless the React root mounted (a Chromium
 * error page would measure a different app), then idle so memory settles.
 *
 * @module scripts/electron-budget-mounted-workload
 */

const IDLE_MS = 2_000;

export default async ({ dispatch, sessionId }) => {
  const mounted = await dispatch('electron_wait_for_selector', {
    sessionId,
    selector: '#root > *',
    timeoutMs: 30_000,
  });
  if (mounted.ok !== true) {
    throw new Error(`the renderer did not mount the app: ${String(mounted.code ?? mounted.error)}`);
  }
  await new Promise(resolve => setTimeout(resolve, IDLE_MS));
};
