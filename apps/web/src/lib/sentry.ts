/**
 * Sentry / GlitchTip adapter for the renderer-side
 * `RenderTelemetrySink`.
 *
 * This module statically imports `@sentry/browser`, so it IS the
 * lazy chunk: `installRenderTelemetryAdapter()` in
 * `lib/observability.ts` only `import()`s it when
 * `VITE_PUNTOVIVO_SENTRY_DSN` is set, which keeps the eager bundle
 * flat ( bundle budget) and guarantees zero SDK code ships
 * to installs that never configured a DSN.
 *
 * Privacy contract (docs/OBSERVABILITY.md § consent layers): render
 * events are forwarded TENANT-LESS in v1 — `tenantId` is stripped
 * from the context before the SDK sees it. The per-tenant opt-in
 * gate lives server-side and the renderer cannot verify it
 * reliably, so the DSN (operator-level consent) only ever covers
 * tenant-less app diagnostics. Per-tenant attribution of render
 * errors arrives with the opt-in-aware follow-up.
 */

import * as Sentry from '@sentry/browser';
import { registerRenderTelemetrySink, type RenderErrorContext } from './observability';

/**
 * Initialise the browser SDK against the operator-provisioned DSN
 * and register the render sink. Called exactly once per page load by
 * `installRenderTelemetryAdapter()`.
 *
 * `defaultIntegrations: false` is deliberate: the SDK's own global
 * handlers would double-capture what `installGlobalErrorListeners()`
 * already funnels into this sink. `dedupeIntegration` rides along as
 * cheap insurance against the dev-mode React re-throw double-fire.
 */
export function initSentryRenderSink(dsn: string): void {
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    defaultIntegrations: false,
    integrations: [Sentry.dedupeIntegration()],
  });
  registerRenderTelemetrySink({
    captureRenderError(err: unknown, context: RenderErrorContext) {
      // Strip the tenant attribution — see the module doc above.
      const tenantlessContext: Record<string, unknown> = { ...context };
      delete tenantlessContext.tenantId;
      Sentry.captureException(err, {
        extra: tenantlessContext,
        tags: { source: context.source },
      });
    },
  });
}
