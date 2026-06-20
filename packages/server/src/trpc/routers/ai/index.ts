/**
 * ENG-030/031 — AI router.
 *
 * Seven procedure groups:
 * - `ai.settings.get` — current AI configuration + provider availability
 *   + this-month spend.
 * - `ai.settings.update` — partial patch on `tenants.settings.ai`.
 *   Rejects setting `providerId` to a notImplemented stub.
 * - `ai.usage` — paginated audit-log read.
 * - `ai.usageByBreakdown` — group-by report (site / user / feature /
 *   provider) for multi-site cost governance.
 * - `ai.completeTest` — fixed "ping" prompt that exercises the full
 *   pipeline so the operator can validate the env var + provider
 *   round-trip without waiting for ENG-031.
 * - `ai.copilot.chat` — manager/admin conversational analytics over a
 *   bounded tenant-scoped snapshot.
 * - `ai.anomalies.list` — manager/admin local-only anomaly detection
 *   for the dashboard tile.
 *
 * ENG-178 — decomposed into per-concern sub-router modules (settings /
 * copilot / anomalies / invoiceOcr) + a `standalone.ts` flat-procedure record
 * + a `helpers.ts` leaf. This barrel re-assembles the exact original shape so
 * every path (`ai.settings.get` … `ai.completeTest`) is preserved.
 *
 * @module trpc/routers/ai
 */

import { router } from '../../init.js';
import { settingsRouter } from './settings.js';
import { copilotRouter } from './copilot.js';
import { anomaliesRouter } from './anomalies.js';
import { invoiceOcrRouter } from './invoiceOcr.js';
import { standaloneProcedures } from './standalone.js';

export const aiRouter = router({
  settings: settingsRouter,
  copilot: copilotRouter,
  anomalies: anomaliesRouter,
  invoiceOcr: invoiceOcrRouter,
  ...standaloneProcedures,
});
